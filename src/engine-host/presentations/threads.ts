// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the agent's comment tools on a deck. B's
// `artifact_comments`, `artifact_reply` and `artifact_resolve` (src/engine-host/tool-server/documents.ts) are wrapped the
// way B wraps A's create and read: a call naming a presentation answers from the deck's threads
// (src/artifacts/slides/threads.ts), in B's names, schemas, refusals and result shapes with `slideId` and `elementId`
// where B has `tab` and `block`; a call naming anything else (or nothing) goes to B's tool unchanged. A reply and a
// resolve are one write as the session on its host replica, recorded under the call's tool-use id (a repeated id answers
// the first result) and filed under the session's turn, whose version names them (the adapter's `summarizeTurn`).
import { getThread, newThreadId, reopen, reply, resolve, threadStates, type DeckThreadState } from '@artifacts/slides/threads';
import type { Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { Artifact } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import {
  ArtifactCommentsInputSchema,
  ArtifactReplyInputSchema,
  ArtifactResolveInputSchema,
  documentRefused,
  parseDocumentArguments,
  type ArtifactReplyResult,
  type ArtifactResolveResult,
  type CommentAuthor,
  type DocumentRefusal,
  type ListedThread,
} from '@shared/maws/document-tools';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ArtifactStore } from '../documents/store';
import type { DocumentToolDeps } from '../tool-server/documents';
import { toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from '../tool-server/server';

type ThreadTool = 'artifact_comments' | 'artifact_reply' | 'artifact_resolve';

/** A deck's thread as `artifact_comments` lists it: B's `ListedThread` with the element's place for the passage's. */
export type ListedDeckThread = Omit<ListedThread, 'tab' | 'block'> & { slideId: string; elementId: string };
export interface ArtifactDeckCommentsResult {
  status: 'listed';
  artifactId: string;
  revision: number;
  threads: ListedDeckThread[];
}

/** B's thread tools in B's order, those three answering a presentation from its threads; every other tool as given. */
export function presentationThreadTools(deps: DocumentToolDeps, tools: readonly McpToolDefinition[]): McpToolDefinition[] {
  const wrap: Record<ThreadTool, (fallback: McpToolDefinition) => McpToolDefinition> = {
    artifact_comments: (fallback) => deckCommentsTool(deps, fallback),
    artifact_reply: (fallback) => deckReplyTool(deps, fallback),
    artifact_resolve: (fallback) => deckResolveTool(deps, fallback),
  };
  return tools.map((tool) => (tool.name in wrap ? wrap[tool.name as ThreadTool](tool) : tool));
}

class Refusal extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}
const refuse = (tool: ThreadTool, refusal: DocumentRefusal, sentence: string): Refusal => new Refusal(documentRefused(tool, refusal, sentence));

// B's `answering`: a refusal becomes the answer, the store's typed refusals machine-readable ones, anything else
// propagates (the server answers `<tool>: <message>`).
async function answering(tool: ThreadTool, body: () => Promise<McpToolResult>): Promise<McpToolResult> {
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
const opIdOf = (ctx: McpToolContext): string | null => (ctx.toolUseId === null ? null : `${ctx.appSessionId}/${ctx.toolUseId}`);
const iso = (ms: number) => new Date(ms).toISOString();
const lineage = (ctx: McpToolContext, deps: DocumentToolDeps): AppSessionId[] => [ctx.appSessionId, ...(deps.artifactScope ?? [])];

function storeOf(tool: ThreadTool, deps: DocumentToolDeps): ArtifactStore {
  const store = deps.artifacts?.() ?? null;
  if (!store) throw refuse(tool, { reason: 'unavailable' }, 'the artifact store is unavailable in this run of MAWS');
  return store;
}

// Whether a call's `artifact` names a live presentation in the session's lineage (the wrappers' dispatch; anything else,
// a ref naming nothing included, goes to B's tool, which answers in its own words).
async function namesPresentation(deps: DocumentToolDeps, args: unknown, ctx: McpToolContext): Promise<boolean> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return false;
  return store.readCommitted(() => {
    const id = store.resolve(ref, lineage(ctx, deps));
    return id !== null && store.get(id)?.kind === 'presentation';
  });
}

// Who wrote something, as an agent reads it (B's).
function authorOf(actor: Actor, self: AppSessionId): CommentAuthor {
  if (actor.kind === 'human') return { by: 'user' };
  return actor.appSessionId === self ? { by: 'this session' } : { by: 'another session', appSessionId: actor.appSessionId };
}

const listed = (thread: DeckThreadState, self: AppSessionId): ListedDeckThread => ({
  threadId: thread.id,
  status: thread.status,
  orphaned: thread.orphan,
  slideId: thread.slideId,
  elementId: thread.elementId,
  quote: thread.quote,
  createdBy: authorOf(thread.createdBy, self),
  createdAt: iso(thread.createdAt),
  ...(thread.status === 'resolved' && thread.resolvedAt != null && { resolvedAt: iso(thread.resolvedAt) }),
  messages: thread.messages.map((message) => ({ id: message.id, at: iso(message.at), body: message.body, ...authorOf(message.by, self) })),
});

function deckCommentsTool(deps: DocumentToolDeps, fallback: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_comments';
  const call: McpToolDefinition['call'] = async (args, ctx) => {
    if (!(await namesPresentation(deps, args, ctx))) return fallback.call(args, ctx);
    return answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactCommentsInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { status = 'open' } = parsed.data;
      const store = storeOf(TOOL, deps);
      const result = await store.readCommitted((): ArtifactDeckCommentsResult | null => {
        const id = store.resolve(parsed.data.artifact, lineage(ctx, deps));
        const artifact = id === null ? null : store.get(id);
        if (!artifact || artifact.kind !== 'presentation') return null;
        const threads = threadStates(store.service.live(artifact.id)).filter((thread) => status === 'all' || thread.status === status);
        return { status: 'listed', artifactId: artifact.id, revision: store.revision(artifact.id), threads: threads.map((thread) => listed(thread, ctx.appSessionId)) };
      });
      if (!result) throw refuse(TOOL, { reason: 'notFound', artifact: parsed.data.artifact }, `no artifact "${parsed.data.artifact}" in this session`);
      return toolText(result);
    });
  };
  return { ...fallback, call };
}

// A refusal computed from the store's state, released once the batch open now has committed (B's, A's Decision Log 33).
async function refusedAfterCommit(store: ArtifactStore, refusal: Refusal): Promise<never> {
  await store.readCommitted(() => null);
  throw refusal;
}

// One write to a deck's thread as the session, recorded with its answer; a change that writes nothing (resolving a
// resolved thread) records its answer alone (B's `threadWrite`).
async function deckThreadWrite<R extends { revision: number }>(
  tool: 'artifact_reply' | 'artifact_resolve',
  store: ArtifactStore,
  target: { id: string | null; ref: string },
  threadId: string,
  ctx: McpToolContext,
  write: (doc: Doc, artifact: Artifact) => Omit<R, 'revision'> | { unchanged: Omit<R, 'revision'> },
): Promise<R> {
  const actor = actorOf(ctx);
  return store.writeCommitted(() =>
    store.withOp(
      opIdOf(ctx),
      tool,
      target.id,
      async (op) => {
        const artifact = target.id === null ? null : store.get(target.id);
        if (!artifact) return refusedAfterCommit(store, refuse(tool, { reason: 'notFound', artifact: target.ref }, `no artifact "${target.ref}" in this session`));
        if (artifact.kind !== 'presentation') return refusedAfterCommit(store, refuse(tool, { reason: 'invalid', kind: artifact.kind }, `${target.ref} is a ${artifact.kind} artifact now`));
        const outcome: { answer?: Omit<R, 'revision'>; unchanged?: Omit<R, 'revision'>; missing?: boolean; result?: R } = {};
        await store.service.writeAs(
          artifact.id,
          actor,
          (doc) => {
            if (!getThread(doc, threadId)) {
              outcome.missing = true;
              return;
            }
            const written = write(doc, artifact);
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

function deckReplyTool(deps: DocumentToolDeps, fallback: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_reply';
  const now = deps.now ?? Date.now;
  const call: McpToolDefinition['call'] = async (args, ctx) => {
    if (!(await namesPresentation(deps, args, ctx))) return fallback.call(args, ctx);
    return answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactReplyInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { threadId, body } = parsed.data;
      const store = storeOf(TOOL, deps);
      const target = { id: store.resolve(parsed.data.artifact, lineage(ctx, deps)), ref: parsed.data.artifact };
      const result = await deckThreadWrite<ArtifactReplyResult>(TOOL, store, target, threadId, ctx, (doc, artifact) => {
        const messageId = `${threadId}:${newThreadId()}`;
        reply(doc, threadId, { id: messageId, by: actorOf(ctx), at: now(), body });
        return { status: 'replied', artifactId: artifact.id, threadId, messageId, threadStatus: getThread(doc, threadId)!.status, line: `replied on c:${threadId}` };
      });
      return toolText(result);
    });
  };
  return { ...fallback, call };
}

function deckResolveTool(deps: DocumentToolDeps, fallback: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_resolve';
  const now = deps.now ?? Date.now;
  const call: McpToolDefinition['call'] = async (args, ctx) => {
    if (!(await namesPresentation(deps, args, ctx))) return fallback.call(args, ctx);
    return answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactResolveInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { threadId, reopen: opening = false } = parsed.data;
      const store = storeOf(TOOL, deps);
      const target = { id: store.resolve(parsed.data.artifact, lineage(ctx, deps)), ref: parsed.data.artifact };
      const result = await deckThreadWrite<ArtifactResolveResult>(TOOL, store, target, threadId, ctx, (doc, artifact) => {
        const answer = { status: opening ? 'reopened' : 'resolved', artifactId: artifact.id, threadId, line: `${opening ? 'reopened' : 'resolved'} c:${threadId}` } as const;
        if (getThread(doc, threadId)!.status === (opening ? 'open' : 'resolved')) return { unchanged: answer };
        if (opening) reopen(doc, threadId, actorOf(ctx), now());
        else resolve(doc, threadId, actorOf(ctx), now());
        return answer;
      });
      return toolText(result);
    });
  };
  return { ...fallback, call };
}
