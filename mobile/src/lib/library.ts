import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

/**
 * Saved files live in the app's Documents folder, which the Files app shows under
 * "On My iPhone › GrabIt". The list itself and thumbnails sit in a hidden ".grabit" folder.
 */
export type EntryKind = 'video' | 'audio' | 'image' | 'gif';

export type Entry = {
  id: string;
  title: string;
  kind: EntryKind;
  /** File name inside the Documents folder. */
  file: string;
  /** Thumbnail file name inside .grabit/thumbs. */
  thumb?: string;
  size: number;
  duration?: number;
  createdAt: number;
  siteName?: string;
  source?: string;
  inPhotos?: boolean;
};

const docs = () => Paths.document;

export function metaDir(): Directory {
  const dir = new Directory(docs(), '.grabit');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function thumbsDir(): Directory {
  const dir = new Directory(metaDir(), 'thumbs');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function tempDir(): Directory {
  const dir = new Directory(Paths.cache, 'grabit-temp');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const fileOf = (entry: Entry) => new File(docs(), entry.file);
export const thumbOf = (entry: Entry) => (entry.thumb ? new File(thumbsDir(), entry.thumb) : null);

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** A free file name in Documents based on the title, e.g. "Sunset in Cairo (2).mp4". */
export function uniqueFile(title: string, ext: string): File {
  const base =
    title
      .replace(/[\\/:*?"<>|#\n\r\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
      .replace(/[. ]+$/, '') || 'GrabIt';
  let candidate = new File(docs(), `${base}.${ext}`);
  for (let n = 2; candidate.exists; n++) candidate = new File(docs(), `${base} (${n}).${ext}`);
  return candidate;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
let entries: Entry[] | null = null;
const listeners = new Set<() => void>();

function indexFile() {
  return new File(metaDir(), 'library.json');
}

function load(): Entry[] {
  if (entries) return entries;
  try {
    const file = indexFile();
    const parsed: Entry[] = file.exists ? JSON.parse(file.textSync()) : [];
    // Drop entries whose file was deleted from the Files app.
    entries = parsed.filter((e) => new File(docs(), e.file).exists);
  } catch {
    entries = [];
  }
  return entries;
}

function persist(next: Entry[]) {
  entries = next;
  try {
    indexFile().write(JSON.stringify(next));
  } catch {
    // Keep going: the list is rebuilt next time.
  }
  listeners.forEach((l) => l());
}

export function getEntries(): Entry[] {
  return load();
}

export function getEntry(id: string): Entry | undefined {
  return load().find((e) => e.id === id);
}

export function addEntry(entry: Entry) {
  persist([entry, ...load().filter((e) => e.id !== entry.id)]);
}

export function updateEntry(id: string, patch: Partial<Entry>) {
  persist(load().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function removeEntry(id: string) {
  const entry = getEntry(id);
  if (entry) {
    try {
      const file = fileOf(entry);
      if (file.exists) file.delete();
      const thumb = thumbOf(entry);
      if (thumb?.exists) thumb.delete();
    } catch {
      // Already gone.
    }
  }
  persist(load().filter((e) => e.id !== id));
}

/** Re-reads the list, e.g. after files were deleted in the Files app. */
export function refreshLibrary() {
  entries = null;
  listeners.forEach((l) => l());
}

export function useLibrary(): Entry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    load
  );
}
