import { getPage, metaContent, SAFARI_MAC, titleFrom, unescapeJson } from '../net';
import { GrabError, type MediaInfo, type VideoVariant } from '../types';

const HEADERS = { 'User-Agent': SAFARI_MAC, Referer: 'https://www.facebook.com/' };

function firstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return unescapeJson(m[1]);
  }
  return undefined;
}

export async function extractFacebook(url: string): Promise<MediaInfo> {
  const { html, finalUrl } = await getPage(url, SAFARI_MAC, {
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Dest': 'document',
  });
  if (/\/login(\.php|\/)/.test(finalUrl) || /id="login_form"/.test(html) && !/playable_url|browser_native/.test(html)) {
    throw new GrabError('login', 'Facebook only shows this to signed-in people, so GrabIt can’t save it. Public videos and reels work.');
  }

  const hd = firstMatch(html, [/"browser_native_hd_url":"([^"]+)"/, /"playable_url_quality_hd":"([^"]+)"/, /hd_src(?:_no_ratelimit)?:"([^"]+)"/]);
  const sd = firstMatch(html, [/"browser_native_sd_url":"([^"]+)"/, /"playable_url":"([^"]+)"/, /sd_src(?:_no_ratelimit)?:"([^"]+)"/]);
  const thumbnail =
    firstMatch(html, [/"preferred_thumbnail":\{"image":\{"uri":"([^"]+)"/, /"thumbnailImage":\{"uri":"([^"]+)"/]) ??
    metaContent(html, 'og:image');
  // og:title looks like "2.8M views · 1.3K reactions | The actual title | Facebook".
  const rawTitle = (metaContent(html, 'og:title') ?? metaContent(html, 'og:description') ?? '')
    .replace(/^[^|]*\b(views?|reactions?|plays?)\b[^|]*\|\s*/i, '')
    .replace(/\s*\|\s*Facebook\s*$/i, '');
  const title = titleFrom(rawTitle, 'Facebook video');
  const author = firstMatch(html, [/"owner":\{"__typename":"[^"]+","name":"([^"]+)"/, /"owner_as_page":\{[^}]*"name":"([^"]+)"/]);

  const variants: VideoVariant[] = [];
  if (hd) variants.push({ height: 720, video: { url: hd, ext: 'mp4', headers: HEADERS } });
  if (sd && sd !== hd) variants.push({ height: 360, video: { url: sd, ext: 'mp4', headers: HEADERS } });

  if (!variants.length) {
    // A photo post: save the picture itself.
    const image = metaContent(html, 'og:image');
    if (image && !/\/videos?\/|\/reel\/|watch/.test(finalUrl)) {
      return {
        site: 'facebook',
        siteName: 'Facebook',
        url: finalUrl,
        title,
        author,
        thumbnail: image,
        items: [{ kind: 'image', thumbnail: image, image: { url: image, ext: 'jpg', headers: HEADERS } }],
      };
    }
    throw new GrabError('blocked', 'Facebook didn’t share the video file. It may be private, or only visible when signed in.');
  }

  return {
    site: 'facebook',
    siteName: 'Facebook',
    url: finalUrl,
    title,
    author,
    thumbnail,
    items: [{ kind: 'video', thumbnail, variants }],
  };
}
