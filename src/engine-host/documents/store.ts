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
import { stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { KindAdapter } from '@artifacts/host';
import { applyV2, bindingVersion, decodeMap, encodeMap, mergeMaps, newDoc, overlayMap, type Doc } from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
// P3-H start
import * as z from 'zod';
import { ConnectorCallRefSchema, ConnectorGrantRequestSchema, ConnectorToolRefSchema, type ConnectorAuthorization, type ConnectorCallRef, type ConnectorGrant, type ConnectorGrantChange, type ConnectorGrantMode, type ConnectorGrantRequest, type ConnectorToolRef, connectorToolKey } from '@shared/artifacts/connectors';
// P3-H end
import { isDocKind, type Artifact, type ArtifactKind, type ArtifactSessionLink, type Space } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import { ARTIFACT_ID, ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { ArtifactFiles, safeName, type ContentRef } from './bytes';
import { ArtifactStoreError, StoreTooNewError } from './errors'; // P3-H: StoreTooNewError
import { Maintenance } from './maintenance';
import { OpLedger, type OpScope } from './ops';
import { timed } from './host-work'; // P4-R6
import { restoreArtifact } from './restore';
import { datasetRefsOf, isQuerySnapshotName, SnapshotRetention, type AssetHold } from './retention'; // E3
import { mainOf, type Committed, type DocumentService, type WriteOptions } from './service';
import type { SqliteDocumentStorage } from './storage';
import { actorFromKey, VersionStore, type DesignSystemRef, type VersionKind } from './versions';

export const AUTO_IDLE_MS = 2 * 60_000; // an auto version 2 minutes after the last human update (§4.7)
export const AUTO_EVERY_MS = 10 * 60_000; // and every 10 minutes of continuous activity, by anyone
export const CHANGE_COALESCE_MS = 250; // a Y doc's commits reach the change feed at most this often per artifact
export const STAGED_MAX_AGE_MS = 3_600_000; // a staged temp file this old is a killed write's (collectStaged)

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

// A byte kind's content: `html` takes bytes (and a file name, `index.html` by default), `file` a path in place, with its
// `digest` when the caller hashed it beforehand (`files.describeStreamed`, off the commit path), else hashed at the write.
export type ByteContent = { bytes: Uint8Array; name?: string } | { path: string; digest?: { sha256: string; size: number } };

// A version row as the store reads it.
type VersionRow = NonNullable<ReturnType<VersionStore['get']>>;

export interface CreateInput {
  kind: ArtifactKind;
  title: string;
  handle?: string;
  spaceId?: string;
  projectId?: string;
  designSystemId?: string;
  content?: ByteContent;
  // A Y kind's first content (an agent's create with files, M6): written by the creating actor in the savepoint of the
  // entity row, so the artifact commits with it or not at all (Decision Log 40b). A throw takes both back.
  initial?: (doc: Doc) => void;
}

// One X12 record as P3-L's cutover hands it to `importArtifact` (Decision Log 35f): `content` an html version's bytes and
// name, or a file version's path in place.
export interface ImportInput {
  id: string;
  kind: 'html' | 'file';
  title: string;
  createdAt: number;
  updatedAt: number;
  createdBy: Actor;
  handle?: string;
  projectId?: string;
  versions: { at: number; actor: Actor; content: ByteContent; label?: string }[]; // P3-L (M6b fix wave 1): `label`, X12's number
  links: { appSessionId: AppSessionId; role: ArtifactSessionLink['role']; lastAt: number }[];
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
  | { op: 'deleteText'; index: number; length: number; root?: string }
  | { op: 'page'; text: string }; // M7 fix wave 1: an html page's new content, its only op

// A store write's recording seam (Decision Log 26c): run inside the savepoint of the write that completes the operation,
// with what it produced, so whatever it writes (an op row, `OpScope.record`) commits with the write or not at all. Every
// path through the operation calls it once, a write that turned out to change nothing included.
export type InFrame<T> = (result: T) => void;

export interface DesignSystemDefaults {
  owner: string | null;
  spaces: Record<string, string>;
}

// Which design system governs an artifact (Decision Log 42; ledger X23, X28): P3-D's chain (own system, Space default,
// owner default, the house system; deleted or non-live ids skipped), synchronous over the store's committed state so it
// is safe inside a version's frame. `{builtin: 'maws'}`: no store system governs and the bundled floor renders. `target`
// is the artifact's row (or, for an artifact not yet created, where it will be placed).
export interface DesignSystemChain {
  governing(target: { designSystemId?: string | null; spaceId?: string | null }): { id: string } | { builtin: 'maws' };
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
  private readonly defaultsListeners = new Set<() => void>(); // P3-C (Decision Log 29)
  private readonly grantListeners = new Set<(change: ConnectorGrantChange) => void>(); // P3-H
  private readonly fences = new Map<string, Set<ConnectorFence>>(); // P3-H H3b: per artifact, the dispatch fences held now
  private readonly coalescing = new Map<string, { timer: ReturnType<typeof setTimeout>; pending: number | null }>();
  private readonly creating = new Set<string>(); // artifacts whose first content is committing: `created` announces them
  private readonly schedule = new Map<string, { idle?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setTimeout> }>();
  // Per session, the artifacts it touched this turn: its committed document edits (a turn version needs one) and its
  // mutating tool calls' results (the turn version's summary).
  private readonly turns = new Map<string, Map<string, { commits: number; results: unknown[] }>>();
  private designSystemContext: ((system: Artifact) => Promise<string | null>) | null = null;
  // A's own chain until P3-D registers its (the last registration wins)
  private designSystemChain: DesignSystemChain = { governing: (target) => this.ownGoverning(target) };
  private readonly unsubscribe: (() => void)[] = [];
  private closed = false;
  // P3-E (ensureMigrated): the artifacts this run found in their kind's current model, and the migrations under way
  private readonly migrated = new Set<string>();
  private readonly migrating = new Map<string, Promise<void>>();
  private readonly retention: SnapshotRetention; // E3: the query snapshots' retention and the readers' holds

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
    this.retention = new SnapshotRetention(this, { now: this.now, log: this.log, closed: () => this.closed }); // E3
    this.unsubscribe.push(service.onCommitted((change) => this.committed(change)));
    this.unsubscribe.push(service.onBeforeCommit((ids) => this.stamp(ids)));
    // the last version's state is kept only while its doc is loaded (versionInFrame): it goes when the doc does
    this.unsubscribe.push(service.onUnload((artifactId) => this.versions.forget(artifactId)));
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

  // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 29; the P3 spec's Decision Log 69): told
  // once main's relay of the design-system defaults (`setDefaults`) has committed, so what the default chain feeds (the
  // deck's mirror) can follow it.
  onDefaultsChange(listener: () => void): () => void {
    this.defaultsListeners.add(listener);
    return () => this.defaultsListeners.delete(listener);
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
    if (!row || (!options.includeDeleted && row.deletedAt !== null)) return null;
    const seen = this.storage.getMeta(`viewed-seq:${artifactId}`);
    return { ...toArtifact(row), ...(seen !== null && { lastViewedSeq: Number(seen) }) };
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
  // ancestors nearest first; Decision Log 3). Null when nothing live matches. P3-F (artifact-protocol finding 7): a
  // handle may be shaped like a UUID (E2's ids were names an agent chose), so a UUID that names no live artifact is
  // looked up as a handle: it resolves, and collides at a create, as any handle does.
  resolve(ref: string, lineage: readonly string[] = []): string | null {
    if (UUID.test(ref) && this.get(ref)) return ref;
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
  // write it as an `import` version; Y kinds start with `initial` written in the entity's savepoint, else with their
  // kind adapter's seed (`KindAdapter.initial`, Decision Log 44c), else empty. One `created` announces it: the first
  // content's commit is not also announced as an update.
  //
  // F (L139): a file given by its path alone is hashed by a streamed read once the create is checked, before its batch;
  // the checks run again where it writes (a Space or a system may have gone meanwhile), their refusal released after the
  // batch they read (`writeCommitted`).
  async create(input: CreateInput, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    this.checkCreate(input, actor);
    if (input.kind !== 'file' || !input.content || !('path' in input.content) || input.content.digest) return this.createChecked(input, actor, inFrame); // a path of another kind is refused by its write, unread
    const content = await this.withDigest(input.content);
    return this.writeCommitted(async () => {
      this.checkCreate(input, actor);
      return this.createChecked({ ...input, content }, actor, inFrame);
    });
  }

  private async createChecked(input: CreateInput, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    const id = randomUUID();
    const at = this.now();
    const adapter = isDocKind(input.kind) ? this.service.adapterFor(input.kind) : undefined;
    const first = input.initial ?? (adapter?.initial ? (doc: Doc) => adapter.initial!(doc, { title: input.title }) : undefined);
    try {
      if (first) {
        this.creating.add(id);
        await this.service.writeAs(id, actor, first, { prepare: () => this.insertInFrame(id, input, actor, at), inFrame: () => inFrame?.(toArtifact(this.entity(id)!)) }).finally(() => this.creating.delete(id));
      } else {
        await this.service.inBatch(() => {
          this.insertInFrame(id, input, actor, at);
          inFrame?.(toArtifact(this.entity(id)!));
        });
      }
    } catch (error) {
      if (!this.entity(id)) this.files.removeAll(id); // a fresh id: whatever its directory holds, no row names
      throw error;
    }
    if (input.content) this.wroteBytes(actor, id);
    this.emit(id, 'created');
    return this.get(id)!;
  }

  // Several creates as one operation (an agent's `send_file`, M6): every entity row, link and content write in one
  // savepoint, with `inFrame` (an op row) last, so the delivery commits whole or not at all; other operations sharing
  // the batch are untouched by its failure. No `initial` here: a Y kind's first content is per document.
  async createAll(inputs: CreateInput[], actor: Actor, inFrame?: InFrame<Artifact[]>): Promise<Artifact[]> {
    const handles = new Set<string>();
    for (const input of inputs) {
      if (input.initial) throw new ArtifactStoreError('invalid', 'createAll writes no first content of a Y kind');
      this.checkCreate(input, actor);
      if (input.handle !== undefined && handles.has(input.handle)) throw new ArtifactStoreError('handleTaken', `the handle ${input.handle} is given twice`, { handle: input.handle });
      if (input.handle !== undefined) handles.add(input.handle);
    }
    const ids = inputs.map(() => randomUUID());
    const at = this.now();
    try {
      await this.service.inBatch(() => {
        inputs.forEach((input, index) => this.insertInFrame(ids[index]!, input, actor, at));
        inFrame?.(ids.map((id) => toArtifact(this.entity(id)!)));
      });
    } catch (error) {
      for (const id of ids) if (!this.entity(id)) this.files.removeAll(id);
      throw error;
    }
    inputs.forEach((input, index) => {
      if (input.content) this.wroteBytes(actor, ids[index]!);
      this.emit(ids[index]!, 'created');
    });
    return ids.map((id) => this.get(id)!);
  }

  // A create's checks, made before its first await (Decision Log 33).
  private checkCreate(input: CreateInput, actor: Actor): void {
    if (input.handle !== undefined && !ARTIFACT_ID.test(input.handle)) throw new ArtifactStoreError('invalid', `the handle ${JSON.stringify(input.handle)} is not a valid artifact handle`);
    if (!isDocKind(input.kind) && !input.content) throw new ArtifactStoreError('invalid', `a ${input.kind} artifact is created with its content`);
    if (isDocKind(input.kind) && input.content) throw new ArtifactStoreError('invalid', `a ${input.kind} artifact starts empty`);
    if (!isDocKind(input.kind) && input.initial) throw new ArtifactStoreError('invalid', `a ${input.kind} artifact has no document to start`);
    if (input.spaceId) this.requireSpace(input.spaceId);
    if (input.designSystemId) this.requireDesignSystem(input.designSystemId);
    if (input.handle && actor.kind === 'session' && this.resolve(input.handle, [actor.appSessionId])) {
      throw new ArtifactStoreError('handleTaken', `this session already has an artifact with the handle ${input.handle}`, { handle: input.handle });
    }
  }

  // Inside a savepoint: a new artifact's entity row, its creator's link and a byte kind's first content.
  private insertInFrame(id: string, input: CreateInput, actor: Actor, at: number): void {
    this.storage.actorInBatch(actor, at);
    this.storage.db
      .prepare('INSERT INTO artifacts (id, kind, title, handle, spaceId, projectId, createdBy, createdAt, updatedAt, pinned, designSystemId, linkedPath, bindingVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(id, input.kind, input.title, input.handle ?? null, input.spaceId ?? null, input.projectId ?? null, actorKey(actor), at, at, input.designSystemId ?? null, input.content && 'path' in input.content ? input.content.path : null, isDocKind(input.kind) ? bindingVersion : null);
    if (actor.kind === 'session') this.linkInFrame(id, actor.appSessionId, 'created', at);
    if (input.content) this.writeBytesInFrame(this.entity(id)!, actor, input.content, { kind: 'import' });
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

  // A soft delete (`deletedAt`); a design system still governing a live artifact is refused (Decision Log 22a). P3-H:
  // its connector grants go in the same savepoint (a soft delete fires no cascade), each announced as revoked.
  async delete(artifactId: string, inFrame?: InFrame<void>): Promise<void> {
    const row = this.requireLive(artifactId);
    if (row.kind === 'design_system') {
      const users = (this.storage.db.prepare('SELECT id FROM artifacts WHERE designSystemId = ? AND deletedAt IS NULL AND id <> ? ORDER BY id').all(artifactId, artifactId) as { id: string }[]).map((r) => r.id);
      if (users.length > 0) throw new ArtifactStoreError('designSystemInUse', `the design system governs ${users.length} artifact(s)`, { artifactIds: users });
    }
    const at = this.now();
    this.breakFences(artifactId, null); // P3-H H3b: no connector call fenced before the delete writes
    const revoked = await this.service.inBatch(() => {
      this.storage.db.prepare('UPDATE artifacts SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(at, at, artifactId);
      const grants = this.grantRows(artifactId); // P3-H
      this.storage.db.prepare('DELETE FROM artifact_connector_grants WHERE artifactId = ?').run(artifactId); // P3-H
      inFrame?.();
      return grants;
    });
    this.versions.forget(artifactId); // a deleted artifact writes no more versions
    for (const grant of revoked) this.emitGrant(artifactId, grant, 'revoked'); // P3-H
    this.emit(artifactId, 'deleted');
  }

  // "Make a copy" (Decision Log 23b): of the live state, or of a version's. A Y kind's copy starts from the state; a
  // byte kind's from the content. The assets that state needs come with it (the version's asset refs, else every asset
  // the artifact has), under the same ids and names, so the copied content's references resolve. The copy's history
  // starts with an `import` version.
  //
  // The copy is one savepoint (Decision Log 37c): the entity row, its link and its assets, then a Y kind's state through
  // the duplicator's host replica (the doc takes its kind's adapter from the entity row written first) with its
  // `import` version, or a byte kind's content write. A copy whose state fails to land leaves nothing, rows or files.
  //
  // F (L139): a file's content is hashed by a streamed read before the copy's batch. The source and its version are read
  // again where the copy is written, so a source or a version gone meanwhile is refused, and the copy takes the source's
  // placement as it is then (never a system or a Space since deleted); its content stays the one hashed.
  async duplicate(artifactId: string, options: { versionId?: number; title?: string }, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    const source = this.requireLive(artifactId);
    const version = options.versionId === undefined ? undefined : this.requireVersion(artifactId, options.versionId);
    const content = isDocKind(source.kind) ? null : this.byteContentOf(source, version ? (JSON.parse(version.content!) as ContentRef) : this.contentRef(artifactId).ref);
    if (!content || !('path' in content)) return this.copyOf(source, version, content, options, actor, inFrame);
    const hashed = await this.withDigest(content);
    return this.writeCommitted(async () =>
      this.copyOf(this.requireLive(artifactId), options.versionId === undefined ? undefined : this.requireVersion(artifactId, options.versionId), hashed, options, actor, inFrame),
    );
  }

  // The copy itself, synchronous up to its batch: `content` a byte kind's, null for a Y kind.
  private async copyOf(source: EntityRow, version: VersionRow | undefined, content: ByteContent | null, options: { title?: string }, actor: Actor, inFrame?: InFrame<Artifact>): Promise<Artifact> {
    const artifactId = source.id;
    const id = randomUUID();
    const at = this.now();
    const state = !isDocKind(source.kind) ? null : version ? this.versions.state(artifactId, version.id) : this.service.readState(artifactId).state;
    const pinned = version ? (JSON.parse(version.assetRefs) as string[]) : this.assetIds(artifactId);
    const assets = state ? this.retention.copiedAssets(artifactId, pinned, state) : pinned; // E3: never a snapshot its state cannot name
    const entity = () => {
      this.storage.actorInBatch(actor, at);
      this.storage.db
        .prepare('INSERT INTO artifacts (id, kind, title, spaceId, projectId, createdBy, createdAt, updatedAt, pinned, designSystemId, linkedPath, bindingVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
        .run(id, source.kind, options.title ?? `Copy of ${source.title}`, source.spaceId, source.projectId, actorKey(actor), at, at, source.designSystemId, source.linkedPath, isDocKind(source.kind) ? bindingVersion : null);
      if (actor.kind === 'session') this.linkInFrame(id, actor.appSessionId, 'created', at);
      this.copyAssetsInFrame(artifactId, id, assets);
    };
    const copied = state ? this.service.adapterFor(source.kind)?.copied : undefined; // P4 (W1, L277): the kind's copy hook
    try {
      if (state) {
        await this.service.writeAs(id, actor, (doc) => {
          applyV2(doc, state);
          copied?.(doc, { title: source.title });
        }, {
          prepare: entity,
          inFrame: () => {
            this.versionInFrame(this.entity(id)!, { kind: 'import', actor });
            inFrame?.(toArtifact(this.entity(id)!));
          },
        });
      } else {
        await this.service.inBatch(() => {
          entity();
          this.writeBytesInFrame(this.entity(id)!, actor, content!, { kind: 'import' });
          inFrame?.(toArtifact(this.entity(id)!));
        });
      }
    } catch (error) {
      if (!this.entity(id)) this.files.removeAll(id); // a fresh id: whatever its directory holds, no row names
      throw error;
    }
    this.emit(id, 'created');
    return this.get(id)!;
  }

  // The import write of P3-L's cutover (Decision Log 35f, 37b): one X12 record as a byte-kind artifact under its own id,
  // with its explicit times, creator, handle and project, its versions written in order as `import` versions at their
  // own times by their own actors, and its session links with their roles and times; no X12 mirror (the records exist).
  // Imported versions carry no design-system pin (Decision Log 38d). One savepoint: all of it commits or none (a version
  // or a commit that fails takes the whole artifact back, its files with it). An id already present, deleted or not, is
  // skipped whole (`imported: false`), so a rerun skips what landed.
  async importArtifact(input: ImportInput): Promise<{ artifactId: string; imported: boolean }> {
    const { id } = input;
    if (!UUID.test(id)) throw new ArtifactStoreError('invalid', `an imported artifact's id must be a UUID, not ${JSON.stringify(id)}`);
    if (input.kind !== 'html' && input.kind !== 'file') throw new ArtifactStoreError('invalid', `a ${String(input.kind)} artifact cannot be imported (html and file only)`);
    if (input.versions.length === 0) throw new ArtifactStoreError('invalid', 'an imported artifact needs at least one version');
    if (input.handle !== undefined && !ARTIFACT_ID.test(input.handle)) throw new ArtifactStoreError('invalid', `the handle ${JSON.stringify(input.handle)} is not a valid artifact handle`);
    if (this.entity(id)) {
      // Landed already, or landing in the open batch: the answer names that row, so it waits for the row's commit.
      if (this.storage.batchOpen) await this.service.whenCommitted();
      return { artifactId: id, imported: false };
    }
    const { handle } = input;
    for (const link of input.links) {
      if (handle !== undefined && link.role === 'created' && this.resolve(handle, [link.appSessionId])) {
        throw new ArtifactStoreError('handleTaken', `session ${link.appSessionId} already has an artifact with the handle ${handle}`, { handle });
      }
    }
    const latest = input.versions[input.versions.length - 1].content;
    try {
      await this.service.inBatch(() => {
        // P4 (W1, L130): no row names this id here (checked above, in the same synchronous turn), so whatever its
        // directory holds is an attempt taken back: one whose catch, run after this frame, will find these rows and keep
        // its files. Swept before anything is placed, the directory holds only what this import writes.
        this.files.removeAll(id);
        this.storage.actorInBatch(input.createdBy, input.createdAt);
        this.storage.db
          .prepare('INSERT INTO artifacts (id, kind, title, handle, projectId, createdBy, createdAt, updatedAt, pinned, linkedPath) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
          .run(id, input.kind, input.title, handle ?? null, input.projectId ?? null, actorKey(input.createdBy), input.createdAt, input.updatedAt, 'path' in latest ? latest.path : null);
        for (const link of input.links) this.linkInFrame(id, link.appSessionId, link.role, link.lastAt);
        const row = this.entity(id)!;
        // no design-system pin: a historic version was not seen under today's system (Decision Log 38d)
        for (const version of input.versions) this.writeBytesInFrame(row, version.actor, version.content, { kind: 'import', at: version.at, pin: false, label: version.label });
        this.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(input.updatedAt, id);
      });
    } catch (error) {
      // The rows went back (the savepoint, or the whole batch when its commit failed); the files the versions placed go
      // too, unless a retry of the same id has rows again by now (open or committed): that retry swept the directory at
      // its frame's start, so it then holds only what the retry placed.
      if (!this.entity(id)) this.files.removeAll(id);
      throw error;
    }
    this.emit(id, 'created');
    return { artifactId: id, imported: true };
  }

  // Inside a savepoint: the assets `assetIds` of one artifact copied into another, rows and files, ids, names and
  // order kept.
  private copyAssetsInFrame(fromId: string, toId: string, assetIds: string[]): void {
    const wanted = new Set(assetIds);
    const rows = (this.storage.db.prepare('SELECT * FROM artifact_assets WHERE artifactId = ? ORDER BY createdAt, rowid').all(fromId) as unknown as { assetId: string; name: string; mime: string; size: number; sha256: string; createdAt: number; createdBy: string; querySnapshot: number }[]).filter((row) =>
      wanted.has(row.assetId),
    );
    // E3: a copy keeps each asset's classification, every copied row active; the copy's own frame (the dashboard kind's
    // hook) starts its membership with the snapshots its state names and retires the copied candidates it does not need
    const insert = this.storage.db.prepare('INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy, querySnapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
      insert.run(toId, row.assetId, row.name, row.mime, row.size, row.sha256, row.createdAt, row.createdBy, row.querySnapshot);
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

  // A session's link written in the frame of a write its caller holds open (a `writeAs`'s or a store write's `inFrame`),
  // so it commits with that write or not at all (P3-F, artifact-protocol finding 3: a publish links `edited` only with
  // what it wrote, never on a refusal), and announced after that commit as `link`'s is. Outside a write's savepoint it
  // throws, as the op ledger's `record` does: the link would commit on its own.
  linkInWrite(artifactId: string, appSessionId: AppSessionId, role: ArtifactSessionLink['role']): void {
    if (!this.storage.frameOpen) throw new Error(`the ${role} link of ${artifactId} was written outside a write's savepoint: write it inside the savepoint of the write it commits with`);
    this.linkInFrame(artifactId, appSessionId, role, this.now());
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
    this.wroteBytes(actor, artifactId);
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

  // A file's content with its digest, hashed now by a streamed read (`files.describeStreamed`), so the write's batch only
  // records it and a large file never holds the event loop inside the transaction (the owner's create, copy and restore,
  // as the agent's `send_file` and `artifact_create` hash first). Bytes, a given digest, or a path that is not a regular
  // file or cannot be read are answered unchanged: the write's own checks refuse what it cannot use. Only a regular file
  // is opened (a FIFO or a device could block the read).
  async withDigest(content: ByteContent): Promise<ByteContent> {
    if (!('path' in content) || content.digest || !isAbsolute(content.path)) return content;
    if (!(await stat(content.path).catch(() => null))?.isFile()) return content;
    const described = await this.files.describeStreamed(content.path).catch(() => null);
    return described ? { path: content.path, digest: { sha256: described.sha256, size: described.size } } : content;
  }

  // Inside a savepoint: one byte-kind write (its log row, its file in place, its version, pinned to the governing design
  // system unless `pin` is false: an imported historic version).
  private writeBytesInFrame(row: EntityRow, actor: Actor, content: ByteContent, version: { kind: VersionKind; label?: string; at?: number; pin?: boolean }): { revision: number; versionId: number } {
    const at = version.at ?? this.now();
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
      const described = content.digest ? { name: basename(content.path), ...content.digest } : this.files.describe(content.path);
      make = () => ({ name: described.name, sha256: described.sha256, size: described.size, path: content.path });
    }
    try {
      let ref: ContentRef | null = null;
      const seq = this.storage.appendContentInBatch({ artifactId: row.id, actor, at, content: (s) => JSON.stringify((ref = make(s))) });
      if (staged) this.files.place(row.id, staged, ref!.path);
      staged = null;
      const versionId = this.versions.writeContent(row.id, seq, ref!, { kind: version.kind, actor: actorKey(actor), at, label: version.label, designSystemRef: version.pin === false ? null : this.pinInFrame(row), assetRefs: this.assetIds(row.id) });
      this.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(at, row.id);
      return { revision: seq, versionId };
    } finally {
      if (staged) this.files.discard(staged);
    }
  }

  // An asset (Decision Log 25l and M6's `artifact_upload_asset`): content-addressed, deduplicated per artifact, named by
  // the ref a format uses (`assets/<name>`, made unique within the artifact). E3 panel wave: a name in the query-snapshot
  // namespace is the refresh sink's alone, refused here (a copy carries its source asset's own name and bytes instead).
  async uploadAsset(artifactId: string, bytes: Uint8Array, meta: { name: string; mime: string }, actor: Actor, inFrame?: InFrame<{ assetId: string; ref: string }>): Promise<{ assetId: string; ref: string }> {
    const name = safeName(meta.name); // E3 panel
    if (name && isQuerySnapshotName(name)) throw reservedName(name); // E3 panel
    return this.placeUpload(artifactId, bytes, meta, actor, inFrame);
  }

  private async placeUpload(artifactId: string, bytes: Uint8Array, meta: { name: string; mime: string }, actor: Actor, inFrame?: InFrame<{ assetId: string; ref: string }>): Promise<{ assetId: string; ref: string }> {
    this.requireLive(artifactId);
    if (bytes.length > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('tooLarge', `the asset is ${bytes.length} bytes; the limit is ${ARTIFACT_MAX_BYTES}`, { size: bytes.length, limit: ARTIFACT_MAX_BYTES });
    const name = safeName(meta.name);
    if (!name) throw new ArtifactStoreError('invalid', `the asset name ${JSON.stringify(meta.name)} is not usable`);
    const stage = this.files.stage(artifactId, bytes);
    try {
      const existing = this.existingAsset(artifactId, stage.sha256);
      if (existing) {
        // Nothing to write, yet the answer names a row that may still sit in the open batch (a concurrent upload of the
        // same bytes): it waits for that batch's commit, and fails with it. The seam still runs, in a frame of its own.
        // E3: an upload answered with a managed query snapshot adopts it (whatever the uploader does with the ref, it is
        // ordinary now, never collected), in a frame of its own too.
        const adopt = this.retention.isManaged(artifactId, existing.assetId);
        if (inFrame || adopt)
          await this.service.inBatch(() => {
            if (adopt) this.retention.adoptInFrame(artifactId, existing.assetId);
            inFrame?.(existing);
          });
        else await this.service.whenCommitted();
        return existing;
      }
      const unique = uniqueName(name, this.assetNames(artifactId));
      const at = this.now();
      const asset = await this.service.inBatch(() => {
        this.storage.actorInBatch(actor, at);
        const placed = this.placeAssetInFrame(artifactId, stage, { name: unique, mime: meta.mime }, actor, at);
        inFrame?.(placed);
        return placed;
      });
      this.emit(artifactId, 'updated');
      return asset;
    } finally {
      this.files.discard(stage.temp);
    }
  }

  // P3-E start (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X23, the parent's Decision Log 6): a
  // document write and the assets it names as one operation (E2's `artifact_dataset`, E3's refresh). The bytes are
  // staged before the frame (a staged or placed file no row names is not live state: a later write of the same bytes
  // reuses it). Inside the write's one savepoint, in order: `options.prepare` (the caller's final check), each asset's
  // row (identical bytes answer the ref the artifact already holds, a new name is made unique, within this call too),
  // the session's `edited` link, `edit` given the refs in the order of `assets`, the kind's hooks, `afterWrite`, then
  // `options.inFrame`. A `prepare` that throws refuses the write: nothing else of it is written (it must write nothing
  // before it throws), the document stays loaded, and the promise rejects with its error once the batch open then has
  // committed. A throw anywhere later takes the whole frame back, as `writeAs` does. Resolves with the revision.
  // E3: an asset marked `querySnapshot` is registered as a query's snapshot (retention.ts), and an identical one already
  // held keeps its classification; an unmarked asset answered with a managed snapshot adopts it.
  async writeWithAssets(
    artifactId: string,
    actor: Actor,
    assets: { bytes: Uint8Array; name: string; mime: string; querySnapshot?: boolean }[],
    edit: (doc: Doc, assets: { assetId: string; ref: string }[]) => void,
    options?: WriteOptions,
  ): Promise<number> {
    const row = this.requireLive(artifactId);
    if (!isDocKind(row.kind)) throw new ArtifactStoreError('invalid', `a ${row.kind} artifact has no document to write`);
    const named = assets.map((asset) => {
      if (asset.bytes.length > ARTIFACT_MAX_BYTES) throw new ArtifactStoreError('tooLarge', `the asset is ${asset.bytes.length} bytes; the limit is ${ARTIFACT_MAX_BYTES}`, { size: asset.bytes.length, limit: ARTIFACT_MAX_BYTES });
      const name = safeName(asset.name);
      if (!name) throw new ArtifactStoreError('invalid', `the asset name ${JSON.stringify(asset.name)} is not usable`);
      if (!asset.querySnapshot && isQuerySnapshotName(name)) throw reservedName(name); // E3 panel: the refresh sink's namespace
      return { ...asset, name };
    });
    const stages: ReturnType<ArtifactFiles['stage']>[] = [];
    try {
      for (const asset of named) stages.push(this.files.stage(artifactId, asset.bytes));
      const refs: { assetId: string; ref: string }[] = [];
      let refused: { error: unknown } | null = null;
      const at = this.now();
      const revision = await this.service.writeAs(artifactId, actor, (doc) => (refused ? undefined : edit(doc, refs)), {
        prepare: () => {
          try {
            options?.prepare?.();
          } catch (error) {
            refused = { error };
            return;
          }
          this.storage.actorInBatch(actor, at);
          const taken = this.assetNames(artifactId);
          named.forEach((asset, k) => {
            const existing = this.existingAsset(artifactId, stages[k]!.sha256);
            if (existing) {
              if (!asset.querySnapshot && this.retention.isManaged(artifactId, existing.assetId)) this.retention.adoptInFrame(artifactId, existing.assetId); // E3
              return void refs.push(existing);
            }
            const unique = uniqueName(asset.name, taken);
            taken.add(unique);
            refs.push(this.placeAssetInFrame(artifactId, stages[k]!, { name: unique, mime: asset.mime }, actor, at, asset.querySnapshot === true));
          });
          if (actor.kind === 'session') this.linkInFrame(artifactId, actor.appSessionId, 'edited', at);
        },
        afterWrite: options?.afterWrite && ((doc) => (refused ? undefined : options.afterWrite!(doc))),
        inFrame: (reached, write) => {
          if (!refused) options?.inFrame?.(reached, write);
        },
      });
      if (refused) throw (refused as { error: unknown }).error;
      this.emit(artifactId, 'updated');
      if (actor.kind === 'session') this.emit(artifactId, 'linked');
      return revision;
    } finally {
      for (const stage of stages) this.files.discard(stage.temp);
    }
  }

  // The asset of `artifactId` holding these bytes, if any (assets are deduplicated by content within an artifact).
  private existingAsset(artifactId: string, sha256: string): { assetId: string; ref: string } | undefined {
    const row = this.storage.db.prepare('SELECT assetId, name FROM artifact_assets WHERE artifactId = ? AND sha256 = ?').get(artifactId, sha256) as { assetId: string; name: string } | undefined;
    return row && { assetId: row.assetId, ref: `assets/${row.name}` };
  }

  private assetNames(artifactId: string): Set<string> {
    return new Set((this.storage.db.prepare('SELECT name FROM artifact_assets WHERE artifactId = ?').all(artifactId) as { name: string }[]).map((row) => row.name));
  }

  // Inside a savepoint: one new asset's file in place (an orphan of a crash replaced or reused) and its row, under the
  // unique name given.
  private placeAssetInFrame(artifactId: string, stage: { temp: string; sha256: string; size: number }, meta: { name: string; mime: string }, actor: Actor, at: number, querySnapshot = false): { assetId: string; ref: string } {
    const assetId = randomUUID();
    if (!this.files.exists(artifactId, ArtifactFiles.assetPath(stage.sha256))) this.files.place(artifactId, stage.temp, ArtifactFiles.assetPath(stage.sha256));
    this.storage.db
      .prepare('INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy, querySnapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(artifactId, assetId, meta.name, meta.mime, stage.size, stage.sha256, at, actorKey(actor), querySnapshot ? 1 : 0); // E3: querySnapshot
    return { assetId, ref: `assets/${meta.name}` };
  }
  // P3-E end

  // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Decision Log 25; the parent's 65): an asset of one
  // artifact copied into another, generic (a deck's pasted picture, a document's): the source's bytes written through
  // `uploadAsset` on the target, so the bytes and mime arrive unchanged, identical bytes answer the target's existing ref
  // and a name taken there is made unique. Both artifacts must be live; a deleted or missing one is refused by name.
  // E3 panel wave: written as an upload is, past the query-snapshot namespace's refusal: the name it carries is its
  // source asset's own, with that asset's own bytes, so it recreates no other bytes under a snapshot's ref.
  async copyAsset(from: string, ref: string, to: string, actor: Actor): Promise<{ assetId: string; ref: string }> {
    this.requireLive(from);
    this.requireLive(to);
    const asset = this.listAssets(from).find((candidate) => candidate.ref === ref);
    if (!asset) throw new ArtifactStoreError('notFound', `no asset ${ref} in ${from}`, { artifactId: from, ref });
    return this.placeUpload(to, this.files.readAsset(from, asset.sha256), { name: asset.name, mime: asset.mime }, actor); // E3 panel
  }

  listAssets(artifactId: string): Asset[] {
    const rows = this.storage.db.prepare('SELECT * FROM artifact_assets WHERE artifactId = ? ORDER BY createdAt, rowid').all(artifactId) as unknown as (Omit<Asset, 'ref' | 'createdBy'> & { createdBy: string })[];
    return rows.map((row) => ({ assetId: row.assetId, ref: `assets/${row.name}`, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256, createdAt: row.createdAt, createdBy: actorFromKey(row.createdBy) }));
  }

  // The asset ids a version written now pins. E3: a retired query snapshot is left out (earlier versions keep theirs).
  private assetIds(artifactId: string): string[] {
    return (this.storage.db.prepare('SELECT assetId FROM artifact_assets WHERE artifactId = ? AND retiredAt IS NULL ORDER BY assetId').all(artifactId) as { assetId: string }[]).map((row) => row.assetId);
  }

  // ── E3 start: query snapshots' retention and the readers' holds (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md
  // R1 and R1b; E's Decision Log 48 (1) and (3); retention.ts) ──

  /** In a publication's frame (its `inFrame`): `ref`, the snapshot `datasetId` just published at `revision`, is kept
   * as that query's latest use; the query keeps its latest two distinct snapshots and what nothing protects any more is
   * retired in the same frame. An ordinary asset is never enrolled. Refused outside a write frame. */
  retainQuerySnapshots(artifactId: string, datasetId: string, ref: string, revision: number): void {
    this.retention.retain(artifactId, datasetId, ref, revision);
  }

  /** The dashboard kind's hook in each write's frame (src/engine-host/dashboards): membership follows `doc`'s datasets
   * (`restored`: a restore's, each query reset to the snapshot it names), a file dataset adopts a managed snapshot it
   * names, and every managed snapshot is active exactly while a membership or a current descriptor names it. */
  reconcileQuerySnapshots(artifactId: string, doc: Doc, options?: { restored?: boolean }): void {
    this.retention.reconcile(artifactId, doc, options);
  }

  /** Retires a managed snapshot no current descriptor names and collects it unless a version or a hold protects it:
   * `removed` once its row and bytes are gone, `retained` while something still protects its bytes (an ordinary
   * asset always), `notFound` for a ref the artifact does not hold. */
  removeAsset(artifactId: string, ref: string): Promise<{ status: 'removed' | 'retained' | 'notFound' }> {
    return this.retention.remove(artifactId, ref);
  }

  /** Post-commit: the retired snapshots of `artifactId` (every artifact's when omitted) that no current descriptor,
   * retained version or hold names lose their rows, then their bytes. Asked while a batch is open, it runs after it. */
  collectRetiredAssets(artifactId?: string): void {
    this.retention.collect(artifactId);
  }

  /** A hold over one of the artifact's assets: its bytes stay until `release`, whatever retires it meanwhile. */
  holdAsset(artifactId: string, ref: string): AssetHold {
    return this.retention.hold(artifactId, [ref]);
  }

  /** `capture` read from the store and the refs it answers held in the same synchronous turn, all or none (the hold
   * bounds of retention.ts, an unavailable ref refused), answered once the batch its read may have seen has committed
   * (Decision Log 33's barrier; a lost batch releases the hold and fails the capture). */
  async captureWithAssets<T>(artifactId: string, capture: () => { value: T; refs: readonly string[] }): Promise<{ value: T; release(): void }> {
    let hold: AssetHold | null = null;
    try {
      const value = await this.readCommitted(() => {
        const captured = capture();
        hold = this.retention.hold(artifactId, captured.refs);
        return captured.value;
      });
      return { value, release: hold!.release };
    } catch (error) {
      (hold as AssetHold | null)?.release();
      throw error;
    }
  }
  // ── E3 end ──

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

  // The owner names an existing version, any kind (Decision Log 37d, 38c; §4.7: any automatic version is nameable): its
  // label becomes this, its note this one when given (`null` clears it, omitted keeps it), its kind and the rest stay; a
  // named `auto` version is never thinned.
  async nameVersion(artifactId: string, versionId: number, name: { label: string; note?: string | null }, inFrame?: InFrame<ArtifactVersion>): Promise<ArtifactVersion> {
    this.requireLive(artifactId);
    this.requireVersion(artifactId, versionId);
    if (name.label.trim() === '') throw new ArtifactStoreError('invalid', 'a version’s name cannot be empty');
    await this.service.inBatch(() => {
      this.versions.name(versionId, name.label, name.note);
      inFrame?.(this.versions.version(artifactId, versionId)!);
    });
    this.emit(artifactId, 'updated');
    return this.versions.version(artifactId, versionId)!;
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
    const id = this.versions.writeState(row.id, revision, state, this.withPin(row, { ...meta, actor, at, assetRefs: this.assetIds(row.id) }), options);
    // The state kept for the next delta lives as long as the doc stays loaded (the service's unload forgets it); a doc
    // read from the store without loading (a scheduled auto version after the idle unload, a design system's pin)
    // keeps none.
    if (!this.service.loaded(row.id)) this.versions.forget(row.id);
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
    const system = this.governingSystem(row);
    if (!system) return null; // the bundled floor governs: nothing of the store's to pin
    const revision = this.service.revision(system.id);
    if (this.versions.latest(system.id)?.seq !== revision) this.versionInFrame(system, { kind: 'auto', actor: this.lastWriter(system.id) }, { pinTarget: true });
    return { id: system.id, versionSeq: this.versions.latest(system.id)!.seq };
  }

  // `meta` with its design-system pin read only where the version store writes a row with it (P3-F store-versions
  // sweep#1): a version that writes nothing (an `auto` at a revision already captured, a turn's checkpoint with no `auto`
  // to upgrade) leaves the governing system's history and `updatedAt` alone, since Decision Log 22b writes the system's
  // `auto` only for a version written. Read at most once.
  private withPin<T extends object>(row: EntityRow, meta: T): T & { readonly designSystemRef: DesignSystemRef | null } {
    let pin: { ref: DesignSystemRef | null } | null = null;
    return Object.defineProperty(meta, 'designSystemRef', { enumerable: true, get: () => (pin ??= { ref: this.pinInFrame(row) }).ref }) as T & { readonly designSystemRef: DesignSystemRef | null };
  }

  // The live design system governing `target` as the registered chain names it (Decision Log 42), or null when the
  // bundled floor governs (`{builtin}`) or the chain named something that is not a live design system.
  private governingSystem(target: { designSystemId?: string | null; spaceId?: string | null }): EntityRow | null {
    const governing = this.designSystemChain.governing(target);
    if (!('id' in governing)) return null;
    const system = this.entity(governing.id);
    return system && system.deletedAt === null && system.kind === 'design_system' ? system : null;
  }

  // A's chain, answering until P3-D registers its own (Decision Log 22d): the artifact's own system, else its Space's
  // default, else the owner's, when that one is a live design system; else the bundled floor.
  private ownGoverning(target: { designSystemId?: string | null; spaceId?: string | null }): { id: string } | { builtin: 'maws' } {
    const defaults = this.defaults();
    const id = target.designSystemId || (target.spaceId ? defaults.spaces[target.spaceId] : undefined) || defaults.owner;
    const system = id ? this.entity(id) : undefined;
    return system && system.deletedAt === null && system.kind === 'design_system' ? { id: system.id } : { builtin: 'maws' };
  }

  registerDesignSystemChain(chain: DesignSystemChain): void {
    this.designSystemChain = chain;
  }

  // The owner looked at the artifact (Decision Log 16): an `auto` version first when the doc moved since its last
  // version, so "See N new changes" has a state to diff from, then `lastViewedAt`. Bookkeeping of a read: a store a newer
  // MAWS wrote (read-only, Decision Log 12, 24e) records nothing and the view goes on.
  async markViewed(artifactId: string): Promise<void> {
    const row = this.requireLive(artifactId);
    if (this.storage.readOnly) return;
    await this.service.inBatch(() => {
      if (isDocKind(row.kind)) this.versionInFrame(row, { kind: 'auto', actor: this.lastWriter(artifactId) });
      this.storage.db.prepare('UPDATE artifacts SET lastViewedAt = ? WHERE id = ?').run(this.now(), artifactId);
      this.storage.setMeta(`viewed-seq:${artifactId}`, String(this.service.revision(artifactId)));
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
    this.collectRetiredAssets(artifactId ?? undefined); // E3: what only the pruned versions pinned
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

  // The maintenance pass's (P3-F store-versions scalpel-1#2): the temp files a write killed between its stage and its
  // place or discard left in an artifact's `tmp/`, once older than STAGED_MAX_AGE_MS (no write in flight holds its file
  // that long), go; a fresh one stays, and so does any file a row names in place (a `file` artifact's).
  collectStaged(now: number): void {
    const named = this.storage.db.prepare(
      "SELECT 1 FROM artifacts WHERE linkedPath = ? UNION ALL SELECT 1 FROM artifact_updates WHERE json_extract(content, '$.path') = ? UNION ALL SELECT 1 FROM artifact_versions WHERE json_extract(content, '$.path') = ? LIMIT 1",
    );
    // P4 (W1, L248): a listing that fails is logged and this sweep skipped, never the rest of the maintenance pass
    let staged: string[];
    try {
      staged = this.files.stagedBefore(now - STAGED_MAX_AGE_MS);
    } catch (error) {
      this.log(`the staged files could not be listed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const path of staged) {
      if (named.get(path, path, path)) continue;
      try {
        this.files.discard(path);
      } catch (error) {
        this.log(`a staged file was not collected (${path}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Artifact-wide restore (Decision Log 16; restore.ts).
  async restore(artifactId: string, versionId: number, actor: Actor, inFrame?: InFrame<{ revision: number; versionId: number }>): Promise<{ revision: number; versionId: number }> {
    const row = this.requireLive(artifactId);
    const version = this.requireVersion(artifactId, versionId);
    // E3 (the M1 review): the query snapshots the version's state names are held from here, before the first await, until
    // the restore has published or refused, so a prune or a thinning dropping the version meanwhile never takes their
    // bytes; nothing else is collectible, so a file's ref is neither held nor checked (E2's restore unchanged)
    const hold = isDocKind(row.kind) && version.enc ? this.retention.hold(artifactId, this.retention.collectible(artifactId, datasetRefsOf(this.versions.state(artifactId, version.id)))) : null;
    try {
      this.migrated.delete(artifactId); // P3-E: a restore may bring back an earlier shape (its kind's `afterRestore` migrates it)
      const result = await restoreArtifact(this, row, version, actor, inFrame);
      this.emit(artifactId, 'updated');
      return result;
    } finally {
      hold?.release();
    }
  }

  // The merged attribution (encoded ContentMap) of every row overlapping [fromSeq, toSeq] (Decision Log 23a); the
  // whole history of an open doc comes from the service's in-memory merge. P4 (W1, L241 and L149): a suggestion doc's
  // rows hold only what was written to it, while it holds its main doc's content too, so on every path its answer lays
  // the main doc's whole merge beneath its own rows, as the service's provenance does (parent Decision Log 57(b)).
  attributions(artifactId: string, fromSeq: number, toSeq: number): Uint8Array {
    if (this.service.loaded(artifactId) && fromSeq <= 1 && toSeq >= this.service.revision(artifactId)) return encodeMap(this.service.provenance(artifactId));
    const own = mergeMaps(this.storage.attributions(artifactId, fromSeq, toSeq).map(decodeMap));
    const main = mainOf(artifactId);
    return encodeMap(main === null ? own : overlayMap(this.service.provenance(main), own));
  }

  // P3-E start (docs/doperpowers/plans/2026-10-16-p3-e-design-dashboard.md Decision Log 11 (1); E1's M2): a document an
  // earlier build stored in another shape is brought into its kind's model (`KindAdapter.migrate`) before a live open,
  // read or write answers from it. The live state is tested on a scratch copy first, so a document already in the model
  // costs no write (and, once found so, nothing more this run); one that needs it is migrated in one `writeAs` credited
  // to `actor`, the actor whose access triggered it, rechecked inside the write, and this resolves once that write
  // committed; a state found already in the model is remembered only once the batch it was read in has committed.
  // Concurrent calls share the first one's migration and its actor. Input the kind cannot migrate, and a
  // read-only store when a migration is needed, refuse `invalid` naming the artifact, with nothing written. Retained
  // versions are never migrated; a restore forgets what this run found (`restore` above). A kind without the hook, a
  // byte kind, a deleted or unknown artifact: nothing to do.
  ensureMigrated(artifactId: string, actor: Actor): Promise<void> {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null || !isDocKind(row.kind) || this.migrated.has(artifactId)) return Promise.resolve();
    const adapter = this.service.adapterFor(row.kind);
    if (!adapter?.migrate) return Promise.resolve();
    const running = this.migrating.get(artifactId);
    if (running) return running;
    const migration = this.migrate(row, adapter.migrate.bind(adapter), actor).finally(() => this.migrating.delete(artifactId));
    this.migrating.set(artifactId, migration);
    return migration;
  }

  private async migrate(row: EntityRow, migrate: (doc: Doc) => boolean, actor: Actor): Promise<void> {
    const refused = (why: string, data: Record<string, unknown> = {}) => new ArtifactStoreError('invalid', `the ${row.kind} ${row.id} cannot be opened: ${why}`, { artifactId: row.id, ...data });
    let needed: boolean;
    const scratch = newDoc();
    try {
      applyV2(scratch, this.service.readState(row.id).state);
      needed = migrate(scratch);
    } catch (error) {
      const coded = error as { data?: unknown };
      throw refused(`it was stored by an earlier build of MAWS and cannot be brought into the ${row.kind} model (${error instanceof Error ? error.message : String(error)}); its earlier versions still read as they were`, typeof coded.data === 'object' && coded.data !== null ? (coded.data as Record<string, unknown>) : {});
    } finally {
      scratch.destroy();
    }
    if (!needed) {
      // certified only once committed: the live state read may hold rows of an open batch (a restore's in-frame migration)
      // that a failed commit takes back, its rejection then this call's
      if (this.storage.batchOpen) await this.service.whenCommitted();
      this.migrated.add(row.id);
      return;
    }
    if (this.storage.readOnly) throw refused(`it was stored by an earlier build of MAWS and must be migrated, and this artifact store is read-only (a newer MAWS wrote it)`);
    await this.service.writeAs(row.id, actor, (doc) => void migrate(doc));
    this.migrated.add(row.id);
  }
  // P3-E end

  // ── turns, idempotency and the test writer ──

  // The session's turn ended (Decision Log 23f, 26c): one `turn` version per Y-kind artifact the session committed an
  // edit to in the turn (a read, or a write that changed no document, makes none), summarised by the kind's
  // `summarizeTurn` over its mutating tool calls' results (else "N edits"); its presence is cleared (23d). A byte kind
  // the session wrote gets its checkpoint the same way: the `auto` version of its latest write becomes the turn's
  // (M6's fix wave; an `import` or a named version there already marks it).
  async endTurn(appSessionId: AppSessionId): Promise<void> {
    this.service.clearPresence(appSessionId);
    const wrote = this.turns.get(appSessionId);
    this.turns.delete(appSessionId);
    if (!wrote) return;
    const actor: Actor = { kind: 'session', appSessionId };
    for (const [artifactId, { commits, results }] of wrote) {
      const row = this.entity(artifactId);
      if (commits === 0 || !row || row.deletedAt !== null) continue;
      const count = results.length > 0 ? results.length : commits;
      const summary = this.service.adapterFor(row.kind)?.summarizeTurn?.(results) ?? `${count} edit${count === 1 ? '' : 's'}`;
      const meta = { kind: 'turn' as const, actor, summary };
      const id = await this.service.inBatch(() =>
        isDocKind(row.kind)
          ? this.versionInFrame(row, meta)
          : this.versions.checkpoint(row.id, this.contentRef(row.id).revision, this.withPin(row, { ...meta, actor: actorKey(actor), at: this.now(), assetRefs: this.assetIds(row.id) })),
      );
      if (id !== null) this.emit(artifactId, 'updated');
    }
  }

  // What a repeated tool-use id answers (Decision Log 11), consulted before the call checks anything that may have moved
  // since the original (a source file, a handle, the artifact): the original's result (waited for while it runs), or
  // `found: false` for an op never applied. A stored row is read behind the read barrier (Decision Log 33).
  async replayOf(opId: string | null): Promise<{ found: true; result: unknown } | { found: false }> {
    if (!opId) return { found: false };
    const running = await this.ops.replayRunning(opId);
    return running.found ? running : this.readCommitted(() => this.ops.stored(opId));
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
    const pages = ops.filter((op): op is Extract<TestOp, { op: 'page' }> => op.op === 'page');
    if (row.kind === 'html') {
      if (pages.length !== ops.length) throw new ArtifactStoreError('invalid', 'an html page takes only page ops');
      return this.withOp(
        opId,
        'testWrite',
        artifactId,
        async (scope) => {
          const { revision } = await this.writeContent(artifactId, { bytes: new TextEncoder().encode(pages.at(-1)!.text), name: this.contentRef(artifactId).ref.name }, actor, {}, (at) => scope.record({ revision: at.revision }));
          return { revision };
        },
        { actor },
      );
    }
    if (!isDocKind(row.kind)) throw new ArtifactStoreError('invalid', `a ${row.kind} artifact is not a document`);
    if (pages.length > 0) throw new ArtifactStoreError('invalid', `a ${row.kind} artifact takes no page op`);
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
    // P3-C (Decision Log 29): the listeners, after the commit
    for (const listener of this.defaultsListeners) {
      try {
        listener();
      } catch (error) {
        this.log(`an onDefaultsChange listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  registerDesignSystemContext(provider: (system: Artifact) => Promise<string | null>): void {
    this.designSystemContext = provider;
  }

  // The governing system's guide (M6's `artifact_create`), from D's provider; null without one. `target` is an artifact,
  // or where a new one will be placed (no system or Space of its own: the owner's default governs). The system is chosen
  // behind the read barrier, and so is the provider's answer (Decision Log 33): what the provider reads before its first
  // suspension is held until the batch open at the end of that synchronous part commits, and a batch lost during it
  // (opened and taken back before the provider suspended) fails the answer rather than reveal what it read. Reads a
  // provider makes after a suspension are outside this boundary and need their own committed reads (`readCommitted`).
  async designSystemContextFor(target: string | { designSystemId?: string | null; spaceId?: string | null }): Promise<string | null> {
    const system = await this.readCommitted(() => {
      const placement = typeof target === 'string' ? this.entity(target) : { designSystemId: target.designSystemId ?? null, spaceId: target.spaceId ?? null };
      const governing = placement ? this.governingSystem(placement) : null;
      return governing ? toArtifact(governing) : null;
    });
    if (!system || !this.designSystemContext) return null;
    const lost = this.service.stats.lostBatches;
    const answering = this.designSystemContext(system);
    const barrier = this.storage.batchOpen ? this.service.whenCommitted() : null; // the batch its first reads saw
    barrier?.catch(() => {}); // awaited below, after the provider's own answer
    const lostMeanwhile = this.service.stats.lostBatches !== lost;
    const context = await answering;
    if (barrier) await barrier;
    if (lostMeanwhile) throw new Error('a batch the design system’s context was read from was lost; ask again');
    return context;
  }

  // ── P3-H start: connector grants (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24 and 80;
  // @shared/artifacts/connectors) ──
  // The owner's per-artifact, per-tool permission, the only gate on a connector call: main checks it before routing a
  // call (`checkConnectorCall`) and the host again just before writing mcp_call (`authorizeConnectorCall`, which takes
  // an Allow once's one use). Grants live beside the artifact, never in its content: no revision, version, change-feed
  // entry or `updatedAt` moves with one, and no copy, restore, import or export carries one. Each operation answers,
  // and announces through `onConnectorGrantChange`, only once its rows have committed (Decision Log 33's barrier), so a
  // listener stopping watches acts on durable state.

  onConnectorGrantChange(listener: (change: ConnectorGrantChange) => void): () => void {
    this.grantListeners.add(listener);
    return () => this.grantListeners.delete(listener);
  }

  // The artifact's grants, committed, ordered by server and tool.
  connectorGrants(artifactId: string): Promise<ConnectorGrant[]> {
    return this.readCommitted(() => {
      this.requireLive(artifactId);
      return this.grantRows(artifactId);
    });
  }

  // The owner's grant of one tool to one artifact; a grant already held for the tool is replaced whole (a re-grant under
  // a changed fingerprint, or Allow once again). H3b: asked for, it breaks every fence of the tool taken for another
  // fingerprint or mode, as a revoke would (the authority that call was admitted under is withdrawn, its row present or
  // already consumed); one taken for this very fingerprint and mode stays held, so a second Allow once does not stop
  // the call the first admitted.
  grantConnectorTool(artifactId: string, request: ConnectorGrantRequest): Promise<ConnectorGrant> {
    return this.writeCommitted(async () => {
      const { server, tool, fingerprint, mode } = connectorInput(GRANT_INPUT, request, 'grant');
      this.requireLive(artifactId);
      this.breakFences(artifactId, { server, tool }, (fence) => fence.fingerprint === fingerprint && fence.mode === mode);
      const grant: ConnectorGrant = { server, tool, fingerprint, mode, grantedAt: this.now() };
      await this.service.inBatch(() =>
        this.storage.db
          .prepare(
            'INSERT INTO artifact_connector_grants (artifactId, server, tool, fingerprint, mode, grantedAt) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (artifactId, server, tool) DO UPDATE SET fingerprint = excluded.fingerprint, mode = excluded.mode, grantedAt = excluded.grantedAt',
          )
          .run(artifactId, server, tool, fingerprint, mode, grant.grantedAt),
      );
      this.emitGrant(artifactId, grant, 'granted');
      return grant;
    });
  }

  // Answers whether a grant was there to revoke; once it resolves, no call under it is authorized.
  revokeConnectorTool(artifactId: string, ref: ConnectorToolRef): Promise<boolean> {
    return this.writeCommitted(async () => {
      const tool = connectorInput(TOOL_INPUT, ref, 'tool');
      this.requireLive(artifactId);
      this.breakFences(artifactId, tool); // H3b: asked for, so no call fenced before it writes
      const removed = await this.service.inBatch(() => Number(this.storage.db.prepare('DELETE FROM artifact_connector_grants WHERE artifactId = ? AND server = ? AND tool = ?').run(artifactId, tool.server, tool.tool).changes) > 0);
      if (removed) this.emitGrant(artifactId, tool, 'revoked');
      return removed;
    });
  }

  // Whether `call` may run, consuming nothing: main's check before it routes a call. Answers behind the read barrier.
  checkConnectorCall(artifactId: string, call: ConnectorCallRef): Promise<ConnectorAuthorization> {
    return this.readCommitted(() => this.connectorDecision(artifactId, call));
  }

  // Whether `call` may run now, the use taken: the host's check immediately before it writes mcp_call. A `read` grant
  // answers behind the read barrier. A `once` grant is consumed in the same synchronous step that found it and answered
  // only after that consumption commits, so of any number of concurrent calls one is granted, and a lost batch grants
  // none and leaves the grant for the next; a call that then fails has still used it (at most once, never twice).
  // H3b: `expected`, the mode the caller's own check admitted, is compared before anything is consumed: a read grant
  // swapped for an Allow once since (or the reverse) answers `wrongMode` and takes nothing. The answer is a snapshot
  // across the commit barrier, so the write still waits on `connectorFenceHolds`.
  authorizeConnectorCall(artifactId: string, call: ConnectorCallRef, expected?: ConnectorGrantMode): Promise<ConnectorAuthorization> {
    return this.writeCommitted(async () => {
      const found = this.connectorDecision(artifactId, call);
      const decision: ConnectorAuthorization = found.granted && expected !== undefined && found.mode !== expected ? { granted: false, refusal: 'wrongMode' } : found;
      if (!decision.granted || decision.mode === 'read') return this.readCommitted(() => decision);
      const { server, tool } = connectorInput(CALL_INPUT, call, 'call');
      await this.service.inBatch(() => this.storage.db.prepare('DELETE FROM artifact_connector_grants WHERE artifactId = ? AND server = ? AND tool = ?').run(artifactId, server, tool));
      this.emitGrant(artifactId, { server, tool }, 'consumed');
      return decision;
    });
  }

  // H3b: the dispatch fence. Taken for a call's fingerprint and expected mode before the authorization and held until
  // the call it guards has ended: a revoke of the tool, a grant replacing it under another fingerprint or mode
  // (`grantConnectorTool`) or a delete of the artifact asked for meanwhile — committed, still in its batch, or later
  // rolled back — breaks it at once, synchronously, and calls its `onBreak` (the holder aborts its operation there, so a
  // write still queued behind the engine's stdin is dropped by the transport before it starts). A read call also needs its grant
  // still there as authorized (the same fingerprint, still `read`); an Allow once's own consumption is the use it
  // authorized, so its fence needs no row. The holder releases it when its work ends (P3 Decision Log 91: the host's
  // connector calls when the call's outcome is taken, cancelled or expired), so nothing is retained past that bound.
  connectorFence(artifactId: string, call: ConnectorCallRef, mode: ConnectorGrantMode, onBreak?: () => void): ConnectorFence {
    const fence: ConnectorFence = { artifactId, key: connectorToolKey(call), fingerprint: call.fingerprint, mode, broken: false, onBreak };
    let held = this.fences.get(artifactId);
    if (!held) this.fences.set(artifactId, (held = new Set()));
    held.add(fence);
    return fence;
  }

  releaseConnectorFence(fence: ConnectorFence): void {
    const held = this.fences.get(fence.artifactId);
    if (!held?.delete(fence)) return;
    if (held.size === 0) this.fences.delete(fence.artifactId);
  }

  connectorFenceHolds(fence: ConnectorFence, call: ConnectorCallRef, mode: ConnectorGrantMode): 'held' | 'revoked' | 'fingerprintChanged' | 'wrongMode' {
    const { artifactId } = fence;
    if (fence.broken || fence.key !== connectorToolKey(call) || !this.fences.get(artifactId)?.has(fence)) return 'revoked';
    const row = this.closed || this.storage.readOnly ? undefined : this.entity(artifactId);
    if (!row || row.deletedAt !== null) return 'revoked';
    if (mode === 'once') return 'held';
    const grant = this.grantRows(artifactId).find((row) => row.server === call.server && row.tool === call.tool);
    if (!grant) return 'revoked';
    if (grant.fingerprint !== call.fingerprint) return 'fingerprintChanged';
    return grant.mode === 'read' ? 'held' : 'wrongMode';
  }

  // P4-B5 start: an owner's delivery's fence (route D's direct send, which no grant authorizes): only the artifact's
  // deletion asked for breaks it, at once and synchronously, as it breaks a call's; no tool's revoke or grant touches it
  // (its key names no tool). Released with `releaseConnectorFence`; `deliveryFenceHolds` is the send's check at its write.
  deliveryFence(artifactId: string, onBreak?: () => void): ConnectorFence {
    const fence: ConnectorFence = { artifactId, key: DELIVERY_FENCE_KEY, fingerprint: '', mode: 'once', broken: false, onBreak };
    let held = this.fences.get(artifactId);
    if (!held) this.fences.set(artifactId, (held = new Set()));
    held.add(fence);
    return fence;
  }

  deliveryFenceHolds(fence: ConnectorFence): boolean {
    if (fence.broken || fence.key !== DELIVERY_FENCE_KEY || !this.fences.get(fence.artifactId)?.has(fence)) return false;
    const row = this.closed ? undefined : this.entity(fence.artifactId);
    return row !== undefined && row.deletedAt === null;
  }
  // P4-B5 end

  // A revoke of `tool` (null: a delete of the artifact), or a grant replacing it, asked for: every fence held of it
  // breaks now, but those the replacing grant still `admits`.
  private breakFences(artifactId: string, tool: ConnectorToolRef | null, admits?: (fence: ConnectorFence) => boolean): void {
    const key = tool && connectorToolKey(tool);
    for (const fence of [...(this.fences.get(artifactId) ?? [])]) {
      if ((key !== null && fence.key !== key) || admits?.(fence)) continue;
      fence.broken = true;
      this.releaseConnectorFence(fence);
      try {
        fence.onBreak?.();
      } catch (error) {
        this.log(`a connector fence's onBreak threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // What the artifact's grant says of `call`, read now. A store a newer MAWS wrote authorizes nothing: its grant rows
  // may mean more than this app reads.
  private connectorDecision(artifactId: string, call: ConnectorCallRef): ConnectorAuthorization {
    const ref = connectorInput(CALL_INPUT, call, 'call');
    if (this.storage.readOnly) throw new StoreTooNewError(this.storage.statusReason ?? 'a newer app wrote this store');
    this.requireLive(artifactId);
    const grant = this.grantRows(artifactId).find((row) => row.server === ref.server && row.tool === ref.tool);
    if (!grant) return { granted: false, refusal: 'notGranted' };
    if (grant.fingerprint !== ref.fingerprint) return { granted: false, refusal: 'fingerprintChanged' };
    return { granted: true, mode: grant.mode };
  }

  private grantRows(artifactId: string): ConnectorGrant[] {
    return this.storage.db.prepare('SELECT server, tool, fingerprint, mode, grantedAt FROM artifact_connector_grants WHERE artifactId = ? ORDER BY server, tool').all(artifactId) as unknown as ConnectorGrant[];
  }

  private emitGrant(artifactId: string, { server, tool }: ConnectorToolRef, change: ConnectorGrantChange['change']): void {
    if (this.closed) return;
    for (const listener of this.grantListeners) {
      try {
        listener({ artifactId, server, tool, change });
      } catch (error) {
        this.log(`an onConnectorGrantChange listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // ── P3-H end ──

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

  // The actor and time of the artifact's last log row (Decision Log 35c), null when it has none. Log pruning keeps each
  // artifact's newest row, so the answer survives maintenance.
  lastWrite(artifactId: string): { actor: Actor; at: number } | null {
    const row = this.storage.db.prepare('SELECT actor, at FROM artifact_updates WHERE artifactId = ? ORDER BY seq DESC LIMIT 1').get(artifactId) as { actor: string; at: number } | undefined;
    return row ? { actor: actorFromKey(row.actor), at: row.at } : null;
  }

  // The actor key of the artifact's last log row (who an `auto` version is credited to), the human when none.
  lastWriter(artifactId: string): string {
    return (this.storage.db.prepare('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq DESC LIMIT 1').get(artifactId) as { actor: string } | undefined)?.actor ?? 'human';
  }

  // An `auto` version now, when the doc moved since its last version (the scheduler; a restore writes its own in its
  // frame, restore.ts).
  async autoVersion(artifactId: string): Promise<void> {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null || !isDocKind(row.kind) || this.closed) return;
    if (this.versions.latest(artifactId)?.seq === this.service.revision(artifactId)) return;
    const id = await this.service.inBatch(() => timed('auto version', () => this.versionInFrame(row, { kind: 'auto', actor: this.lastWriter(artifactId) }), () => artifactId)); // P4-R6: timed
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

  requireLive(artifactId: string): EntityRow {
    const row = this.entity(artifactId);
    if (!row || row.deletedAt !== null) throw new ArtifactStoreError('notFound', `no artifact ${artifactId}`, { artifactId });
    return row;
  }

  requireVersion(artifactId: string, versionId: number): VersionRow {
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

  // A session's committed byte-kind write, counted toward its turn's checkpoint (endTurn).
  private wroteBytes(actor: Actor, artifactId: string): void {
    if (actor.kind === 'session') this.turnEntry(actor.appSessionId, artifactId).commits += 1;
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
    if (!this.creating.has(artifactId)) this.feed(row, revision);
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

  // An operation's change, announced after its own commit with the artifact's revision (Decision Log 33's barrier): the
  // next operation may already have opened a batch whose rows the live revision includes, so a revision read while a
  // batch is open is held until that batch commits, and read again if that batch is lost. A revision read with no batch
  // open is durable and goes at once.
  private emit(artifactId: string, change: ArtifactChange): void {
    const row = this.entity(artifactId);
    if (!row) return;
    const release = (held: number | null): void => {
      if (this.closed) return;
      if (!this.storage.batchOpen) return this.send({ artifactId, kind: row.kind, revision: this.service.revision(artifactId), change });
      if (held !== null) return this.send({ artifactId, kind: row.kind, revision: held, change }); // committed with the batch it was read in
      const revision = this.service.revision(artifactId);
      const later = (next: number | null) => () => {
        try {
          release(next);
        } catch (error) {
          this.log(`the change of ${artifactId} was not announced: ${error instanceof Error ? error.message : String(error)}`); // the store closed meanwhile
        }
      };
      this.service.whenCommitted().then(later(revision), later(null));
    };
    release(null);
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

// P3-H start: a grant operation's input, its known fields taken and checked (an extra field, a grant's `mode` passed
// to a revoke, is dropped), else refused as `invalid`.
const GRANT_INPUT = z.object(ConnectorGrantRequestSchema.shape);
const TOOL_INPUT = z.object(ConnectorToolRefSchema.shape);
const CALL_INPUT = z.object(ConnectorCallRefSchema.shape);

// P4-B5: a delivery fence's key, which no tool's key (`connectorToolKey`, never empty) equals.
const DELIVERY_FENCE_KEY = '';

// H3b: a connector call's dispatch fence (`connectorFence`): its tool and authority, and whether a revoke, a replacing
// grant or a delete broke it.
export interface ConnectorFence {
  readonly artifactId: string;
  readonly key: string;
  readonly fingerprint: string; // the authority it was taken for: the call's fingerprint and the mode its check admitted
  readonly mode: ConnectorGrantMode;
  broken: boolean;
  readonly onBreak?: () => void;
}

function connectorInput<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ArtifactStoreError('invalid', `not a connector ${what}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
// P3-H end

// E3 panel wave (retention.ts `isQuerySnapshotName`): a name only the refresh sink mints, so a collected snapshot's ref is
// never recreated by an ordinary upload.
const reservedName = (name: string) => new ArtifactStoreError('invalid', `the asset name ${JSON.stringify(name)} is reserved for live query snapshots; choose another name`, { name });

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
}

function applyTestOps(doc: Doc, ops: TestOp[]): void {
  for (const op of ops) {
    if (op.op === 'page') continue; // a page's, refused before
    const node = doc.get(op.root ?? 'root');
    if (op.op === 'setAttr') node.setAttr(op.key, op.value);
    else if (op.op === 'insertText') node.insert(op.index, op.text);
    else if (op.op === 'deleteText') node.delete(op.index, op.length);
  }
}

function unref<T>(timer: T): T {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
