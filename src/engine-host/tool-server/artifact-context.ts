// What the artifact tools share (X25; the P3-A document's M6 and Decision Log 3, 9, 11, 33): the engine host's artifact
// store, the calling session's lineage, the session's own memory (its bases for byte kinds, the kinds whose guide it was
// given), and the refusals.
//
// Store state reaches a tool's answer only once it may be revealed (Decision Log 33): reads go through
// `readCommitted`, writes run inside `writeCommitted`, and an answer that carries store state is re-read through
// `readCommitted` or built in the write's `inFrame`. A refusal computed from store state (a stale base, a conflict, a
// missing artifact) is held the same way, so no answer names rows a failed batch takes back.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { publishFiles, readFiles, type PublishOutcome } from '@artifacts/files';
import type { KindAdapter } from '@artifacts/host';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import { ARTIFACT_MAX_BYTES, TOOL_ERRORS, type ArtifactEditor, type ArtifactPublishResult, type ArtifactRefusal, type ArtifactToolName } from '@shared/maws/tools';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ArtifactStore } from '../documents/store';
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
  private readonly calls = new Map<string, Promise<McpToolResult>>(); // by op id: the writing calls still answering

  // One response per tool-use id while a call is answering (Decision Log 11): an overlapping call with the same id waits
  // for the first one's whole response (its write and its decorations) and answers it, never a bare recorded result
  // while the first call is still decorating its answer. Once answered, a repeat is the op ledger's (`replayOf`).
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
// deliverable made before P3 is an artifact under its record's id from the host's start (P3-L's X12 import, at store
// open), so its id and its page's name resolve as any artifact's do.
export async function resolveArtifact(tool: ArtifactToolName, store: ArtifactStore, ref: string, lineage: readonly AppSessionId[]): Promise<string> {
  const found = await store.readCommitted(() => store.resolve(ref, lineage));
  if (found !== null) return found;
  throw new ToolRefusal(TOOL_ERRORS.noArtifact(tool, ref));
}

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

// P3-C: the outcome's loader fields (`added`, `warnings`, `notes`, `held`) reach the answer when the kind gives them
export function publisherOf(store: ArtifactStore, kind: ArtifactKind): (...args: Parameters<NonNullable<KindAdapter['publish']>>) => PublishOutcome {
  return store.service.adapterFor(kind)?.publish ?? publishFiles;
}

// P3-C (the parent's Decision Log 58): the doc's file paths in `filesOf`'s order, by the kind's `paths` when it has one
export function pathsOf(store: ArtifactStore, kind: ArtifactKind, doc: Doc): string[] {
  return store.service.adapterFor(kind)?.paths?.(doc) ?? Object.keys(filesOf(store, kind, doc));
}

// P3-C: what a kind's loader said of the files, each field when it says something
export function loaderFields(outcome: PublishOutcome): Pick<ArtifactPublishResult, 'added' | 'warnings' | 'notes' | 'held'> {
  return {
    ...(outcome.added && outcome.added.length > 0 && { added: outcome.added }),
    ...(outcome.warnings && outcome.warnings.length > 0 && { warnings: outcome.warnings }),
    ...(outcome.notes !== undefined && outcome.notes > 0 && { notes: outcome.notes }),
    ...(outcome.held && outcome.held.length > 0 && { held: outcome.held }),
  };
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
