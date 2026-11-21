/**
 * The share extension opens the app with grabit://expo-sharing. Send that to the Download tab,
 * which picks up the shared link with useIncomingShare().
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('expo-sharing')) return '/';
    return path;
  } catch {
    return '/';
  }
}
