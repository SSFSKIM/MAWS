// A session host's binary and files (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §B and §H). The
// binary is resolved at each spawn from the engine host's own build location, never from another build's: after an app
// bundle swap an engine host spawns the new bundle's session host, which speaks the same protocol major (M1). The host's
// files live in `<profile>/supervisor/hosts/` (0700), one set per launch, named by its launch id.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SOCKET_PATH_MAX_BYTES } from '../supervisor-files';

export const SESSION_HOST_BINARY = 'maws-session-host';

export function hostsDirOf(supervisorDir: string): string {
  return join(supervisorDir, 'hosts');
}

// The binary beside the build `entryFile` belongs to (the engine host's entry: `process.argv[1]` when detached):
// a packaged app's `Contents/Resources/session-host/` (electron-builder's extraResources), `mawsd`'s Linux release's
// `bin/` (scripts/mawsd-pack.mjs; its package.json names the release), or a checkout's prebuild for this platform.
export function sessionHostBinary(
  entryFile: string = process.argv[1] ?? '',
  target: { platform: NodeJS.Platform; arch: string } = { platform: process.platform, arch: process.arch },
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  const archive = /^(.*?)[/\\][^/\\]+\.asar(?:[/\\]|$)/.exec(entryFile);
  if (archive) return join(archive[1], 'session-host', SESSION_HOST_BINARY);
  const root = resolve(dirname(entryFile), '..', '..'); // entries are emitted to <root>/out/main/
  if (isRelease(root, readFile)) return join(root, 'bin', SESSION_HOST_BINARY);
  return join(root, 'native', 'session-host', 'prebuilds', `${target.platform}-${target.arch}`, SESSION_HOST_BINARY);
}

function isRelease(root: string, readFile: (path: string) => string): boolean {
  try {
    const manifest = JSON.parse(readFile(join(root, 'package.json'))) as { mawsd?: unknown };
    return typeof manifest.mawsd === 'object' && manifest.mawsd !== null;
  } catch {
    return false;
  }
}

export interface SessionHostPaths {
  roster: string; // written by the host, at every state change
  token: string; // written by the engine host before the spawn, removed by the host at its exit
  socket: string;
  log: string;
}

// One launch's files. The socket sits beside them when its path fits sun_path, else in a per-profile 0700 directory
// under the user's tmpdir (`maws-session-hosts-<12 hex of the profile's sha1>`), as the supervisor's socket does
// (supervisor-files.ts socketPathFor); the roster records the path, so a reader never computes the fallback itself.
export function sessionHostPaths(hostsDir: string, launchId: string, opts: { userData: string; tmpdir: string }): SessionHostPaths {
  const inDir = join(hostsDir, `${launchId}.sock`);
  const fits = Buffer.byteLength(inDir, 'utf8') <= SOCKET_PATH_MAX_BYTES;
  const profile = createHash('sha1').update(opts.userData).digest('hex').slice(0, 12);
  return {
    roster: join(hostsDir, `${launchId}.json`),
    token: join(hostsDir, `${launchId}.token`),
    socket: fits ? inDir : join(opts.tmpdir, `maws-session-hosts-${profile}`, `${launchId}.sock`),
    log: join(hostsDir, `${launchId}.log`),
  };
}
