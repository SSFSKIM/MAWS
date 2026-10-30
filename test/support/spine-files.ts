// The spine's files on a profile (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1's table, binding; P5 O9:
// and lane A's driver files): every file at or under SPINE_PATHS with its bytes, and each directory, so two readings
// compare equal only when no spine file changed and none appeared. e2e/spine-lock.spec.ts compares them across a run
// refused the spine (O3-A acceptance 5); e2e/cross-build.spec.ts's `(pre-O3 app, daemon)` scene across an O2-era app's
// idle after `mawsd` yielded to it (P5 O3-D acceptance 11), and src/mawsd/process-yield.test.ts across the yield itself.
// spineFilesOpen: the spine files a process holds open, by lsof (P5 O3-D M6 fix round 1: the yield's per-process proof).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SPINE_PATHS = ['index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm', 'machine-settings.json', 'sessions', 'prompt-history.jsonl', 'attention.json', 'lane-a'];

export function spineFiles(userData: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      files.set(`${relative(userData, path)}/`, '');
      for (const name of readdirSync(path)) visit(join(path, name));
    } else files.set(relative(userData, path), readFileSync(path).toString('base64'));
  };
  for (const name of SPINE_PATHS) visit(join(userData, name));
  return files;
}

// Every path under the profile's SPINE_PATHS that `pid` holds open, by lsof's name field (empty for a process gone)
export function spineFilesOpen(pid: number, userData: string): string[] {
  const listed = spawnSync('lsof', ['-n', '-P', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
  if (listed.error) throw listed.error;
  const roots = SPINE_PATHS.map((name) => join(userData, name));
  return listed.stdout.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1)).filter((path) => roots.some((root) => path === root || path.startsWith(`${root}/`)));
}
