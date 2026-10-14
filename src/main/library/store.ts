// The library's derived index (the P3-L document, Decision Log 6 and 9; index migration 9): main's view of the engine
// host's live artifacts, their session links and the Spaces, with the search index over titles and extracted text.
// Everything here is derived from the host's library reads (sync.ts), never from its database: a reconciliation
// replaces the whole set in one transaction, an entry refresh replaces one artifact and its links, and a revision only
// rises, so an older entry is dropped. The reads answer `library.list`, `library.get` and `library.spaces`.
//
// Search: `library_text` is FTS5 with the trigram tokenizer, so a query of three characters or more matches any
// substring of a title or a text, Korean and identifiers included, case-insensitively; a shorter one (which trigrams
// cannot index) scans titles and texts with `instr`, ASCII-case-insensitively. A row matched in its text carries the
// passage around the match (`snippet`); one matched only in its title carries none.
import type { SQLInputValue } from 'node:sqlite';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactSessionLink, type Space } from '@shared/artifacts/entity';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LibraryCounts, LibraryEntry, LibraryEntryAnswer, LibraryFilter, LibraryRow, LibrarySession, LibrarySnapshot, LibrarySpace } from '@shared/ipc/schema/library';
import { ARTIFACT_SCOPE_MAX_LINKS } from '@shared/maws/artifact-scope';
import type { Db } from '../index/db';

export interface LibraryStoreDeps {
  sessionTitle(appSessionId: AppSessionId): string; // main's index's title for it, '' when it has no record
}

// What applying an entry answer did.
export type EntryApplied = 'applied' | 'stale' | 'removed' | 'absent';

interface ArtifactRow {
  id: string;
  kind: ArtifactKind;
  title: string;
  handle: string | null;
  space_id: string | null;
  project_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  last_viewed_at: number | null;
  pinned: number;
  design_system_id: string | null;
  linked_path: string | null;
  agent_edits_as_suggestions: number;
  revision: number;
  last_editor: string;
  last_edited_at: number;
}

interface ListedRow extends ArtifactRow {
  space_name: string | null;
  project_name: string | null;
  passage: string | null; // the FTS snippet, with SNIPPET_OPEN/CLOSE around the match, or the fallback's window
  hit: number | null; // the fallback's 1-based match position in the text (0: none)
  text_length: number | null;
}

interface LinkRow {
  artifact_id: string;
  app_session_id: string;
  role: ArtifactSessionLink['role'];
  last_at: number;
}

const ROLE_ORDER: readonly ArtifactSessionLink['role'][] = ['created', 'edited', 'viewed', 'commented'];
const TRIGRAM = 3; // the shortest query the trigram tokenizer indexes
// The FTS passage: at most this many tokens (about a character each under trigram; FTS5's own cap is 64), the match
// marked with two control characters no text carries, so a row matched only in its title is told apart and the marks
// are taken out before the row is answered.
const SNIPPET_TOKENS = 64;
const SNIPPET_OPEN = '\u0002';
const SNIPPET_CLOSE = '\u0003';
const FALLBACK_BEFORE = 24; // the fallback's window: characters before the match, and its whole length
const FALLBACK_LENGTH = 64;

const actorOf = (key: string): Actor => (key.startsWith('session:') ? { kind: 'session', appSessionId: key.slice('session:'.length) as AppSessionId } : { kind: 'human' });

// A query as one FTS5 phrase: its quotes doubled, so operators and punctuation are text.
const phrase = (query: string) => `"${query.replaceAll('"', '""')}"`;

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

export class LibraryStore {
  private stamped = 0;
  private readonly listeners = new Set<(revision: number) => void>();

  constructor(
    private readonly db: Db,
    private readonly deps: LibraryStoreDeps,
  ) {}

  // The last revision told: one per committed change.
  get revision(): number {
    return this.stamped;
  }

  // Called once per committed transaction that changed the library, after its commit.
  onChange(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- writes (the sync's) -----------------------------------------------------------------------------------------

  // The host's whole live set: every listed artifact upserted (whatever its indexed revision: the host's answer at a
  // connection is the truth, even when its store was recreated), every unlisted one deleted with its text, links and
  // Spaces replaced. Indexed text is kept for a row whose revision did not fall.
  reconcile(snapshot: LibrarySnapshot): void {
    this.db.transaction(() => {
      const listed = new Set(snapshot.artifacts.map((artifact) => artifact.id));
      for (const { id, text_rowid } of this.db.all<{ id: string; text_rowid: number }>('SELECT id, text_rowid FROM library_artifacts')) {
        if (!listed.has(id)) this.delete(id, text_rowid);
      }
      for (const artifact of snapshot.artifacts) this.upsert(artifact);
      this.db.run('DELETE FROM library_links');
      for (const link of snapshot.links) if (listed.has(link.artifactId)) this.insertLink(link);
      this.writeSpaces(snapshot.spaces);
      this.changed();
    });
  }

  // One artifact as `library.entry` answered it: upserted with its links replaced, unless the index holds a later
  // revision (`stale`, nothing written); removed when the host has it no more.
  apply(artifactId: string, answer: LibraryEntryAnswer): EntryApplied {
    if (answer.artifact === null) return this.remove(artifactId) ? 'removed' : 'absent';
    const artifact = answer.artifact;
    return this.db.transaction(() => {
      const indexed = this.db.get<{ revision: number }>('SELECT revision FROM library_artifacts WHERE id = ?', artifact.id);
      if (indexed !== null && artifact.revision < indexed.revision) return 'stale';
      this.upsert(artifact);
      this.db.run('DELETE FROM library_links WHERE artifact_id = ?', artifact.id);
      for (const link of answer.links) if (link.artifactId === artifact.id) this.insertLink(link);
      this.changed();
      return 'applied';
    });
  }

  remove(artifactId: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.get<{ text_rowid: number }>('SELECT text_rowid FROM library_artifacts WHERE id = ?', artifactId);
      if (row === null) return false;
      this.delete(artifactId, row.text_rowid);
      this.changed();
      return true;
    });
  }

  replaceSpaces(spaces: readonly Space[]): void {
    this.db.transaction(() => {
      this.writeSpaces(spaces);
      this.changed();
    });
  }

  // An artifact's text at `revision`, kept when it is newer than the indexed text (false otherwise, or with no row).
  setText(artifactId: string, revision: number, text: string): boolean {
    return this.db.transaction(() => {
      const row = this.db.get<{ text_revision: number | null; text_rowid: number }>('SELECT text_revision, text_rowid FROM library_artifacts WHERE id = ?', artifactId);
      if (row === null || (row.text_revision !== null && revision <= row.text_revision)) return false;
      this.db.run('UPDATE library_text SET body = ? WHERE rowid = ?', text, row.text_rowid);
      this.db.run('UPDATE library_artifacts SET text_revision = ? WHERE id = ?', revision, artifactId);
      this.changed();
      return true;
    });
  }

  // The artifacts whose text was never fetched or is older than their revision, most recently updated first.
  needingText(): string[] {
    return this.db
      .all<{ id: string }>('SELECT id FROM library_artifacts WHERE text_revision IS NULL OR revision > text_revision ORDER BY updated_at DESC, id')
      .map((row) => row.id);
  }

  needsText(artifactId: string): boolean {
    return this.db.get('SELECT 1 FROM library_artifacts WHERE id = ? AND (text_revision IS NULL OR revision > text_revision)', artifactId) !== null;
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  list(filter: LibraryFilter = {}): { rows: LibraryRow[]; counts: LibraryCounts } {
    const rows = this.query(filter, true);
    const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])) as LibraryCounts;
    const { from, where, params } = this.filtered({ ...filter, kind: undefined });
    for (const { kind, n } of this.db.all<{ kind: ArtifactKind; n: number }>(`SELECT a.kind, count(*) AS n ${from} ${where} GROUP BY a.kind`, ...params)) counts[kind] = n;
    return { rows: this.rowsOf(rows), counts };
  }

  get(artifactId: string): LibraryRow | null {
    const [row] = this.rowsOf(this.query({}, false, artifactId));
    return row ?? null;
  }

  spaces(): LibrarySpace[] {
    return this.db
      .all<{ id: string; name: string; linked_dir: string | null; created_at: number; count: number }>(
        'SELECT s.*, (SELECT count(*) FROM library_artifacts a WHERE a.space_id = s.id) AS count FROM library_spaces s ORDER BY s.name COLLATE NOCASE, s.id',
      )
      .map((row) => ({ id: row.id, name: row.name, ...(row.linked_dir !== null ? { linkedDir: row.linked_dir } : {}), createdAt: row.created_at, count: row.count }));
  }

  // M6b (Decision Log 16, 36i): the paths of the live File artifacts the files service may admit for `appSessionId`:
  // those linked to it or to a side thread's ancestor of it, and those no session is linked to (the owner's own), each
  // as the host recorded it (the caller compares realpaths).
  fileLinkedPaths(appSessionId: AppSessionId): string[] {
    const sessions = this.lineageOf(appSessionId);
    return this.db
      .all<{ linked_path: string }>(
        `SELECT DISTINCT a.linked_path FROM library_artifacts a WHERE a.kind = 'file' AND a.linked_path IS NOT NULL AND (
          EXISTS (SELECT 1 FROM library_links l WHERE l.artifact_id = a.id AND l.app_session_id IN (${sessions.map(() => '?').join(', ')}))
          OR NOT EXISTS (SELECT 1 FROM library_links l WHERE l.artifact_id = a.id))`,
        ...sessions,
      )
      .map((row) => row.linked_path);
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  private changed(): void {
    this.db.defer('library.changed', () => {
      const revision = ++this.stamped;
      for (const listener of this.listeners) listener(revision);
    });
  }

  private upsert(artifact: LibraryEntry): void {
    const values = {
      kind: artifact.kind,
      title: artifact.title,
      handle: artifact.handle ?? null,
      space_id: artifact.spaceId ?? null,
      project_id: artifact.projectId ?? null,
      created_by: actorKey(artifact.createdBy),
      created_at: artifact.createdAt,
      updated_at: artifact.updatedAt,
      last_viewed_at: artifact.lastViewedAt,
      pinned: artifact.pinned,
      design_system_id: artifact.designSystemId ?? null,
      linked_path: artifact.linkedPath ?? null,
      agent_edits_as_suggestions: artifact.agentEditsAsSuggestions,
      revision: artifact.revision,
      last_editor: actorKey(artifact.lastEditor),
      last_edited_at: artifact.lastEditedAt,
    };
    const indexed = this.db.get<{ title: string; revision: number; text_rowid: number }>('SELECT title, revision, text_rowid FROM library_artifacts WHERE id = ?', artifact.id);
    if (indexed === null) {
      const { lastInsertRowid } = this.db.prepare("INSERT INTO library_text (artifact_id, title, body) VALUES (?, ?, '')").run(artifact.id, artifact.title);
      this.db.insert('library_artifacts', { id: artifact.id, ...values, text_revision: null, text_rowid: Number(lastInsertRowid) });
      return;
    }
    // A revision that fell is another store's history: its indexed text is fetched again.
    this.db.update('library_artifacts', 'id', artifact.id, artifact.revision < indexed.revision ? { ...values, text_revision: null } : values);
    if (indexed.title !== artifact.title) this.db.run('UPDATE library_text SET title = ? WHERE rowid = ?', artifact.title, indexed.text_rowid);
  }

  private delete(artifactId: string, textRowid: number): void {
    this.db.run('DELETE FROM library_text WHERE rowid = ?', textRowid);
    this.db.run('DELETE FROM library_artifacts WHERE id = ?', artifactId); // its links go with it (ON DELETE CASCADE)
  }

  private insertLink(link: ArtifactSessionLink): void {
    this.db.run('INSERT OR REPLACE INTO library_links (artifact_id, app_session_id, role, last_at) VALUES (?, ?, ?, ?)', link.artifactId, link.appSessionId, link.role, link.lastAt);
  }

  private writeSpaces(spaces: readonly Space[]): void {
    this.db.run('DELETE FROM library_spaces');
    for (const space of spaces) this.db.insert('library_spaces', { id: space.id, name: space.name, linked_dir: space.linkedDir ?? null, created_at: space.createdAt });
  }

  // The session and its side-thread ancestors, nearest first, up to the family root (X9's scope, over `side_threads`).
  private lineageOf(appSessionId: AppSessionId): string[] {
    const chain: string[] = [appSessionId];
    let at: string = appSessionId;
    while (chain.length <= ARTIFACT_SCOPE_MAX_LINKS) {
      const parent = this.db.get<{ parent_app_id: string }>('SELECT parent_app_id FROM side_threads WHERE child_app_id = ?', at)?.parent_app_id;
      if (parent === undefined || chain.includes(parent)) break;
      chain.push((at = parent));
    }
    return chain;
  }

  // The FROM and WHERE of a filter, with their parameters in order.
  private filtered(filter: LibraryFilter): { from: string; where: string; params: SQLInputValue[]; search: string | null } {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    let from = 'FROM library_artifacts a LEFT JOIN library_spaces sp ON sp.id = a.space_id LEFT JOIN projects p ON p.id = a.project_id';
    if (filter.kind !== undefined) {
      clauses.push('a.kind = ?');
      params.push(filter.kind);
    }
    if (filter.spaceId === null) clauses.push('a.space_id IS NULL');
    else if (filter.spaceId !== undefined) {
      clauses.push('a.space_id = ?');
      params.push(filter.spaceId);
    }
    if (filter.projectId !== undefined) {
      clauses.push('a.project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.pinned !== undefined) {
      clauses.push('a.pinned = ?');
      params.push(filter.pinned ? 1 : 0);
    }
    if (filter.appSessionId !== undefined) {
      const sessions = filter.lineage ? this.lineageOf(filter.appSessionId as AppSessionId) : [filter.appSessionId];
      clauses.push(`EXISTS (SELECT 1 FROM library_links l WHERE l.artifact_id = a.id AND l.app_session_id IN (${sessions.map(() => '?').join(', ')}))`);
      params.push(...sessions);
    }
    const query = filter.query?.trim() ?? '';
    let search: string | null = null;
    if (query !== '') {
      search = query;
      from += ' JOIN library_text ON library_text.rowid = a.text_rowid';
      if ([...query].length >= TRIGRAM) {
        clauses.push('library_text MATCH ?');
        params.push(phrase(query));
      } else {
        clauses.push('(instr(lower(library_text.title), lower(?)) > 0 OR instr(lower(library_text.body), lower(?)) > 0)');
        params.push(query, query);
      }
    }
    return { from, where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params, search };
  }

  private query(filter: LibraryFilter, ordered: boolean, artifactId?: string): ListedRow[] {
    const { from, where, params, search } = this.filtered(filter);
    const select: string[] = ['a.*', 'sp.name AS space_name', 'p.name AS project_name'];
    const selectParams: SQLInputValue[] = [];
    if (search === null) select.push('NULL AS passage', 'NULL AS hit', 'NULL AS text_length');
    else if ([...search].length >= TRIGRAM) {
      select.push(`snippet(library_text, 2, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', ${SNIPPET_TOKENS}) AS passage`, 'NULL AS hit', 'NULL AS text_length');
    } else {
      select.push(
        'instr(lower(library_text.body), lower(?)) AS hit',
        `substr(library_text.body, max(1, instr(lower(library_text.body), lower(?)) - ${FALLBACK_BEFORE}), ${FALLBACK_LENGTH}) AS passage`,
        'length(library_text.body) AS text_length',
      );
      selectParams.push(search, search);
    }
    const byId = artifactId === undefined ? '' : `${where === '' ? 'WHERE' : `${where} AND`} a.id = ?`;
    const sql = `SELECT ${select.join(', ')} ${from} ${byId || where}${ordered ? ' ORDER BY a.updated_at DESC, a.id' : ''}`;
    return this.db.all<ListedRow>(sql, ...selectParams, ...params, ...(artifactId === undefined ? [] : [artifactId]));
  }

  private rowsOf(rows: ListedRow[]): LibraryRow[] {
    if (rows.length === 0) return [];
    const wanted = new Set(rows.map((row) => row.id));
    const links = new Map<string, LinkRow[]>();
    const all = rows.length === 1
      ? this.db.all<LinkRow>('SELECT * FROM library_links WHERE artifact_id = ?', rows[0].id)
      : this.db.all<LinkRow>('SELECT * FROM library_links');
    for (const link of all) {
      if (!wanted.has(link.artifact_id)) continue;
      let list = links.get(link.artifact_id);
      if (!list) links.set(link.artifact_id, (list = []));
      list.push(link);
    }
    const titles = new Map<string, string>();
    const titleOf = (appSessionId: string) => {
      let title = titles.get(appSessionId);
      if (title === undefined) titles.set(appSessionId, (title = this.deps.sessionTitle(appSessionId as AppSessionId)));
      return title;
    };
    return rows.map((row) => this.toRow(row, sessionsOf(links.get(row.id) ?? [], titleOf), titleOf));
  }

  private toRow(row: ListedRow, sessions: LibrarySession[], titleOf: (appSessionId: string) => string): LibraryRow {
    const snippet = passageOf(row);
    const lastEditor = actorOf(row.last_editor);
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      ...(row.handle !== null ? { handle: row.handle } : {}),
      ...(row.space_id !== null ? { spaceId: row.space_id } : {}),
      ...(row.project_id !== null ? { projectId: row.project_id as ProjectId } : {}),
      createdBy: actorOf(row.created_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastViewedAt: row.last_viewed_at,
      pinned: row.pinned === 1,
      ...(row.design_system_id !== null ? { designSystemId: row.design_system_id } : {}),
      ...(row.linked_path !== null ? { linkedPath: row.linked_path } : {}),
      agentEditsAsSuggestions: row.agent_edits_as_suggestions === 1,
      revision: row.revision,
      lastEditor,
      lastEditedAt: row.last_edited_at,
      ...(lastEditor.kind === 'session' ? { lastEditorTitle: titleOf(lastEditor.appSessionId) } : {}), // linked or not (DL 27f)
      sessions,
      ...(row.space_id !== null && row.space_name !== null ? { space: { id: row.space_id, name: row.space_name } } : {}),
      ...(row.project_id !== null && row.project_name !== null ? { project: { id: row.project_id as ProjectId, name: row.project_name } } : {}),
      ...(snippet !== null ? { snippet } : {}),
    };
  }
}

// The sessions of an artifact's links, one each with its roles in role order, by last touch, newest first.
function sessionsOf(links: readonly LinkRow[], titleOf: (appSessionId: string) => string): LibrarySession[] {
  const bySession = new Map<string, LibrarySession>();
  for (const link of links) {
    const session = bySession.get(link.app_session_id);
    if (session === undefined) {
      bySession.set(link.app_session_id, { appSessionId: link.app_session_id as AppSessionId, title: titleOf(link.app_session_id), roles: [link.role], lastAt: link.last_at });
    } else {
      session.roles.push(link.role);
      session.lastAt = Math.max(session.lastAt, link.last_at);
    }
  }
  const sessions = [...bySession.values()];
  for (const session of sessions) session.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  return sessions.sort((a, b) => b.lastAt - a.lastAt || a.appSessionId.localeCompare(b.appSessionId));
}

// The passage of a text match, or null for a row matched only in its title (or with no search).
function passageOf(row: ListedRow): string | null {
  if (row.passage === null) return null;
  if (row.hit === null) {
    if (!row.passage.includes(SNIPPET_OPEN)) return null; // the FTS matched the title, not the text
    return tidy(row.passage.replaceAll(SNIPPET_OPEN, '').replaceAll(SNIPPET_CLOSE, ''));
  }
  if (row.hit === 0) return null;
  const start = Math.max(1, row.hit - FALLBACK_BEFORE);
  return tidy(`${start > 1 ? '…' : ''}${row.passage}${start - 1 + FALLBACK_LENGTH < (row.text_length ?? 0) ? '…' : ''}`);
}
