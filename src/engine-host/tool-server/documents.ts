// The document tools of the `maws` server (P3-B's M7; X25's document part; §4.3 and §4.4 [binding] of
// docs/doperpowers/plans/2026-10-12-p3-co-work.md; D7, D11 and D14 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
//
//   artifact_edit      one atomic batch of block ops through the patch writer, on the session's host replica (A's
//                      `writeAs` with the session as actor), its op recorded in the write's savepoint (`withOp`, so a
//                      repeated tool-use id answers the first result); the writer validates every op before its one
//                      transaction, so a refusal writes nothing; the writer's carries go to the adapter's registry in
//                      the same transaction, before A's service runs the adapter's hooks; `answering` posts the result
//                      lines into the thread in the same transaction; the session's presence names the blocks while
//                      the batch lands and drops them 1.5 s after (D11).
//   artifact_comments  the threads, open (orphans included), resolved or all, with their messages.
//   artifact_reply     a message into a thread as the session.
//   artifact_resolve   resolve or reopen a thread as the session.
//   artifact_read      (a document's) D7's read: one tab as the kind's markdown with ids, ranged, `sinceRevision`; it
//                      warms the replica the session's batches are planned on and records the session's view.
//   artifact_create    (a document's) the first tab from the kind's markdown, in the batch of the entity row.
//
// Suggestions (D14; parent Decision Log 27): `mode: 'suggest'`, or a plain batch on an artifact whose owner set
// `agentEditsAsSuggestions`, lands on the artifact's suggestion doc through A's suggestion service (A's M8). Without it
// the batch is refused `unavailable` and nothing is written; the owner's setting is never bypassed by a direct write.
//
// These definitions stand alone until P3-A's artifact tools are on this branch; then `mawsTools` lists the four
// tools after A's and wraps A's `artifact_read` and `artifact_create` with `withDocumentRead`/`withDocumentCreate`.
import { DocIndex } from '@artifacts/document/block-index';
import { caretsOf } from '@artifacts/document/carets';
import { EditError, type Op } from '@artifacts/document/edit-ops';
import { importMarkdown } from '@artifacts/document/import/markdown';
import { applyEdit } from '@artifacts/document/patch-writer';
import { readDocument, ReadError, type ReadOptions } from '@artifacts/document/read';
import { nanoid8 } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { getThread, liveThreadIds, locate, reopen, reply, resolve as resolveThread, threadStates, type ThreadState } from '@artifacts/document/threads';
import { KIND_GUIDES } from '@artifacts/types/guides';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { Artifact, ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import * as z from 'zod';
import {
  ArtifactCommentsInputSchema,
  ArtifactEditInputSchema,
  ArtifactReplyInputSchema,
  ArtifactResolveInputSchema,
  DOCUMENT_LIMITS,
  DOCUMENT_TOOLS,
  DocumentCreateInputSchema,
  DocumentReadInputSchema,
  documentRefused,
  parseDocumentArguments,
  type ArtifactCommentsResult,
  type ArtifactEditResult,
  type ArtifactReplyResult,
  type ArtifactResolveResult,
  type CommentAuthor,
  type DocumentRefusal,
  type DocumentReadResult,
  type DocumentToolName,
  type ListedThread,
} from '@shared/maws/document-tools';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import { documentAdapterOf } from '../documents/kinds/document';
import { changesSince, DocumentViews, onSessionReplica, warmInSlices } from '../documents/kinds/document-host';
import type { ArtifactStore } from '../documents/store';
import { toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from './server';

const PRESENCE_EDITING_MS = 1_500; // D11: the agent's editing blocks stay outlined this long after its batch commits

// What one session's document tools remember between calls: its views of each replica, the kinds whose guide it was
// given (A's `ArtifactSession.guided` once A's tools are here), its presence timers.
export class DocumentToolSession {
  readonly views = new DocumentViews();
  readonly guided: Set<ArtifactKind>;
  readonly presence = new Map<string, ReturnType<typeof setTimeout>>(); // by artifact id

  constructor(guided?: Set<ArtifactKind>) {
    this.guided = guided ?? new Set();
  }
}

// A's suggestion service (X24: `DocumentService.suggestionDoc(artifactId)`, `acceptSuggestion`, `rejectSuggestion`;
// A's M8), present on the service once A lands it.
interface SuggestionService {
  suggestionDoc(artifactId: string): unknown;
}

export interface DocumentToolDeps {
  artifacts?: () => ArtifactStore | null; // the host's store; null when it failed to open
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, nearest first
  session: DocumentToolSession;
  log?: (line: string) => void;
  now?: () => number;
  presenceEditingMs?: number;
}

type Tool = DocumentToolName | 'artifact_read' | 'artifact_create';

class Refusal extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}
const refuse = (tool: Tool, refusal: DocumentRefusal, sentence: string): Refusal => new Refusal(documentRefused(tool, refusal, sentence));

// A tool body whose refusals become its answer; the store's typed refusals as machine-readable ones; anything else
// propagates (the server answers `<tool>: <message>`).
async function answering(tool: Tool, body: () => Promise<McpToolResult>): Promise<McpToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Refusal) return toolError(error.text);
    if (error instanceof ArtifactStoreError) return toolError(documentRefused(tool, { reason: error.code === 'notFound' || error.code === 'handleTaken' ? error.code : 'invalid', ...error.data }, error.message));
    if (error instanceof StoreTooNewError) return toolError(documentRefused(tool, { reason: 'unavailable' }, error.message));
    throw error;
  }
}

const actorOf = (ctx: McpToolContext): Actor => ({ kind: 'session', appSessionId: ctx.appSessionId });
// The idempotency key of a call: its tool-use id under the session that made it (A's Decision Log 11).
const opIdOf = (ctx: McpToolContext): string | null => (ctx.toolUseId === null ? null : `${ctx.appSessionId}/${ctx.toolUseId}`);
const iso = (ms: number) => new Date(ms).toISOString();

function storeOf(tool: Tool, deps: DocumentToolDeps): ArtifactStore {
  const store = deps.artifacts?.() ?? null;
  if (!store) throw refuse(tool, { reason: 'unavailable' }, 'the artifact store is unavailable in this run of MAWS');
  return store;
}

// The live document a ref names in the session's lineage (Decision Log 3 of A), answered once its batch committed.
async function documentOf(tool: Tool, store: ArtifactStore, ref: string, ctx: McpToolContext, deps: DocumentToolDeps): Promise<Artifact> {
  const lineage = [ctx.appSessionId, ...(deps.artifactScope ?? [])];
  const artifact = await store.readCommitted(() => {
    const id = store.resolve(ref, lineage);
    return id === null ? null : store.get(id);
  });
  if (!artifact) throw refuse(tool, { reason: 'notFound', artifact: ref }, `no artifact "${ref}" in this session`);
  if (artifact.kind !== 'document') throw refuse(tool, { reason: 'invalid', kind: artifact.kind }, `${ref} is a ${artifact.kind} artifact; ${tool} works on documents`);
  return artifact;
}

// A refusal computed from the store's state, released once the batch open now has committed (A's Decision Log 33).
async function refusedAfterCommit(store: ArtifactStore, refusal: Refusal): Promise<never> {
  await store.readCommitted(() => null);
  throw refusal;
}

// Who wrote something, as an agent reads it.
function authorOf(actor: Actor, self: AppSessionId): CommentAuthor {
  if (actor.kind === 'human') return { by: 'user' };
  return actor.appSessionId === self ? { by: 'this session' } : { by: 'another session', appSessionId: actor.appSessionId };
}

function definition(name: DocumentToolName, call: McpToolDefinition['call']): McpToolDefinition {
  const { title, description, input, annotations } = DOCUMENT_TOOLS[name];
  return { name, title, description, inputSchema: z.toJSONSchema(input) as Record<string, unknown>, annotations: { ...annotations, title }, call };
}

// ── artifact_edit ────────────────────────────────────────────────────────────────────────────────────────────────

const targetsOf = (op: Op): string[] => {
  switch (op.op) {
    case 'replace_text':
      return op.block ? [op.block] : [];
    case 'replace_block':
    case 'delete':
      return [op.id];
    case 'insert':
      return [op.after ?? op.before!];
    case 'move':
      return [op.id];
    case 'set_cell':
      return [op.table];
  }
};

// The writer's refusal as the tool's: the sentence, the reason with what it names, and the live revision (a retry
// from it is validated against what the refusal showed).
const editRefusal = (error: EditError, liveRevision: number): Refusal => refuse('artifact_edit', { ...error.refusal, liveRevision }, error.message);

export function artifactEditTool(deps: DocumentToolDeps): McpToolDefinition {
  const TOOL = 'artifact_edit';
  const now = deps.now ?? Date.now;
  return definition(TOOL, (args, ctx) =>
    answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactEditInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf(TOOL, deps);
      const adapter = documentAdapterOf(store);
      if (!adapter) throw refuse(TOOL, { reason: 'unavailable' }, 'documents are not registered with the artifact store in this run of MAWS');
      const artifact = await documentOf(TOOL, store, input.artifact, ctx, deps);
      const ops = input.ops as Op[];
      if (input.mode === 'suggest' || artifact.agentEditsAsSuggestions) return toolText(await suggest(store, artifact, input.mode === 'suggest'));
      const revision = await store.readCommitted(() => store.revision(artifact.id));
      if (input.baseRevision > revision) throw refuse(TOOL, { reason: 'invalid', liveRevision: revision }, `baseRevision ${input.baseRevision} is newer than the live revision ${revision}`);
      const restoredSince = await store.readCommitted(() => store.listVersions(artifact.id).some((version) => version.kind === 'restore' && version.seq > input.baseRevision));
      const actor = actorOf(ctx);
      const replica = store.service.replica(ctx.appSessionId, artifact.id); // keeps the document loaded; presence; carets
      const presence = actorDisplay(actor);
      const editing = [...new Set(ops.flatMap(targetsOf))];
      clearTimeout(deps.session.presence.get(artifact.id));
      replica.setPresence({ ...presence, editing: { blocks: editing } });

      try {
        const result = await store.writeCommitted(() =>
          store.withOp(
            opIdOf(ctx),
            TOOL,
            artifact.id,
            async (op) => {
              const outcome: { result?: ArtifactEditResult; refusal?: Refusal; doc?: Doc } = {};
              await store.service.writeAs(
                artifact.id,
                actor,
                (doc) => {
                  outcome.doc = doc;
                  const view = deps.session.views.base(doc, input.baseRevision);
                  try {
                    refuseInsertsIntoFullTabs(doc, ops);
                    const applied = applyEdit(doc, ops, {
                      since: view?.epoch ?? -1, // a base the session never saw here: every checked target counts as changed
                      carets: caretsOf(replica.provider.awareness.getStates(), doc, replica.provider.awareness.clientID),
                      restoredAway: restoredSince && view ? view.ids : undefined,
                      answering: input.answering,
                    });
                    adapter.registerCarries(artifact.id, applied.carries);
                    let answered: ArtifactEditResult['answered'];
                    if (applied.answer) {
                      const messageId = `${applied.answer.threadId}:${nanoid8()}`;
                      reply(doc, applied.answer.threadId, { id: messageId, by: actor, at: now(), body: applied.answer.body });
                      answered = { threadId: applied.answer.threadId, messageId };
                    }
                    outcome.result = { status: 'edited', artifactId: artifact.id, revision: 0, results: applied.results, orphaned: applied.orphaned, ...(answered && { answered }) };
                  } catch (error) {
                    if (!(error instanceof EditError)) throw error;
                    const live = store.service.revision(artifact.id);
                    if (error.reason === 'staleTargets') deps.session.views.record(doc, live); // the refusal showed the targets as they are now
                    outcome.refusal = editRefusal(error, live);
                  }
                },
                {
                  inFrame: (at) => {
                    if (!outcome.result) return;
                    outcome.result.revision = at;
                    if (outcome.doc) deps.session.views.record(outcome.doc, at); // the session's own write is a revision it knows
                    op.record(outcome.result);
                  },
                },
              );
              if (outcome.refusal) return refusedAfterCommit(store, outcome.refusal);
              await store.link(artifact.id, ctx.appSessionId, 'edited');
              return outcome.result!;
            },
            { actor },
          ),
        );
        return toolText(result);
      } finally {
        const timer = setTimeout(() => {
          deps.session.presence.delete(artifact.id);
          replica.setPresence(presence);
        }, deps.presenceEditingMs ?? PRESENCE_EDITING_MS);
        timer.unref?.();
        deps.session.presence.set(artifact.id, timer);
      }
    }),
  );
}

// A tab already holding DOCUMENT_LIMITS.blocksPerTab top-level blocks takes no more inserts.
function refuseInsertsIntoFullTabs(doc: Doc, ops: readonly Op[]): void {
  const index = DocIndex.of(doc);
  ops.forEach((op, opIndex) => {
    if (op.op !== 'insert') return;
    const found = index.find(op.after ?? op.before!);
    if (found && index.tops(found.top.tabId).length >= DOCUMENT_LIMITS.blocksPerTab) {
      throw new EditError({ reason: 'invalid', opIndex, message: `the tab holds ${DOCUMENT_LIMITS.blocksPerTab} blocks, the most a tab takes` }, `op ${opIndex}: the tab holds ${DOCUMENT_LIMITS.blocksPerTab} top-level blocks, the most a tab takes; start another document or tab`);
    }
  });
}

// The suggest path (D14): A's suggestion service when the store has it (A's M8), else refused with nothing written.
async function suggest(store: ArtifactStore, artifact: Artifact, asked: boolean): Promise<never> {
  const service = store.service as unknown as Partial<SuggestionService>;
  const why = asked ? 'mode "suggest" asks' : 'the owner set this document to take agent edits as suggestions, which needs';
  if (typeof service.suggestionDoc !== 'function') {
    return refusedAfterCommit(store, refuse('artifact_edit', { reason: 'unavailable', mode: 'suggest', setting: !asked }, `${why} MAWS's suggestion service, which this build does not have yet; nothing was written`));
  }
  // A's M8: the batch applied on `service.suggestionDoc(artifact.id)` as the session, the editor offering Accept and
  // Reject per range. Not wired until A's service exists to code against (Decision Log 8: behind this flag).
  return refusedAfterCommit(store, refuse('artifact_edit', { reason: 'unavailable', mode: 'suggest', setting: !asked }, `suggested edits to ${artifact.title} are not wired to MAWS's suggestion service yet; nothing was written`));
}

// ── artifact_comments, artifact_reply, artifact_resolve ─────────────────────────────────────────────────────────────

function listed(doc: Doc, thread: ThreadState, self: AppSessionId): ListedThread {
  return {
    threadId: thread.id,
    status: thread.status,
    orphaned: thread.orphan,
    tab: thread.tabId,
    block: thread.live ? locate(doc, thread).blockId : (locate(doc, thread).blockId ?? thread.blockId),
    quote: thread.quote,
    createdBy: authorOf(thread.createdBy, self),
    createdAt: iso(thread.createdAt),
    ...(thread.status === 'resolved' && thread.resolvedAt != null && { resolvedAt: iso(thread.resolvedAt) }),
    messages: thread.messages.map((message) => ({ id: message.id, at: iso(message.at), body: message.body, ...authorOf(message.by, self) })),
  };
}

export function artifactCommentsTool(deps: DocumentToolDeps): McpToolDefinition {
  const TOOL = 'artifact_comments';
  return definition(TOOL, (args, ctx) =>
    answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactCommentsInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { status = 'open' } = parsed.data;
      const store = storeOf(TOOL, deps);
      const artifact = await documentOf(TOOL, store, parsed.data.artifact, ctx, deps);
      const result = await store.readCommitted((): ArtifactCommentsResult => {
        const doc = store.service.live(artifact.id);
        const threads = threadStates(doc, liveThreadIds(doc)).filter((thread) => status === 'all' || thread.status === status);
        return { status: 'listed', artifactId: artifact.id, revision: store.revision(artifact.id), threads: threads.map((thread) => listed(doc, thread, ctx.appSessionId)) };
      });
      return toolText(result);
    }),
  );
}

// One write to a thread as the session, recorded with its answer; a change that writes nothing (resolving a resolved
// thread) records its answer alone.
async function threadWrite<R extends { revision: number }>(
  tool: 'artifact_reply' | 'artifact_resolve',
  store: ArtifactStore,
  artifact: Artifact,
  threadId: string,
  ctx: McpToolContext,
  write: (doc: Doc) => Omit<R, 'revision'> | { unchanged: Omit<R, 'revision'> },
): Promise<R> {
  const actor = actorOf(ctx);
  return store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      tool,
      artifact.id,
      async (op) => {
        const outcome: { answer?: Omit<R, 'revision'>; unchanged?: Omit<R, 'revision'>; missing?: boolean; result?: R } = {};
        await store.service.writeAs(
          artifact.id,
          actor,
          (doc) => {
            if (!getThread(doc, threadId)) {
              outcome.missing = true;
              return;
            }
            const written = write(doc);
            if ('unchanged' in written) outcome.unchanged = written.unchanged;
            else outcome.answer = written;
          },
          {
            inFrame: (revision) => {
              if (!outcome.answer) return;
              outcome.result = { ...outcome.answer, revision } as R;
              op.record(outcome.result);
            },
          },
        );
        if (outcome.missing) return refusedAfterCommit(store, refuse(tool, { reason: 'notFound', threadId }, `no comment thread ${threadId} in ${artifact.title}; artifact_comments lists them`));
        if (outcome.unchanged) {
          const result = { ...outcome.unchanged, revision: store.revision(artifact.id) } as R;
          await store.service.inBatch(() => op.record(result));
          return result;
        }
        await store.link(artifact.id, ctx.appSessionId, 'edited');
        return outcome.result!;
      },
      { actor },
    ),
  );
}

export function artifactReplyTool(deps: DocumentToolDeps): McpToolDefinition {
  const TOOL = 'artifact_reply';
  const now = deps.now ?? Date.now;
  return definition(TOOL, (args, ctx) =>
    answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactReplyInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { threadId, body } = parsed.data;
      const store = storeOf(TOOL, deps);
      const artifact = await documentOf(TOOL, store, parsed.data.artifact, ctx, deps);
      const result = await threadWrite<ArtifactReplyResult>(TOOL, store, artifact, threadId, ctx, (doc) => {
        const messageId = `${threadId}:${nanoid8()}`;
        reply(doc, threadId, { id: messageId, by: actorOf(ctx), at: now(), body });
        return { status: 'replied', artifactId: artifact.id, threadId, messageId, threadStatus: getThread(doc, threadId)!.status, line: `replied on c:${threadId}` };
      });
      return toolText(result);
    }),
  );
}

export function artifactResolveTool(deps: DocumentToolDeps): McpToolDefinition {
  const TOOL = 'artifact_resolve';
  const now = deps.now ?? Date.now;
  return definition(TOOL, (args, ctx) =>
    answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactResolveInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { threadId, reopen: opening = false } = parsed.data;
      const store = storeOf(TOOL, deps);
      const artifact = await documentOf(TOOL, store, parsed.data.artifact, ctx, deps);
      const result = await threadWrite<ArtifactResolveResult>(TOOL, store, artifact, threadId, ctx, (doc) => {
        const answer = { status: opening ? 'reopened' : 'resolved', artifactId: artifact.id, threadId, line: `${opening ? 'reopened' : 'resolved'} c:${threadId}` } as const;
        if (getThread(doc, threadId)!.status === (opening ? 'open' : 'resolved')) return { unchanged: answer };
        if (opening) reopen(doc, threadId, actorOf(ctx), now());
        else resolveThread(doc, threadId, actorOf(ctx), now());
        return answer;
      });
      return toolText(result);
    }),
  );
}

// ── artifact_read (a document) ──────────────────────────────────────────────────────────────────────────────────

function versionSummary(version: ArtifactVersion): NonNullable<DocumentReadResult['version']> {
  return { id: version.id, kind: version.kind, revision: version.seq, at: iso(version.at), ...(version.label !== undefined && { label: version.label }) };
}

const readRefusal = (error: ReadError): Refusal => refuse('artifact_read', { reason: error.reason, target: error.target }, error.message);

/** A document's `artifact_read`; `fallback` answers every other kind (A's tool, once it is here). */
export function documentReadTool(deps: DocumentToolDeps, fallback?: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_read';
  return {
    ...(fallback ?? { name: TOOL, title: 'Read artifact', description: '', inputSchema: z.toJSONSchema(DocumentReadInputSchema) as Record<string, unknown>, annotations: { readOnlyHint: true, openWorldHint: false, title: 'Read artifact' } }),
    call: (args, ctx) =>
      answering(TOOL, async () => {
        if (fallback && !(await namesDocument(deps, args, ctx))) return fallback.call(args, ctx);
        const parsed = parseDocumentArguments(TOOL, DocumentReadInputSchema, args);
        if (!parsed.ok) return toolError(parsed.error);
        const input = parsed.data;
        const store = storeOf(TOOL, deps);
        const artifact = await documentOf(TOOL, store, input.artifact, ctx, deps);
        if (input.revision !== undefined || input.paths !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'a document is read by tab, range and sinceRevision (or a retained version), not by revision or paths');
        const options = { tab: input.tab, from: input.from, count: input.count ?? DOCUMENT_LIMITS.readCount };
        const head = { status: 'read' as const, artifactId: artifact.id, kind: 'document' as const, title: artifact.title, ...(artifact.handle !== undefined && { handle: artifact.handle }) };
        let result: DocumentReadResult;
        if (input.version !== undefined) {
          if (input.sinceRevision !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'a retained version is read whole, without sinceRevision');
          const read = await store.readCommitted(() => {
            const version = store.versions.version(artifact.id, input.version!);
            if (!version) throw refuse(TOOL, { reason: 'notFound', version: input.version }, `version ${input.version} does not exist`);
            const doc = newDoc();
            try {
              applyV2(doc, store.versionState(artifact.id, version.id));
              return { version, read: readDocument(doc, options) };
            } catch (error) {
              if (error instanceof ReadError) throw readRefusal(error);
              throw error;
            } finally {
              doc.destroy();
            }
          });
          result = { ...head, revision: read.version.seq, ...publicRead(read.read), version: versionSummary(read.version) };
        } else {
          const actor = actorOf(ctx);
          store.service.replica(ctx.appSessionId, artifact.id); // the session's replica keeps the document loaded
          const read = await onSessionReplica(store, artifact.id, actor, (doc, revision) => {
            let since: { changed?: string[]; deleted?: string[]; complete?: true } = {};
            let only: ReadOptions['only'];
            if (input.sinceRevision !== undefined) {
              const changes = changesSince(store, artifact.id, doc, input.sinceRevision, deps.session.views);
              if (changes) {
                only = changes.touched;
                since = { deleted: changes.deleted };
              } else since = { complete: true };
            }
            const read = readDocument(doc, { ...options, only });
            if (only) since.changed = read.shown;
            deps.session.views.record(doc, revision);
            warmInSlices(doc);
            return { revision, read, since };
          }).catch((error: unknown) => {
            throw error instanceof ReadError ? readRefusal(error) : error;
          });
          result = { ...head, revision: read.revision, ...publicRead(read.read), ...(input.sinceRevision !== undefined && { sinceRevision: input.sinceRevision }), ...read.since };
          await store.writeCommitted(() => store.link(artifact.id, ctx.appSessionId, 'viewed'));
        }
        return toolText(result);
      }),
  };
}

const publicRead = (read: ReturnType<typeof readDocument>) => ({ tabs: read.tabs, tab: read.tab, markdown: read.markdown, next: read.next });

// Whether a call's `artifact` names a document (the wrappers' dispatch; a call that names nothing goes to A's tool,
// which refuses it in its own words).
async function namesDocument(deps: DocumentToolDeps, args: unknown, ctx: McpToolContext): Promise<boolean> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return false;
  const lineage = [ctx.appSessionId, ...(deps.artifactScope ?? [])];
  return store.readCommitted(() => {
    const id = store.resolve(ref, lineage);
    return id !== null && store.get(id)?.kind === 'document';
  });
}

// ── artifact_create (a document) ────────────────────────────────────────────────────────────────────────────────

/** A document's `artifact_create`; `fallback` answers every other kind (A's tool, once it is here). */
export function documentCreateTool(deps: DocumentToolDeps, fallback?: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_create';
  return {
    ...(fallback ?? { name: TOOL, title: 'Create artifact', description: '', inputSchema: z.toJSONSchema(DocumentCreateInputSchema) as Record<string, unknown>, annotations: { readOnlyHint: false, openWorldHint: false, title: 'Create artifact' } }),
    call: (args, ctx) =>
      answering(TOOL, async () => {
        if (fallback && (args as { kind?: unknown } | null)?.kind !== 'document') return fallback.call(args, ctx);
        const parsed = parseDocumentArguments(TOOL, DocumentCreateInputSchema, args);
        if (!parsed.ok) return toolError(parsed.error);
        const input = parsed.data;
        if (input.id !== undefined && input.handle !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'give handle or id (its older name), not both');
        const handle = input.handle ?? input.id;
        const store = storeOf(TOOL, deps);
        const actor = actorOf(ctx);
        let body: ReturnType<typeof importMarkdown>;
        try {
          body = importMarkdown(input.content ?? '');
        } catch (error) {
          throw refuse(TOOL, { reason: 'invalid' }, `the content is not the document kind's markdown: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (handle !== undefined) {
          const taken = await store.readCommitted(() => (store.resolve(handle, [ctx.appSessionId]) ? 'this session' : deps.artifactScope?.length && store.resolve(handle, deps.artifactScope) ? 'the conversation this side thread was opened from' : null));
          if (taken) throw refuse(TOOL, { reason: 'handleTaken', handle }, `an artifact "${handle}" already exists in ${taken}; edit it with artifact_edit`);
        }
        const created = await store.writeCommitted(() =>
          store.withOp(
            opIdOf(ctx),
            TOOL,
            null,
            async (op) => {
              const made: { artifact?: Artifact; doc?: Doc; answer?: { artifactId: string; title: string; revision: number; handle?: string } } = {};
              const creating = store.create({ kind: 'document', title: input.title, ...(handle !== undefined && { handle }) }, actor, (artifact) => (made.artifact = artifact));
              // the first tab, written through the session's host replica in the batch that holds the entity row
              const writing = made.artifact
                ? store.service.writeAs(made.artifact.id, actor, (doc) => {
                    made.doc = doc;
                    createDocument(doc, { title: input.title, body });
                  }, {
                    inFrame: (revision) => {
                      made.answer = { artifactId: made.artifact!.id, title: made.artifact!.title, revision, ...(handle !== undefined && { handle }) };
                      if (made.doc) deps.session.views.record(made.doc, revision);
                      op.record(made.answer);
                    },
                  })
                : null;
              await creating;
              await writing;
              return made.answer!;
            },
            { actor },
          ),
        );
        store.service.replica(ctx.appSessionId, created.artifactId); // the session's replica keeps the document loaded
        const result: Record<string, unknown> = { status: 'created', kind: 'document', ...created };
        if (!deps.session.guided.has('document')) {
          deps.session.guided.add('document');
          result.guide = KIND_GUIDES.document;
        }
        const system = await store.designSystemContextFor(created.artifactId);
        if (system !== null) result.designSystem = system;
        return toolText(result);
      }),
  };
}

/** The four document tools, in `tools/list` order (appended after A's artifact tools). */
export function documentTools(deps: DocumentToolDeps): McpToolDefinition[] {
  return [artifactEditTool(deps), artifactCommentsTool(deps), artifactReplyTool(deps), artifactResolveTool(deps)];
}
