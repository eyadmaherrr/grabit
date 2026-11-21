import { getJson, titleFrom } from '../net';
import { GrabError, type MediaInfo, type MediaItem } from '../types';

/** The token X's public embed service expects (same formula as Vercel's react-tweet). */
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, '');
}

export async function extractX(url: string): Promise<MediaInfo> {
  const id = url.match(/(?:twitter|x)\.com\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d+)/)?.[1];
  if (!id) throw new GrabError('invalid', 'That doesn’t look like a link to a post on X.');

  const data = await getJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`
  );
  if (!data || data.__typename === 'TweetTombstone') {
    throw new GrabError('not_found', 'This post isn’t available. It may be deleted, or from a protected account.');
  }

  const media: any[] = data.mediaDetails ?? data.quoted_tweet?.mediaDetails ?? [];
  const items: MediaItem[] = media.map((m) => {
    if (m.type === 'photo') {
      return {
        kind: 'image',
        thumbnail: m.media_url_https,
        width: m.original_info?.width,
        height: m.original_info?.height,
        image: { url: `${m.media_url_https}?name=orig`, ext: m.media_url_https.split('.').pop() ?? 'jpg' },
      };
    }
    const mp4s = (m.video_info?.variants ?? [])
      .filter((v: any) => v.content_type === 'video/mp4')
      .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return {
      kind: 'video',
      thumbnail: m.media_url_https,
      width: m.original_info?.width,
      height: m.original_info?.height,
      duration: m.video_info?.duration_millis ? m.video_info.duration_millis / 1000 : undefined,
      variants: mp4s.map((v: any) => ({
        height: Number(v.url.match(/\/(\d+)x(\d+)\//)?.[2] ?? 0),
        video: { url: v.url, ext: 'mp4' },
      })),
    };
  });
  if (!items.length) throw new GrabError('not_found', 'This post has no photos or videos to save.');

  const author = data.user?.screen_name ? `@${data.user.screen_name}` : undefined;
  return {
    site: 'x',
    siteName: 'X',
    url,
    title: titleFrom(data.text?.replace(/https:\/\/t\.co\/\S+/g, '').trim(), author ? `Post by ${author}` : 'Post on X'),
    author,
    thumbnail: items[0].thumbnail,
    duration: items[0].duration,
    items,
  };
}
