import { Innertube, Platform } from 'youtubei.js/react-native';
import type { Types } from 'youtubei.js/react-native';

import { request, SAFARI_MAC } from '../net';
import { GrabError, type MediaInfo, type Stream, type VideoVariant } from '../types';

type InnerTubeClient = Types.InnerTubeClient;

// youtubei.js builds a small script from YouTube's player to unlock video URLs; run it.
Platform.shim.eval = (data: { output: string }) => new Function(data.output)();

const CLIENT_USER_AGENTS: Partial<Record<InnerTubeClient, string>> = {
  IOS: 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
  ANDROID_VR:
    'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
};

// Tried in order until one returns downloadable formats.
const CLIENTS: InnerTubeClient[] = ['IOS', 'ANDROID_VR', 'MWEB', 'TV', 'WEB_EMBEDDED', 'WEB'];
const HEIGHTS = [1080, 720, 480, 360];

let clientPromise: Promise<Innertube> | null = null;
function youtube(): Promise<Innertube> {
  clientPromise ??= Innertube.create({
    retrieve_player: true,
    generate_session_locally: true,
    enable_session_cache: false,
    lang: 'en',
  }).catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/** Asks for the first byte only, to check the server will actually hand over the file. */
async function downloadable(url: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const probeUrl = url.includes('?') ? `${url}&range=0-0` : url;
    const res = await request(probeUrl, { headers: { ...headers, Range: 'bytes=0-0' }, timeoutMs: 12_000 });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

type Picked = { variants: VideoVariant[]; audio?: Stream };

async function pickFormats(yt: Innertube, streaming: any, client: InnerTubeClient): Promise<Picked | null> {
  const headers = { 'User-Agent': CLIENT_USER_AGENTS[client] ?? SAFARI_MAC };
  const unlock = async (format: any): Promise<string | undefined> => {
    try {
      return await format.decipher(yt.session.player);
    } catch {
      return format.url;
    }
  };

  const adaptive: any[] = streaming.adaptive_formats ?? [];
  const progressive: any[] = streaming.formats ?? [];

  // H.264 + AAC in MP4: the only combination that iPhones (and WhatsApp) play and Photos accepts everywhere.
  const videoOnly = adaptive
    .filter((f) => f.has_video && !f.has_audio && f.mime_type?.startsWith('video/mp4') && f.mime_type.includes('avc1'))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const audioFormat = adaptive
    .filter((f) => f.has_audio && !f.has_video && f.mime_type?.startsWith('audio/mp4'))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const combined = progressive
    .filter((f) => f.has_audio && f.has_video && f.mime_type?.startsWith('video/mp4'))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

  let audio: Stream | undefined;
  if (audioFormat) {
    const url = await unlock(audioFormat);
    if (url && (await downloadable(url, headers))) {
      audio = { url, ext: 'm4a', headers, size: audioFormat.content_length };
    }
  }

  const variants: VideoVariant[] = [];
  if (audio) {
    for (const target of HEIGHTS) {
      const format = videoOnly.find((f) => (f.height ?? 0) <= target && (f.height ?? 0) > target * 0.6);
      if (!format || variants.some((v) => v.height === format.height)) continue;
      const url = await unlock(format);
      if (url) variants.push({ height: format.height, video: { url, ext: 'mp4', headers, size: format.content_length }, audio });
    }
  }
  if (combined) {
    const url = await unlock(combined);
    if (url && !variants.some((v) => v.height === combined.height)) {
      variants.push({ height: combined.height ?? 360, video: { url, ext: 'mp4', headers, size: combined.content_length } });
    }
  }
  if (!variants.length) return null;
  if (!(await downloadable(variants[0].video.url, headers))) return null;
  return { variants, audio };
}

export async function extractYouTube(url: string): Promise<MediaInfo> {
  const id = youtubeId(url);
  if (!id) throw new GrabError('invalid', 'That doesn’t look like a link to a YouTube video.');

  const yt = await youtube();
  let reason = '';
  let status = '';

  for (const client of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(id, { client });
      status = info.playability_status?.status ?? status;
      if (info.playability_status && info.playability_status.status !== 'OK') {
        reason = info.playability_status.reason || reason;
        continue;
      }
      if (!info.streaming_data) continue;
      const picked = await pickFormats(yt, info.streaming_data, client);
      if (!picked) continue;

      const basic = info.basic_info;
      const thumbs = [...(basic.thumbnail ?? [])].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0));
      const thumbnail = thumbs[0]?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return {
        site: 'youtube',
        siteName: 'YouTube',
        url: `https://www.youtube.com/watch?v=${id}`,
        title: basic.title ?? 'YouTube video',
        author: basic.author ?? basic.channel?.name ?? undefined,
        thumbnail,
        duration: basic.duration,
        items: [{ kind: 'video', thumbnail, duration: basic.duration, variants: picked.variants, audio: picked.audio }],
      };
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
  }

  if (/age|inappropriate/i.test(reason)) {
    throw new GrabError('login', 'YouTube only shows this video to signed-in adults, so GrabIt can’t save it.');
  }
  if (/private|unavailable|removed|does not exist/i.test(reason) || status === 'ERROR') {
    throw new GrabError('not_found', 'This video is private, removed, or not available in your country.');
  }
  if (/live/i.test(reason) || status === 'LIVE_STREAM_OFFLINE') {
    throw new GrabError('unsupported', 'Live streams can’t be saved. Try again after the stream has ended.');
  }
  throw new GrabError('blocked', 'YouTube didn’t allow this download right now. Try again in a minute.', reason);
}
