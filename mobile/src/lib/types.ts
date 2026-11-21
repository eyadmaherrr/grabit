export type Site = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'other';

/** One downloadable URL plus the headers the site expects with it. */
export type Stream = {
  url: string;
  ext: string;
  headers?: Record<string, string>;
  /** Approximate size in bytes, when the site tells us. */
  size?: number;
};

/** A video at one quality. When `audio` is set, picture and sound are separate files and get merged. */
export type VideoVariant = {
  height: number;
  video: Stream;
  audio?: Stream;
};

export type MediaItem = {
  kind: 'video' | 'image' | 'audio';
  thumbnail?: string;
  thumbnailHeaders?: Record<string, string>;
  width?: number;
  height?: number;
  duration?: number;
  /** Video qualities, best first. */
  variants?: VideoVariant[];
  /** The photo, for image items. */
  image?: Stream;
  /** A ready-made audio file (YouTube, SoundCloud), so "audio only" needn't download the video. */
  audio?: Stream;
};

export type MediaInfo = {
  site: Site;
  siteName: string;
  url: string;
  title: string;
  author?: string;
  thumbnail?: string;
  thumbnailHeaders?: Record<string, string>;
  duration?: number;
  items: MediaItem[];
};

export type ErrorCode = 'invalid' | 'login' | 'not_found' | 'blocked' | 'unsupported' | 'network' | 'failed' | 'cancelled';

export class GrabError extends Error {
  code: ErrorCode;
  detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/** Turns anything thrown into a GrabError with a sentence a person can act on. */
export function toGrabError(err: unknown): GrabError {
  if (err instanceof GrabError) return err;
  const text = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(text)) return new GrabError('cancelled', 'Cancelled.');
  // Native module errors read "Call to function ... has been rejected. → Caused by: <reason>".
  const native = text.match(/Caused by:\s*([\s\S]+)$/);
  if (native) return new GrabError('failed', native[1].trim(), text);
  if (/network request failed|offline|timed out|not connected|could not connect/i.test(text)) {
    return new GrabError('network', "Couldn't connect. Check your internet connection and try again.", text);
  }
  return new GrabError('failed', 'Something went wrong. Try again, or try a different link.', text);
}
