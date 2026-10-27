// Private local paths (P5 O2 M3, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; the remote layer's RL §5.11). Where
// no peer authentication exists, the uid is the boundary, so every local socket a host creates or connects to is
// checked by `lstat` (a symlink is never followed) before a listen, a token read or a connect: its directory is a
// directory the process's uid owns with no group or other bits, and the socket is a socket the uid owns in such a
// directory. A path that fails throws a PrivatePathError naming the path and the reason; the caller logs it and treats
// the host as unreachable. A path that does not exist throws as `lstat` does (ENOENT), which a connect reads as nothing
// listening.
import * as fs from 'node:fs';
import { dirname } from 'node:path';

export type PrivatePathReason = 'symlink' | 'not_directory' | 'not_socket' | 'owner' | 'mode';

export class PrivatePathError extends Error {
  constructor(
    readonly path: string,
    readonly reason: PrivatePathReason,
    detail: string,
  ) {
    super(`${path} ${detail}`);
    this.name = 'PrivatePathError';
  }
}

interface PathDeps {
  lstat?: typeof fs.lstatSync;
  uid?: number;
}

export function assertPrivateDirectory(dir: string, deps: PathDeps = {}): void {
  const stat = (deps.lstat ?? fs.lstatSync)(dir);
  if (stat.isSymbolicLink()) throw new PrivatePathError(dir, 'symlink', 'is a symlink');
  if (!stat.isDirectory()) throw new PrivatePathError(dir, 'not_directory', 'is not a directory');
  assertOwner(dir, stat.uid, deps);
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) throw new PrivatePathError(dir, 'mode', `is mode 0${mode.toString(8)}, more open than 0700`);
}

export function assertPrivateSocket(path: string, deps: PathDeps = {}): void {
  const stat = (deps.lstat ?? fs.lstatSync)(path);
  if (stat.isSymbolicLink()) throw new PrivatePathError(path, 'symlink', 'is a symlink');
  if (!stat.isSocket()) throw new PrivatePathError(path, 'not_socket', 'is not a socket');
  assertOwner(path, stat.uid, deps);
  assertPrivateDirectory(dirname(path), deps);
}

function assertOwner(path: string, owner: number, deps: PathDeps): void {
  const uid = deps.uid ?? process.getuid?.();
  if (uid !== undefined && owner !== uid) throw new PrivatePathError(path, 'owner', `is owned by uid ${owner}, not this process's ${uid}`);
}
