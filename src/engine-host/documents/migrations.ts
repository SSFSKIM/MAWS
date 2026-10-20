// The artifact store's database file and its schema history (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M2 and
// Decision Log 5 to 8, 11 and 12; parent §4.1 and §4.2): `<userData>/artifacts/store.sqlite`, opened by the engine host
// alone. The rules are the index's (src/main/index/db.ts): an append-only list where version N is the N-th entry, every
// pending entry applied in one transaction with `PRAGMA user_version` recording the count; a file a newer app wrote is
// opened read-only and left as it is; a file SQLite reports as corrupt or not a database is moved aside, never deleted,
// and a fresh one created. Never edit a released entry; append.
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  sql: string;
}

const KINDS = "'document','presentation','design','design_system','dashboard','html','file'";

export const STORE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    // Times are epoch milliseconds; an actor column holds `actorKey(actor)` (X29), its JSON in `actors`. The log, the
    // versions, the head, provenance and the bindings carry no foreign key to `artifacts`: their `artifactId` is an
    // opaque document key (the artifact's id for its main doc; P3-B stores a suggestion doc as `<artifactId>:suggest`),
    // an artifact is deleted softly (`deletedAt`), and the document service writes rows before the entity layer need.
    //   artifact_updates   the live revision is a global AUTOINCREMENT seq, never reused; `bytes` a V1 update for a Y
    //                      kind, `content` the JSON {name, sha256, size, path} of a byte kind's write (Decision Log 7)
    //   artifact_versions  `bytes` zstd V2, `enc` full or a delta from the previous retained version (Decision Log 8)
    //   artifact_head      one zstd V2 checkpoint per artifact; a load is the head plus the log rows after it
    //   artifact_attributions  encoded v14 ContentMaps, one `update` row per log row, merged into `hour` and `day`
    //                      rows by maintenance, never dropped (Decision Log 5)
    //   client_actors      the actor a clientID is bound to; `host` marks the host's own replica of that actor
    //                      (Decision Log 6 and 18)
    //   meta               host-held values: settings main relays (the design-system defaults, Decision Log 22d),
    //                      the last maintenance time
    sql: `
CREATE TABLE spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, linkedDir TEXT, createdAt INTEGER NOT NULL);
CREATE TABLE artifacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN (${KINDS})), title TEXT NOT NULL, handle TEXT,
  spaceId TEXT REFERENCES spaces(id) ON DELETE SET NULL, projectId TEXT, createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL, lastViewedAt INTEGER, pinned INTEGER NOT NULL DEFAULT 0, designSystemId TEXT, linkedPath TEXT,
  bindingVersion TEXT, deletedAt INTEGER, agentEditsAsSuggestions INTEGER NOT NULL DEFAULT 0);
CREATE INDEX artifacts_updated ON artifacts(updatedAt DESC);
CREATE INDEX artifacts_space ON artifacts(spaceId) WHERE spaceId IS NOT NULL;
CREATE INDEX artifacts_handle ON artifacts(handle) WHERE handle IS NOT NULL;
CREATE INDEX artifacts_design_system ON artifacts(designSystemId) WHERE designSystemId IS NOT NULL;
CREATE TABLE artifact_sessions (artifactId TEXT NOT NULL, appSessionId TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('created','edited','viewed','commented')), lastAt INTEGER NOT NULL,
  PRIMARY KEY (artifactId, appSessionId, role));
CREATE INDEX artifact_sessions_session ON artifact_sessions(appSessionId, artifactId);
CREATE TABLE artifact_updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, artifactId TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL,
  bytes BLOB, content TEXT, CHECK ((bytes IS NULL) <> (content IS NULL)));
CREATE INDEX artifact_updates_artifact ON artifact_updates(artifactId, seq);
CREATE TABLE artifact_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, artifactId TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL,
  actor TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('auto','turn','named','restore','import')), label TEXT, note TEXT, summary TEXT,
  enc TEXT CHECK (enc IN ('full','delta')), bytes BLOB, content TEXT, designSystemRef TEXT, assetRefs TEXT NOT NULL DEFAULT '[]');
CREATE INDEX artifact_versions_artifact ON artifact_versions(artifactId, seq);
CREATE INDEX artifact_versions_kind ON artifact_versions(artifactId, kind, id);
CREATE INDEX artifact_versions_design_system ON artifact_versions(designSystemRef) WHERE designSystemRef IS NOT NULL;
CREATE TABLE artifact_head (artifactId TEXT PRIMARY KEY, seq INTEGER NOT NULL, state BLOB NOT NULL);
CREATE TABLE artifact_attributions (artifactId TEXT NOT NULL, fromSeq INTEGER NOT NULL, toSeq INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('update','hour','day')), fromAt INTEGER NOT NULL, toAt INTEGER NOT NULL, bytes BLOB NOT NULL,
  PRIMARY KEY (artifactId, fromSeq));
CREATE INDEX artifact_attributions_tier ON artifact_attributions(tier, toAt);
CREATE TABLE client_actors (artifactId TEXT NOT NULL, clientId INTEGER NOT NULL, actor TEXT NOT NULL, firstSeq INTEGER NOT NULL,
  host INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (artifactId, clientId));
CREATE TABLE actors (key TEXT PRIMARY KEY, json TEXT NOT NULL, firstAt INTEGER NOT NULL);
CREATE TABLE artifact_threads (artifactId TEXT NOT NULL, threadId TEXT NOT NULL, status TEXT NOT NULL, quote TEXT NOT NULL,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, resolvedAt INTEGER, appSessionId TEXT, PRIMARY KEY (artifactId, threadId));
CREATE INDEX artifact_threads_session ON artifact_threads(appSessionId) WHERE appSessionId IS NOT NULL;
CREATE TABLE artifact_assets (artifactId TEXT NOT NULL, assetId TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, createdAt INTEGER NOT NULL, createdBy TEXT NOT NULL, PRIMARY KEY (artifactId, assetId));
CREATE INDEX artifact_assets_sha ON artifact_assets(sha256);
CREATE TABLE artifact_ops (opId TEXT PRIMARY KEY, artifactId TEXT, tool TEXT NOT NULL, result TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  // P3-H start (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 80; the X15 slot "host artifacts
  // store schema 2"): the owner's connector grants, one per artifact and tool (@shared/artifacts/connectors). Beside the
  // artifact and never content: no version, copy, export or restore carries one. The foreign key cascades a hard
  // delete; an artifact's soft delete removes its grants explicitly in its own transaction (store.ts).
  {
    version: 2,
    sql: `
CREATE TABLE artifact_connector_grants (artifactId TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, server TEXT NOT NULL,
  tool TEXT NOT NULL, fingerprint TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('read','once')), grantedAt INTEGER NOT NULL,
  PRIMARY KEY (artifactId, server, tool));
`,
  },
  // P3-H end
  // E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1; E's Decision Log 48 (1), the schema slot 3 it
  // allocates): the query snapshots' retention. `querySnapshot` 1 marks an asset E3 registered as a query's snapshot
  // (every other asset, and every row this migration finds, stays 0: never collected); `retiredAt` set takes such an
  // asset out of every later version's asset refs, the versions already written untouched. `artifact_query_snapshots`
  // is each live query's membership, at most two rows per query kept by the publication's own write frame (never a
  // trigger, which could drop another query's shared row); `lastUsedSeq` the revision that last published the snapshot.
  {
    version: 3,
    sql: `
ALTER TABLE artifact_assets ADD COLUMN querySnapshot INTEGER NOT NULL DEFAULT 0 CHECK (querySnapshot IN (0, 1));
ALTER TABLE artifact_assets ADD COLUMN retiredAt INTEGER;
CREATE TABLE artifact_query_snapshots (
  artifactId TEXT NOT NULL, datasetId TEXT NOT NULL, assetId TEXT NOT NULL, lastUsedSeq INTEGER NOT NULL,
  PRIMARY KEY (artifactId, datasetId, assetId),
  FOREIGN KEY (artifactId, assetId) REFERENCES artifact_assets(artifactId, assetId) ON DELETE CASCADE
);
`,
  },
  // E3 end
  // P4-B4 start (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The mirror"; the P4 ledger's X15 slot "the
  // host store's next schema version" and its X23 row): `artifact_search`'s full-text mirror, main's `library_text`
  // shape. `artifact_text` holds each live artifact's title and sectioned body (trigram FTS5, so a term of three
  // characters or more matches inside a longer word); `artifact_text_rows` the revision and title each row was written
  // at, by which a row is told stale, and the body's sections (`[offset, place][]` JSON, `@artifacts/library/sections`).
  // Left empty here: the search's catch-up and the host's sweep fill it (search.ts).
  {
    version: 4,
    sql: `
CREATE VIRTUAL TABLE artifact_text USING fts5(artifact_id UNINDEXED, title, body, tokenize = 'trigram');
CREATE TABLE artifact_text_rows (artifactId TEXT PRIMARY KEY, textRowid INTEGER NOT NULL UNIQUE, revision INTEGER NOT NULL,
  title TEXT NOT NULL, sections TEXT NOT NULL);
`,
  },
  // P4-B4 end
];

// `ok`; `readOnly`: a newer app's file, every write refused with `storeTooNew`; `recovered`: the file at the path was
// not a database, was moved aside and a fresh store created (surfaced through `artifacts.status`, M4).
export type StoreStatus = 'ok' | 'readOnly' | 'recovered';

export interface OpenedStore {
  db: DatabaseSync;
  status: StoreStatus;
  reason: string | null; // why not `ok`
  applied: number[]; // the migrations this open ran
}

// SQLite result codes meaning the file itself is not a usable database (primary codes, in an extended code's low byte).
// Anything else at open (SQLITE_BUSY, an I/O error) is environmental and must never cost the owner a valid store.
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const isBrokenFile = (error: unknown): boolean => {
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'number' && [SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff);
};

export function openStore(path: string, migrations: readonly Migration[] = STORE_MIGRATIONS, log: (line: string) => void = (line) => console.error(`[documents] ${line}`)): OpenedStore {
  mkdirSync(dirname(path), { recursive: true });
  const known = migrations.length;
  let status: StoreStatus = 'ok';
  let reason: string | null = null;
  let db: DatabaseSync;
  let version: number;
  try {
    ({ db, version } = probe(path));
  } catch (error) {
    if (!isBrokenFile(error)) throw error;
    const aside = `${path}.broken-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) renameSync(path + suffix, aside + suffix);
    status = 'recovered';
    reason = `${path} was not a usable database (${error instanceof Error ? error.message : String(error)}); moved aside as ${aside}`;
    log(reason);
    ({ db, version } = probe(path));
  }

  if (version > known) {
    db.close();
    reason = `user_version ${version} is newer than this app knows (${known})`;
    log(`${path}: ${reason}; the store is read-only this run and the file is left as it is`);
    const readOnly = new DatabaseSync(path, { readOnly: true });
    readOnly.exec('PRAGMA busy_timeout = 2000');
    return { db: readOnly, status: 'readOnly', reason, applied: [] };
  }

  try {
    // auto_vacuum takes effect only before the first table is created (Decision Log 8); WAL persists in the file; the
    // rest are this connection's.
    if (version === 0) db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA foreign_keys = ON');
    const pending = migrations.slice(version);
    if (pending.length > 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const migration of pending) db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${known}`);
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
    return { db, status, reason, applied: pending.map((migration) => migration.version) };
  } catch (error) {
    db.close();
    throw error;
  }
}

// Opens the file and reads its schema version, changing nothing; reading `user_version` is what surfaces SQLITE_NOTADB
// or SQLITE_CORRUPT for a file that is not a database.
function probe(path: string): { db: DatabaseSync; version: number } {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 2000');
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return { db, version: user_version };
  } catch (error) {
    db.close();
    throw error;
  }
}
