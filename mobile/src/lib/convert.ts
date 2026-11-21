import { File } from 'expo-file-system';

import { MediaTools, type ConvertOptions } from '../../modules/media-tools';
import { addEntry, newId, thumbsDir, uniqueFile, type Entry } from './library';
import { saveToPhotos } from './save';
import { GrabError, toGrabError } from './types';

export type ConvertTarget = 'video' | 'audio' | 'gif';

export type ConvertChoice = {
  target: ConvertTarget;
  /** 0 = keep the original size. */
  maxHeight: number;
  gifSize: number;
  mute: boolean;
  start: number;
  end: number;
};

export async function convertFile(
  source: { uri: string; name: string },
  choice: ConvertChoice,
  onProgress: (fraction: number) => void
): Promise<{ entry: Entry; inPhotos: boolean; photosDenied: boolean }> {
  if (!MediaTools) throw new GrabError('failed', 'Converting needs the full GrabIt app (it isn’t available in Expo Go).');

  const id = newId();
  const stem = source.name.replace(/\.[^.]+$/, '') || 'Converted';
  const ext = choice.target === 'audio' ? 'm4a' : choice.target === 'gif' ? 'gif' : 'mp4';
  const output = uniqueFile(stem, ext);
  const options: ConvertOptions = {
    output: ext as ConvertOptions['output'],
    maxHeight: choice.maxHeight,
    gifSize: choice.gifSize,
    gifFps: 12,
    mute: choice.mute,
    start: choice.start,
    end: choice.end,
    jobId: id,
  };

  const sub = MediaTools.addListener('onProgress', (e) => {
    if (e.jobId === id) onProgress(e.progress);
  });
  try {
    await MediaTools.convert(source.uri, output.uri, options);
  } catch (err) {
    if (output.exists) output.delete();
    throw toGrabError(err);
  } finally {
    sub.remove();
  }

  let inPhotos = false;
  let photosDenied = false;
  if (choice.target !== 'audio') {
    const result = await saveToPhotos(output);
    inPhotos = result.ok;
    photosDenied = result.denied;
  }

  let thumb: string | undefined;
  if (choice.target !== 'audio') {
    try {
      const target = new File(thumbsDir(), `${id}.jpg`);
      await MediaTools.thumbnail(output.uri, target.uri, 400);
      thumb = target.name;
    } catch {}
  }
  const probe = await MediaTools.probe(output.uri).catch(() => null);
  const entry: Entry = {
    id,
    title: stem,
    kind: choice.target === 'gif' ? 'gif' : choice.target,
    file: output.name,
    thumb,
    size: output.size,
    duration: probe?.duration,
    createdAt: Date.now(),
    siteName: 'Converted',
    inPhotos,
  };
  addEntry(entry);
  return { entry, inPhotos, photosDenied };
}
