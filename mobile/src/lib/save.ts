import { File } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import { MediaTools } from '../../modules/media-tools';
import { addEntry, newId, tempDir, thumbsDir, uniqueFile, type Entry, type EntryKind } from './library';
import { extFromUrl } from './net';
import { GrabError, type MediaInfo, type MediaItem, type Stream, type VideoVariant } from './types';

export type Progress = { fraction: number | null; label: string };
type OnProgress = (p: Progress) => void;
export type SaveMode = 'video' | 'audio' | 'image';

export type SaveResult = { entry: Entry; inPhotos: boolean; photosDenied: boolean };

/** Picks the best quality at or below the requested height (null = best available). */
export function pickVariant(variants: VideoVariant[], height: number | null): VideoVariant {
  if (!height) return variants[0];
  return variants.find((v) => v.height > 0 && v.height <= height) ?? variants[variants.length - 1];
}

async function download(stream: Stream, file: File, onFraction: (f: number | null) => void, signal?: AbortSignal) {
  try {
    await File.downloadFileAsync(stream.url, file, {
      headers: stream.headers,
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : (stream.size ?? 0);
        onFraction(total > 0 ? Math.min(1, bytesWritten / total) : null);
      },
    });
  } catch (err) {
    if (signal?.aborted) throw new GrabError('cancelled', 'Cancelled.');
    throw new GrabError('blocked', 'The site stopped the download. Try again, or pick a lower quality.', String(err));
  }
  // An error page saved as a "video" is tiny; catch that here instead of failing later in Photos.
  if (!file.exists || file.size < 2048) {
    if (file.exists) file.delete();
    throw new GrabError('blocked', 'The site refused to hand over the file. Try again in a minute.');
  }
}

async function withNativeProgress<T>(jobId: string, onFraction: (f: number) => void, run: () => Promise<T>): Promise<T> {
  const sub = MediaTools?.addListener('onProgress', (e) => {
    if (e.jobId === jobId) onFraction(e.progress);
  });
  try {
    return await run();
  } finally {
    sub?.remove();
  }
}

function requireTools() {
  if (!MediaTools) throw new GrabError('failed', 'This feature needs the full GrabIt app (it isn’t available in Expo Go).');
  return MediaTools;
}

async function makeThumb(id: string, item: MediaItem | null, file: File, kind: EntryKind): Promise<string | undefined> {
  const name = `${id}.jpg`;
  const target = new File(thumbsDir(), name);
  try {
    if (kind === 'image') {
      file.copy(target);
      return name;
    }
    if (kind !== 'audio' && MediaTools) {
      await MediaTools.thumbnail(file.uri, target.uri, 400);
      return name;
    }
    if (item?.thumbnail) {
      await File.downloadFileAsync(item.thumbnail, target, { headers: item.thumbnailHeaders, idempotent: true });
      return name;
    }
  } catch {
    // A missing thumbnail isn't worth failing the save for.
  }
  return undefined;
}

export async function saveToPhotos(file: File): Promise<{ ok: boolean; denied: boolean }> {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) return { ok: false, denied: true };
  try {
    await Asset.create(file.uri);
    return { ok: true, denied: false };
  } catch {
    return { ok: false, denied: false };
  }
}

export async function saveItem(
  info: MediaInfo,
  item: MediaItem,
  mode: SaveMode,
  height: number | null,
  onProgress: OnProgress,
  signal?: AbortSignal,
  titleSuffix = ''
): Promise<SaveResult> {
  const id = newId();
  const title = `${info.title}${titleSuffix}`;
  const temps: File[] = [];
  let output: File;
  let kind: EntryKind;

  try {
    if (mode === 'image') {
      if (!item.image) throw new GrabError('failed', 'This item has no photo to save.');
      kind = 'image';
      output = uniqueFile(title, extFromUrl(item.image.url, item.image.ext).replace('jpeg', 'jpg'));
      onProgress({ fraction: 0, label: 'Downloading photo…' });
      await download(item.image, output, (f) => onProgress({ fraction: f, label: 'Downloading photo…' }), signal);
    } else if (mode === 'audio') {
      kind = 'audio';
      if (item.audio && /^(m4a|mp3|aac)$/.test(extFromUrl(item.audio.url, item.audio.ext))) {
        output = uniqueFile(title, extFromUrl(item.audio.url, item.audio.ext));
        onProgress({ fraction: 0, label: 'Downloading sound…' });
        await download(item.audio, output, (f) => onProgress({ fraction: f, label: 'Downloading sound…' }), signal);
      } else {
        // No separate audio file: download the smallest video and pull the sound out on the phone.
        const tools = requireTools();
        const source = item.audio
          ? { video: item.audio, height: 0 }
          : item.variants?.length
            ? item.variants[item.variants.length - 1]
            : null;
        if (!source) throw new GrabError('failed', 'This item has no sound to save.');
        const temp = new File(tempDir(), `${id}-src.${source.video.ext}`);
        temps.push(temp);
        onProgress({ fraction: 0, label: 'Downloading…' });
        await download(source.video, temp, (f) => onProgress({ fraction: f === null ? null : f * 0.85, label: 'Downloading…' }), signal);
        output = uniqueFile(title, 'm4a');
        const jobId = `${id}-audio`;
        await withNativeProgress(
          jobId,
          (f) => onProgress({ fraction: 0.85 + f * 0.15, label: 'Taking out the sound…' }),
          () => tools.convert(temp.uri, output.uri, { output: 'm4a', jobId })
        );
      }
    } else {
      if (!item.variants?.length) throw new GrabError('failed', 'This item has no video to save.');
      kind = 'video';
      const variant = pickVariant(item.variants, height);
      output = uniqueFile(title, 'mp4');

      if (variant.audio) {
        // Picture and sound come separately at HD; download both, then join them on the phone.
        const tools = requireTools();
        const vSize = variant.video.size ?? 0;
        const aSize = variant.audio.size ?? 0;
        const vShare = vSize && aSize ? (vSize / (vSize + aSize)) * 0.95 : 0.8;
        const videoTemp = new File(tempDir(), `${id}-v.mp4`);
        const audioTemp = new File(tempDir(), `${id}-a.m4a`);
        temps.push(videoTemp, audioTemp);

        onProgress({ fraction: 0, label: 'Downloading video…' });
        await download(variant.video, videoTemp, (f) => onProgress({ fraction: f === null ? null : f * vShare, label: 'Downloading video…' }), signal);
        await download(
          variant.audio,
          audioTemp,
          (f) => onProgress({ fraction: f === null ? null : vShare + f * (0.95 - vShare), label: 'Downloading sound…' }),
          signal
        );
        const jobId = `${id}-merge`;
        await withNativeProgress(
          jobId,
          (f) => onProgress({ fraction: 0.95 + f * 0.05, label: 'Joining video and sound…' }),
          () => tools.merge(videoTemp.uri, audioTemp.uri, output.uri, jobId)
        );
      } else {
        onProgress({ fraction: 0, label: 'Downloading video…' });
        await download(variant.video, output, (f) => onProgress({ fraction: f, label: 'Downloading video…' }), signal);
      }
    }
  } finally {
    temps.forEach((t) => {
      try {
        if (t.exists) t.delete();
      } catch {}
    });
  }

  let inPhotos = false;
  let photosDenied = false;
  if (kind === 'video' || kind === 'image') {
    onProgress({ fraction: 1, label: 'Saving to Photos…' });
    const result = await saveToPhotos(output);
    inPhotos = result.ok;
    photosDenied = result.denied;
  }

  const thumb = await makeThumb(id, item, output, kind);
  let duration = item.duration ?? info.duration;
  if (!duration && kind !== 'image' && MediaTools) {
    duration = (await MediaTools.probe(output.uri).catch(() => null))?.duration;
  }
  const entry: Entry = {
    id,
    title,
    kind,
    file: output.name,
    thumb,
    size: output.size,
    duration,
    createdAt: Date.now(),
    siteName: info.siteName,
    source: info.url,
    inPhotos,
  };
  addEntry(entry);
  return { entry, inPhotos, photosDenied };
}
