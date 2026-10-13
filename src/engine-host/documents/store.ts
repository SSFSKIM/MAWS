// The artifact store (X23; parent §4.1, §4.2 and §4.7; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M3): the
// entity rows and every operation M4's IPC and M6's tools call. Artifacts, Spaces and session links; handles resolved
// over a session's lineage (Decision Log 3); byte-kind writes and reads (Decision Log 2, 7); assets; versions with the
// design-system pin (Decision Log 8, 22b) and the auto-version scheduler and turn versions (§4.7, Decision Log 23f);
// restore (restore.ts); the idempotency ledger (ops.ts); maintenance (maintenance.ts); and a change feed.
//
// Every write joins the document service's group-commit batch inside a savepoint (`service.inBatch`, or a write's
// `inFrame`), so an operation's rows commit together, with the documents' rows of that turn, and nothing is answered or
// announced before the commit (Decision Log 26).
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { KindAdapter } from '@artifacts/host';
import { applyV2, bindingVersion, decodeMap, encodeMap, mergeMaps, type Doc } from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import { isDocKind, type Artifact, type ArtifactKind, type ArtifactSessionLink, type Space } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import { ARTIFACT_ID, ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { ArtifactFiles, safeName, type ContentRef } from './bytes';
import { ArtifactStoreError } from './errors';
import { Maintenance } from './maintenance';
import { OpLedger, type OpScope } from './ops';
import { restoreArtifact } from './restore';
import type { Committed, DocumentService } from './service';
import type { SqliteDocumentStorage } from './storage';
import { actorFromKey, VersionStore, type DesignSystemRef, type VersionKind } from './versions';

export const AUTO_IDLE_MS = 2 * 60_000; // an auto version 2 minutes after the last human update (§4.7)
export const AUTO_EVERY_MS = 10 * 60_000; // and every 10 minutes of continuous activity, by anyone
export const CHANGE_COALESCE_MS = 250; // a Y doc's commits reach the change feed at most this often per artifact

export type ArtifactChange = 'created' | 'updated' | 'deleted' | 'linked';
export interface ArtifactChanged {
  artifactId: string;
  kind: ArtifactKind;
  revision: number;
  change: ArtifactChange;
}
export interface SpaceChanged {
  spaceId: string;
  change: 'created' | 'updated' | 'deleted';
}

export interface ListFilter {
  kind?: ArtifactKind;
  spaceId?: string;
  appSessionId?: string; // linked to this session in any role
  pinned?: boolean;
  deleted?: boolean; // only the deleted ones (default: only the live ones)
  query?: string; // a title substring (`artifacts.search` until P3-L's index)
}

// A byte kind's content: `html` takes bytes (and a file name, `index.html` by default), `file` a path in place.
export type ByteContent = { bytes: Uint8Array; name?: string } | { path: string };

export interface CreateInput {
  kind: ArtifactKind;
  title: string;
  handle?: string;
  spaceId?: string;
  projectId?: string;
  designSystemId?: string;
  content?: ByteContent;
}

export interface ArtifactUpdate {
  title?: string;
  spaceId?: string | null;
  pinned?: boolean;
  designSystemId?: string | null;
  agentEditsAsSuggestions?: boolean;
}

export interface Asset {
  assetId: string;
  ref: string; // the path a format uses: `assets/<name>`
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: number;
  createdBy: Actor;
}

// The schema-agnostic test writer's operations (on a root type, `root` by default).
export type TestOp =
  | { op: 'setAttr'; key: string; value: unknown; root?: string }
  | { op: 'insertText'; index: number; text: string; root?: string }
  | { op: 'deleteText'; index: number; length: number; root?: string };

// A store write's recording seam (Decision Log 26c): run inside the savepoint of the write that completes the operation,
// with what it produced, so whatever it writes (an op row, `OpScope.record`) commits with the write or not at all. Every
// path through the operation calls it once, a write that turned out to change nothing included.
export type InFrame<T> = (result: T) => void;

export interface DesignSystemDefaults {
  owner: string | null;
  spaces: Record<string, string>;
}

interface EntityRow {
  id: string;
  kind: ArtifactKind;
  title: string;
  handle: string | null;
  spaceId: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastViewedAt: number | null;
  pinned: number;
  designSystemId: string | null;
  linkedPath: string | null;
  deletedAt: number | null;
  agentEditsAsSuggestions: number;
}

export interface StoreOptions {
  root: string; // `<userData>/artifacts`
  now?: () => number;
  log?: (line: string) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULTS_KEY = 'designSystemDefaults';

export class ArtifactStore {
  readonly versions: VersionStore;
  readonly files: ArtifactFiles;
  readonly maintenance: Maintenance;
  private readonly ops: OpLedger;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly changeListeners = new Set<(change: ArtifactChanged) => void>();
  private readonly spaceListeners = new Set<(change: SpaceChanged) => void>();
  private readonly coalescing = new Map<string, { timer: ReturnType<typeof setTimeout>; pending: number | null }>();
  private readonly schedule = new Map<string, { idle?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setTimeout> }>();
  // Per session, the artifacts it touched this turn: its committed document edits (a turn version needs one) and its
  // mutating tool calls' results (the turn version's summary).
  private readonly turns = new Map<string, Map<string, { commits: number; results: unknown[] }>>();
  private designSystemContext: ((system: Artifact) => Promise<string | null>) | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  private closed = false;

  constructor(
    readonly service: DocumentService,
    readonly storage: SqliteDocumentStorage,
    options: StoreOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(`[artifacts] ${line}`));
    this.versions = new VersionStore(storage.db);
    this.files = new ArtifactFiles(options.root);
    this.ops = new OpLedger({
      db: storage.db,
      now: this.now,
      frameOpen: () => storage.frameOpen,
      whenCommitted: () => service.whenCommitted(),
      inBatch: (write) => service.inBatch(write),
    });
    this.maintenance = new Maintenance(this, { now: this.now, log: this.log });
    this.unsubscribe.push(service.onCommitted((change) => this.committed(change)));
    this.unsubscribe.push(service.onBeforeCommit((ids) => this.stamp(ids)));
  }

  registerAdapter(adapter: KindAdapter): void {
    this.service.registerAdapter(adapter);
  }

  onChange(listener: (change: ArtifactChanged) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onSpaceChange(listener: (change: SpaceChanged) => void): () => void {
    this.spaceListeners.add(listener);
    return () => this.spaceListeners.delete(listener);
  }

  // A read whose answer reveals store state (an IPC answer, a tool's result), released only once it may be revealed
  // (Decision Log 33): reads share the batch's connection (26j), so `read` runs now and its answer waits for the batch
  // open at the time of the read to commit — at once when none is — and fails if that batch is lost, so no caller sees
  // rows that may yet be taken back. A refusal `read` throws is store state too and waits the same way.
  async readCommitted<T>(read: () => T): Promise<T> {
    let answer: { value: T } | { error: unknown };
    try {
      answer = { value: read() };
    } catch (error) {
      answer = { error };
    }
    if (this.storage.batchOpen) await this.service.whenCommitted();
    if ('error' in answer) throw answer.error;
    return answer.value;
  }

  // A write whose refusal is store state too (Decision Log 33): the validation that refused it (a row gone, a design
  // system still governing one) read the batch's connection, so it may have seen an open batch's rows. `run` starts
  // now; a refusal it ends with (an `ArtifactStoreError`) waits for the batch open when its synchronous part returned
  // — where the store's writes validate — and that batch's failure replaces it. Success answers at once: an answer that
  // carries store state is re-read through `readCommitted`.
  async writeCommitted<T>(run: () => Promise<T>): Promise<T> {
    let running: Promise<T>;
    try {
      running = run();
    } catch (error) {
      running = Promise.reject(error);
    }
    const barrier = this.storage.batchOpen ? this.service.whenCommitted() : null;
    barrier?.catch(() => {}); // awaited only for a refusal; a write that fails with its batch reports that itself
    try {
      return await running;
    } catch (error) {
      if (error instanceof ArtifactStoreError && barrier) await barrier;
      throw error;
    }
  }

  // ── artifacts ──

  get(artifactId: string, options: { includeDeleted?: boolean } = {}): Artifact | null {
    const row = this.entity(artifactId);
    return row && (options.includeDeleted || row.deletedAt === null) ? toArtifact(row) : null;
  }

  revision(artifactId: string): number {
    return this.service.revision(artifactId);
  }

  list(filter: ListFilter = {}): Artifact[] {
    const where = [filter.deleted ? 'a.deletedAt IS NOT NULL' : 'a.deletedAt IS NULL'];
    const params: (string | number)[] = [];
    const add = (clause: string, value: string | number) => {
      where.push(clause);
      params.push(value);
    };
    if (filter.kind) add('a.kind = ?', filter.kind);
    if (filter.spaceId) add('a.spaceId = ?', filter.spaceId);
    if (filter.pinned !== undefined) add('a.pinned = ?', filter.pinned ? 1 : 0);
    if (filter.query) add('instr(lower(a.title), lower(?)) > 0', filter.query);
    if (filter.appSessionId) add('EXISTS (SELECT 1 FROM artifact_sessions s WHERE s.artifactId = a.id AND s.appSessionId = ?)', filter.appSessionId);
    const rows = this.storage.db.prepare(`SELECT a.* FROM artifacts a WHERE ${where.join(' AND ')} ORDER BY a.updatedAt DESC, a.id`).all(...params) as unknown as EntityRow[];
    return rows.map(toArtifact);
  }

  // An artifact named by its UUID or by a handle its asking session's lineage created (itself first, then its
  // ancestors nearest first; Decision Log 3). Null when nothing live matches.
  resolve(ref: string, lineage: readonly string[] = []): string | null {
    if (UUID.test(ref)) return this.get(ref) ? ref : null;
    const find = this.storage.db.prepare(
      "SELECT a.id FROM artifacts a JOIN artifact_sessions s ON s.artifactId = a.id AND s.role = 'created' WHERE s.appSessionId = ? AND a.handle = ? AND a.deletedAt IS NULL ORDER BY a.createdAt DESC LIMIT 1",
    );
    for (const appSessionId of lineage) {
      const row = find.get(appSessionId, ref) as { id: string } | undefined;
      if (row) return row.id;
    }
    return null;
  }

  // The human's create or an agent's (`actor`; a session is linked `created`). Byte kinds take their first content and
  // write it as an `import` version; Y kinds start empty.
  async create(input: CreateInput, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    const id = randomUUID();
    const at = this.now();
    if (input.handle !== undefined && !ARTIFACT_ID.test(input.handle)) throw new ArtifactStoreError('invalid', `the handle ${JSON.stringify(input.handle)} is not a valid artifact handle`);
    if (!isDocKind(input.kind) && !input.content) throw new ArtifactStoreError('invalid', `a ${input.kind} artifact is created with its content`);
    if (isDocKind(input.kind) && input.content) throw new ArtifactStoreError('invalid', `a ${input.kind} artifact starts empty`);
    if (input.spaceId) this.requireSpace(input.spaceId);
    if (input.designSystemId) this.requireDesignSystem(input.designSystemId);
    if (input.handle && actor.kind === 'session' && this.resolve(input.handle, [actor.appSessionId])) {
      throw new ArtifactStoreError('handleTaken', `this session already has an artifact with the handle ${input.handle}`, { handle: input.handle });
    }
    const key = actorKey(actor);
    await this.service.inBatch(() => {
      this.storage.actorInBatch(actor, at);
      this.storage.db
        .prepare('INSERT INTO artifacts (id, kind, title, handle, spaceId, projectId, createdBy, createdAt, updatedAt, pinned, designSystemId, linkedPath, bindingVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
        .run(id, input.kind, input.title, input.handle ?? null, input.spaceId ?? null, input.projectId ?? null, key, at, at, input.designSystemId ?? null, input.content && 'path' in input.content ? input.content.path : null, isDocKind(input.kind) ? bindingVersion : null);
      if (actor.kind === 'session') this.linkInFrame(id, actor.appSessionId, 'created', at);
      if (input.content) this.writeBytesInFrame(this.entity(id)!, actor, input.content, { kind: 'import' });
      inFrame?.(toArtifact(this.entity(id)!));
    });
    this.emit(id, 'created');
    return this.get(id)!;
  }

  async update(artifactId: string, change: ArtifactUpdate, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    this.requireLive(artifactId);
    if (change.spaceId) this.requireSpace(change.spaceId);
    if (change.designSystemId) this.requireDesignSystem(change.designSystemId);
    const columns: Record<string, string | number | null | undefined> = {
      title: change.title,
      spaceId: change.spaceId,
      pinned: change.pinned === undefined ? undefined : change.pinned ? 1 : 0,
      designSystemId: change.designSystemId,
      agentEditsAsSuggestions: change.agentEditsAsSuggestions === undefined ? undefined : change.agentEditsAsSuggestions ? 1 : 0,
      updatedAt: this.now(),
    };
    const set = Object.entries(columns).filter(([, value]) => value !== undefined) as [string, string | number | null][];
    await this.service.inBatch(() => {
      this.storage.db.prepare(`UPDATE artifacts SET ${set.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...set.map(([, value]) => value), artifactId);
      inFrame?.(toArtifact(this.entity(artifactId)!));
    });
    this.emit(artifactId, 'updated');
    return this.get(artifactId)!;
  }

  // A soft delete (`deletedAt`); a design system still governing a live artifact is refused (Decision Log 22a).
  async delete(artifactId: string, inFrame?: InFrame<void>): Promise<void> {
    const row = this.requireLive(artifactId);
    if (row.kind === 'design_system') {
      const users = (this.storage.db.prepare('SELECT id FROM artifacts WHERE designSystemId = ? AND deletedAt IS NULL AND id <> ? ORDER BY id').all(artifactId, artifactId) as { id: string }[]).map((r) => r.id);
      if (users.length > 0) throw new ArtifactStoreError('designSystemInUse', `the design system governs ${users.length} artifact(s)`, { artifactIds: users });
    }
    const at = this.now();
    await this.service.inBatch(() => {
      this.storage.db.prepare('UPDATE artifacts SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(at, at, artifactId);
      inFrame?.();
    });
    this.emit(artifactId, 'deleted');
  }

  // "Make a copy" (Decision Log 23b): of the live state, or of a version's. A Y kind's copy starts from the state; a
  // byte kind's from the content. The assets that state needs come with it (the version's asset refs, else every asset
  // the artifact has), under the same ids and names, so the copied content's references resolve. The copy's history
  // starts with an `import` version.
  //
  // A Y kind's copy is two frames of one batch, so one commit: the entity row and the assets, then the state through
  // the duplicator's host replica with its `import` version (the doc opens once its entity row is there, with its
  // kind's adapter). If the second frame fails, the first still commits: an empty copy is left, as before.
  async duplicate(artifactId: string, options: { versionId?: number; title?: string }, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    const source = this.requireLive(artifactId);
    const version = options.versionId === undefined ? undefined : this.requireVersion(artifactId, options.versionId);
    const id = randomUUID();
    const at = this.now();
    const content = isDocKind(source.kind) ? null : this.byteContentOf(source, version ? (JSON.parse(version.content!) as ContentRef) : this.contentRef(artifactId).ref);
    const state = !isDocKind(source.kind) ? null : version ? this.versions.state(artifactId, version.id) : this.service.readState(artifactId).state;
    const assets = version ? (JSON.parse(version.assetRefs) as string[]) : this.assetIds(artifactId);
    let entityWritten = false;
    const entity = this.service.inBatch(() => {
      this.storage.actorInBatch(actor, at);
      this.storage.db
        .prepare('INSERT INTO artifacts (id, kind, title, spaceId, projectId, createdBy, createdAt, updatedAt, pinned, designSystemId, linkedPath, bindingVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
        .run(id, source.kind, options.title ?? `Copy of ${source.title}`, source.spaceId, source.projectId, actorKey(actor), at, at, source.designSystemId, source.linkedPath, isDocKind(source.kind) ? bindingVersion : null);
      if (actor.kind === 'session') this.linkInFrame(id, actor.appSessionId, 'created', at);
      this.copyAssetsInFrame(artifactId, id, assets);
      if (content) {
        this.writeBytesInFrame(this.entity(id)!, actor, content, { kind: 'import' });
        inFrame?.(toArtifact(this.entity(id)!));
      }
      entityWritten = true;
    });
    if (state && entityWritten) {
      const copy = this.entity(id)!;
      const written = this.service.writeAs(id, actor, (doc) => applyV2(doc, state), {
        inFrame: () => {
          this.versionInFrame(copy, { kind: 'import', actor });
          inFrame?.(toArtifact(this.entity(id)!));
        },
      });
      await Promise.all([entity, written]);
    } else {
      await entity;
    }
    this.emit(id, 'created');
    return this.get(id)!;
  }

  // Inside a savepoint: the assets `assetIds` of one artifact copied into another, rows and files, ids, names and
  // order kept.
  private copyAssetsInFrame(fromId: string, toId: string, assetIds: string[]): void {
    const wanted = new Set(assetIds);
    const rows = (this.storage.db.prepare('SELECT * FROM artifact_assets WHERE artifactId = ? ORDER BY createdAt, rowid').all(fromId) as unknown as { assetId: string; name: string; mime: string; size: number; sha256: string; createdAt: number; createdBy: string }[]).filter((row) =>
      wanted.has(row.assetId),
    );
    const insert = this.storage.db.prepare('INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const row of rows) {
      const path = ArtifactFiles.assetPath(row.sha256);
      if (!this.files.exists(toId, path)) {
        const stage = this.files.stage(toId, this.files.readAsset(fromId, row.sha256));
        try {
          this.files.place(toId, stage.temp, path);
        } finally {
          this.files.discard(stage.temp);
        }
      }
      insert.run(toId, row.assetId, row.name, row.mime, row.size, row.sha256, row.createdAt, row.createdBy);
    }
  }

  async link(artifactId: string, appSessionId: AppSessionId, role: ArtifactSessionLink['role'], inFrame?: InFrame<void>): Promise<void> {
    this.requireLive(artifactId);
    await this.service.inBatch(() => {
      this.linkInFrame(artifactId, appSessionId, role, this.now());
      inFrame?.();
    });
    this.emit(artifactId, 'linked');
  }

  links(artifactId: string): ArtifactSessionLink[] {
    return this.storage.db.prepare('SELECT artifactId, appSessionId, role, lastAt FROM artifact_sessions WHERE artifactId = ? ORDER BY lastAt, appSessionId, role').all(artifactId) as unknown as ArtifactSessionLink[];
  }

  private linkInFrame(artifactId: string, appSessionId: string, role: ArtifactSessionLink['role'], at: number): void {
    this.storage.db
      .prepare('INSERT INTO artifact_sessions (artifactId, appSessionId, role, lastAt) VALUES (?, ?, ?, ?) ON CONFLICT (artifactId, appSessionId, role) DO UPDATE SET lastAt = excluded.lastAt')
      .run(artifactId, appSessionId, role, at);
  }

  // ── spaces ──

  listSpaces(): Space[] {
    return (this.storage.db.prepare('SELECT * FROM spaces ORDER BY createdAt, id').all() as unknown as { id: string; name: string; linkedDir: string | null; createdAt: number }[]).map(toSpace);
  }

  getSpace(spaceId: string): Space | null {
    const row = this.storage.db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId) as { id: string; name: string; linkedDir: string | null; createdAt: number } | undefined;
    return row ? toSpace(row) : null;
  }

  async createSpace(input: { name: string; linkedDir?: string }): Promise<Space> {
    const id = randomUUID();
    await this.service.inBatch(() => this.storage.db.prepare('INSERT INTO spaces (id, name, linkedDir, createdAt) VALUES (?, ?, ?, ?)').run(id, input.name, input.linkedDir ?? null, this.now()));
    this.emitSpace(id, 'created');
    return this.getSpace(id)!;
  }

  async updateSpace(spaceId: string, change: { name?: string; linkedDir?: string | null }): Promise<Space> {
    this.requireSpace(spaceId);
    const set = Object.entries({ name: change.name, linkedDir: change.linkedDir }).filter(([, value]) => value !== undefined) as [string, string | null][];
    if (set.length > 0) await this.service.inBatch(() => this.storage.db.prepare(`UPDATE spaces SET ${set.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...set.map(([, value]) => value), spaceId));
    this.emitSpace(spaceId, 'updated');
    return this.getSpace(spaceId)!;
  }

  // Deletes the Space; its artifacts stay, outside any Space.
  async deleteSpace(spaceId: string): Promise<void> {
    this.requireSpace(spaceId);
    const moved = (this.storage.db.prepare('SELECT id FROM artifacts WHERE spaceId = ?').all(spaceId) as { id: string }[]).map((row) => row.id);
    const at = this.now();
    await this.service.inBatch(() => {
      this.storage.db.prepare('UPDATE artifacts SET spaceId = NULL, updatedAt = ? WHERE spaceId = ?').run(at, spaceId);
      this.storage.db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
    });
    this.emitSpace(spaceId, 'deleted');
    for (const id of moved) this.emit(id, 'updated');
  }

  // ── byte kinds and assets ──

  // A byte kind's write (an agent's publish of `html`, a re-sent file): its log row, its file and an `auto` version.
  async writeContent(
    artifactId: string,
    content: ByteContent,
    actor: Actor,
    version: { kind?: VersionKind; label?: string } = {},
    inFrame?: InFrame<{ revision: number; versionId: number }>,
  ): Promise<{ revision: number; versionId: number }> {
    const row = this.requireLive(artifactId);
    if (isDocKind(row.kind)) throw new ArtifactStoreError('invalid', `a ${row.kind} artifact has no byte content`);
    const written = await this.writeBytes(row, actor, content, { kind: version.kind ?? 'auto', label: version.label }, inFrame);
    this.emit(artifactId, 'updated');
    return written;
  }

  // A byte kind's content at `revision` (the latest when omitted): the stored ref and its absolute path.
  contentRef(artifactId: string, revision?: number): { revision: number; ref: ContentRef; path: string } {
    const row = (
      revision === undefined
        ? this.storage.db.prepare('SELECT seq, content FROM artifact_updates WHERE artifactId = ? AND content IS NOT NULL ORDER BY seq DESC LIMIT 1').get(artifactId)
        : this.storage.db.prepare('SELECT seq, content FROM artifact_updates WHERE artifactId = ? AND seq = ? AND content IS NOT NULL').get(artifactId, revision)
    ) as { seq: number; content: string } | undefined;
    if (!row) throw new ArtifactStoreError('notFound', `no content of ${artifactId}${revision === undefined ? '' : ` at revision ${revision}`}`);
    const ref = JSON.parse(row.content) as ContentRef;
    return { revision: row.seq, ref, path: this.files.resolve(artifactId, ref) };
  }

  private byteContentOf(row: EntityRow, ref: ContentRef): ByteContent {
    return row.kind === 'html' ? { bytes: this.files.read(row.id, ref), name: ref.name } : { path: ref.path };
  }

  // Inside a savepoint: one byte-kind write (its log row, its file in place, its version).
  private writeBytesInFrame(row: EntityRow, actor: Actor, content: ByteContent, version: { kind: VersionKind; label?: string }): { revision: number; versionId: number } {
    const at = this.now();
    let make: (seq: number) => ContentRef;
    let staged: string | null = null;
    if (row.kind === 'html') {
      if (!('bytes' in content)) throw new ArtifactStoreError('invalid', 'an html artifact’s content is its bytes');
      if (content.bytes.length > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('tooLarge', `the page is ${content.bytes.length} bytes; the limit is ${ARTIFACT_MAX_BYTES}`, { size: content.bytes.length, limit: ARTIFACT_MAX_BYTES });
      const name = safeName(content.name ?? 'index.html');
      if (!name) throw new ArtifactStoreError('invalid', `the file name ${JSON.stringify(content.name)} is not usable`);
      const stage = this.files.stage(row.id, content.bytes);
      staged = stage.temp;
      make = (seq) => ({ name, sha256: stage.sha256, size: stage.size, path: ArtifactFiles.contentPath(seq, name) });
    } else {
      if (!('path' in content) || !isAbsolute(content.path) || !existsSync(content.path) || !statSync(content.path).isFile()) {
        throw new ArtifactStoreError('invalid', `a file artifact’s content is an existing file’s absolute path`);
      }
      const described = this.files.describe(content.path);
      make = () => ({ ...described, path: content.path });
    }
    try {
      let ref: ContentRef | null = null;
      const seq = this.storage.appendContentInBatch({ artifactId: row.id, actor, at, content: (s) => JSON.stringify((ref = make(s))) });
      if (staged) this.files.place(row.id, staged, ref!.path);
      staged = null;
      const versionId = this.versions.writeContent(row.id, seq, ref!, { kind: version.kind, actor: actorKey(actor), at, label: version.label, designSystemRef: this.pinInFrame(row), assetRefs: this.assetIds(row.id) });
      this.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(at, row.id);
      return { revision: seq, versionId };
    } finally {
      if (staged) this.files.discard(staged);
    }
  }

  // An asset (Decision Log 25l and M6's `artifact_upload_asset`): content-addressed, deduplicated per artifact, named by
  // the ref a format uses (`assets/<name>`, made unique within the artifact).
  async uploadAsset(artifactId: string, bytes: Uint8Array, meta: { name: string; mime: string }, actor: Actor, inFrame?: InFrame<{ assetId: string; ref: string }>): Promise<{ assetId: string; ref: string }> {
    this.requireLive(artifactId);
    if (bytes.length > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('tooLarge', `the asset is ${bytes.length} bytes; the limit is ${ARTIFACT_MAX_BYTES}`, { size: bytes.length, limit: ARTIFACT_MAX_BYTES });
    const name = safeName(meta.name);
    if (!name) throw new ArtifactStoreError('invalid', `the asset name ${JSON.stringify(meta.name)} is not usable`);
    const stage = this.files.stage(artifactId, bytes);
    try {
      const existing = this.storage.db.prepare('SELECT assetId, name FROM artifact_assets WHERE artifactId = ? AND sha256 = ?').get(artifactId, stage.sha256) as { assetId: string; name: string } | undefined;
      if (existing) {
        const same = { assetId: existing.assetId, ref: `assets/${existing.name}` };
        // Nothing to write, yet the answer names a row that may still sit in the open batch (a concurrent upload of the
        // same bytes): it waits for that batch's commit, and fails with it. The seam still runs, in a frame of its own.
        if (inFrame) await this.service.inBatch(() => inFrame(same));
        else await this.service.whenCommitted();
        return same;
      }
      const taken = new Set((this.storage.db.prepare('SELECT name FROM artifact_assets WHERE artifactId = ?').all(artifactId) as { name: string }[]).map((row) => row.name));
      const unique = uniqueName(name, taken);
      const assetId = randomUUID();
      const at = this.now();
      await this.service.inBatch(() => {
        this.storage.actorInBatch(actor, at);
        if (!this.files.exists(artifactId, ArtifactFiles.assetPath(stage.sha256))) this.files.place(artifactId, stage.temp, ArtifactFiles.assetPath(stage.sha256));
        this.storage.db
          .prepare('INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(artifactId, assetId, unique, meta.mime, stage.size, stage.sha256, at, actorKey(actor));
        inFrame?.({ assetId, ref: `assets/${unique}` });
      });
      this.emit(artifactId, 'updated');
      return { assetId, ref: `assets/${unique}` };
    } finally {
      this.files.discard(stage.temp);
    }
  }

  listAssets(artifactId: string): Asset[] {
    const rows = this.storage.db.prepare('SELECT * FROM artifact_assets WHERE artifactId = ? ORDER BY createdAt, rowid').all(artifactId) as unknown as (Omit<Asset, 'ref' | 'createdBy'> & { createdBy: string })[];
    return rows.map((row) => ({ assetId: row.assetId, ref: `assets/${row.name}`, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256, createdAt: row.createdAt, createdBy: actorFromKey(row.createdBy) }));
  }

  private assetIds(artifactId: string): string[] {
    return (this.storage.db.prepare('SELECT assetId FROM artifact_assets WHERE artifactId = ? ORDER BY assetId').all(artifactId) as { assetId: string }[]).map((row) => row.assetId);
  }

  // ── versions ──

  listVersions(artifactId: string): ArtifactVersion[] {
    return this.versions.list(artifactId);
  }

  // A version's V2 state (Decision Log 22c): by id, or the latest version at a seq (a design-system pin's target).
  versionState(artifactId: string, version: number | { seq: number }): Uint8Array {
    const row = this.versions.get(artifactId, version);
    if (!row?.enc) throw new ArtifactStoreError('notFound', `no state for version ${JSON.stringify(version)} of ${artifactId}`);
    return this.versions.state(artifactId, row.id);
  }

  // A version the owner (or a hook) asks for: `named` with its label and note. Answers the version id, or null when an
  // `auto` found nothing new to record.
  async createVersion(artifactId: string, meta: { kind: VersionKind; actor: Actor; label?: string; note?: string; summary?: string }, inFrame?: InFrame<number | null>): Promise<number | null> {
    const row = this.requireLive(artifactId);
    const id = await this.service.inBatch(() => {
      const written = this.versionOf(row, meta);
      inFrame?.(written);
      return written;
    });
    if (id !== null) this.emit(artifactId, 'updated');
    return id;
  }

  // Inside a savepoint: a version of the artifact's current state (a byte kind's names its latest write).
  private versionOf(row: EntityRow, meta: { kind: VersionKind; actor: Actor; label?: string; note?: string; summary?: string }): number | null {
    if (isDocKind(row.kind)) return this.versionInFrame(row, meta);
    if (meta.kind === 'auto') return null;
    const latest = this.versions.latest(row.id);
    if (!latest?.content) return null;
    return this.versions.writeContent(row.id, latest.seq, JSON.parse(latest.content) as ContentRef, { ...meta, actor: actorKey(meta.actor), at: this.now(), designSystemRef: this.pinInFrame(row), assetRefs: this.assetIds(row.id) });
  }

  // Inside a savepoint: a Y kind's version of its current state, with its design-system pin and asset refs.
  // `pinTarget`: the version a design-system pin is about to name, written even for a system never written.
  versionInFrame(row: EntityRow, meta: { kind: VersionKind; actor: Actor | string; label?: string | null; note?: string | null; summary?: string | null }, options: { pinTarget?: boolean } = {}): number | null {
    const at = this.now();
    const { revision, state } = this.service.readState(row.id);
    const actor = typeof meta.actor === 'string' ? meta.actor : actorKey(meta.actor);
    const id = this.versions.writeState(row.id, revision, state, { ...meta, actor, at, designSystemRef: this.pinInFrame(row), assetRefs: this.assetIds(row.id) }, options);
    if (id !== null) {
      this.storage.db.prepare('UPDATE artifacts SET updatedAt = MAX(updatedAt, ?) WHERE id = ?').run(at, row.id);
      this.service.requestHead(row.id);
    }
    return id;
  }

  // The design-system pin of a version being written (Decision Log 22b): the governing system and a retained version of
  // it equal to its live state, writing an `auto` version of the system first when it moved since its last one.
  private pinInFrame(row: EntityRow): DesignSystemRef | null {
    if (row.kind === 'design_system') return null;
    const systemId = this.governingSystem(row);
    const system = systemId ? this.entity(systemId) : undefined;
    if (!system || system.deletedAt !== null || system.kind !== 'design_system') return null;
    const revision = this.service.revision(system.id);
    if (this.versions.latest(system.id)?.seq !== revision) this.versionInFrame(system, { kind: 'auto', actor: this.lastWriter(system.id) }, { pinTarget: true });
    return { id: system.id, versionSeq: this.versions.latest(system.id)!.seq };
  }

  // The artifact's governing design system (Decision Log 22d): its own, else its Space's default, else the owner's.
  governingSystem(row: Pick<EntityRow, 'designSystemId' | 'spaceId'>): string | null {
    if (row.designSystemId) return row.designSystemId;
    const defaults = this.defaults();
    return (row.spaceId ? defaults.spaces[row.spaceId] : undefined) ?? defaults.owner ?? null;
  }

  // The owner looked at the artifact (Decision Log 16): an `auto` version first when the doc moved since its last
  // version, so "See N new changes" has a state to diff from, then `lastViewedAt`.
  async markViewed(artifactId: string): Promise<void> {
    const row = this.requireLive(artifactId);
    await this.service.inBatch(() => {
      if (isDocKind(row.kind)) this.versionInFrame(row, { kind: 'auto', actor: this.lastWriter(artifactId) });
      this.storage.db.prepare('UPDATE artifacts SET lastViewedAt = ? WHERE id = ?').run(this.now(), artifactId);
    });
    this.emit(artifactId, 'updated');
  }

  // The owner's "Delete versions older than…" (Decision Log 8): every kind but pinned states, one artifact or all.
  async pruneVersions(artifactId: string | null, olderThan: number): Promise<number> {
    const pinned = this.versions.pinned();
    const targets = artifactId ? [this.requireLive(artifactId)] : (this.storage.db.prepare('SELECT * FROM artifacts').all() as unknown as EntityRow[]);
    const plan = targets.map((row) => ({ row, ids: this.versions.prunable(row.id, olderThan, pinned, !isDocKind(row.kind)) })).filter((p) => p.ids.length > 0);
    const files = await this.service.inBatch(() => plan.flatMap(({ row, ids }) => this.versions.drop(row.id, ids).map((ref) => ({ artifactId: row.id, ref }))));
    this.removeUnreferenced(files);
    for (const { row } of plan) this.emit(row.id, 'updated');
    return plan.reduce((n, p) => n + p.ids.length, 0);
  }

  // Deletes the stored files of dropped byte-kind versions that no retained version and no live content still names.
  removeUnreferenced(files: { artifactId: string; ref: ContentRef }[]): void {
    for (const { artifactId, ref } of files) {
      const live = this.storage.db.prepare('SELECT 1 FROM artifact_updates WHERE artifactId = ? AND content = ? AND seq = (SELECT MAX(seq) FROM artifact_updates WHERE artifactId = ? AND content IS NOT NULL)').get(artifactId, JSON.stringify(ref), artifactId);
      const kept = this.storage.db.prepare('SELECT 1 FROM artifact_versions WHERE artifactId = ? AND content = ?').get(artifactId, JSON.stringify(ref));
      if (!live && !kept) this.files.removeContent(artifactId, ref);
    }
  }

  // Artifact-wide restore (Decision Log 16; restore.ts).
  async restore(artifactId: string, versionId: number, actor: Actor, inFrame?: InFrame<{ revision: number; versionId: number }>): Promise<{ revision: number; versionId: number }> {
    const row = this.requireLive(artifactId);
    const version = this.requireVersion(artifactId, versionId);
    const result = await restoreArtifact(this, row, version, actor, inFrame);
    this.emit(artifactId, 'updated');
    return result;
  }

  // The merged attribution (encoded ContentMap) of every row overlapping [fromSeq, toSeq] (Decision Log 23a); the
  // whole history of an open doc comes from the service's in-memory merge.
  attributions(artifactId: string, fromSeq: number, toSeq: number): Uint8Array {
    if (this.service.loaded(artifactId) && fromSeq <= 1 && toSeq >= this.service.revision(artifactId)) return encodeMap(this.service.provenance(artifactId));
    return encodeMap(mergeMaps(this.storage.attributions(artifactId, fromSeq, toSeq).map(decodeMap)));
  }

  // ── turns, idempotency and the test writer ──

  // The session's turn ended (Decision Log 23f, 26c): one `turn` version per Y-kind artifact the session committed an
  // edit to in the turn (a read, or a write that changed no document, makes none), summarised by the kind's
  // `summarizeTurn` over its mutating tool calls' results (else "N edits"); its presence is cleared (23d).
  async endTurn(appSessionId: AppSessionId): Promise<void> {
    this.service.clearPresence(appSessionId);
    const wrote = this.turns.get(appSessionId);
    this.turns.delete(appSessionId);
    if (!wrote) return;
    const actor: Actor = { kind: 'session', appSessionId };
    for (const [artifactId, { commits, results }] of wrote) {
      const row = this.entity(artifactId);
      if (commits === 0 || !row || row.deletedAt !== null || !isDocKind(row.kind)) continue;
      const count = results.length > 0 ? results.length : commits;
      const summary = this.service.adapterFor(row.kind)?.summarizeTurn?.(results) ?? `${count} edit${count === 1 ? '' : 's'}`;
      const id = await this.service.inBatch(() => this.versionInFrame(row, { kind: 'turn', actor, summary }));
      if (id !== null) this.emit(artifactId, 'updated');
    }
  }

  // Runs `run` once per tool-use id (Decision Log 11, 26c; ops.ts). A mutating run records its op through `scope.record`
  // inside the savepoint of the write that commits it (a store operation's `inFrame` seam, or `writeAs`'s), and fails
  // when it never does; a `readOnly` run's op row is written after it settles. `actor` (the calling session) files a
  // mutating run's result under its turn (what `summarizeTurn` reads); a read-only result never counts as an edit.
  async withOp<R>(opId: string | null | undefined, tool: string, artifactId: string | null, run: (scope: OpScope) => Promise<R>, options: { actor?: Actor; readOnly?: boolean } = {}): Promise<R> {
    if (!opId) this.log(`${tool} ran without a tool-use id: no replay guarantee`);
    const outcome = await this.ops.once(opId || null, tool, artifactId, run, options.readOnly ?? false);
    const { actor } = options;
    if (outcome.fresh && !options.readOnly && artifactId && actor?.kind === 'session') this.turnEntry(actor.appSessionId, artifactId).results.push(outcome.result);
    return outcome.result;
  }

  // The schema-agnostic test writer (M3; IPC under MAWS_E2E=1 in M4): `ops` applied through the host replica of
  // `actor` as one write, idempotent by `opId`.
  async testWrite(artifactId: string, opId: string, ops: TestOp[], actor: Actor): Promise<{ revision: number }> {
    const row = this.requireLive(artifactId);
    if (!isDocKind(row.kind)) throw new ArtifactStoreError('invalid', `a ${row.kind} artifact is not a document`);
    return this.withOp(
      opId,
      'testWrite',
      artifactId,
      async (scope) => {
        const revision = await this.service.writeAs(artifactId, actor, (doc) => applyTestOps(doc, ops), { inFrame: (at) => scope.record({ revision: at }) });
        return { revision };
      },
      { actor },
    );
  }

  // ── design systems' defaults and context (Decision Log 22d) ──

  defaults(): DesignSystemDefaults {
    const raw = this.storage.getMeta(DEFAULTS_KEY);
    return raw ? (JSON.parse(raw) as DesignSystemDefaults) : { owner: null, spaces: {} };
  }

  // Main's relay of the owner's and the Spaces' defaults, kept so a detached host with main absent still honours them.
  async setDefaults(defaults: DesignSystemDefaults): Promise<void> {
    await this.service.inBatch(() => this.storage.setMeta(DEFAULTS_KEY, JSON.stringify({ owner: defaults.owner, spaces: defaults.spaces })));
  }

  registerDesignSystemContext(provider: (system: Artifact) => Promise<string | null>): void {
    this.designSystemContext = provider;
  }

  // The governing system's guide for a new artifact (M6's `artifact_create`), from D's provider; null without one.
  async designSystemContextFor(artifactId: string): Promise<string | null> {
    const row = this.entity(artifactId);
    const systemId = row ? this.governingSystem(row) : null;
    const system = systemId ? this.get(systemId) : null;
    if (!system || !this.designSystemContext) return null;
    return this.designSystemContext(system);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.maintenance.stop();
    for (const off of this.unsubscribe) off();
    for (const { timer } of this.coalescing.values()) clearTimeout(timer);
    this.coalescing.clear();
    for (const timers of this.schedule.values()) {
      clearTimeout(timers.idle);
      clearTimeout(timers.every);
    }
    this.schedule.clear();
  }

  // ── internals shared with restore.ts and maintenance.ts ──

  entity(artifactId: string): EntityRow | undefined {
    return this.storage.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) as EntityRow | undefined;
  }

  // The actor key of the artifact's last log row (who an `auto` version is credited to), the human when none.
  lastWriter(artifactId: string): string {
    return (this.storage.db.prepare('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq DESC LIMIT 1').get(artifactId) as { actor: string } | undefined)?.actor ?? 'human';
  }

  // An `auto` version now, when the doc moved since its last version (the scheduler; before a restore).
  async autoVersion(artifactId: string): Promise<void> {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null || !isDocKind(row.kind) || this.closed) return;
    if (this.versions.latest(artifactId)?.seq === this.service.revision(artifactId)) return;
    const id = await this.service.inBatch(() => this.versionInFrame(row, { kind: 'auto', actor: this.lastWriter(artifactId) }));
    if (id !== null) this.emit(artifactId, 'updated');
  }

  writeBytes(row: EntityRow, actor: Actor, content: ByteContent, version: { kind: VersionKind; label?: string }, inFrame?: InFrame<{ revision: number; versionId: number }>): Promise<{ revision: number; versionId: number }> {
    return this.service.inBatch(() => {
      const written = this.writeBytesInFrame(row, actor, content, version);
      inFrame?.(written);
      return written;
    });
  }

  readBytes(row: EntityRow, ref: ContentRef): ByteContent {
    return this.byteContentOf(row, ref);
  }

  private requireLive(artifactId: string): EntityRow {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
    return row;
  }

  private requireVersion(artifactId: string, versionId: number) {
    const version = this.versions.get(artifactId, versionId);
    if (!version) throw new ArtifactStoreError('notFound', `no version ${versionId} of ${artifactId}`, { artifactId, versionId });
    return version;
  }

  private requireSpace(spaceId: string): void {
    if (!this.getSpace(spaceId)) throw new ArtifactStoreError('notFound', `no space ${spaceId}`, { spaceId });
  }

  private requireDesignSystem(artifactId: string): void {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null || row.kind !== 'design_system') throw new ArtifactStoreError('invalid', `${artifactId} is not a live design system`, { designSystemId: artifactId });
  }

  private turnEntry(appSessionId: string, artifactId: string): { commits: number; results: unknown[] } {
    const wrote = this.turns.get(appSessionId) ?? new Map<string, { commits: number; results: unknown[] }>();
    this.turns.set(appSessionId, wrote);
    const entry = wrote.get(artifactId) ?? { commits: 0, results: [] };
    wrote.set(artifactId, entry);
    return entry;
  }

  // A document commit: the change feed (coalesced), the auto-version scheduler and the writing sessions' turns.
  private committed({ artifactId, revision, actors }: Committed): void {
    const row = this.entity(artifactId);
    if (!row || !isDocKind(row.kind)) return; // a suggestion doc's key, or no entity row
    for (const actor of actors) if (actor.kind === 'session') this.turnEntry(actor.appSessionId, artifactId).commits += 1;
    this.feed(row, revision);
    const timers = this.schedule.get(artifactId) ?? {};
    this.schedule.set(artifactId, timers);
    const fire = (which: 'idle' | 'every') => () => {
      delete timers[which];
      if (!timers.idle && !timers.every) this.schedule.delete(artifactId);
      void this.autoVersion(artifactId).catch((error: unknown) => this.log(`an auto version of ${artifactId} failed: ${error instanceof Error ? error.message : String(error)}`));
    };
    if (actors.some((actor) => actor.kind === 'human')) {
      clearTimeout(timers.idle);
      timers.idle = unref(setTimeout(fire('idle'), AUTO_IDLE_MS));
    }
    timers.every ??= unref(setTimeout(fire('every'), AUTO_EVERY_MS));
  }

  // The docs with rows in the batch about to commit get their `updatedAt` in it.
  private stamp(artifactIds: string[]): void {
    const at = this.now();
    const update = this.storage.db.prepare('UPDATE artifacts SET updatedAt = MAX(updatedAt, ?) WHERE id = ?');
    for (const id of artifactIds) update.run(at, id);
  }

  // At most one change per artifact per CHANGE_COALESCE_MS for document commits, the latest revision winning.
  private feed(row: EntityRow, revision: number): void {
    const slot = this.coalescing.get(row.id);
    if (slot) {
      slot.pending = revision;
      return;
    }
    this.send({ artifactId: row.id, kind: row.kind, revision, change: 'updated' });
    const open = (): { timer: ReturnType<typeof setTimeout>; pending: number | null } => {
      const next = {
        pending: null as number | null,
        timer: unref(
          setTimeout(() => {
            if (next.pending === null) return void this.coalescing.delete(row.id);
            this.send({ artifactId: row.id, kind: row.kind, revision: next.pending, change: 'updated' });
            this.coalescing.set(row.id, open());
          }, CHANGE_COALESCE_MS),
        ),
      };
      return next;
    };
    this.coalescing.set(row.id, open());
  }

  private emit(artifactId: string, change: ArtifactChange): void {
    const row = this.entity(artifactId);
    if (row) this.send({ artifactId, kind: row.kind, revision: this.service.revision(artifactId), change });
  }

  private send(change: ArtifactChanged): void {
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch (error) {
        this.log(`an onChange listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private emitSpace(spaceId: string, change: SpaceChanged['change']): void {
    for (const listener of this.spaceListeners) {
      try {
        listener({ spaceId, change });
      } catch (error) {
        this.log(`an onSpaceChange listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export type { EntityRow };

function toArtifact(row: EntityRow): Artifact {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.handle === null ? {} : { handle: row.handle }),
    ...(row.spaceId === null ? {} : { spaceId: row.spaceId }),
    ...(row.projectId === null ? {} : { projectId: row.projectId as Artifact['projectId'] }),
    createdBy: actorFromKey(row.createdBy),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastViewedAt: row.lastViewedAt,
    pinned: row.pinned === 1,
    ...(row.designSystemId === null ? {} : { designSystemId: row.designSystemId }),
    ...(row.linkedPath === null ? {} : { linkedPath: row.linkedPath }),
    agentEditsAsSuggestions: row.agentEditsAsSuggestions === 1,
  };
}

function toSpace(row: { id: string; name: string; linkedDir: string | null; createdAt: number }): Space {
  return { id: row.id, name: row.name, ...(row.linkedDir === null ? {} : { linkedDir: row.linkedDir }), createdAt: row.createdAt };
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
}

function applyTestOps(doc: Doc, ops: TestOp[]): void {
  for (const op of ops) {
    const node = doc.get(op.root ?? 'root');
    if (op.op === 'setAttr') node.setAttr(op.key, op.value);
    else if (op.op === 'insertText') node.insert(op.index, op.text);
    else node.delete(op.index, op.length);
  }
}

function unref<T>(timer: T): T {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
