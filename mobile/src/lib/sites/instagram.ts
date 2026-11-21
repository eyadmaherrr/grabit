import { getPage, request, SAFARI_MAC, titleFrom, unescapeJson } from '../net';
import { GrabError, type MediaInfo, type MediaItem } from '../types';

const APP_ID = '936619743392459';
// Instagram's own query for a single post (the one its website uses).
const POST_QUERY_DOC_ID = '8845758582119845';

const CDN_HEADERS = { 'User-Agent': SAFARI_MAC, Referer: 'https://www.instagram.com/' };

export function instagramShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function extractInstagram(url: string): Promise<MediaInfo> {
  if (/instagram\.com\/stories\//.test(url)) {
    throw new GrabError('login', 'Instagram stories can only be seen when signed in, so GrabIt can’t save them.');
  }
  const code = instagramShortcode(url);
  if (!code) throw new GrabError('invalid', 'That doesn’t look like a link to an Instagram post or reel.');

  const media = (await viaGraphQL(code)) ?? (await viaEmbed(code));
  if (!media) {
    throw new GrabError(
      'login',
      'Instagram didn’t share this post. It may be from a private account, or Instagram is limiting requests right now. Try again in a few minutes.'
    );
  }
  return media;
}

async function viaGraphQL(code: string): Promise<MediaInfo | null> {
  // Load the post page first: it sets Instagram's cookies and carries the tokens the query needs.
  let csrf = '';
  let lsd = '';
  try {
    const { html, res } = await getPage(`https://www.instagram.com/p/${code}/`);
    csrf = html.match(/"csrf_token":"([^"]+)"/)?.[1] ?? res.headers.get('set-cookie')?.match(/csrftoken=([^;,]+)/)?.[1] ?? '';
    lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? html.match(/"lsd":"([^"]+)"/)?.[1] ?? '';
  } catch {
    // The query sometimes works without them.
  }

  const variables = JSON.stringify({
    shortcode: code,
    fetch_tagged_user_count: null,
    hoisted_comment_id: null,
    hoisted_reply_id: null,
  });
  const body = `variables=${encodeURIComponent(variables)}&doc_id=${POST_QUERY_DOC_ID}${lsd ? `&lsd=${encodeURIComponent(lsd)}` : ''}`;

  try {
    const res = await request('https://www.instagram.com/graphql/query', {
      method: 'POST',
      headers: {
        'User-Agent': SAFARI_MAC,
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-IG-App-ID': APP_ID,
        'X-ASBD-ID': '129477',
        'X-IG-WWW-Claim': '0',
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
        ...(lsd ? { 'X-FB-LSD': lsd } : {}),
        Origin: 'https://www.instagram.com',
        Referer: `https://www.instagram.com/p/${code}/`,
      },
      body,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const node = json?.data?.xdt_shortcode_media ?? json?.data?.shortcode_media;
    if (!node) return null;
    return fromNode(node, code);
  } catch {
    return null;
  }
}

function fromNode(node: any, code: string): MediaInfo {
  const children: any[] = node.edge_sidecar_to_children?.edges?.map((e: any) => e.node) ?? [node];
  const items: MediaItem[] = children.map((child) => {
    const width = child.dimensions?.width;
    const height = child.dimensions?.height;
    if (child.is_video && child.video_url) {
      return {
        kind: 'video',
        thumbnail: child.display_url,
        thumbnailHeaders: CDN_HEADERS,
        width,
        height,
        duration: child.video_duration,
        variants: [{ height: height ?? 0, video: { url: child.video_url, ext: 'mp4', headers: CDN_HEADERS } }],
      };
    }
    const best = [...(child.display_resources ?? [])].sort((a, b) => b.config_width - a.config_width)[0];
    const imageUrl = best?.src ?? child.display_url;
    return {
      kind: 'image',
      thumbnail: child.display_url,
      thumbnailHeaders: CDN_HEADERS,
      width,
      height,
      image: { url: imageUrl, ext: 'jpg', headers: CDN_HEADERS },
    };
  });

  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text;
  const author = node.owner?.username;
  return {
    site: 'instagram',
    siteName: 'Instagram',
    url: `https://www.instagram.com/p/${code}/`,
    title: titleFrom(caption, author ? `Post by @${author}` : 'Instagram post'),
    author: author ? `@${author}` : undefined,
    thumbnail: node.display_url,
    thumbnailHeaders: CDN_HEADERS,
    duration: node.video_duration,
    items,
  };
}

/** Fallback: the public embed page includes the media of public posts. */
async function viaEmbed(code: string): Promise<MediaInfo | null> {
  try {
    const { html } = await getPage(`https://www.instagram.com/p/${code}/embed/captioned/`);
    const unescaped = html.replace(/\\"/g, '"').replace(/\\\\\//g, '/');
    const videoUrl = unescaped.match(/"video_url":"([^"]+)"/)?.[1];
    const displayUrl =
      unescaped.match(/"display_url":"([^"]+)"/)?.[1] ??
      html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    const author = unescaped.match(/"owner":\{[^}]*"username":"([^"]+)"/)?.[1] ?? html.match(/class="UsernameText"[^>]*>([^<]+)</)?.[1];
    if (!videoUrl && !displayUrl) return null;

    const item: MediaItem = videoUrl
      ? {
          kind: 'video',
          thumbnail: displayUrl && unescapeJson(displayUrl),
          thumbnailHeaders: CDN_HEADERS,
          variants: [{ height: 0, video: { url: unescapeJson(videoUrl), ext: 'mp4', headers: CDN_HEADERS } }],
        }
      : {
          kind: 'image',
          thumbnail: unescapeJson(displayUrl!),
          thumbnailHeaders: CDN_HEADERS,
          image: { url: unescapeJson(displayUrl!), ext: 'jpg', headers: CDN_HEADERS },
        };
    return {
      site: 'instagram',
      siteName: 'Instagram',
      url: `https://www.instagram.com/p/${code}/`,
      title: author ? `Post by @${author}` : 'Instagram post',
      author: author ? `@${author}` : undefined,
      thumbnail: item.thumbnail,
      thumbnailHeaders: CDN_HEADERS,
      items: [item],
    };
  } catch {
    return null;
  }
}
