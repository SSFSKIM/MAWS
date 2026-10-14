// What the artifact tools share (X25; the P3-A document's M6 and Decision Log 3, 9, 11, 33): the engine host's artifact
// store, the calling session's lineage, the session's own memory (its bases for byte kinds, the kinds whose guide it was
// given), and the refusals.
//
// Store state reaches a tool's answer only once it may be revealed (Decision Log 33): reads go through
// `readCommitted`, writes run inside `writeCommitted`, and an answer that carries store state is re-read through
// `readCommitted` or built in the write's `inFrame`. A refusal computed from store state (a stale base, a conflict, a
// missing artifact) is held the same way, so no answer names rows a failed batch takes back.
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { publishFiles, readFiles } from '@artifacts/files';
import type { KindAdapter } from '@artifacts/host';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { ARTIFACT_MAX_BYTES, TOOL_ERRORS, type ArtifactEditor, type ArtifactRefusal, type ArtifactToolName } from '@shared/maws/tools';
import type { DeliverableWriter } from '../deliverables/store';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ArtifactStore, ImportInput } from '../documents/store';
import type { McpToolContext, McpToolResult } from './server';
import { toolError } from './server';

// A byte kind's base (Decision Log 9 and 10 for `html`): the revision and content hash of what the session last read,
// created or published. A Y kind's base lives on the session's agent replica (`AgentReplica.base`).
export interface ByteBase {
  revision: number;
  sha256: string;
}

// One session's memory, made with its tools and gone with its process (so a base never outlives the session, as its
// replicas do not).
export class ArtifactSession {
  readonly byteBases = new Map<string, ByteBase>(); // by artifact id
  readonly guided = new Set<ArtifactKind>(); // the kinds whose guide this session was given (§4.3: once per session)
  readonly unimportable = new Set<string>(); // X12 record ids a listing failed to import: not tried again by this session
  private readonly calls = new Map<string, Promise<McpToolResult>>(); // by op id: the writing calls still answering

  // One response per tool-use id while a call is answering (Decision Log 11): an overlapping call with the same id waits
  // for the first one's whole response (its write, its X12 mirror and its decorations) and answers it, never a bare
  // recorded result while the first call is still mirroring. Once answered, a repeat is the op ledger's (`replayOf`).
  joined(opId: string | null, answer: () => Promise<McpToolResult>): Promise<McpToolResult> {
    if (opId === null) return answer();
    const running = this.calls.get(opId);
    if (running) return running;
    const call = answer().finally(() => this.calls.delete(opId));
    this.calls.set(opId, call);
    return call;
  }
}

export interface ArtifactToolDeps {
  artifacts?: () => ArtifactStore | null; // the host's store; null when it failed to open (absent: never opened)
  deliverables: DeliverableWriter; // X12's records, mirrored until P3-L's cutover (Decision Log 4)
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, nearest first
  session: ArtifactSession;
  log?: (line: string) => void;
  now?: () => Date;
}

// A refusal the tool answers with as its `isError` text.
export class ToolRefusal extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}

export const refuse = (tool: ArtifactToolName, refusal: ArtifactRefusal, sentence: string): ToolRefusal => new ToolRefusal(TOOL_ERRORS.refused(tool, refusal, sentence));

// The session and the sessions it was opened from, nearest first: where a handle resolves (Decision Log 3, X9).
export const lineageOf = (ctx: McpToolContext, deps: Pick<ArtifactToolDeps, 'artifactScope'>): AppSessionId[] => [ctx.appSessionId, ...(deps.artifactScope ?? [])];
export const actorOf = (ctx: McpToolContext): Actor => ({ kind: 'session', appSessionId: ctx.appSessionId });
// The idempotency key of a call (Decision Log 11): its tool-use id, under the session that made it, so a replayed or
// forked journal reusing an id in another session never answers from this one's ledger.
export const opIdOf = (ctx: McpToolContext): string | null => (ctx.toolUseId === null ? null : `${ctx.appSessionId}/${ctx.toolUseId}`);

export function storeOf(tool: ArtifactToolName, deps: Pick<ArtifactToolDeps, 'artifacts'>): ArtifactStore {
  const store = deps.artifacts?.() ?? null;
  if (!store) throw refuse(tool, { reason: 'unavailable' }, 'the artifact store is unavailable in this run of MAWS');
  return store;
}

// The artifact a ref names (its id, or a handle in the lineage), answered once the batch it was read in committed. A
// ref the store lacks but an X12 record in the lineage answers to (a page or file delivered before the store) is
// imported first (Decision Log 40a), then named; a read-only store (a newer MAWS wrote it) imports nothing.
export async function resolveArtifact(tool: ArtifactToolName, deps: Pick<ArtifactToolDeps, 'deliverables' | 'log'>, store: ArtifactStore, ref: string, lineage: readonly AppSessionId[]): Promise<string> {
  const found = await store.readCommitted(() => store.resolve(ref, lineage));
  if (found !== null) return found;
  const record = store.storage.readOnly ? null : await x12RecordOf(deps.deliverables, ref, lineage);
  if (record && (await importRecord(deps, store, record))) {
    const imported = await store.readCommitted(() => store.resolve(ref, lineage) ?? store.resolve(record.id));
    if (imported !== null) return imported;
  }
  throw new ToolRefusal(TOOL_ERRORS.noArtifact(tool, ref));
}

// Before a listing (Decision Log 40a): every X12 record of the lineage's sessions the store lacks is imported as a
// tool naming it would import it, so a pre-P3 page or file is listed before anything names it. Bounded by the lineage
// (X9) and idempotent (an id the store holds, deleted or not, is skipped; `importArtifact` skips one landed meanwhile); a
// record that cannot be imported is logged once and not tried again by this session. A read-only store imports nothing.
export async function importLineage(deps: Pick<ArtifactToolDeps, 'deliverables' | 'log' | 'session'>, store: ArtifactStore, lineage: readonly AppSessionId[]): Promise<void> {
  if (store.storage.readOnly) return;
  for (const session of lineage) {
    const records = await deps.deliverables.list(session).catch(() => []);
    const ids = records.map((record) => record.id);
    const held = new Set(await store.readCommitted(() => ids.filter((id) => store.entity(id) !== undefined)));
    for (const record of records) {
      if (held.has(record.id) || deps.session.unimportable.has(record.id)) continue;
      if (!(await importRecord(deps, store, record))) deps.session.unimportable.add(record.id);
    }
  }
}

// The nearest X12 record the ref names in the lineage: by its id (a page, a delivered file, or a screenshot E4c's
// browser tool kept, which imports as a file), or an artifact record by its name.
async function x12RecordOf(deliverables: DeliverableWriter, ref: string, lineage: readonly AppSessionId[]): Promise<DeliverableRecord | null> {
  for (const session of lineage) {
    const record = UUID.test(ref) ? await deliverables.get(session, ref).catch(() => null) : await deliverables.findArtifact(session, ref).catch(() => null);
    if (record) return record;
  }
  return null;
}

// An X12 record imported as P3-L's cutover walker imports it (Decision Log 35f, 40a): its id, title, times, versions in
// order credited to its session, and its session's `created` link; a page's handle, dropped when its session already
// holds it in the store. Answers whether the artifact is there now (imported, or already present); a record that cannot
// be imported (a version gone from disk) is logged and answers false.
async function importRecord(deps: Pick<ArtifactToolDeps, 'log'>, store: ArtifactStore, record: DeliverableRecord): Promise<boolean> {
  const kind = record.kind === 'artifact' ? 'html' : 'file';
  const actor: Actor = { kind: 'session', appSessionId: record.appSessionId };
  const createdAt = Date.parse(record.createdAt);
  const updatedAt = Date.parse(record.updatedAt ?? record.createdAt);
  try {
    const versions = await Promise.all(
      record.versions.map(async (version) => ({
        at: Date.parse(version.at),
        actor,
        content:
          kind === 'html'
            ? { bytes: await readFile(version.path), name: version.sourcePath ? basename(version.sourcePath) : 'index.html' }
            : { path: version.path, digest: await digestOf(store, version.path) },
      })),
    );
    const input: ImportInput = {
      id: record.id, kind, title: record.title ?? record.artifactId ?? basename(record.path), createdAt, updatedAt, createdBy: actor,
      ...(kind === 'html' && record.artifactId !== undefined && { handle: record.artifactId }),
      versions, links: [{ appSessionId: record.appSessionId, role: 'created', lastAt: updatedAt }],
    };
    try {
      await store.writeCommitted(() => store.importArtifact(input));
    } catch (error) {
      if (!(error instanceof ArtifactStoreError && error.code === 'handleTaken')) throw error;
      await store.writeCommitted(() => store.importArtifact({ ...input, handle: undefined }));
    }
    return true;
  } catch (error) {
    deps.log?.(`the X12 record ${record.id} of ${record.appSessionId} was not imported: ${messageOf(error)}`);
    return false;
  }
}

// A file version's digest, hashed off the import's commit path; none for a file gone (the import then refuses it).
async function digestOf(store: ArtifactStore, path: string): Promise<{ sha256: string; size: number } | undefined> {
  const described = await store.files.describeStreamed(path).catch(() => null);
  return described ? { sha256: described.sha256, size: described.size } : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A refusal computed from what the store holds now, released once the batch open now has committed (and replaced by
// that batch's failure).
export async function refusedAfterCommit(store: ArtifactStore, refusal: ToolRefusal): Promise<never> {
  await store.readCommitted(() => null);
  throw refusal;
}

// Who wrote last, as an agent reads it.
export function editorOf(write: { actor: Actor; at: number } | null, self: AppSessionId): ArtifactEditor | null {
  if (!write) return null;
  const at = new Date(write.at).toISOString();
  if (write.actor.kind === 'human') return { by: 'user', at };
  return write.actor.appSessionId === self ? { by: 'this session', at } : { by: 'another session', appSessionId: write.actor.appSessionId, at };
}

// A tool body whose refusals become its answer: a `ToolRefusal` as it is; the store's typed refusals (Decision Log 26e)
// and a kind's file problems (`code: 'invalid'` with `data`, as P3-D's adapter throws them) as machine-readable ones;
// anything else propagates (the server answers `<tool>: <message>`).
export async function answering(tool: ArtifactToolName, body: () => Promise<McpToolResult>): Promise<McpToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ToolRefusal) return toolError(error.text);
    if (error instanceof ArtifactStoreError) return toolError(TOOL_ERRORS.refused(tool, { reason: error.code === 'designSystemInUse' ? 'invalid' : error.code, ...error.data }, error.message));
    if (error instanceof StoreTooNewError) return toolError(TOOL_ERRORS.refused(tool, { reason: 'unavailable' }, error.message));
    const coded = error as { code?: unknown; data?: unknown; message?: unknown };
    if (error instanceof Error && coded.code === 'invalid' && typeof coded.data === 'object' && coded.data !== null) return toolError(TOOL_ERRORS.refused(tool, { reason: 'invalid', ...(coded.data as Record<string, unknown>) }, error.message));
    throw error;
  }
}

// A path the agent named, resolved against the working directory, that must lie inside it (Decision Log: assets and
// exports stay under the session's cwd).
export function pathUnderCwd(tool: ArtifactToolName, cwd: string, path: string): string {
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw refuse(tool, { reason: 'invalid', path: absolute }, `${absolute} is not under the working directory ${cwd}`);
  return absolute;
}

// A regular file of at most ARTIFACT_MAX_BYTES, read whole; refused otherwise.
export async function readSourceFile(tool: ArtifactToolName, path: string): Promise<Buffer> {
  const found = await stat(path).catch(() => null);
  if (!found?.isFile()) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(tool, path));
  if (found.size > ARTIFACT_MAX_BYTES) throw new ToolRefusal(TOOL_ERRORS.tooLarge(tool, path, found.size));
  const bytes = await readFile(path);
  if (bytes.length > ARTIFACT_MAX_BYTES) throw new ToolRefusal(TOOL_ERRORS.tooLarge(tool, path, bytes.length));
  return bytes;
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ── the kinds' files (Decision Log 10): a kind's registered `readFiles` and `publish`, else the generic file model ──

export function filesOf(store: ArtifactStore, kind: ArtifactKind, doc: Doc): Record<string, string> {
  return store.service.adapterFor(kind)?.readFiles?.(doc) ?? readFiles(doc);
}

export function publisherOf(store: ArtifactStore, kind: ArtifactKind): NonNullable<KindAdapter['publish']> {
  return store.service.adapterFor(kind)?.publish ?? publishFiles;
}

// A scratch doc holding `state` (V2; null: an empty doc), destroyed after `use`.
export function withDoc<T>(state: Uint8Array | null, use: (doc: Doc) => T): T {
  const doc = newDoc();
  try {
    if (state) applyV2(doc, state);
    return use(doc);
  } finally {
    doc.destroy();
  }
}
