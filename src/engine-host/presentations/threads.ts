// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the agent's comment tools on a deck. B's
// `artifact_comments`, `artifact_reply` and `artifact_resolve` (src/engine-host/tool-server/documents.ts) are wrapped the
// way B wraps A's create and read: a call naming a presentation answers from the deck's threads
// (src/artifacts/slides/threads.ts), in B's names, schemas, refusals and result shapes with `slideId` and `elementId`
// where B has `tab` and `block`; a call naming anything else (or nothing) goes to B's tool unchanged. Fix wave 1: the
// parsing, the refusals, the write as the session under the call's tool-use id (a repeated id answers the first
// result) and the link to its turn are B's one helper (`threadTool`); this file gives it the deck's thread model.
import { getThread, reopen, reply, resolve, threadStates, type DeckThreadState } from '@artifacts/slides/threads';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommentAuthor, ListedThread } from '@shared/maws/document-tools';
import { threadTool, type DocumentToolDeps, type ThreadKindOps } from '../tool-server/documents';
import type { McpToolContext, McpToolDefinition } from '../tool-server/server';

type ThreadToolName = 'artifact_comments' | 'artifact_reply' | 'artifact_resolve';
const THREAD_TOOLS: readonly string[] = ['artifact_comments', 'artifact_reply', 'artifact_resolve'];

/** A deck's thread as `artifact_comments` lists it: B's `ListedThread` with the element's place for the passage's. */
export type ListedDeckThread = Omit<ListedThread, 'tab' | 'block'> & { slideId: string; elementId: string };

const iso = (ms: number) => new Date(ms).toISOString();
// Who wrote something, as an agent reads it (B's words).
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

/** The deck's thread model, as B's helper takes it. */
export const DECK_THREADS: ThreadKindOps = {
  kind: 'presentation',
  list: (doc, status, self) => threadStates(doc).filter((thread) => status === 'all' || thread.status === status).map((thread) => listed(thread, self)),
  has: (doc, threadId) => getThread(doc, threadId) !== null,
  status: (doc, threadId) => getThread(doc, threadId)!.status,
  reply: (doc, threadId, message) => reply(doc, threadId, message),
  resolve: (doc, threadId, by, at) => resolve(doc, threadId, by, at),
  reopen: (doc, threadId, by, at) => reopen(doc, threadId, by, at),
};

// Whether a call's `artifact` names a live presentation in the session's lineage (the wrappers' dispatch; anything else,
// a ref naming nothing included, goes to B's tool, which answers in its own words).
async function namesPresentation(deps: DocumentToolDeps, args: unknown, ctx: McpToolContext): Promise<boolean> {
  const ref = (args as { artifact?: unknown } | null)?.artifact;
  const store = deps.artifacts?.() ?? null;
  if (typeof ref !== 'string' || !store) return false;
  return store.readCommitted(() => {
    const id = store.resolve(ref, [ctx.appSessionId, ...(deps.artifactScope ?? [])]);
    return id !== null && store.get(id)?.kind === 'presentation';
  });
}

/** B's thread tools in B's order, those three answering a presentation from its threads; every other tool as given. */
export function presentationThreadTools(deps: DocumentToolDeps, tools: readonly McpToolDefinition[]): McpToolDefinition[] {
  return tools.map((tool) => {
    if (!THREAD_TOOLS.includes(tool.name)) return tool;
    const deck = threadTool(tool.name as ThreadToolName, deps, DECK_THREADS);
    const call: McpToolDefinition['call'] = async (args, ctx) => ((await namesPresentation(deps, args, ctx)) ? deck.call(args, ctx) : tool.call(args, ctx));
    return { ...tool, call };
  });
}
