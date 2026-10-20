// The document tools of the `maws` server (P3-B's M7; X25's document part; §4.3 and §4.4 [binding] of
// docs/doperpowers/plans/2026-10-12-p3-co-work.md; D7, D11 and D14 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
//
//   artifact_edit      one atomic batch of block ops through the patch writer, on the session's host replica (A's
//                      `writeAs` with the session as actor), its op recorded in the write's savepoint (`withOp`, so a
//                      repeated tool-use id answers the first result); the writer validates every op before its one
//                      transaction, so a refusal writes nothing; the writer's carries go to the adapter's registry in
//                      the same transaction, before A's service runs the adapter's hooks; `answering` posts the result
//                      lines into the thread in the same transaction; the session's presence names the blocks while
//                      the batch lands and drops them 4 s after (D11; P3-F wave S F19, was 1.5 s). P4-A2 (X35): while
//                      its input streams the batch is shown provisionally (`./provisional.ts`); the write's frame
//                      announces the commit to that layer, and any other ending of the call drops it.
//   artifact_comments  the threads, open (orphans included), resolved or all, with their messages.
//   artifact_reply     a message into a thread as the session.
//   artifact_resolve   resolve or reopen a thread as the session.
//   artifact_read      (a document's) D7's read: one tab as the kind's markdown with ids, ranged, `sinceRevision`; it
//                      warms the replica the session's batches are planned on and records the session's view.
//   artifact_create    (a document's) the first tab from the kind's markdown, in the batch of the entity row.
//
// Suggestions (D14; parent Decision Log 27): `mode: 'suggest'`, or a plain batch on an artifact whose owner set
// `agentEditsAsSuggestions`, lands on the artifact's suggestion doc through A's suggestion service (A's M8).
// The owner's setting is never bypassed by a direct write. A suggested batch takes no `answering` (refused, see
// SUGGESTED_ANSWER).
//
// `mawsTools` lists the four tools after A's and wraps A's `artifact_read` and `artifact_create` with
// `documentReadTool`/`documentCreateTool`, which answer a document and hand every other kind to A's tool.
import { precheckEdit } from '@artifacts/document/edit-plan';
import { DocIndex } from '@artifacts/document/block-index';
import { caretsOf } from '@artifacts/document/carets';
import { EditError, type Op } from '@artifacts/document/edit-ops';
import { importMarkdown } from '@artifacts/document/import/markdown';
import { applyEdit } from '@artifacts/document/patch-writer';
import { readDocument, ReadError, type ReadOptions } from '@artifacts/document/read';
import { nanoid8 } from '@artifacts/document/schema';
import { textblocksY } from '@artifacts/document/structs';
import { createDocument } from '@artifacts/document/tabs';
import { getThread, liveThreadIds, locate, reopen, reply, resolve as resolveThread, threadStates, type ThreadState } from '@artifacts/document/threads';
import { KIND_GUIDES } from '@artifacts/types/guides';
import { applyV2, newDoc, type Doc, type Node } from '@artifacts/yjs';
import { createRelativePositionFromTypeIndex, relativePositionToJSON } from '@artifacts/yjs/document';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { Artifact, ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import {
  ArtifactCommentsInputSchema,
  ArtifactEditInputSchema,
  ArtifactReplyInputSchema,
  ArtifactResolveInputSchema,
  DOCUMENT_LIMITS,
  documentRefused,
  parseDocumentArguments,
  type ArtifactEditResult,
  type ArtifactReplyResult,
  type ArtifactResolveResult,
  type CommentAuthor,
  type DocumentRefusal,
  type DocumentReadResult,
  type DocumentToolName,
  type DocumentVersionSummary,
  type ListedThread,
} from '@shared/maws/document-tools';
import { parseToolArguments } from '@shared/maws/tools';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import { documentAdapterOf } from '../documents/kinds/document';
import { datasetFooter } from '../dashboards/answers'; // P3-E
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy'; // P3-E
import { chartSpecsBefore, normalizeChartSpecs, viewWarnings, type ViewWarning } from '@artifacts/dashboard/views'; // P3-E (E2 M3)
import { changesSince, DocumentViews, onSessionReplica, warmInSlices } from '../documents/kinds/document-host';
import type { AgentReplica } from '../documents/replica';
import type { ArtifactStore } from '../documents/store';
import { spaceFields, spaceNamed } from './artifact-tools'; // P3-F wave S (F5)
import { defineMawsTool, toolError, toolText, type McpToolContext, type McpToolDefinition, type McpToolResult } from './server';
import { withProvisional, type ProvisionalEmitter } from './provisional'; // P4-A2 (X35)

// D11: the agent's editing blocks stay outlined this long after its batch commits. P3-F wave S (F19, sitting candidate
// 21): 4 s, was 1.5 s, which the owner missed in two passes; a turn that ends sooner leaves the outline to this hold.
const PRESENCE_EDITING_MS = 4_000;

// What one session's document tools remember between calls: its views of each replica, the kinds whose guide it was
// given (A's `ArtifactSession.guided` once A's tools are here), its presence timers.
export class DocumentToolSession {
  readonly views = new DocumentViews();
  readonly guided: Set<ArtifactKind>;
  readonly presence = new Map<string, ReturnType<typeof setTimeout>>(); // by document key (main or suggestions)

  constructor(guided?: Set<ArtifactKind>) {
    this.guided = guided ?? new Set();
  }
}

export interface DocumentToolDeps {
  artifacts?: () => ArtifactStore | null; // the host's store; null when it failed to open
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, nearest first
  session: DocumentToolSession;
  log?: (line: string) => void;
  now?: () => number;
  presenceEditingMs?: number;
  provisional?: ProvisionalEmitter; // P4-A2 (X35): the session's provisional layer, ended by `artifact_edit`'s commit or its drop
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

// P3-E start (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X25): a dashboard is B's document plus its
// datasets, so these tools serve both kinds; each write reaches the adapter of the artifact's own kind.
type DocumentLikeKind = 'document' | 'dashboard';
const isDocumentLike = (kind: ArtifactKind): kind is DocumentLikeKind => kind === 'document' || kind === 'dashboard';
// P3-E end

// The live document a ref names in the session's lineage (Decision Log 3 of A), answered once its batch committed.
async function documentOf(tool: Tool, store: ArtifactStore, ref: string, ctx: McpToolContext, deps: DocumentToolDeps): Promise<Artifact> {
  const lineage = [ctx.appSessionId, ...(deps.artifactScope ?? [])];
  const artifact = await store.readCommitted(() => {
    const id = store.resolve(ref, lineage);
    return id === null ? null : store.get(id);
  });
  if (!artifact) throw refuse(tool, { reason: 'notFound', artifact: ref }, `no artifact "${ref}" in this session`);
  if (!isDocumentLike(artifact.kind)) throw refuse(tool, { reason: 'invalid', kind: artifact.kind }, `${ref} is a ${artifact.kind} artifact; ${tool} works on documents`); // P3-E: and dashboards
  return artifact;
}

// What a write's ref names now, for its operation's record (§4.3: the tool-use id alone is the operation's identity; A's
// ledger looks a repeated id up by it and answers the recorded result, the artifact id being only what a fresh op files
// its row and its turn result under). Never a refusal: a ref naming nothing live (a handle whose artifact was deleted
// since) still enters the operation, whose replay lookup comes first; a fresh operation refuses it (`liveDocumentIn`).
function opTargetOf(store: ArtifactStore, ref: string, ctx: McpToolContext, deps: DocumentToolDeps): string | null {
  return store.resolve(ref, [ctx.appSessionId, ...(deps.artifactScope ?? [])]);
}

// Inside a fresh operation: the live document the write applies to, refused (after the batch commits) when nothing live
// is named, it was deleted, or it is not a document.
async function liveDocumentIn(tool: Tool, store: ArtifactStore, id: string | null, ref: string): Promise<Artifact> {
  const artifact = id === null ? null : store.get(id);
  if (!artifact) return refusedAfterCommit(store, refuse(tool, { reason: 'notFound', artifact: ref }, `no artifact "${ref}" in this session`));
  if (!isDocumentLike(artifact.kind)) return refusedAfterCommit(store, refuse(tool, { reason: 'invalid', kind: artifact.kind }, `${ref} is a ${artifact.kind} artifact; ${tool} works on documents`)); // P3-E: and dashboards
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

// A document tool as `tools/list` describes it (`MAWS_TOOLS`, which appends `DOCUMENT_TOOLS` after A's), served by `call`.
const definition = (name: DocumentToolName, call: McpToolDefinition['call']): McpToolDefinition => defineMawsTool(name, call);

// ── artifact_edit ────────────────────────────────────────────────────────────────────────────────────────────────

// The writer's refusal as the tool's: the sentence, the reason with what it names, and the live revision (a retry
// from it is validated against what the refusal showed).
const editRefusal = (error: EditError, liveRevision: number): Refusal => refuse('artifact_edit', { ...error.refusal, liveRevision }, error.message);

/** The id of `node` or of its nearest ancestor that has one. */
const blockIdOf = (node: Node | null): string | null => {
  for (let at = node; at; at = at.parent) {
    const id: unknown = at.getAttr('id');
    if (typeof id === 'string') return id;
  }
  return null;
};

/**
 * The blocks a landed batch touched, in op order, as the editor outlines them (D11): each op's resolved target (the
 * block an unscoped quote matched, a cell, a moved block) and the blocks it made (the outermost new ones), never an
 * insert's anchor or a deleted block. Read after the write, when the doc's index holds the new blocks.
 */
function touchedBlocksOf(doc: Doc, ops: readonly Op[], results: readonly { target: string; newIds: string[] }[]): string[] {
  const index = DocIndex.of(doc);
  const out: string[] = [];
  results.forEach((result, i) => {
    const op = ops[i];
    if (op.op === 'delete') return;
    if (op.op !== 'insert') out.push(...result.target.split(','));
    const made = new Set(result.newIds);
    for (const id of result.newIds) {
      const found = index.find(id);
      const parent = found ? blockIdOf(found.node.parent) : null;
      if (found && (parent === null || !made.has(parent))) out.push(id);
    }
  });
  return [...new Set(out)].filter((id) => index.find(id) !== null);
}

/** The agent's cursor at the start of the first touched block's first textblock, as the editors' cursor plugin reads it. */
function cursorAt(doc: Doc, blockId: string | undefined): { anchor: unknown; head: unknown } | undefined {
  const found = blockId === undefined ? null : DocIndex.of(doc).find(blockId);
  const textblock = found ? textblocksY(found.node)[0] : undefined;
  if (!textblock) return undefined;
  const at = relativePositionToJSON(createRelativePositionFromTypeIndex(textblock, 0));
  return { anchor: at, head: at };
}

// A session's first proposal starts from its base read, not from another session's unseen proposals. Compare only
// the targets whose operations require a read; quoted edits validate themselves and inserts/moves use live anchors.
function checkProposalTargets(base: Doc, proposal: Doc, ops: readonly Op[]): void {
  const before = DocIndex.of(base);
  const next = DocIndex.of(proposal);
  const stale = new Map<string, string>();
  const same = (a: Node | undefined, b: Node | undefined) => JSON.stringify(a?.toDelta()) === JSON.stringify(b?.toDelta());
  const children = (node: Node | undefined) => node?.toArray() as Node[] | undefined;
  const structure = (node: Node | undefined) => children(node)?.map((child) => [child.name, child.getAttr('id')]);
  for (const op of ops) {
    if (op.op !== 'replace_block' && op.op !== 'delete' && op.op !== 'set_cell') continue;
    const id = op.op === 'set_cell' ? op.table : op.id;
    const a = before.find(id)?.node;
    const b = next.find(id);
    let changed = !same(a, b?.node);
    if (op.op === 'set_cell') {
      const ar = children(a)?.[op.row];
      const br = children(b?.node)?.[op.row];
      changed = JSON.stringify(structure(a)) !== JSON.stringify(structure(b?.node)) || JSON.stringify(structure(ar)) !== JSON.stringify(structure(br)) || !same(children(ar)?.[op.col], children(br)?.[op.col]);
    }
    if (changed) stale.set(id, b ? next.md(b.top) : '(removed in suggestions)');
  }
  if (stale.size) throw new EditError({ reason: 'staleTargets', blocks: [...stale].map(([id, text]) => ({ id, text })) }, 'the proposal targets changed since the base read; use the shown text or quote with replace_text');
}

// A suggested batch's answer belongs in the main document's thread as the session's message (D14), but A's service
// writes one document per savepoint (its frames do not nest), so the proposal and that reply cannot be all-or-none: a
// throw in the second write would leave the first standing without its op row. Refused before anything is written
// until A's service can write both in one savepoint (M9 addendum fix wave).
const SUGGESTED_ANSWER =
  "answering is not available on a suggested batch: the proposal and its reply in the main document's thread cannot land as one write; send the batch without answering, then reply with artifact_reply";

export function artifactEditTool(deps: DocumentToolDeps): McpToolDefinition {
  const TOOL = 'artifact_edit';
  const now = deps.now ?? Date.now;
  // P4-A2 (X35, R8): the call's provisional layer ends with it: committed from the write's frame, dropped otherwise
  return definition(TOOL, (args, ctx) => withProvisional(deps.provisional, ctx.toolUseId, () =>
    answering(TOOL, async () => {
      const parsed = parseDocumentArguments(TOOL, ArtifactEditInputSchema, args);
      if (!parsed.ok) return toolError(parsed.error);
      const input = parsed.data;
      const store = storeOf(TOOL, deps);
      const target = opTargetOf(store, input.artifact, ctx, deps);
      const ops = input.ops as Op[];
      const actor = actorOf(ctx);
      const presence = actorDisplay(actor);
      const shown: { agent?: AgentReplica; id?: string } = {}; // the replica whose presence the batch published, and its artifact
      // Everything that reads the store's current state runs inside the operation, after its replay lookup.
      const written = store.writeCommitted(() =>
        store.withOp(
          opIdOf(ctx),
          TOOL,
          target,
          async (op) => {
            if (!documentAdapterOf(store)) throw refuse(TOOL, { reason: 'unavailable' }, 'documents are not registered with the artifact store in this run of MAWS');
            const artifact = await liveDocumentIn(TOOL, store, target, input.artifact);
            // P3-E: the adapter of the artifact's own kind, whose hooks take the carries this batch registers
            const adapter = documentAdapterOf(store, artifact.kind as DocumentLikeKind);
            if (!adapter) throw refuse(TOOL, { reason: 'unavailable' }, `${artifact.kind}s are not registered with the artifact store in this run of MAWS`);
            const id = artifact.id;
            const suggesting = input.mode === 'suggest' || artifact.agentEditsAsSuggestions;
            if (suggesting && input.answering !== undefined) return refusedAfterCommit(store, refuse(TOOL, { reason: 'invalid', message: SUGGESTED_ANSWER }, SUGGESTED_ANSWER));
            const writeId = suggesting ? store.service.suggestionDoc(id) : id;
            const live = store.revision(id);
            if (input.baseRevision > live) return refusedAfterCommit(store, refuse(TOOL, { reason: 'invalid', liveRevision: live }, `baseRevision ${input.baseRevision} is newer than the live revision ${live}`));
            const restoredSince = store.listVersions(id).some((version) => version.kind === 'restore' && version.seq > input.baseRevision);
            const agent = store.service.replica(ctx.appSessionId, writeId); // keeps the document loaded; carets; presence
            const outcome: { result?: ArtifactEditResult; refusal?: Refusal; doc?: Doc } = {};
            await store.service.writeAs(
              writeId,
              actor,
              (doc) => {
                outcome.doc = doc;
                // P3-E (E2 M2 fix wave R1): a dashboard made from files before E2 is held, checked here, at the write
                // itself and after the operation's replay lookup; the batch writes nothing
                const held = artifact.kind === 'dashboard' ? legacyDashboardFiles(doc) : null;
                if (held) {
                  outcome.refusal = refuse(TOOL, { reason: 'invalid', kind: 'dashboard', held }, `${input.artifact}: ${legacyDashboardReason(held)}; nothing was written`);
                  return;
                }
                const view = deps.session.views.base(doc, input.baseRevision);
                try {
                  // A first proposal has no view of its own yet. Validate against the main replica the session
                  // read before applying to the proposal replica; never pretend its unrelated index epoch is a read.
                  if (suggesting && !view) {
                    store.service.readAs(id, actor, (base) => {
                      const seen = deps.session.views.base(base, input.baseRevision);
                      precheckEdit(base, ops, { since: seen?.epoch ?? -1, restoredAway: restoredSince ? seen?.ids : undefined });
                      checkProposalTargets(base, doc, ops);
                    });
                  }
                  const specsBefore = artifact.kind === 'dashboard' ? chartSpecsBefore(doc) : null; // P3-E (E2 M3)
                  const applied = applyEdit(doc, ops, {
                    since: view?.epoch ?? (suggesting ? undefined : -1), // a base the session never saw here: every checked target counts as changed
                    carets: caretsOf(agent.provider.awareness.getStates(), doc, agent.provider.awareness.clientID),
                    restoredAway: restoredSince && view ? view.ids : undefined,
                    answering: input.answering,
                    blocksPerTab: DOCUMENT_LIMITS.blocksPerTab,
                  });
                  adapter.registerCarries(writeId, applied.carries);
                  // P3-E (E2 M3; E's Decision Log 9): a dashboard's chart specs this batch wrote, normalised in its frame
                  const written = specsBefore ? normalizeChartSpecs(doc, specsBefore) : [];
                  let answered: ArtifactEditResult['answered'];
                  if (applied.answer) {
                    const messageId = `${applied.answer.threadId}:${nanoid8()}`;
                    reply(doc, applied.answer.threadId, { id: messageId, by: actor, at: now(), body: applied.answer.body });
                    answered = { threadId: applied.answer.threadId, messageId };
                  }
                  outcome.result = { status: 'edited', artifactId: id, revision: 0, results: applied.results, orphaned: applied.orphaned, ...(answered && { answered }), ...(written.length > 0 && { viewWarnings: written }) /* P3-E */ };
                } catch (error) {
                  if (!(error instanceof EditError)) throw error;
                  const liveRevision = store.service.revision(id);
                  if (error.reason === 'staleTargets') deps.session.views.record(doc, liveRevision); // the refusal showed the targets as they are now
                  outcome.refusal = editRefusal(error, liveRevision);
                }
              },
              {
                inFrame: (at, { edited }) => {
                  if (!outcome.result || !outcome.doc) return;
                  outcome.result.revision = suggesting ? store.service.revision(id) : at;
                  deps.session.views.record(outcome.doc, outcome.result.revision); // the session's own write is a revision it knows
                  op.record(outcome.result);
                  // D11: the agent's cursor and the blocks it touched, published with the write (nothing of it is
                  // revealed before this frame commits), dropped PRESENCE_EDITING_MS after
                  const blocks = touchedBlocksOf(outcome.doc, ops, outcome.result.results);
                  const cursor = cursorAt(outcome.doc, blocks[0]);
                  clearTimeout(deps.session.presence.get(writeId));
                  agent.setPresence({ ...presence, ...(cursor && { cursor }), editing: { blocks } });
                  store.service.holdPresence(agent); // P3-F (F19): a turn end leaves it to the hold
                  // P4-A2 (X35 rule 2): the layer's committed notice, ahead of this write's frames, names the batch's own
                  // row; a batch that changed nothing has none to wait for, and its layer goes now
                  if (ctx.toolUseId !== null) {
                    if (edited !== null) deps.provisional?.committed(ctx.toolUseId, writeId, edited);
                    else deps.provisional?.uncommitted(ctx.toolUseId, writeId);
                  }
                  shown.agent = agent;
                  shown.id = writeId;
                },
              },
            );
            if (outcome.refusal) return refusedAfterCommit(store, outcome.refusal);
            await store.link(id, ctx.appSessionId, 'edited');
            return outcome.result!;
          },
          { actor },
        ),
      );
      const result = await written.catch((error: unknown) => {
        if (shown.agent) store.service.releasePresence(shown.agent, presence); // P3-F (F19): published in a frame that did not commit; nothing to hold
        throw error;
      });
      const { agent, id } = shown;
      if (agent && id) {
        const timer = setTimeout(() => {
          deps.session.presence.delete(id);
          if (deps.provisional?.presenting(id)) return; // P4-A2 (R6): a later call streaming here shows its outline; its ending releases it
          store.service.releasePresence(agent, presence); // nothing at all once the session's turn ended
        }, deps.presenceEditingMs ?? PRESENCE_EDITING_MS);
        timer.unref?.();
        deps.session.presence.set(id, timer);
      }
      return toolText(result);
    })),
  );
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

// P3-C start (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M7 fix wave 1; the architect's ruling, the
// child's Decision Log 35): one orchestration for the three thread tools, extracted from B's own so a presentation's
// wrappers (src/engine-host/presentations/threads.ts) share it rather than copy it.
//
// Contract. `threadTool(tool, deps, ops)` serves `artifact_comments`, `artifact_reply` or `artifact_resolve` for the
// artifacts of kind `ops.kind`: it parses the call with B's schema, resolves `artifact` in the session's lineage and
// refuses (in B's words and reasons: `unavailable`, `notFound`, `invalid` with the kind) a store that is not there, a ref
// that names nothing, or an artifact of another kind. A listing reads the live doc behind the read barrier and answers
// `{status: 'listed', artifactId, revision, threads}` with `ops.list`'s threads. A reply or a resolve is one write as the
// session on its host replica inside `store.withOp` (a repeated tool-use id answers the first result), refused
// `notFound` when `ops.has` finds no such thread, writing nothing when the thread is already in the state asked for (its
// answer recorded alone), linking the session `edited` after a write. `ops` owns the kind's thread model only: listing,
// lookup, status, and the reply, resolve and reopen writes.
export interface ThreadKindOps {
  kind: ArtifactKind;
  list(doc: Doc, status: 'open' | 'resolved' | 'all', self: AppSessionId): unknown[];
  has(doc: Doc, threadId: string): boolean;
  status(doc: Doc, threadId: string): 'open' | 'resolved';
  reply(doc: Doc, threadId: string, message: { id: string; by: Actor; at: number; body: string }): void;
  resolve(doc: Doc, threadId: string, by: Actor, at: number): void;
  reopen(doc: Doc, threadId: string, by: Actor, at: number): void;
}

export function threadTool(tool: 'artifact_comments' | 'artifact_reply' | 'artifact_resolve', deps: DocumentToolDeps, ops: ThreadKindOps): McpToolDefinition {
  const now = deps.now ?? Date.now;
  const lineage = (ctx: McpToolContext) => [ctx.appSessionId, ...(deps.artifactScope ?? [])];
  const wrongKind = (ref: string, kind: ArtifactKind) => refuse(tool, { reason: 'invalid', kind }, `${ref} is a ${kind} artifact; ${tool} works on ${ops.kind}s`);
  // One write to a thread as the session, recorded with its answer; a change that writes nothing (resolving a resolved
  // thread) records its answer alone.
  const write = async <R extends { revision: number }>(
    ref: string,
    threadId: string,
    ctx: McpToolContext,
    change: (doc: Doc, artifact: Artifact) => Omit<R, 'revision'> | { unchanged: Omit<R, 'revision'> },
  ): Promise<R> => {
    const store = storeOf(tool, deps);
    const target = store.resolve(ref, lineage(ctx));
    const actor = actorOf(ctx);
    return store.writeCommitted(() =>
      store.withOp(
        opIdOf(ctx),
        tool,
        target,
        async (op) => {
          const artifact = target === null ? null : store.get(target);
          if (!artifact) return refusedAfterCommit(store, refuse(tool, { reason: 'notFound', artifact: ref }, `no artifact "${ref}" in this session`));
          if (artifact.kind !== ops.kind) return refusedAfterCommit(store, wrongKind(ref, artifact.kind));
          const outcome: { answer?: Omit<R, 'revision'>; unchanged?: Omit<R, 'revision'>; missing?: boolean; result?: R } = {};
          await store.service.writeAs(
            artifact.id,
            actor,
            (doc) => {
              if (!ops.has(doc, threadId)) {
                outcome.missing = true;
                return;
              }
              const written = change(doc, artifact);
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
  };
  const calls: Record<typeof tool, McpToolDefinition['call']> = {
    artifact_comments: (args, ctx) =>
      answering(tool, async () => {
        const parsed = parseDocumentArguments(tool, ArtifactCommentsInputSchema, args);
        if (!parsed.ok) return toolError(parsed.error);
        const { status = 'open' } = parsed.data;
        const store = storeOf(tool, deps);
        const ref = parsed.data.artifact;
        const artifact = await store.readCommitted(() => {
          const id = store.resolve(ref, lineage(ctx));
          return id === null ? null : store.get(id);
        });
        if (!artifact) throw refuse(tool, { reason: 'notFound', artifact: ref }, `no artifact "${ref}" in this session`);
        if (artifact.kind !== ops.kind) throw wrongKind(ref, artifact.kind);
        const result = await store.readCommitted(() => {
          const doc = store.service.live(artifact.id);
          return { status: 'listed' as const, artifactId: artifact.id, revision: store.revision(artifact.id), threads: ops.list(doc, status, ctx.appSessionId) };
        });
        return toolText(result);
      }),
    artifact_reply: (args, ctx) =>
      answering(tool, async () => {
        const parsed = parseDocumentArguments(tool, ArtifactReplyInputSchema, args);
        if (!parsed.ok) return toolError(parsed.error);
        const { threadId, body } = parsed.data;
        const result = await write<ArtifactReplyResult>(parsed.data.artifact, threadId, ctx, (doc, artifact) => {
          const messageId = `${threadId}:${nanoid8()}`;
          ops.reply(doc, threadId, { id: messageId, by: actorOf(ctx), at: now(), body });
          return { status: 'replied', artifactId: artifact.id, threadId, messageId, threadStatus: ops.status(doc, threadId), line: `replied on c:${threadId}` };
        });
        return toolText(result);
      }),
    artifact_resolve: (args, ctx) =>
      answering(tool, async () => {
        const parsed = parseDocumentArguments(tool, ArtifactResolveInputSchema, args);
        if (!parsed.ok) return toolError(parsed.error);
        const { threadId, reopen: opening = false } = parsed.data;
        const result = await write<ArtifactResolveResult>(parsed.data.artifact, threadId, ctx, (doc, artifact) => {
          const answer = { status: opening ? 'reopened' : 'resolved', artifactId: artifact.id, threadId, line: `${opening ? 'reopened' : 'resolved'} c:${threadId}` } as const;
          if (ops.status(doc, threadId) === (opening ? 'open' : 'resolved')) return { unchanged: answer };
          if (opening) ops.reopen(doc, threadId, actorOf(ctx), now());
          else ops.resolve(doc, threadId, actorOf(ctx), now());
          return answer;
        });
        return toolText(result);
      }),
  };
  return definition(tool, calls[tool]);
}

// B's thread model, as the helper takes it (P3-E: exported, a dashboard's threads being a document's).
export const DOCUMENT_THREADS: ThreadKindOps = {
  kind: 'document',
  list: (doc, status, self) => threadStates(doc, liveThreadIds(doc)).filter((thread) => status === 'all' || thread.status === status).map((thread) => listed(doc, thread, self)),
  has: (doc, threadId) => getThread(doc, threadId) !== null,
  status: (doc, threadId) => getThread(doc, threadId)!.status,
  reply: (doc, threadId, message) => reply(doc, threadId, message),
  resolve: (doc, threadId, by, at) => resolveThread(doc, threadId, by, at),
  reopen: (doc, threadId, by, at) => reopen(doc, threadId, by, at),
};
// P3-C end

export function artifactCommentsTool(deps: DocumentToolDeps): McpToolDefinition {
  return threadTool('artifact_comments', deps, DOCUMENT_THREADS); // P3-C: through the shared helper
}

export function artifactReplyTool(deps: DocumentToolDeps): McpToolDefinition {
  return threadTool('artifact_reply', deps, DOCUMENT_THREADS); // P3-C: through the shared helper
}

export function artifactResolveTool(deps: DocumentToolDeps): McpToolDefinition {
  return threadTool('artifact_resolve', deps, DOCUMENT_THREADS); // P3-C: through the shared helper
}

// ── artifact_read (a document) ──────────────────────────────────────────────────────────────────────────────────

const VERSIONS_LISTED = 10; // a read lists this many of the latest versions (A's read does too)

function versionSummary(version: ArtifactVersion, self: AppSessionId): DocumentVersionSummary {
  return { id: version.id, kind: version.kind, revision: version.seq, at: iso(version.at), by: authorOf(version.actor, self).by, ...(version.label !== undefined && { label: version.label }) };
}

const readRefusal = (error: ReadError): Refusal => refuse('artifact_read', { reason: error.reason, target: error.target }, error.message);

/** A document's `artifact_read`, parsed by the shared parser (A's schema, with the document fields); `fallback` answers
 * every other kind (A's tool). */
export function documentReadTool(deps: DocumentToolDeps, fallback?: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_read';
  const call: McpToolDefinition['call'] = (args, ctx) =>
      answering(TOOL, async () => {
        if (fallback && !(await namesDocument(deps, args, ctx))) return fallback.call(args, ctx);
        const parsed = parseToolArguments(TOOL, args);
        if (!parsed.ok) return toolError(parsed.error);
        const input = parsed.data;
        const store = storeOf(TOOL, deps);
        const artifact = await documentOf(TOOL, store, input.artifact, ctx, deps);
        if (input.revision !== undefined || input.paths !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'a document is read by tab, range and sinceRevision (or a retained version), not by revision or paths');
        const options = { tab: input.tab, from: input.from, count: input.count ?? DOCUMENT_LIMITS.readCount };
        const versions = await store.readCommitted(() => store.listVersions(artifact.id).slice(-VERSIONS_LISTED).reverse().map((version) => versionSummary(version, ctx.appSessionId)));
        const head = { status: 'read' as const, artifactId: artifact.id, kind: artifact.kind as DocumentLikeKind /* P3-E */, title: artifact.title, ...(artifact.handle !== undefined && { handle: artifact.handle }), versions };
        // P3-E: a dashboard's read closes with its datasets as the read doc holds them (the footer of the parent's §2)
        const footer = (doc: Doc) => {
          if (artifact.kind !== 'dashboard') return {};
          const warnings = viewWarnings(doc); // E2 M3: a retained spec's problems, read only (E's Decision Log 9)
          return { datasets: datasetFooter(doc, (actor) => authorOf(actor, ctx.appSessionId)), ...(warnings.length > 0 && { viewWarnings: warnings }) };
        };
        let result: DocumentReadResult;
        if (input.version !== undefined) {
          if (input.sinceRevision !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'a retained version is read whole, without sinceRevision');
          const read = await store.readCommitted(() => {
            const version = store.versions.version(artifact.id, input.version!);
            if (!version) throw refuse(TOOL, { reason: 'notFound', version: input.version }, `version ${input.version} does not exist`);
            const doc = newDoc();
            try {
              applyV2(doc, store.versionState(artifact.id, version.id));
              return { version, live: store.revision(artifact.id), read: readDocument(doc, options), footer: footer(doc) /* P3-E */ };
            } catch (error) {
              if (error instanceof ReadError) throw readRefusal(error);
              throw error;
            } finally {
              doc.destroy();
            }
          });
          // the live revision, as every read answers (§4.3); the version's own in its summary. A version read records no
          // view, so a batch from this revision is validated as from a base the session never saw
          result = { ...head, revision: read.live, ...publicRead(read.read), version: versionSummary(read.version, ctx.appSessionId), ...read.footer /* P3-E */ };
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
            return { revision, read, since, footer: footer(doc) /* P3-E */ };
          }).catch((error: unknown) => {
            throw error instanceof ReadError ? readRefusal(error) : error;
          });
          result = { ...head, revision: read.revision, ...publicRead(read.read), ...(input.sinceRevision !== undefined && { sinceRevision: input.sinceRevision }), ...read.since, ...read.footer /* P3-E */ };
          // a store a newer MAWS wrote is read-only: the read stands, its viewed link is not recorded (A's reader's rule)
          if (!store.storage.readOnly) await store.writeCommitted(() => store.link(artifact.id, ctx.appSessionId, 'viewed'));
        }
        return toolText(result);
      });
  return fallback ? { ...fallback, call } : defineMawsTool(TOOL, call);
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
    const kind = id === null ? undefined : store.get(id)?.kind;
    return kind !== undefined && isDocumentLike(kind); // P3-E: a dashboard too
  });
}

// ── artifact_create (a document) ────────────────────────────────────────────────────────────────────────────────

/** A document's `artifact_create`, parsed by the shared parser (A's schema admits a document's `content`); `fallback`
 * answers every other kind (A's tool). */
export function documentCreateTool(deps: DocumentToolDeps, fallback?: McpToolDefinition): McpToolDefinition {
  const TOOL = 'artifact_create';
  const call: McpToolDefinition['call'] = (args, ctx) =>
      answering(TOOL, async () => {
        const asked = (args as { kind?: unknown } | null)?.kind;
        if (fallback && asked !== 'document' && asked !== 'dashboard' /* P3-E */) return fallback.call(args, ctx);
        const parsed = parseToolArguments(TOOL, args);
        if (!parsed.ok) return toolError(parsed.error);
        const input = parsed.data;
        if (input.kind === undefined || !isDocumentLike(input.kind)) throw refuse(TOOL, { reason: 'invalid', kind: input.kind ?? 'html' }, 'this tool creates documents'); // P3-E: and dashboards
        const kind = input.kind; // P3-E: the kind created, answered and guided
        if (input.files !== undefined) throw refuse(TOOL, { reason: 'invalid', kind }, `a ${kind} artifact takes markdown content, not files`); // P3-E: A's schema lets a dashboard's through
        if (input.content !== undefined && input.content.length > DOCUMENT_LIMITS.markdownChars) {
          throw refuse(TOOL, { reason: 'invalid' }, `the content is ${input.content.length} characters; a document's content is at most ${DOCUMENT_LIMITS.markdownChars}`);
        }
        if (input.id !== undefined && input.handle !== undefined) throw refuse(TOOL, { reason: 'invalid' }, 'give handle or id (its older name), not both');
        const handle = input.handle ?? input.id;
        const store = storeOf(TOOL, deps);
        const actor = actorOf(ctx);
        // a repeated call answers what the first one did, before anything that may have moved since is read (§4.3; A's
        // generic create)
        const replayed = await store.replayOf(opIdOf(ctx));
        if (replayed.found) {
          deps.session.guided.add(kind); // P3-E
          return toolText(replayed.result);
        }
        const space = await spaceNamed(store, input.space, (refusal, sentence) => refuse(TOOL, refusal, sentence)); // P3-F wave S (F5)
        let body: ReturnType<typeof importMarkdown>;
        try {
          body = importMarkdown(input.content ?? '');
        } catch (error) {
          throw refuse(TOOL, { reason: 'invalid' }, `the content is not the document kind's markdown: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (body.childCount > DOCUMENT_LIMITS.blocksPerTab) {
          throw refuse(TOOL, { reason: 'invalid', blocks: body.childCount }, `the content holds ${body.childCount} top-level blocks; a tab takes at most ${DOCUMENT_LIMITS.blocksPerTab}: create the document with less and insert the rest elsewhere, or split it`);
        }
        // the answer's context, settled before the write so the recorded answer is the whole first answer: the guide when
        // this session has not had it, the governing system's guide (a new document has no system of its own, and the
        // Space it is made in, if any)
        const guide = deps.session.guided.has(kind) ? undefined : KIND_GUIDES[kind]; // P3-E: by kind
        const designSystem = await store.designSystemContextFor(space ? { spaceId: space.id } : {});
        const created = await store.writeCommitted(() =>
          store.withOp(
            opIdOf(ctx),
            TOOL,
            null,
            async (op) => {
              // the handle is checked inside the operation, after its replay lookup: a repeated call answers its result
              if (handle !== undefined) {
                const taken = store.resolve(handle, [ctx.appSessionId]) ? 'this session' : deps.artifactScope?.length && store.resolve(handle, deps.artifactScope) ? 'the conversation this side thread was opened from' : null;
                if (taken) return refusedAfterCommit(store, refuse(TOOL, { reason: 'handleTaken', handle }, `an artifact "${handle}" already exists in ${taken}; edit it with artifact_edit`));
              }
              const made: { doc?: Doc; answer?: Record<string, unknown> & { artifactId: string }; viewWarnings?: ViewWarning[] /* P3-E */ } = {};
              // The first tab is the create's `initial` (so the kind's seed hook writes none), written through the session's
              // host replica in the savepoint of the entity row, the answer recorded in it too: the artifact commits with
              // its content and its op row or not at all (P3-F, artifact-protocol finding 2)
              await store.create(
                {
                  kind /* P3-E */, title: input.title, ...(handle !== undefined && { handle }), ...(space && { spaceId: space.id }) /* F5 */,
                  initial: (doc) => {
                    made.doc = doc;
                    createDocument(doc, { title: input.title, body });
                    if (kind === 'dashboard') made.viewWarnings = normalizeChartSpecs(doc, new Map()); // P3-E (E2 M3): in the create's frame
                  },
                },
                actor,
                (artifact) => {
                  const revision = store.revision(artifact.id);
                  made.answer = {
                    status: 'created', kind /* P3-E */, artifactId: artifact.id, title: artifact.title, revision, ...(handle !== undefined && { handle }),
                    ...(guide && { guide }), ...(designSystem !== null && { designSystem }),
                    ...(made.viewWarnings?.length && { viewWarnings: made.viewWarnings }), // P3-E (E2 M3)
                    ...spaceFields(space), // F5
                  };
                  if (made.doc) deps.session.views.record(made.doc, revision);
                  op.record(made.answer);
                },
              );
              return made.answer!;
            },
            { actor },
          ),
        );
        deps.session.guided.add(kind); // P3-E
        store.service.replica(ctx.appSessionId, created.artifactId); // the session's replica keeps the document loaded
        return toolText(created);
      });
  return fallback ? { ...fallback, call } : defineMawsTool(TOOL, call);
}

/** The four document tools, in `tools/list` order (appended after A's artifact tools). */
export function documentTools(deps: DocumentToolDeps): McpToolDefinition[] {
  return [artifactEditTool(deps), artifactCommentsTool(deps), artifactReplyTool(deps), artifactResolveTool(deps)];
}
