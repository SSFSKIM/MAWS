// What the artifact tools share (X25; the P3-A document's M6 and Decision Log 3, 9, 11, 33): the engine host's artifact
// store, the calling session's lineage, the session's own memory (its bases for byte kinds, the kinds whose guide it was
// given), and the refusals.
//
// Store state reaches a tool's answer only once it may be revealed (Decision Log 33): reads go through
// `readCommitted`, writes run inside `writeCommitted`, and an answer that carries store state is re-read through
// `readCommitted` or built in the write's `inFrame`. A refusal computed from store state (a stale base, a conflict, a
// missing artifact) is held the same way, so no answer names rows a failed batch takes back.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

// P3-F (artifact-protocol finding 4): `pathUnderCwd` checks the words; these check where they lead once every link on
// the path and on the working directory is resolved. A source (a file read) must lead inside; a path that leads
// nowhere is answered as no file. A destination (a file written) must not be a link itself, and the nearest of it and
// its directories that exists must lead inside (the directory itself included), so what is made below it stays inside.
// P4 (the tech-debt row of 2026-10-18): and what is read or written is what was checked, so a link a process racing in
// the working directory puts in a file's place after the check is never followed. A source is read through one
// descriptor of the very file validated; a destination is opened through its real directory, through no link.
//
// macOS 11 and later: O_NOFOLLOW_ANY (not in Node's fs.constants, so passed numerically) refuses a link anywhere on the
// path the kernel walks, the last component included. It replaces O_NOFOLLOW, since macOS answers EINVAL for the two
// together, and it refuses /tmp and /var themselves, which is why both open a real path. Linux ignores the bit, and its
// O_NOFOLLOW guards the last component alone: there a directory above turned into a link after the check is the
// documented gap of the Linux unit lane (MAWS ships on macOS), as for datasets.ts's read. O_NONBLOCK: a FIFO put in a
// file's place opens at once (or, written with no reader, fails) and is refused as not a regular file, never holding a
// thread.
const NO_LINK = process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK | NO_LINK;
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NONBLOCK | NO_LINK;
const errnoOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

// A source the agent named: a regular file of at most ARTIFACT_MAX_BYTES under the working directory once its links
// are resolved, read whole through one descriptor, opened by its real path. The opened file must be the regular file
// validated (its device and inode), so one replaced since, by a link out, another file or a FIFO, is refused; the read
// stops one byte past the cap, so one grown since is refused by size.
export async function readSourceUnderCwd(tool: ArtifactToolName, cwd: string, path: string): Promise<{ path: string; bytes: Buffer }> {
  const named = pathUnderCwd(tool, cwd, path);
  const real = await realpath(named).catch(() => null);
  if (real === null) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(tool, named));
  await leadsInside(tool, cwd, named, real, false);
  const validated = await lstat(real).catch(() => null);
  if (!validated?.isFile()) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(tool, named));
  if (validated.size > ARTIFACT_MAX_BYTES) throw new ToolRefusal(TOOL_ERRORS.tooLarge(tool, named, validated.size));
  const changed = () => refuse(tool, { reason: 'invalid', path: named }, `${named} changed after it was checked; it was not read`);
  const handle = await open(real, READ_FLAGS).catch((error: unknown) => {
    throw errnoOf(error) === 'ELOOP' || errnoOf(error) === 'ENOENT' ? changed() : error;
  });
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== validated.dev || opened.ino !== validated.ino) throw changed();
    // sized by the opened file, one byte over to see it grow; a file that did grow is read on, never past the cap
    const chunks: Buffer[] = [];
    let length = 0;
    let room = Math.min(opened.size, ARTIFACT_MAX_BYTES) + 1;
    while (length <= ARTIFACT_MAX_BYTES) {
      const chunk = Buffer.alloc(Math.min(room, ARTIFACT_MAX_BYTES + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      room = 1024 * 1024;
    }
    if (length > ARTIFACT_MAX_BYTES) throw new ToolRefusal(TOOL_ERRORS.tooLarge(tool, named, Math.max(opened.size, length)));
    return { path: named, bytes: chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, length) };
  } finally {
    await handle.close();
  }
}

// A destination the agent named, opened to be written whole (made, or emptied): checked as `destinationUnderCwd`
// checks it, its directory made, that directory's real path checked to lie inside, and the file opened there through
// no link; anything but a regular file there is refused. The caller writes and closes the handle.
export async function openDestinationUnderCwd(tool: ArtifactToolName, cwd: string, path: string): Promise<FileHandle> {
  const named = await destinationUnderCwd(tool, cwd, path);
  await mkdir(dirname(named), { recursive: true });
  const directory = await realpath(dirname(named));
  await leadsInside(tool, cwd, named, directory, true);
  const handle = await open(join(directory, basename(named)), WRITE_FLAGS).catch((error: unknown) => {
    throw errnoOf(error) === 'ELOOP' ? refuse(tool, { reason: 'invalid', path: named }, `${named} became a link after it was checked; a file is not written through one`) : error;
  });
  const opened = await handle.stat().catch(async (error: unknown) => {
    await handle.close();
    throw error;
  });
  if (opened.isFile()) return handle;
  await handle.close();
  throw refuse(tool, { reason: 'invalid', path: named }, `${named} is not a regular file; it was not written`);
}

export async function destinationUnderCwd(tool: ArtifactToolName, cwd: string, path: string): Promise<string> {
  const named = pathUnderCwd(tool, cwd, path);
  if ((await lstat(named).catch(() => null))?.isSymbolicLink()) throw refuse(tool, { reason: 'invalid', path: named }, `${named} is a link; a file is not written through one`);
  for (let existing = named; ; existing = dirname(existing)) {
    const real = await realpath(existing).catch(() => null);
    if (real === null) continue;
    await leadsInside(tool, cwd, named, real, existing !== named);
    return named;
  }
}

async function leadsInside(tool: ArtifactToolName, cwd: string, named: string, real: string, directory: boolean): Promise<void> {
  const root = await realpath(cwd).catch(() => resolve(cwd));
  const inside = relative(root, real);
  if (inside === '' ? directory : !inside.startsWith('..') && !isAbsolute(inside)) return;
  throw refuse(tool, { reason: 'invalid', path: named }, `${named} leads to ${real}, outside the working directory ${root}`);
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
