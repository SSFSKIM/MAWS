// A session's cua socket (E13): `<dir>/<appSessionId>.sock` in the app's cua socket directory, `<userData>/browser/cua`.
// The app listens on it (src/main/browser/cua); the spine tells a launch its path, in main on the embedded shape and in
// `mawsd` on the daemon shape, which learns the directory from the app's `machine.client` (P5 O3-D M5b). None for a path
// longer than a Unix socket allows.
import { join } from 'node:path';

export const CUA_SOCKET_DIR = ['browser', 'cua'] as const; // under the profile

// sockaddr_un's sun_path on macOS is 104 bytes, the terminating NUL included.
export const MAX_SOCKET_PATH_BYTES = 103;

export function cuaSocketPath(dir: string, appSessionId: string): string | null {
  const path = join(dir, `${appSessionId}.sock`);
  return Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES ? null : path;
}
