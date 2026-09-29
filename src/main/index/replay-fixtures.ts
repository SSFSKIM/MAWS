// The replay fixtures the index lists (C4 execution document, M5 fills and plays them): a probe journal or a transcript
// JSONL by absolute path, one row per path.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readSync, type Dirent } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ReplayFixture } from '@shared/ipc/schema/session';
import { JournalRowSchema } from '@shared/wire/journal';
import type { Db } from './db';

interface FixtureRow {
  id: string;
  name: string;
  kind: ReplayFixture['kind'];
  path: string;
  session_id: string | null;
  added_at: string;
  last_played_at: string | null;
}

const toFixture = (row: FixtureRow): ReplayFixture => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  path: row.path,
  sessionId: row.session_id,
  addedAt: row.added_at,
  lastPlayedAt: row.last_played_at,
});

export class ReplayFixtureStore {
  constructor(private readonly db: Db) {}

  list(): ReplayFixture[] {
    return this.db.all<FixtureRow>('SELECT * FROM replay_fixtures ORDER BY kind, name, path').map(toFixture);
  }

  // Idempotent by path: a fixture already listed is answered as it is.
  add(fixture: { name: string; kind: ReplayFixture['kind']; path: string; sessionId: string | null }): ReplayFixture {
    return this.db.transaction(() => {
      const existing = this.db.get<FixtureRow>('SELECT * FROM replay_fixtures WHERE path = ?', fixture.path);
      if (existing) return toFixture(existing);
      const id = randomUUID();
      this.db.insert('replay_fixtures', { id, name: fixture.name, kind: fixture.kind, path: fixture.path, session_id: fixture.sessionId, added_at: new Date().toISOString(), last_played_at: null });
      return toFixture(this.db.get<FixtureRow>('SELECT * FROM replay_fixtures WHERE id = ?', id)!);
    });
  }

  markPlayed(id: string, at: string): void {
    this.db.transaction(() => void this.db.update('replay_fixtures', 'id', id, { last_played_at: at }));
  }
}

// Seeding (M5): every probe journal under `<root>/spikes/protocol-probe/fixtures/**` and every transcript under
// `<root>/test/fixtures/transcripts/` that exists, by absolute path, named by its file's stem. A probe-tree file is a
// journal when its physical first line (the first non-blank one, which a launch reads first) is an X8 row: a corrupt
// line 1 is not a journal, since its launch would fail there, and the tree also holds sidecar transcripts and a
// workflow's own journal, which are not journals either. The session id is the first one the file's head names. Idempotent by path, so it runs at every open; a
// packaged app, whose root holds neither tree, seeds nothing.
const HEAD_BYTES = 64 * 1024;

export function seedReplayFixtures(store: ReplayFixtureStore, root: string): void {
  for (const path of jsonlUnder(join(root, 'spikes/protocol-probe/fixtures'), true)) {
    const lines = headLines(path);
    if (lines.length === 0 || !JournalRowSchema.safeParse(lines[0]).success) continue;
    const frames = lines.map((line) => (line as { frame?: { session_id?: unknown } } | undefined)?.frame);
    store.add({ name: basename(path, '.jsonl'), kind: 'journal', path, sessionId: firstString(frames.map((frame) => frame?.session_id)) });
  }
  for (const path of jsonlUnder(join(root, 'test/fixtures/transcripts'), false)) {
    const records = headLines(path) as { sessionId?: unknown }[];
    store.add({ name: basename(path, '.jsonl'), kind: 'transcript', path, sessionId: firstString(records.map((record) => record?.sessionId)) });
  }
}

// The checkout the app runs from: the nearest directory at or above the app path holding a package.json (the repository
// under `pnpm dev`, whose app path may be `out/main`; the asar itself when packaged, which holds no fixture trees).
export function appRoot(appPath: string): string {
  for (let dir = appPath; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) return appPath;
  }
}

function jsonlUnder(dir: string, recursive: boolean): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return recursive ? jsonlUnder(path, true) : [];
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
    })
    .sort();
}

// The non-blank whole lines of the file's first 64 KiB, in order, each parsed or `undefined` where it does not parse
// (so the first entry is the line a launch would read first); an unreadable file has none.
function headLines(path: string): unknown[] {
  let head: string;
  try {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(HEAD_BYTES);
      head = buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0)).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const lines = head.split('\n');
  if (!head.endsWith('\n')) lines.pop(); // a line the window cut
  return lines.flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      return [JSON.parse(line.replace(/^\0+/, '')) as unknown];
    } catch {
      return [undefined];
    }
  });
}

const firstString = (values: unknown[]): string | null => (values.find((value) => typeof value === 'string' && value.length > 0) as string | undefined) ?? null;
