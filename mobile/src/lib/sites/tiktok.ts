import { getPage, resolveRedirects, SAFARI_MAC, titleFrom } from '../net';
import { GrabError, type MediaInfo, type MediaItem, type VideoVariant } from '../types';

const HEADERS = { 'User-Agent': SAFARI_MAC, Referer: 'https://www.tiktok.com/' };

export async function extractTikTok(input: string): Promise<MediaInfo> {
  let url = input;
  if (!/\/(video|photo)\/\d+/.test(url)) url = await resolveRedirects(url); // vm.tiktok.com, /t/ short links
  const id = url.match(/\/(?:video|photo)\/(\d+)/)?.[1];
  if (!id) throw new GrabError('invalid', 'That doesn’t look like a link to a TikTok video.');

  // Loading the page also gives the phone the cookies TikTok checks when the video file is downloaded.
  const { html } = await getPage(`https://www.tiktok.com/@i/video/${id}`, SAFARI_MAC);
  const raw = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new GrabError('blocked', 'TikTok didn’t return this video. Try again in a moment.');

  let item: any;
  try {
    const data = JSON.parse(raw);
    const detail = data?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
    if (detail?.statusCode && detail.statusCode !== 0) {
      throw new GrabError('not_found', 'This TikTok is private, removed, or not available in your region.');
    }
    item = detail?.itemInfo?.itemStruct;
  } catch (err) {
    if (err instanceof GrabError) throw err;
  }
  if (!item) throw new GrabError('blocked', 'TikTok didn’t return this video. Try again in a moment.');

  const author = item.author?.uniqueId ? `@${item.author.uniqueId}` : undefined;
  const base = {
    site: 'tiktok' as const,
    siteName: 'TikTok',
    url: `https://www.tiktok.com/${author ?? '@i'}/video/${id}`,
    title: titleFrom(item.desc, author ? `TikTok by ${author}` : 'TikTok video'),
    author,
  };

  // Photo slideshows
  const images: any[] = item.imagePost?.images ?? [];
  if (images.length) {
    const items: MediaItem[] = images.map((img) => {
      const src = img.imageURL?.urlList?.[0];
      return {
        kind: 'image',
        thumbnail: src,
        width: img.imageWidth,
        height: img.imageHeight,
        image: { url: src, ext: 'jpg', headers: HEADERS },
      };
    });
    const music = item.music?.playUrl;
    if (music) items.push({ kind: 'audio', audio: { url: music, ext: 'm4a', headers: HEADERS } });
    return { ...base, thumbnail: items[0]?.thumbnail, items };
  }

  const video = item.video ?? {};
  const variants: VideoVariant[] = [];
  // Prefer H.264 renditions: they play everywhere, including older iPhones and WhatsApp.
  const renditions: any[] = [...(video.bitrateInfo ?? [])].sort((a, b) => {
    const h264a = a.CodecType?.includes('h264') ? 1 : 0;
    const h264b = b.CodecType?.includes('h264') ? 1 : 0;
    return h264b - h264a || (b.PlayAddr?.Height ?? 0) - (a.PlayAddr?.Height ?? 0) || (b.Bitrate ?? 0) - (a.Bitrate ?? 0);
  });
  for (const r of renditions) {
    const src = r.PlayAddr?.UrlList?.find((u: string) => u.includes('tiktok')) ?? r.PlayAddr?.UrlList?.[0];
    if (src) {
      variants.push({ height: r.PlayAddr?.Height ?? video.height ?? 0, video: { url: src, ext: 'mp4', headers: HEADERS, size: r.PlayAddr?.DataSize } });
    }
  }
  const play = video.playAddr || video.downloadAddr;
  if (play) variants.push({ height: video.height ?? 0, video: { url: play, ext: 'mp4', headers: HEADERS } });
  if (!variants.length) throw new GrabError('blocked', 'TikTok didn’t share the video file. Try again in a moment.');

  return {
    ...base,
    thumbnail: video.cover || video.originCover,
    duration: video.duration,
    items: [
      {
        kind: 'video',
        thumbnail: video.cover || video.originCover,
        width: video.width,
        height: video.height,
        duration: video.duration,
        variants: [variants[0]],
        audio: item.music?.playUrl ? { url: item.music.playUrl, ext: 'm4a', headers: HEADERS } : undefined,
      },
    ],
  };
}
