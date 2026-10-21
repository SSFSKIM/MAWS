// `artifact_search`'s full-text mirror in the host's store (P4-B4: docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md,
// "The mirror", "Freshness", "The query", "The snippet and `read`"; Decision Log 3 and 4; the X23 row for the mirror's
// tables, schema 4 in `./migrations.ts`). One `artifact_text` row (trigram FTS5) per live artifact holds its title and
// its sectioned body (`@artifacts/library/sections`); `artifact_text_rows` the revision and title the row was written
// at, and the body's sections. Main's library index (`main/library/store.ts`) is not touched and nothing crosses to main.
//
// Freshness without a write-path extraction. A row is stale when it is missing for a live artifact, when its revision is
// not the artifact's live revision (every write records one), or when its title is not the artifact's. A search first
// brings the stale rows among the artifacts it may return up to date, newest first, within SEARCH_CATCHUP_MS, and names
// what that budget left in its hint; beside it, a refresher re-extracts a changed artifact once its changes settle
// (MIRROR_SETTLE_MS, one artifact per macrotask; one the document service holds loaded waits for its unload, then
// settles like a change, so no extraction runs on the loop beside the owner's typing, Decision Log 18) and a sweep after
// the store opens (MIRROR_SWEEP_DELAY_MS) fills the rows the migration left empty and drops those of deleted artifacts.
// All that background extraction waits for the host to be quiet (Decision Log 24): no artifact commit for
// MIRROR_QUIET_MS and no batch open, checked again before each artifact, so it never lands in an agent's batch or the
// owner's burst of edits. And it never takes a large artifact (MIRROR_BACKGROUND_MAX_BYTES as stored, Decision Log
// 25): one is left stale for the search's catch-up, which still brings it up to date within its budget. The query joins the live `artifacts`, so a deleted
// artifact is never returned meanwhile. So a write committed in the host is found by the next search.
//
// Writes follow the store's discipline: each artifact's row is written inside its own savepoint of the document
// service's group-commit batch (`service.inBatch`), extracted in the same synchronous frame from the state that batch
// holds, so the row commits with the rows it was read from or is taken back with them (a lost batch leaves the row as
// it was: stale, which the next search repairs). A search's answer is read through `store.readCommitted`. A read-only
// store (a newer app's file) searches what the mirror holds and writes nothing.
import { readFiles } from '@artifacts/files';
import { FILE_MODEL_KINDS, placeAt, sectionText, type Section, type SectionedText, type SectionSource } from '@artifacts/library/sections';
import { FILE_TEXT_MAX_BYTES } from '@artifacts/library/text';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { isDocKind, type ArtifactKind, type DocKind } from '@shared/artifacts/entity';
import { instrTerms, matchExpression, type QueryTerm } from '@shared/artifacts/search-query';
import type { ArtifactSearchRead } from '@shared/maws/search-tools';
import { byteContentOf, fileBytes } from '../library/reads';
import { timed } from './host-work'; // P4-R6
import type { ArtifactStore, EntityRow } from './store';

export const SEARCH_CATCHUP_MS = 400; // a search's budget for bringing stale rows up to date before it queries
export const MIRROR_SETTLE_MS = 2_000; // the refresher re-extracts a changed artifact this long after its last change
export const MIRROR_SWEEP_DELAY_MS = 5_000; // the sweep starts this long after the store opens
export const MIRROR_QUIET_MS = 2_000; // background extraction waits until no artifact has committed for this long
// Background work never takes an artifact stored this large (Decision Log 25): a quiet window cannot rule out an agent's
// batch starting during its extraction, so a large one is left stale for the search-time catch-up.
export const MIRROR_BACKGROUND_MAX_BYTES = 16 * 1024; // Decision Log 25 as revised: a few pages; larger waits for a search
// The catch-up yields to the host's loop after this much synchronous extraction (its rows commit in that batch), so a
// search that has many rows to bring up to date shares the loop with the typing and the agents' batches.
export const CATCHUP_SLICE_MS = 50;
export const SNIPPET_BEFORE = 80; // code points before the anchor
export const SNIPPET_AFTER = 160; // code points after the term
export const SNIPPET_LEAD = 240; // a title-only hit's snippet: the body's first code points
const SNIPPET_SNAP = 16; // an end moves to a whitespace this close, so no word is cut

export interface SearchTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const hostTimers: SearchTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ArtifactSearchOptions {
  now?: () => number; // the catch-up's clock, in milliseconds
  timers?: SearchTimers; // the refresher's and the sweep's
  log?: (line: string) => void;
  catchUpMs?: number;
  settleMs?: number;
  sweepDelayMs?: number;
  quietMs?: number;
}

export interface SearchRequest {
  terms: readonly QueryTerm[]; // at least one (`parseQuery`'s)
  kind?: ArtifactKind;
  spaceId?: string;
  linkedTo?: readonly string[]; // `scope: 'session'`: the lineage the artifacts must be linked to
  limit: number;
}

// A hit with what `artifact_list`'s row is built from (read at the query, inside its commit barrier).
export interface SearchHit {
  id: string;
  kind: ArtifactKind;
  title: string;
  handle: string | null;
  spaceId: string | null;
  spaceName: string | undefined;
  updatedAt: number;
  revision: number;
  lastWrite: { actor: Actor; at: number } | null;
  snippet?: string;
  read?: ArtifactSearchRead;
}

export interface SearchAnswer {
  hits: SearchHit[];
  more: boolean;
  searchedAsBefore: number; // the changed artifacts the catch-up left searched in their earlier text
}

interface MirrorRow {
  textRowid: number;
  revision: number;
  title: string;
}

interface QueryRow {
  id: string;
  kind: ArtifactKind;
  title: string;
  handle: string | null;
  spaceId: string | null;
  updatedAt: number;
  body: string;
  sections: string;
}

export class ArtifactSearch {
  private readonly now: () => number;
  private readonly timers: SearchTimers;
  private readonly log: (line: string) => void;
  private readonly catchUpMs: number;
  private readonly settleMs: number;
  private readonly sweepDelayMs: number;
  private readonly quietMs: number;
  private readonly settling = new Map<string, unknown>(); // artifact → its settle timer
  private readonly queue = new Set<string>(); // the refresher's and the sweep's artifacts, in order
  private readonly untilUnloaded = new Set<string>(); // queued while the document service held them loaded
  private pumpTimer: unknown = null;
  private sweepTimer: unknown = null;
  private quietTimer: unknown = null; // running while the host is not yet quiet (Decision Log 24)
  private sweepDue = false; // the sweep's time came while the host was busy
  private stepping = false;
  private offs: (() => void)[] = [];
  private closed = false;

  constructor(
    private readonly store: ArtifactStore,
    options: ArtifactSearchOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.timers = options.timers ?? hostTimers;
    this.log = options.log ?? ((line) => console.warn(`[search] ${line}`));
    this.catchUpMs = options.catchUpMs ?? SEARCH_CATCHUP_MS;
    this.settleMs = options.settleMs ?? MIRROR_SETTLE_MS;
    this.sweepDelayMs = options.sweepDelayMs ?? MIRROR_SWEEP_DELAY_MS;
    this.quietMs = options.quietMs ?? MIRROR_QUIET_MS;
  }

  private get writable(): boolean {
    return !this.store.storage.readOnly && !this.closed;
  }

  // The refresher on the store's change feed (and the document service's unloads) and the sweep after
  // MIRROR_SWEEP_DELAY_MS, both held back while the host is busy (every commit restarts the quiet window); neither on a
  // read-only store.
  start(): void {
    if (this.offs.length > 0 || !this.writable) return;
    this.offs = [
      this.store.onChange(({ artifactId, change }) => {
        this.busy();
        if (change !== 'linked') this.settle(artifactId);
      }),
      this.store.service.onCommitted(() => this.busy()), // a document's every commit, before the feed coalesces them
      // an unload settles like a change: an entry already queued (a change that settled while the host was busy) is
      // withdrawn, so it waits for this settle too
      this.store.service.onUnload((artifactId) => {
        const setAside = this.untilUnloaded.delete(artifactId);
        if (!setAside && !this.queue.has(artifactId)) return;
        this.queue.delete(artifactId);
        this.settle(artifactId);
      }),
    ];
    this.sweepTimer = this.timers.setTimeout(() => this.sweep(), this.sweepDelayMs);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.untilUnloaded.clear();
    for (const timer of this.settling.values()) this.timers.clearTimeout(timer);
    this.settling.clear();
    this.queue.clear();
    if (this.pumpTimer !== null) this.timers.clearTimeout(this.pumpTimer);
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer);
    this.pumpTimer = this.sweepTimer = this.quietTimer = null;
  }

  // ── the search ──

  async search(request: SearchRequest): Promise<SearchAnswer> {
    const searchedAsBefore = this.writable ? await this.catchUp(this.stale(request)) : 0;
    const { rows, spaceNames, more, revisions, lastWrites } = await this.store.readCommitted(() => {
      const rows = this.query(request);
      const shown = rows.slice(0, request.limit);
      return {
        rows: shown,
        more: rows.length > request.limit,
        revisions: shown.map((row) => this.store.revision(row.id)),
        lastWrites: shown.map((row) => this.store.lastWrite(row.id)),
        spaceNames: new Map(this.store.listSpaces().map((space) => [space.id, space.name])),
      };
    });
    const hits = rows.map((row, index): SearchHit => {
      const sectioned: SectionedText = { body: row.body, sections: JSON.parse(row.sections) as Section[] };
      return {
        id: row.id, kind: row.kind, title: row.title, handle: row.handle, spaceId: row.spaceId, spaceName: row.spaceId === null ? undefined : spaceNames.get(row.spaceId),
        updatedAt: row.updatedAt, revision: revisions[index]!, lastWrite: lastWrites[index]!,
        ...snippetAndRead(sectioned, request.terms),
      };
    });
    return { hits, more, searchedAsBefore };
  }

  // The candidates' stale rows, newest first: the live artifacts the search may return whose row is missing, at another
  // revision or under another title.
  private stale(request: Omit<SearchRequest, 'terms' | 'limit'>): string[] {
    const { where, params } = candidates(request);
    const rows = this.store.storage.db
      .prepare(`SELECT a.id, a.title, r.revision AS mirrored, r.title AS mirroredTitle FROM artifacts a LEFT JOIN artifact_text_rows r ON r.artifactId = a.id WHERE ${where.join(' AND ')} ORDER BY a.updatedAt DESC, a.id`)
      .all(...params) as { id: string; title: string; mirrored: number | null; mirroredTitle: string | null }[];
    return rows.filter((row) => row.mirrored === null || row.mirroredTitle !== row.title || row.mirrored !== this.store.revision(row.id)).map((row) => row.id);
  }

  // Brings `stale` up to date in order within the budget: extracted synchronously in slices of CATCHUP_SLICE_MS, each
  // slice's rows committed with the batch they joined before the next. Answers how many it left (or whose batch failed).
  private async catchUp(stale: string[]): Promise<number> {
    const started = this.now();
    const inBudget = () => this.now() - started < this.catchUpMs;
    let next = 0;
    let failed = 0;
    while (next < stale.length && inBudget()) {
      const slice = this.now();
      const pending = [this.refresh(stale[next++]!, 'mirror catch-up')]; // a slice takes one at least, however long it runs
      while (next < stale.length && inBudget() && this.now() - slice < CATCHUP_SLICE_MS) pending.push(this.refresh(stale[next++]!, 'mirror catch-up'));
      failed += (await Promise.all(pending)).filter((done) => !done).length;
    }
    return stale.length - next + failed;
  }

  // One artifact's row brought up to date in its own savepoint of the batch; true once that batch committed. P4-R6: timed
  // as the host's work (`what`: the background refresh or a search's catch-up), named by what it did.
  private refresh(artifactId: string, what: 'mirror' | 'mirror catch-up'): Promise<boolean> {
    let did: string | undefined;
    return this.store.service.inBatch(() => timed(what, () => (did = this.refreshInFrame(artifactId)), () => did)).then(
      () => true,
      (error: unknown) => {
        this.log(`the search mirror of ${artifactId} was not written: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      },
    );
  }

  // What it did, for the host's work record (P4-R6).
  private refreshInFrame(artifactId: string): string {
    const db = this.store.storage.db;
    const row = this.store.entity(artifactId);
    const mirrored = db.prepare('SELECT textRowid, revision, title FROM artifact_text_rows WHERE artifactId = ?').get(artifactId) as MirrorRow | undefined;
    if (!row || row.deletedAt !== null) {
      if (mirrored) {
        db.prepare('DELETE FROM artifact_text WHERE rowid = ?').run(mirrored.textRowid);
        db.prepare('DELETE FROM artifact_text_rows WHERE artifactId = ?').run(artifactId);
      }
      return 'a deleted row dropped';
    }
    const revision = this.store.revision(artifactId);
    if (mirrored && mirrored.revision === revision) {
      if (mirrored.title === row.title) return 'current';
      // a rename moves no revision: the title alone is rewritten
      db.prepare('UPDATE artifact_text SET title = ? WHERE rowid = ?').run(row.title.normalize('NFC'), mirrored.textRowid);
      db.prepare('UPDATE artifact_text_rows SET title = ? WHERE artifactId = ?').run(row.title, artifactId);
      return 'a title';
    }
    const text = this.extract(row);
    const sections = JSON.stringify(text.sections);
    if (mirrored) {
      db.prepare('UPDATE artifact_text SET title = ?, body = ? WHERE rowid = ?').run(row.title.normalize('NFC'), text.body, mirrored.textRowid);
      db.prepare('UPDATE artifact_text_rows SET revision = ?, title = ?, sections = ? WHERE artifactId = ?').run(revision, row.title, sections, artifactId);
    } else {
      const textRowid = Number(db.prepare('INSERT INTO artifact_text (artifact_id, title, body) VALUES (?, ?, ?)').run(artifactId, row.title.normalize('NFC'), text.body).lastInsertRowid);
      db.prepare('INSERT INTO artifact_text_rows (artifactId, textRowid, revision, title, sections) VALUES (?, ?, ?, ?, ?)').run(artifactId, textRowid, revision, row.title, sections);
    }
    return `${row.kind} text, ${text.body.length} characters`;
  }

  // The artifact's text as its frame's batch holds it: a loaded document's live doc, another's stored state, a byte
  // kind's latest content. An artifact whose content cannot be read is mirrored by its title alone (logged), so it is
  // not read again until it changes.
  private extract(row: EntityRow): SectionedText {
    try {
      if (isDocKind(row.kind)) {
        const live = this.store.service.loaded(row.id);
        if (live) return sectionText(this.docSource(row.kind, live));
        const doc = newDoc();
        try {
          applyV2(doc, this.store.service.readState(row.id).state);
          return sectionText(this.docSource(row.kind, doc));
        } finally {
          doc.destroy();
        }
      }
      const content = byteContentOf(this.store, row.id);
      const source: SectionSource = row.kind === 'html' && 'bytes' in content ? { kind: 'html', bytes: content.bytes } : { kind: 'file', name: content.name, bytes: 'bytes' in content ? content.bytes : fileBytes(content.path, FILE_TEXT_MAX_BYTES) };
      return sectionText(source);
    } catch (error) {
      this.log(`the text of ${row.id} could not be read for search; its title alone is searched: ${error instanceof Error ? error.message : String(error)}`);
      return { body: '', sections: [] };
    }
  }

  // A file model's files as `artifact_read` answers them: the kind's own `readFiles`, else the generic file model's.
  private docSource(kind: DocKind, doc: Doc): SectionSource {
    if ((FILE_MODEL_KINDS as readonly string[]).includes(kind)) {
      const files = this.store.service.adapterFor(kind)?.readFiles?.(doc) ?? readFiles(doc);
      return { kind: kind as (typeof FILE_MODEL_KINDS)[number], files };
    }
    return { kind: kind as 'document' | 'dashboard', doc };
  }

  private query(request: SearchRequest): QueryRow[] {
    const { sql, params } = searchQuery(request);
    return this.store.storage.db.prepare(sql).all(...params) as unknown as QueryRow[];
  }

  // ── the refresher and the sweep ──

  private storedBytes(artifactId: string): number {
    return storedBytesOf(this.store, artifactId);
  }

  // An artifact committed: the quiet window starts again, and at its end the deferred sweep and the queue go on.
  private busy(): void {
    if (this.closed) return;
    if (this.quietTimer !== null) this.timers.clearTimeout(this.quietTimer);
    this.quietTimer = this.timers.setTimeout(() => {
      this.quietTimer = null;
      if (this.sweepDue) this.sweep();
      this.pump();
    }, this.quietMs);
  }

  // No artifact commit for MIRROR_QUIET_MS and no batch open now. A batch open (rows on their way to a commit) counts as
  // a commit, so the window starts again.
  private quiet(): boolean {
    if (this.store.storage.batchOpen) this.busy();
    return this.quietTimer === null;
  }

  private settle(artifactId: string): void {
    if (this.closed) return;
    const pending = this.settling.get(artifactId);
    if (pending !== undefined) this.timers.clearTimeout(pending);
    this.settling.set(
      artifactId,
      this.timers.setTimeout(() => {
        this.settling.delete(artifactId);
        this.enqueue([artifactId]);
      }, this.settleMs),
    );
  }

  // Every live artifact whose row is stale, newest first, then the rows of artifacts deleted or gone.
  private sweep(): void {
    this.sweepTimer = null;
    if (!this.writable) return;
    if (!this.quiet()) {
      this.sweepDue = true;
      return;
    }
    this.sweepDue = false;
    const orphans = this.store.storage.db.prepare('SELECT r.artifactId AS id FROM artifact_text_rows r LEFT JOIN artifacts a ON a.id = r.artifactId WHERE a.id IS NULL OR a.deletedAt IS NOT NULL').all() as { id: string }[];
    this.enqueue([...this.stale({}), ...orphans.map((row) => row.id)]);
  }

  private enqueue(artifactIds: readonly string[]): void {
    for (const artifactId of artifactIds) this.queue.add(artifactId);
    this.pump();
  }

  // One artifact per macrotask, the next once its row's batch has committed; one held loaded is set aside until it unloads.
  private pump(): void {
    if (!this.writable || this.stepping || this.pumpTimer !== null || this.queue.size === 0 || !this.quiet()) return;
    this.pumpTimer = this.timers.setTimeout(() => {
      this.pumpTimer = null;
      void this.step();
    }, 0);
  }

  private async step(): Promise<void> {
    const artifactId = this.queue.values().next().value;
    if (artifactId === undefined || !this.writable || !this.quiet()) return; // the quiet window's end pumps again
    this.queue.delete(artifactId);
    if (this.store.service.loaded(artifactId)) {
      // Decision Log 18: held open (an editor, an agent's replica), so it waits for its unload; a search catches it up
      this.untilUnloaded.add(artifactId);
      return this.pump();
    }
    if (this.storedBytes(artifactId) >= MIRROR_BACKGROUND_MAX_BYTES) return this.pump(); // Decision Log 25: the search's
    this.stepping = true;
    try {
      await this.refresh(artifactId, 'mirror');
    } finally {
      this.stepping = false;
    }
    this.pump();
  }
}

// The artifact's size as the store holds it, read without decoding anything: a Y kind's compressed head and the update
// rows after it, a byte kind's content as its latest write recorded it (0 for a deleted or unknown artifact, whose row
// the refresh drops).
function storedBytesOf(store: ArtifactStore, artifactId: string): number {
  const row = store.entity(artifactId);
  if (!row || row.deletedAt !== null) return 0;
  const db = store.storage.db;
  if (isDocKind(row.kind)) {
    const { bytes } = db
      .prepare(
        'SELECT COALESCE((SELECT length(state) FROM artifact_head WHERE artifactId = ?1), 0) + COALESCE((SELECT SUM(length(bytes)) FROM artifact_updates WHERE artifactId = ?1 AND bytes IS NOT NULL AND seq > COALESCE((SELECT seq FROM artifact_head WHERE artifactId = ?1), 0)), 0) AS bytes',
      )
      .get(artifactId) as { bytes: number };
    return bytes;
  }
  const latest = db.prepare('SELECT content FROM artifact_updates WHERE artifactId = ? AND content IS NOT NULL ORDER BY seq DESC LIMIT 1').get(artifactId) as { content: string } | undefined;
  return latest ? Number((JSON.parse(latest.content) as { size?: number }).size ?? 0) : 0;
}

// The search's statement: every `MATCH` term through the trigram index, every short term through `instr`; bm25 with the
// title weighed ten times the body, then recency, then id; with only short terms, how many the title holds, then
// recency, then id. `limit + 1` rows, so the caller can tell `more`. With a `MATCH` term the FTS table is the outer loop
// (`CROSS JOIN` fixes the join order) whatever the filters: a plan starting from `artifacts` (a Space's index, the
// session links) would restart the FTS cursor per artifact, bm25 re-reading the term's postings each time.
export function searchQuery(request: SearchRequest): { sql: string; params: (string | number)[] } {
  const { where, params } = candidates(request);
  const match = matchExpression(request.terms);
  const shorts = instrTerms(request.terms);
  if (match !== null) {
    where.push('artifact_text MATCH ?');
    params.push(match);
  }
  for (const term of shorts) {
    where.push('(instr(lower(artifact_text.title), ?) > 0 OR instr(lower(artifact_text.body), ?) > 0)');
    params.push(term, term);
  }
  const order = match !== null ? 'bm25(artifact_text, 0, 10, 1), a.updatedAt DESC, a.id' : `${shorts.map(() => '(instr(lower(artifact_text.title), ?) > 0)').join(' + ')} DESC, a.updatedAt DESC, a.id`;
  if (match === null) params.push(...shorts);
  const join = match !== null ? 'CROSS JOIN' : 'JOIN';
  return {
    sql: `SELECT a.id, a.kind, a.title, a.handle, a.spaceId, a.updatedAt, artifact_text.body AS body, r.sections AS sections FROM artifact_text ${join} artifact_text_rows r ON r.textRowid = artifact_text.rowid ${join} artifacts a ON a.id = r.artifactId WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    params: [...params, request.limit + 1],
  };
}

// The live artifacts a search may return: of a kind, in a Space, linked to the lineage (`artifact_list`'s scope).
function candidates({ kind, spaceId, linkedTo }: Pick<SearchRequest, 'kind' | 'spaceId' | 'linkedTo'>): { where: string[]; params: (string | number)[] } {
  const where = ['a.deletedAt IS NULL'];
  const params: (string | number)[] = [];
  if (kind !== undefined) {
    where.push('a.kind = ?');
    params.push(kind);
  }
  if (spaceId !== undefined) {
    where.push('a.spaceId = ?');
    params.push(spaceId);
  }
  if (linkedTo !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM artifact_sessions s WHERE s.artifactId = a.id AND s.appSessionId IN (${linkedTo.map(() => '?').join(', ') || 'NULL'}))`);
    params.push(...linkedTo);
  }
  return { where, params };
}

// ── the snippet and `read` ──

const codePoints = (text: string): number => [...text].length;
const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/u.test(char);
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Moves `index` back or forward by `count` code points, stopping at the text's ends.
function back(text: string, index: number, count: number): number {
  for (; count > 0 && index > 0; count--) {
    index -= 1;
    const low = text.charCodeAt(index);
    if (low >= 0xdc00 && low <= 0xdfff && index > 0) {
      const high = text.charCodeAt(index - 1);
      if (high >= 0xd800 && high <= 0xdbff) index -= 1;
    }
  }
  return index;
}
function forward(text: string, index: number, count: number): number {
  for (; count > 0 && index < text.length; count--) index += text.codePointAt(index)! > 0xffff ? 2 : 1;
  return index;
}

// A document's tab-title section (`{tab}` with no block): the document's own title again, more often than not.
const isTabTitle = ([, place]: Section): boolean => place !== null && 'tab' in place && place.from === undefined;

// The anchor (Decision Logs 17 and 22): the longest term's first occurrence, Unicode case-insensitively, inside the first
// section that holds every term, so a hit opens where the query's words are together; else the first occurrence of the
// longest term the body holds. A document's tab titles are passed over in both, since they repeat its title (which bm25
// already ranked): a later tab's title is the anchor only when no other section holds any term, and the first tab's
// title never is (matched there alone, the hit is title-only).
export function anchorOf(text: SectionedText, terms: readonly QueryTerm[]): { index: number; end: number } | null {
  const longestFirst = [...terms].sort((a, b) => codePoints(b.text) - codePoints(a.text)).map((term) => new RegExp(escaped(term.text), 'giu'));
  const at = (pattern: RegExp, from: number): { index: number; end: number } | null => {
    pattern.lastIndex = from;
    const found = pattern.exec(text.body);
    return found ? { index: found.index, end: found.index + found[0].length } : null;
  };
  const { sections } = text;
  const sectionOf = (offset: number): number => {
    let low = 0;
    let high = sections.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (sections[mid]![0] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  // the first section at or after `index` that is not a tab title, or -1
  const eligibleFrom = (index: number): number => {
    for (let i = index; i < sections.length; i++) if (!isTabTitle(sections[i]!)) return i;
    return -1;
  };
  // a pattern's first occurrence outside the tab titles
  const outsideTitles = (pattern: RegExp): { index: number; end: number } | null => {
    for (let from = 0; ; ) {
      const found = at(pattern, from);
      if (!found || sections.length === 0) return found;
      const section = sectionOf(found.index);
      if (!isTabTitle(sections[section]!)) return found;
      const next = eligibleFrom(section + 1);
      if (next < 0) return null;
      from = sections[next]![0];
    }
  };
  const together = sectionHoldingAll(longestFirst, at, sectionOf, eligibleFrom, sections);
  if (together !== null) return at(longestFirst[0]!, sections[together]![0]);
  for (const pattern of longestFirst) {
    const found = outsideTitles(pattern);
    if (found) return found;
  }
  // the last resort, a later tab's title; never the document's first tab title, the copy of its own title, which leaves
  // the hit title-only (the lead, no `read`)
  const pastFirstTitle = sections.length > 1 && isTabTitle(sections[0]!) ? sections[1]![0] : sections.length === 1 && isTabTitle(sections[0]!) ? text.body.length : 0;
  for (const pattern of longestFirst) {
    const found = at(pattern, pastFirstTitle);
    if (found) return found;
  }
  return null;
}

// The first section, not a tab title, in which every pattern occurs, or null: each pattern's next occurrence from the
// candidate section's start, the candidate moving to the furthest section one of them lands in (past it when that is a
// tab title), until all land in it: a walk that visits each section at most once per pattern, not a scan of every
// occurrence.
function sectionHoldingAll(
  patterns: RegExp[],
  at: (pattern: RegExp, from: number) => { index: number } | null,
  sectionOf: (offset: number) => number,
  eligibleFrom: (index: number) => number,
  sections: readonly Section[],
): number | null {
  let candidate = eligibleFrom(0);
  if (candidate < 0) return null;
  for (;;) {
    let moved = false;
    for (const pattern of patterns) {
      const found = at(pattern, sections[candidate]![0]);
      if (!found) return null;
      const section = sectionOf(found.index);
      if (section > candidate) {
        candidate = eligibleFrom(section);
        if (candidate < 0) return null;
        moved = true;
        break;
      }
    }
    if (!moved) return candidate;
  }
}

// `body.slice(start, end)` cleaned (whitespace collapsed, control characters removed), within the section [low, high):
// each end clamped to it and snapped to whitespace, "…" at an end that cuts inside the section.
function excerpt(body: string, start: number, end: number, low: number, high: number): string {
  let from = Math.max(start, low);
  let to = Math.min(end, high);
  if (from > low && !isSpace(body[from - 1])) {
    for (let at = from, seen = 0; seen < SNIPPET_SNAP && at < to; seen++, at = forward(body, at, 1)) {
      if (isSpace(body[at])) {
        from = at + 1;
        break;
      }
    }
  }
  if (to < high && !isSpace(body[to])) {
    for (let at = back(body, to, 1), seen = 0; seen < SNIPPET_SNAP && at > from; seen++, at = back(body, at, 1)) {
      if (isSpace(body[at])) {
        to = at;
        break;
      }
    }
  }
  // eslint-disable-next-line no-control-regex -- the control characters are what is removed
  const text = body.slice(from, to).replace(/\s+/gu, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return `${from > low ? '…' : ''}${text}${to < high ? '…' : ''}`;
}

// The section holding `offset`, as the body's range [start, end) without the line break that ends it.
function sectionAround({ body, sections }: SectionedText, offset: number): { start: number; end: number } {
  let low = 0;
  let high = sections.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (sections[mid]![0] <= offset) low = mid;
    else high = mid - 1;
  }
  const next = sections[low + 1]?.[0];
  return { start: sections[low]?.[0] ?? 0, end: next === undefined ? body.length : next - 1 };
}

// A hit's snippet and `read` (Decision Log 20): the snippet is the passage `read` opens, around the anchor inside its
// section (a document's block, a file model's file; one section, the whole body, for the other kinds); a title-only
// hit's snippet is about SNIPPET_LEAD code points from the first section holding body text (past a document's tab
// titles), across sections, and it has no `read`; an empty body has neither.
export function snippetAndRead(text: SectionedText, terms: readonly QueryTerm[]): { snippet?: string; read?: ArtifactSearchRead } {
  if (text.body === '') return {};
  const anchor = anchorOf(text, terms);
  if (!anchor) {
    // the lead: from the first section holding body text (past a document's tab titles, which repeat its title), across
    // sections, since a title-only hit has no `read` the text must stay true to (Decision Log 22)
    const lead = text.sections.find((section) => !isTabTitle(section))?.[0] ?? 0;
    return { snippet: excerpt(text.body, lead, forward(text.body, lead, SNIPPET_LEAD), lead, text.body.length) };
  }
  const section = sectionAround(text, anchor.index);
  const snippet = excerpt(text.body, back(text.body, anchor.index, SNIPPET_BEFORE), forward(text.body, anchor.end, SNIPPET_AFTER), section.start, section.end);
  const place = placeAt(text, anchor.index);
  return { snippet, ...(place && { read: 'paths' in place ? { paths: place.paths } : { tab: place.tab, ...(place.from !== undefined && { from: place.from }) } }) };
}

// ── the host's one mirror per store ──

const searches = new WeakMap<ArtifactStore, ArtifactSearch>();

// The store's search, as the host started it at the store's open (`./index.ts`); a store opened without it (a test's)
// gets one with no refresher or sweep, its searches catching up on their own.
export function artifactSearchOf(store: ArtifactStore): ArtifactSearch {
  let search = searches.get(store);
  if (!search) searches.set(store, (search = new ArtifactSearch(store)));
  return search;
}

// The refresher and the sweep over `store`, stopped by `close` before the store closes.
export function startArtifactSearch(store: ArtifactStore, options: ArtifactSearchOptions = {}): ArtifactSearch {
  searches.get(store)?.close();
  const search = new ArtifactSearch(store, options);
  searches.set(store, search);
  search.start();
  return search;
}
