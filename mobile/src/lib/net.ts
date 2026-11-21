import { GrabError } from './types';

export const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
export const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** fetch() with a timeout. Requests come from the phone itself, so sites see a normal phone connection. */
export async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 25_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new GrabError('network', 'The site took too long to answer. Try again.');
    throw new GrabError('network', "Couldn't connect. Check your internet connection and try again.", String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function getPage(url: string, userAgent = SAFARI_MAC, extra: Record<string, string> = {}) {
  const res = await request(url, { headers: { 'User-Agent': userAgent, ...BROWSER_HEADERS, ...extra } });
  const html = await res.text();
  return { res, html, finalUrl: res.url || url };
}

export async function getJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { headers: { 'User-Agent': SAFARI_MAC, Accept: 'application/json', ...headers } });
  if (res.status === 404) throw new GrabError('not_found', 'Nothing was found at that link. It may have been deleted.');
  if (!res.ok) throw new GrabError('failed', `The site answered with an error (${res.status}).`);
  return res.json();
}

/** Follows short links (vm.tiktok.com, fb.watch, youtu.be...) to the real page. */
export async function resolveRedirects(url: string): Promise<string> {
  try {
    const res = await request(url, { method: 'GET', headers: { 'User-Agent': SAFARI_IOS }, timeoutMs: 15_000 });
    return res.url || url;
  } catch {
    return url;
  }
}

/** Decodes a JSON string literal body, e.g. "https:\/\/a.com\/x%3D" -> "https://a.com/x%3D". */
export function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\\//g, '/');
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i');
  const m = html.match(re) ?? html.match(alt);
  return m ? decodeHtml(m[1]) : undefined;
}

/** First line of a caption, trimmed to a sensible title length. */
export function titleFrom(text: string | undefined, fallback: string): string {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return fallback;
  return line.length > 90 ? `${line.slice(0, 87).trimEnd()}…` : line;
}

export function extFromUrl(url: string, fallback: string): string {
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : fallback;
}
