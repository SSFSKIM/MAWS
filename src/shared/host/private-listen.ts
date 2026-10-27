// The creating side of private local paths (P5 O2 M3; RL §5.11), internal to the hosts: a host's directory made when
// missing, and the socket path cleared before a listen. Both check through private-path.ts, whose exports stay the
// Interfaces block's (O10 shares that file), so this module holds what only the processes that listen need.
import * as fs from 'node:fs';
import { assertPrivateDirectory, assertPrivateSocket } from './private-path';

// A host's directory, created 0700 when it is missing; one that exists is checked, never corrected, so a path another
// process put there (a symlink, a wider mode, another owner) is refused (PrivatePathError) rather than adopted.
export function makePrivateDirectory(path: string): void {
  try {
    fs.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  assertPrivateDirectory(path);
}

// Before a listen on `path`: nothing there is fine; a stale socket this uid owns (a dead listener's, which the kernel
// never removes) is unlinked; anything else (a symlink, a file, a directory, another uid's socket) is refused with a
// PrivatePathError naming the path, and left where it is.
export function clearSocketPath(path: string): void {
  try {
    assertPrivateSocket(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  fs.unlinkSync(path);
}
