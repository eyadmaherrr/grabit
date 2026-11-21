import { request } from '../net';
import { GrabError, type ErrorCode, type MediaInfo } from '../types';

/**
 * For sites GrabIt doesn't read on the phone (SoundCloud, Dailymotion, Vimeo...), ask the GrabIt
 * server, which runs yt-dlp. Some sites block cloud servers, so this is a best-effort fallback.
 */
export const SERVER = 'https://grabit-mauve.vercel.app';

const CODES: Record<string, ErrorCode> = {
  invalid_url: 'invalid',
  login_required: 'login',
  bot_check: 'blocked',
  unsupported: 'unsupported',
  not_found: 'not_found',
  unreachable: 'not_found',
};

export async function extractViaServer(url: string): Promise<MediaInfo> {
  const res = await request(`${SERVER}/api/info?url=${encodeURIComponent(url)}`, { timeoutMs: 60_000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = CODES[data.code] ?? 'failed';
    const message =
      code === 'unsupported'
        ? 'GrabIt doesn’t support this website yet.'
        : code === 'login' || code === 'blocked'
          ? 'This website didn’t allow the download. Try a link from Instagram, TikTok, YouTube, Facebook or X.'
          : code === 'not_found'
            ? 'Nothing was found at that link.'
            : 'GrabIt couldn’t read that link.';
    throw new GrabError(code, message, data.error);
  }
  if (data.kind !== 'single') {
    throw new GrabError('unsupported', 'Playlists and albums from this site aren’t supported. Share a single video instead.');
  }

  const download = (params: string) => `${SERVER}/api/download?${params}&url=${encodeURIComponent(url)}`;
  const audio = { url: download('type=audio&format=m4a'), ext: 'm4a' };
  const top = data.heights?.[0] ?? 0;
  return {
    site: 'other',
    siteName: data.site ?? 'Web',
    url,
    title: data.title ?? 'Video',
    author: data.uploader ?? undefined,
    thumbnail: data.thumbnail ?? undefined,
    duration: data.duration ?? undefined,
    items: [
      data.has_video === false
        ? { kind: 'audio', thumbnail: data.thumbnail, duration: data.duration, audio }
        : {
            kind: 'video',
            thumbnail: data.thumbnail,
            duration: data.duration,
            variants: [{ height: top, video: { url: download('type=video&quality=1080'), ext: 'mp4' } }],
            audio,
          },
    ],
  };
}
