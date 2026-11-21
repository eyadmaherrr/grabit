import { NativeModule, requireOptionalNativeModule } from 'expo';

export type ConvertOptions = {
  /** Output format. */
  output: 'mp4' | 'mov' | 'm4a' | 'gif';
  /** Short side of the output video in pixels (720 = 720p). 0 keeps the original size. */
  maxHeight?: number;
  /** Trim start/end in seconds. 0 = from the beginning / to the end. */
  start?: number;
  end?: number;
  mute?: boolean;
  gifFps?: number;
  /** Longest side of the GIF in pixels. */
  gifSize?: number;
  jobId?: string;
};

export type ProbeResult = {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
};

type MediaToolsEvents = {
  onProgress: (event: { jobId: string; progress: number }) => void;
};

declare class MediaToolsModule extends NativeModule<MediaToolsEvents> {
  probe(uri: string): Promise<ProbeResult>;
  merge(videoUri: string, audioUri: string, outputUri: string, jobId: string): Promise<string>;
  convert(inputUri: string, outputUri: string, options: ConvertOptions): Promise<string>;
  thumbnail(uri: string, outputUri: string, maxSize: number): Promise<string>;
}

/** Null when the native code isn't in the build (for example in Expo Go or on the web). */
export const MediaTools = requireOptionalNativeModule<MediaToolsModule>('MediaTools');
