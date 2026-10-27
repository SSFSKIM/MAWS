// Private paths (RL §5.11; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M3 and Interfaces): where a machine's
// sockets, tokens and keys live, the uid is the boundary, since Node's `net` can't check a peer's credentials. A
// directory is private when, by `lstat`, it is a directory (not a symlink to one), owned by this process's uid, with no
// group or other bits; a socket when it is a socket the uid owns in a private directory. A failure throws with the path
// and the reason, for the caller to log and to treat what lives there as unreachable. O2 creates this file's interface;
// O10's endpoint module imports it (whichever lands first creates it).
import * as fs from 'node:fs';
import { dirname } from 'node:path';

export class PrivatePathError extends Error {
  readonly path: string;
  readonly reason: 'symlink' | 'not_directory' | 'not_socket' | 'owner' | 'mode';

  constructor(path: string, reason: PrivatePathError['reason']) {
    super(`${path} ${WORDS[reason]}`);
    this.name = 'PrivatePathError';
    this.path = path;
    this.reason = reason;
  }
}

const WORDS: Record<PrivatePathError['reason'], string> = {
  symlink: 'is a symlink',
  not_directory: 'is not a directory',
  not_socket: 'is not a socket',
  owner: 'is owned by another user',
  mode: 'is open to other users (group or other permission bits are set)',
};

type Deps = { lstat?: typeof fs.lstatSync; uid?: number };

function owned(path: string, stat: fs.Stats, uid: number | undefined): void {
  if (stat.uid !== (uid ?? process.getuid?.())) throw new PrivatePathError(path, 'owner');
}

export function assertPrivateDirectory(dir: string, deps: Deps = {}): void {
  const stat = (deps.lstat ?? fs.lstatSync)(dir);
  if (stat.isSymbolicLink()) throw new PrivatePathError(dir, 'symlink');
  if (!stat.isDirectory()) throw new PrivatePathError(dir, 'not_directory');
  owned(dir, stat, deps.uid);
  if ((stat.mode & 0o077) !== 0) throw new PrivatePathError(dir, 'mode');
}

export function assertPrivateSocket(path: string, deps: Deps = {}): void {
  const stat = (deps.lstat ?? fs.lstatSync)(path);
  if (stat.isSymbolicLink()) throw new PrivatePathError(path, 'symlink');
  if (!stat.isSocket()) throw new PrivatePathError(path, 'not_socket');
  owned(path, stat, deps.uid);
  assertPrivateDirectory(dirname(path), deps);
}
