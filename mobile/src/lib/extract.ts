import { extractFacebook } from './sites/facebook';
import { extractInstagram } from './sites/instagram';
import { extractViaServer } from './sites/server';
import { extractTikTok } from './sites/tiktok';
import { extractX } from './sites/x';
import { extractYouTube } from './sites/youtube';
import { GrabError, type MediaInfo, type Site } from './types';

/** Pulls the first link out of whatever was pasted or shared (captions often come with it). */
export function findUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[).,!?…]+$/, '');
  const bare = text.trim().match(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i);
  return bare ? `https://${bare[0]}` : null;
}

export function detectSite(url: string): Site {
  const host = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (/(^|\.)instagram\.com$|(^|\.)instagr\.am$/.test(host)) return 'instagram';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(host)) return 'youtube';
  if (/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/.test(host)) return 'facebook';
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) return 'x';
  return 'other';
}

export async function extract(text: string): Promise<MediaInfo> {
  const url = findUrl(text);
  if (!url) throw new GrabError('invalid', 'That doesn’t look like a link. Copy the link to a post or video and paste it here.');

  switch (detectSite(url)) {
    case 'instagram':
      return extractInstagram(url);
    case 'tiktok':
      return extractTikTok(url);
    case 'youtube':
      return extractYouTube(url);
    case 'facebook':
      return extractFacebook(url);
    case 'x':
      return extractX(url);
    default:
      return extractViaServer(url);
  }
}
