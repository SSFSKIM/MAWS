// The spine's files on a profile (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1's table, binding; P5 O9:
// and lane A's driver files): every file at or under SPINE_PATHS with its bytes, and each directory, so two readings
// compare equal only when no spine file changed and none appeared. e2e/spine-lock.spec.ts compares them across a run
// refused the spine (O3-A acceptance 5); e2e/cross-build.spec.ts's `(pre-O3 app, daemon)` scene across an O2-era app's
// idle after `mawsd` yielded to it (P5 O3-D acceptance 11), and src/mawsd/process-yield.test.ts across the yield itself.
// spineFilesOpen: the spine files a process holds open, by lsof on macOS and /proc/<pid>/fd on Linux, whose images
// carry no lsof (P5 O3-D M6 fix rounds 1, 2: the yield's per-process proof).
// indexContents: the index's logical contents, schema and rows, read from a copy (fix round 2: what a checkpoint keeps).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

// Every path under the profile's SPINE_PATHS that `pid` holds open (empty for a process gone): lsof's name field on
// macOS; on Linux each of /proc/<pid>/fd's links, a file unlinked while open still counted (its " (deleted)" mark cut)
export function spineFilesOpen(pid: number, userData: string): string[] {
  const roots = SPINE_PATHS.map((name) => join(userData, name));
  return openPaths(pid).filter((path) => roots.some((root) => path === root || path.startsWith(`${root}/`)));
}

function openPaths(pid: number): string[] {
  if (process.platform === 'linux') {
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // the process is gone
      throw error;
    }
    return fds.flatMap((fd) => {
      try {
        return [readlinkSync(`/proc/${pid}/fd/${fd}`).replace(/ \(deleted\)$/, '')];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; // closed between the listing and the read
        throw error; // a denied or failed read proves nothing about what the process holds
      }
    });
  }
  const listed = spawnSync('lsof', ['-n', '-P', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
  if (listed.error) throw listed.error;
  return listed.stdout.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

// The index's schema (sqlite_master, user_version) and every row of every stored table (an FTS table's content through its
// shadow tables), read from a copy of index.sqlite with its -wal and -shm, so the reading neither takes a lock on the
// live files nor checkpoints them. A checkpoint moves pages from the WAL into the main file and leaves this unchanged;
// any write to a row or the schema changes it.
export function indexContents(userData: string): { schema: unknown[]; userVersion: unknown; rows: Record<string, string[]> } {
  const copy = mkdtempSync(join(tmpdir(), 'maws-index-copy-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = join(userData, `index.sqlite${suffix}`);
      if (existsSync(from)) copyFileSync(from, join(copy, `index.sqlite${suffix}`));
    }
    const db = new DatabaseSync(join(copy, 'index.sqlite'));
    try {
      const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name").all() as { name: string }[];
      const rows: Record<string, string[]> = {};
      for (const { name } of tables) rows[name] = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map((row) => JSON.stringify(row, (_key, value: unknown) => (value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value))).sort();
      return { schema, userVersion: db.prepare('PRAGMA user_version').get(), rows };
    } finally {
      db.close();
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
