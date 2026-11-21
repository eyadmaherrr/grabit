// Browser features some libraries (youtubei.js) expect but React Native doesn't fully provide.
import 'react-native-url-polyfill/auto';

const g = globalThis as any;

if (!g.window) g.window = g;
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  // Used only for request nonces, never for anything secret.
  g.crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    const view = array as unknown as { length: number; BYTES_PER_ELEMENT?: number; [i: number]: number };
    const max = 2 ** (8 * (view.BYTES_PER_ELEMENT ?? 1));
    for (let i = 0; i < view.length; i++) view[i] = Math.floor(Math.random() * max);
    return array;
  };
}
if (!g.crypto.randomUUID) {
  g.crypto.randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
