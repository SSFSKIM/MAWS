// The document tools through their `call` with an `McpToolContext` (A's pattern), over A's real store with the document
// kind registered (M7's Proves of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; D7, D14; §4.4 [binding]).
import * as awarenessProtocol from '@y/protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { charSlots } from '@artifacts/document/structs';
import { insertedBy, carriedBy } from '@artifacts/yjs';
import { DocIndex } from '@artifacts/document/block-index';
import { fingerprint } from '@artifacts/document/fingerprint';
import { schemaFor } from '@artifacts/document/schema';
import { getThread, locate, liveThreadIds } from '@artifacts/document/threads';
import { body, nodeOf, pmOf, seedDoc, TAB, textOf } from '@artifacts/document/writer.fixture';
import { createAbsolutePositionFromRelativePosition, createRelativePositionFromJSON, createRelativePositionFromTypeIndex, relativePositionToJSON } from '@artifacts/yjs/document';
import { pmnodeToDelta } from '@artifacts/yjs/prosemirror';
import { applyV1, diffV1, stateV2, transact } from '@artifacts/yjs';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import committedFingerprint from '@artifacts/document/fingerprint.json';
import { onSessionReplica, isWarming } from '../documents/kinds/document-host';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { artifactCommentsTool, artifactEditTool, artifactReplyTool, artifactResolveTool, documentCreateTool, documentReadTool, DocumentToolSession, type DocumentToolDeps } from './documents';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';

const SELF = 'app-self' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;
let world: DocumentWorld;
let session: DocumentToolSession;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  session = new DocumentToolSession();
});
afterEach(() => world.close());

const deps = (over: Partial<DocumentToolDeps> = {}): DocumentToolDeps => ({ artifacts: () => world.store, session, presenceEditingMs: 20, ...over });
const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const textOfResult = (result: McpToolResult): string => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${textOfResult(result)}`);
  return JSON.parse(textOfResult(result)) as T;
};
/** A refusal's machine-readable part. */
const refusalOf = (result: McpToolResult): Record<string, unknown> => {
  expect(result.isError).toBe(true);
  const text = textOfResult(result);
  return JSON.parse(text.slice(text.indexOf(' {"reason":') + 1)) as Record<string, unknown>;
};
const call = (tool: McpToolDefinition, args: unknown, over: Partial<McpToolContext> = {}) => tool.call(args, ctx(over));
const read = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => call(documentReadTool(deps()), args, over);
const edit = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => call(artifactEditTool(deps()), args, over);
const live = (id: string) => world.service.live(id);
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A seeded document the session has read (its view recorded); answers the id and the read's revision. */
async function readSeed(): Promise<{ id: string; revision: number }> {
  const id = await world.seeded();
  const answer = json<{ revision: number }>(await read({ artifact: id }));
  return { id, revision: answer.revision };
}

describe('artifact_create of a document', () => {
  it('parses the content as the kind’s markdown into the first tab, ids kept, the guide given once per session', async () => {
    const create = documentCreateTool(deps());
    const first = json<{ artifactId: string; revision: number; guide?: unknown; kind: string }>(await call(create, { kind: 'document', title: 'Brief', content: '# Brief ^h1\n\nThe plan ships **quarterly**. ^p1\n\n- one ^li1\n- two ^li2\n^ul1' }));
    expect(first.kind).toBe('document');
    expect(first.revision).toBeGreaterThan(0);
    expect(first.guide).toEqual(KIND_GUIDES.document);
    const doc = live(first.artifactId);
    expect(DocIndex.of(doc).tops(DocIndex.of(doc).tabIds()[0]).map((top) => top.id)).toEqual(['h1', 'p1', 'ul1']);
    expect(textOf(doc, 'p1')).toBe('The plan ships quarterly.');
    const second = json<{ guide?: unknown }>(await call(create, { kind: 'document', title: 'Empty' }));
    expect(second.guide).toBeUndefined();
  });

  it('answers a repeated tool-use id with the first result and creates one artifact', async () => {
    const create = documentCreateTool(deps());
    const toolUseId = 'toolu_create_once' as ToolUseId;
    const a = json(await call(create, { kind: 'document', title: 'Once', content: 'Text.' }, { toolUseId }));
    const b = json(await call(create, { kind: 'document', title: 'Once', content: 'Text.' }, { toolUseId }));
    expect(b.artifactId).toBe(a.artifactId);
    expect(world.store.list({ kind: 'document' }).filter((artifact) => artifact.title === 'Once')).toHaveLength(1);
  });

  it('hands every other kind to the tool it wraps', async () => {
    const fallback: McpToolDefinition = { name: 'artifact_create', title: 'A', description: 'A', inputSchema: {}, annotations: {}, call: async () => ({ content: [{ type: 'text', text: 'A answered' }] }) };
    expect(textOfResult(await call(documentCreateTool(deps(), fallback), { kind: 'html', title: 'x', content: '<p>x</p>' }))).toBe('A answered');
  });
});

describe('artifact_read of a document', () => {
  it('returns D7’s read: the live revision, the tabs, one tab’s markdown with ids and the comments footer', async () => {
    const id = await world.seeded();
    const answer = json<{ revision: number; tabs: unknown; tab: string; markdown: string; next: string | null }>(await read({ artifact: id }));
    expect(answer.revision).toBe(world.store.revision(id));
    expect(answer.tabs).toEqual([{ id: TAB, title: 'Plan', blocks: 8 }]);
    expect(answer.markdown).toContain('A plain paragraph the human types into. <c:t4>Words</c:t4> to keep. ^p3');
    expect(answer.markdown).toContain('---\nComments: 4 open');
    const ranged = json<{ markdown: string; next: string }>(await read({ artifact: id, from: 'p2', count: 2 }));
    expect(ranged.markdown.startsWith('The review is <c:t3>scheduled for Friday</c:t3>')).toBe(true);
    expect(ranged.next).toBe('l1');
  });

  // M9's fix wave (A's M7): a read reaches the session's host replica through A's `readAs`, opening no write frame
  // (until then a `writeAs` that wrote nothing stood in for it).
  it('reads on the session’s host replica without a write', async () => {
    const id = await world.seeded();
    const writes = vi.spyOn(world.service, 'writeAs');
    const reads = vi.spyOn(world.service, 'readAs');
    json(await read({ artifact: id, count: 1 }));
    expect(writes).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalled();
  });

  it('warms the replica the session’s batches are planned on: every block of every tab, in slices after the read', async () => {
    const id = await world.seeded();
    await read({ artifact: id, count: 1 });
    const replica = await onSessionReplica(world.store, id, { kind: 'session', appSessionId: SELF }, (doc) => doc);
    for (let i = 0; i < 50 && isWarming(replica); i++) await settle();
    const index = DocIndex.of(replica);
    expect(index.tabIds().flatMap((tab) => index.tops(tab)).every((top) => top.textCache !== null)).toBe(true);
  });

  it('sinceRevision returns only the blocks changed since, and the blocks deleted', async () => {
    const { id, revision } = await readSeed();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p2').insert(0, 'Note: ')));
    person.edit((doc) => transact(doc, () => body(doc).delete(7, 1))); // p4
    await world.service.whenCommitted();
    const since = json<{ markdown: string; changed: string[]; deleted: string[]; sinceRevision: number; revision: number }>(await read({ artifact: id, sinceRevision: revision }));
    expect(since.sinceRevision).toBe(revision);
    expect(since.changed).toEqual(['p2']);
    expect(since.deleted).toEqual(['p4']);
    expect(since.markdown.startsWith('Note: The review is')).toBe(true);
    expect(since.markdown).not.toContain('^p1');
    const nothing = json<{ changed: string[]; deleted: string[] }>(await read({ artifact: id, sinceRevision: since.revision }));
    expect(nothing).toMatchObject({ changed: [], deleted: [] });
  });

  it('sinceRevision a session never saw is rebuilt from the log; older than the head checkpoint, the read is whole', async () => {
    const id = await world.seeded();
    const seeded = world.store.revision(id);
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p1').insert(0, 'One: ')));
    await world.service.whenCommitted();
    const edited = world.store.revision(id);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p2').insert(0, 'Two: ')));
    await world.service.whenCommitted();
    const fresh = (since: number) => read({ artifact: id, sinceRevision: since }, { appSessionId: OTHER });
    expect(json(await fresh(edited))).toMatchObject({ changed: ['p2'], deleted: [] });
    await world.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'Checkpoint' }); // the head moves to the live revision
    await world.service.whenCommitted();
    const whole = json<{ complete?: boolean; markdown: string }>(await fresh(seeded));
    expect(whole.complete).toBe(true);
    expect(whole.markdown).toContain('^p1');
  });

  it('reads a retained version read-only', async () => {
    const id = await world.seeded();
    const versionId = (await world.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'v1' }))!;
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p1').insert(0, 'Later: ')));
    await world.service.whenCommitted();
    const answer = json<{ markdown: string; version: { id: number; label: string }; versions: Array<{ id: number; by: string }> }>(await read({ artifact: id, version: versionId }));
    expect(answer.version).toMatchObject({ id: versionId, label: 'v1', by: 'user' });
    expect(answer.versions[0]).toMatchObject({ id: versionId, by: 'user' });
    expect(answer.markdown).not.toContain('Later: ');
  });

  it('refuses an unknown block or tab with what it named', async () => {
    const id = await world.seeded();
    expect(refusalOf(await read({ artifact: id, from: 'nope' }))).toMatchObject({ reason: 'notFound', target: 'nope' });
  });
});

describe('artifact_edit', () => {
  it('applies a batch atomically and answers the new revision, one line per op and the new ids', async () => {
    const { id, revision } = await readSeed();
    const answer = json<{ revision: number; results: Array<{ line: string; newIds: string[] }>; orphaned: string[] }>(
      await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: 'p2', old: 'the owner signs off', new: 'the lead signs off' }, { op: 'insert', after: 'h1', markdown: 'An inserted paragraph.' }] }),
    );
    expect(answer.revision).toBeGreaterThan(revision);
    expect(answer.results).toHaveLength(2);
    expect(answer.results[1].newIds).toHaveLength(1);
    expect(textOf(live(id), 'p2')).toBe('The review is scheduled for Friday and the lead signs off after it.');
    expect(textOf(live(id), answer.results[1].newIds[0])).toBe('An inserted paragraph.');
    expect(world.persistedAuthors(id, answer.results[1].newIds[0])).toEqual(['session:app-self']);
  });

  it('a stale baseRevision with an intact quote applies (quote validation, the person typing elsewhere in the paragraph)', async () => {
    const { id, revision } = await readSeed();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p2').insert(nodeOf(doc, 'p2').length, ' Typed later.')));
    await world.service.whenCommitted();
    json(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: 'p2', old: 'scheduled for Friday', new: 'moved to Monday' }] }));
    expect(textOf(live(id), 'p2')).toBe('The review is moved to Monday and the owner signs off after it. Typed later.');
  });

  it('a changed quote is refused naming the block and its current text, and nothing of the batch lands', async () => {
    const { id, revision } = await readSeed();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p3').delete(2, 'plain '.length)));
    await world.service.whenCommitted();
    const before = stateV2(live(id));
    const liveRevision = world.store.revision(id);
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'p1', markdown: 'Would land first.' }, { op: 'replace_text', block: 'p3', old: 'A plain paragraph', new: 'A rewritten paragraph' }] }));
    expect(refusal).toMatchObject({ reason: 'notFound', opIndex: 1, liveRevision });
    expect(refusal.candidates).toContainEqual({ id: 'p3', text: 'A paragraph the human types into. Words to keep.' });
    expect(stateV2(live(id))).toEqual(before);
    expect(world.store.revision(id)).toBe(liveRevision);
  });

  it('a replace_block whose target changed since the read is refused naming it with its current text', async () => {
    const { id, revision } = await readSeed();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p4').insert(0, 'Edited: ')));
    await world.service.whenCommitted();
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_block', id: 'p4', markdown: 'Replaced.' }] }));
    expect(refusal.reason).toBe('staleTargets');
    expect(JSON.stringify(refusal.blocks)).toContain('Edited: Closing paragraph');
    // the refusal showed the block as it is: a retry from the live revision it named lands
    json(await edit({ artifact: id, baseRevision: refusal.liveRevision as number, ops: [{ op: 'replace_block', id: 'p4', markdown: 'Replaced.' }] }));
    expect(textOf(live(id), 'p4')).toBe('Replaced.');
  });

  it('a base revision this session never saw counts every checked target as changed', async () => {
    const id = await world.seeded();
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: world.store.revision(id), ops: [{ op: 'delete', id: 'p4' }] }));
    expect(refusal.reason).toBe('staleTargets');
  });

  it('answers a repeated tool-use id with the first result and applies the batch once', async () => {
    const { id, revision } = await readSeed();
    const toolUseId = 'toolu_edit_once' as ToolUseId;
    const args = { artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: 'p1', old: 'It has two sentences.', new: 'It has two sentences. Appended once.' }] };
    const a = json(await edit(args, { toolUseId }));
    const b = json(await edit(args, { toolUseId }));
    expect(b).toEqual(a);
    expect(textOf(live(id), 'p1').match(/Appended once/g)).toHaveLength(1);
  });

  it('set_cell refuses a table whose row structure changed since the read', async () => {
    const { id, revision } = await readSeed();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'tb1').delete(1, 1))); // a row removed
    await world.service.whenCommitted();
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '42' }] }));
    expect(refusal.reason).toBe('staleTargets');
    expect(JSON.stringify(refusal.blocks)).toContain('tb1');
  });

  it('a move whose block and passed span both hold a person’s caret answers retry', async () => {
    const { id, revision } = await readSeed();
    const caretIn = (blockId: string) => {
      const end = world.connect(id, HUMAN);
      const awareness = new awarenessProtocol.Awareness(end.doc);
      const at = relativePositionToJSON(createRelativePositionFromTypeIndex(nodeOf(end.doc, blockId), 1));
      awareness.setLocalState({ user: { name: 'Owner', color: '--author-1' }, cursor: { anchor: at, head: at } });
      end.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [end.doc.clientID]));
      return end.doc.clientID;
    };
    const clients = [caretIn('p3'), caretIn('c1')];
    const replica = world.service.replica(SELF, id);
    for (let i = 0; i < 50 && !clients.every((client) => replica.provider.awareness.getStates().has(client)); i++) await settle();
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'move', id: 'p3', after: 'c1' }] }));
    expect(refusal).toMatchObject({ reason: 'retry', opIndex: 0 });
  });

  it('a batch on blocks a restore removed since the read is refused removedByRestore', async () => {
    const id = await world.seeded();
    const versionId = (await world.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'before' }))!;
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => body(doc).insert(1, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'x1' }, content: [{ type: 'text', text: 'Added after the version.' }] }))])));
    await world.service.whenCommitted();
    const { revision } = json<{ revision: number }>(await read({ artifact: id }));
    await world.store.restore(id, versionId, HUMAN);
    const refusal = refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_block', id: 'x1', markdown: 'Rewritten.' }] }));
    expect(refusal).toMatchObject({ reason: 'removedByRestore', blocks: ['x1'] });
  });

  it('answering posts the result lines into the thread as the session’s message, in the same write', async () => {
    const { id, revision } = await readSeed();
    const answer = json<{ answered: { threadId: string; messageId: string } }>(await edit({ artifact: id, baseRevision: revision, answering: 't3', ops: [{ op: 'replace_text', block: 'p2', old: 'scheduled for Friday', new: 'scheduled for Monday' }] }));
    expect(answer.answered.threadId).toBe('t3');
    const message = getThread(live(id), 't3')!.messages.at(-1)!;
    expect(message).toMatchObject({ id: answer.answered.messageId, by: { kind: 'session', appSessionId: SELF } });
    expect(message.body).toContain('^p2');
  });

  it('publishes the agent’s cursor and the blocks the batch touched (an unscoped quote’s block, an insert’s new block), then drops both', async () => {
    const { id, revision } = await readSeed();
    const answer = json<{ results: Array<{ newIds: string[] }> }>(
      await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', old: 'scheduled for Friday', new: 'scheduled for Monday' }, { op: 'insert', after: 'h1', markdown: 'Here.' }] }),
    );
    const inserted = answer.results[1].newIds[0];
    const replica = world.service.replica(SELF, id);
    const state = replica.provider.awareness.getLocalState() as { editing?: { blocks: string[] }; cursor?: { anchor: unknown; head: unknown } };
    expect(state.editing?.blocks).toEqual(['p2', inserted]);
    const at = createAbsolutePositionFromRelativePosition(createRelativePositionFromJSON(state.cursor!.head), live(id), false)!;
    expect((at.type as unknown as { getAttr(key: string): unknown }).getAttr('id')).toBe('p2');
    expect(at.index).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = replica.provider.awareness.getLocalState();
    expect(after).not.toHaveProperty('editing');
    expect(after).not.toHaveProperty('cursor');
    expect(after).toMatchObject({ name: expect.any(String), color: expect.any(String) });
  });

  it('publishes no presence for a refused batch', async () => {
    const { id, revision } = await readSeed();
    refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', old: 'no such words', new: 'x' }] }));
    expect(world.service.replica(SELF, id).provider.awareness.getLocalState() ?? {}).not.toHaveProperty('editing');
  });

  it('the turn’s end writes a turn version whose summary is the batch’s lines', async () => {
    const { id, revision } = await readSeed();
    const answer = json<{ results: Array<{ line: string }> }>(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'delete', id: 'p4' }, { op: 'insert', after: 'h1', markdown: 'Lead.' }] }));
    await world.store.endTurn(SELF);
    const turn = world.store.listVersions(id).find((version) => version.kind === 'turn');
    expect(turn?.summary).toBe(answer.results.map((result) => result.line).join('\n'));
  });

  it('builds every node through the schema module’s one schema (D4, the host half)', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'p1', markdown: '> A quote with **bold** ^q1' }] }));
    const index = DocIndex.of(live(id));
    const pm = index.pm(index.find('q1')!.top);
    expect(pm.type.schema).toBe(schemaFor());
    pm.check();
    expect(fingerprint(pm.type.schema)).toEqual(committedFingerprint);
  });
});

describe('suggestions (D14)', () => {
  const proposal = (id: string) => live(world.service.suggestionDoc(id));
  const blockRange = (id: string, block: string) => {
    const item = nodeOf(proposal(id), block)._item!.id;
    return { start: { client: item.client, clock: item.clock }, end: { client: item.client, clock: item.clock } };
  };

  it('a batch is direct by default', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'Direct.' }] }));
    expect(textOf(live(id), 'p1')).toBe('Direct.');
  });

  it.each(['mode', 'setting', 'setting-over-direct'] as const)('%s routes a batch to suggestions with the base byte-unchanged', async (route) => {
    const { id, revision } = await readSeed();
    const before = stateV2(live(id));
    if (route !== 'mode') await world.store.update(id, { agentEditsAsSuggestions: true });
    json(await edit({ artifact: id, baseRevision: revision, ...(route === 'setting' ? {} : { mode: route === 'mode' ? 'suggest' : 'direct' }), ops: [{ op: 'replace_block', id: 'p1', markdown: 'Suggested.' }] }));
    expect(textOf(proposal(id), 'p1')).toBe('Suggested.');
    expect(stateV2(live(id))).toEqual(before);
  });

  it('Reject leaves the base content byte-unchanged', async () => {
    const { id, revision } = await readSeed();
    const before = JSON.stringify(body(live(id)).toDelta());
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_block', id: 'p1', markdown: 'Suggested.' }] }));
    const node = nodeOf(proposal(id), 'p1');
    let last = node._start!;
    while (last.right) last = last.right;
    await world.service.rejectSuggestion(id, [{ start: node._start!.id, end: last.id }]);
    expect(JSON.stringify(body(live(id)).toDelta())).toBe(before);
    expect(textOf(proposal(id), 'p1')).toBe(textOf(live(id), 'p1'));
  });

  it('Accept credits the suggester through the bound clientID with carry accept', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'insert', after: 'p1', markdown: 'Agent proposal. ^proposal' }] }));
    await world.service.acceptSuggestion(id, [blockRange(id, 'proposal')], HUMAN);
    expect(textOf(live(id), 'proposal')).toBe('Agent proposal.');
    const [client, clock] = charSlots(nodeOf(live(id), 'proposal'))[0].slot;
    expect(insertedBy(world.service.provenance(id), { client, clock })?.actor).toBe(`session:${SELF}`);
    expect(carriedBy(world.service.provenance(id), { client, clock })).toBe('accept');
    expect(world.store.storage.clientActor(id, client)).toEqual({ kind: 'session', appSessionId: SELF });
  });
  it('clears direct and suggestion presence independently when a session switches write modes', async () => {
    const { id, revision } = await readSeed();
    const tool = artifactEditTool(deps({ presenceEditingMs: 200 }));
    const first = json<{ revision: number }>(await call(tool, { artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'Direct presence.' }] }));
    json(await call(tool, { artifact: id, baseRevision: first.revision, mode: 'suggest', ops: [{ op: 'insert', after: 'h1', markdown: 'Suggested presence.' }] }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const key of [id, world.service.suggestionDoc(id)]) expect(world.service.replica(SELF, key).provider.awareness.getLocalState()).not.toHaveProperty('editing');
  });

  it('validates quoted edits against the proposal, not the unchanged base', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_block', id: 'p1', markdown: 'First proposal.' }] }));
    const otherDeps = deps({ session: new DocumentToolSession() });
    json(await call(documentReadTool(otherDeps), { artifact: id }, { appSessionId: OTHER }));
    json(await call(artifactEditTool(otherDeps), { artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_text', block: 'p1', old: 'First proposal.', new: 'Revised proposal.' }] }, { appSessionId: OTHER }));
    expect(textOf(proposal(id), 'p1')).toBe('Revised proposal.');
    expect(textOf(live(id), 'p1')).toContain('The quick brown');
  });

  it('refuses an unread change to a proposal target instead of overwriting another session’s suggestion', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_block', id: 'p1', markdown: 'First proposal.' }] }));
    await read({ artifact: id }, { appSessionId: OTHER });
    // Another session read only the base; it has never seen the proposed replacement.
    const other = new DocumentToolSession();
    const otherDeps = deps({ session: other });
    json(await call(documentReadTool(otherDeps), { artifact: id }, { appSessionId: OTHER }));
    const answer = await call(artifactEditTool(otherDeps), { artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_block', id: 'p1', markdown: 'Overwrite.' }] }, { appSessionId: OTHER });
    expect(refusalOf(answer)).toMatchObject({ reason: 'staleTargets' });
    expect(textOf(proposal(id), 'p1')).toBe('First proposal.');
  });

  it('a suggested retype carries existing authorship through the document adapter', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [{ op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the **lazy** [dog](https://example.com). It has two sentences.' }] }));
    const [client, clock] = charSlots(nodeOf(proposal(id), 'p1'))[0].slot;
    const map = world.service.provenance(world.service.suggestionDoc(id));
    expect(insertedBy(map, { client, clock })?.actor).toBe('human');
    expect(carriedBy(map, { client, clock })).toBe('retype');
  });

  it('Accept preserves rich marks, block attributes and ids, and comment anchors on the real schema', async () => {
    const { id, revision } = await readSeed();
    json(await edit({ artifact: id, baseRevision: revision, mode: 'suggest', ops: [
      { op: 'insert', after: 'h1', markdown: '### Rich **bold** [link](https://example.com) <mark color="#fde68a">highlight</mark> ^rich\n\n:::callout {tone="warn"}\nCareful. ^inside\n:::\n^callout\n\n```ts\nconst n = 1\n```\n^code' },
      { op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the **lazy** [dog](https://example.com). It has two sentences.' },
    ] }));
    const ids = ['rich', 'callout', 'code', 'p1'];
    const expected = ids.map((block) => pmOf(proposal(id), block).toJSON());
    await world.service.acceptSuggestion(id, ids.map((block) => blockRange(id, block)), HUMAN);
    expect(ids.map((block) => pmOf(live(id), block).toJSON())).toEqual(expected);
    const marks: string[] = [];
    pmOf(live(id), 'rich').descendants((node) => { marks.push(...node.marks.map((mark) => mark.type.name)); });
    expect(marks).toEqual(expect.arrayContaining(['bold', 'link', 'highlight']));
    expect(pmOf(live(id), 'rich').attrs.level).toBe(3);
    expect(pmOf(live(id), 'callout').attrs.tone).toBe('warn');
    expect(pmOf(live(id), 'code').attrs.language).toBe('ts');
    for (const threadId of ['t1', 't2']) {
      const thread = getThread(live(id), threadId)!;
      expect(liveThreadIds(live(id)).has(threadId)).toBe(true);
      expect(locate(live(id), thread)).toMatchObject({ how: 'text', blockId: 'p1' });
    }
  });

});

describe('comments: artifact_comments, artifact_reply, artifact_resolve', () => {
  it('lists the open threads, orphans included, with their messages; resolved ones on request', async () => {
    const id = await world.seeded();
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p3').delete(nodeOf(doc, 'p3').length - 'Words to keep.'.length, 'Words'.length))); // t4's text gone
    await world.service.whenCommitted();
    const open = json<{ threads: Array<{ threadId: string; orphaned: boolean; block: string | null; messages: Array<{ by: string; body: string }> }> }>(await call(artifactCommentsTool(deps()), { artifact: id }));
    expect(open.threads.map((thread) => thread.threadId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(open.threads.find((thread) => thread.threadId === 't4')).toMatchObject({ orphaned: true, block: 'p3' });
    expect(open.threads[0].messages[0]).toMatchObject({ by: 'user', body: 'About "quick brown"' });
    json(await call(artifactResolveTool(deps()), { artifact: id, threadId: 't1' }));
    const resolved = json<{ threads: Array<{ threadId: string }> }>(await call(artifactCommentsTool(deps()), { artifact: id, status: 'resolved' }));
    expect(resolved.threads.map((thread) => thread.threadId)).toEqual(['t1']);
  });

  it('artifact_reply posts as the session; an unknown thread is refused', async () => {
    const id = await world.seeded();
    const answer = json<{ messageId: string; threadStatus: string }>(await call(artifactReplyTool(deps()), { artifact: id, threadId: 't2', body: 'Done: I tightened it.' }));
    expect(answer.threadStatus).toBe('open');
    expect(getThread(live(id), 't2')!.messages.at(-1)).toMatchObject({ id: answer.messageId, body: 'Done: I tightened it.', by: { kind: 'session', appSessionId: SELF } });
    expect(refusalOf(await call(artifactReplyTool(deps()), { artifact: id, threadId: 'nope', body: 'x' }))).toMatchObject({ reason: 'notFound', threadId: 'nope' });
  });

  it('artifact_resolve resolves and reopens as the session; resolving a resolved thread writes nothing', async () => {
    const id = await world.seeded();
    const resolve = artifactResolveTool(deps());
    expect(json(await call(resolve, { artifact: id, threadId: 't3' }))).toMatchObject({ status: 'resolved' });
    expect(getThread(live(id), 't3')).toMatchObject({ status: 'resolved', resolvedBy: { kind: 'session', appSessionId: SELF } });
    const revision = world.store.revision(id);
    expect(json(await call(resolve, { artifact: id, threadId: 't3' }))).toMatchObject({ status: 'resolved', revision });
    expect(world.store.revision(id)).toBe(revision);
    expect(json(await call(resolve, { artifact: id, threadId: 't3', reopen: true }))).toMatchObject({ status: 'reopened' });
    expect(getThread(live(id), 't3')!.status).toBe('open');
  });
});

describe('the tools’ guards', () => {
  it('refuses a non-document, an unknown artifact and a missing store', async () => {
    const html = await world.store.create({ kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>x</p>'), name: 'index.html' } }, HUMAN);
    expect(refusalOf(await edit({ artifact: html.id, baseRevision: 0, ops: [{ op: 'delete', id: 'x' }] }))).toMatchObject({ reason: 'invalid', kind: 'html' });
    expect(refusalOf(await edit({ artifact: 'nope', baseRevision: 0, ops: [{ op: 'delete', id: 'x' }] }))).toMatchObject({ reason: 'notFound' });
    expect(refusalOf(await call(artifactEditTool(deps({ artifacts: () => null })), { artifact: 'x', baseRevision: 0, ops: [{ op: 'delete', id: 'x' }] }))).toMatchObject({ reason: 'unavailable' });
  });

  it('refuses invalid arguments in the tool’s words (an insert naming both anchors, more than 100 ops)', async () => {
    const id = await world.seeded();
    expect(textOfResult(await edit({ artifact: id, baseRevision: 0, ops: [{ op: 'insert', after: 'p1', before: 'p2', markdown: 'x' }] }))).toMatch(/^artifact_edit: invalid arguments: ops\.0: an insert names one of after or before/);
    expect(textOfResult(await edit({ artifact: id, baseRevision: 0, ops: Array.from({ length: 101 }, () => ({ op: 'delete', id: 'p1' })) }))).toMatch(/^artifact_edit: invalid arguments: ops/);
  });
});

// M7's review, fix wave 1: the reviewer's reproductions (/tmp/maws-review/m7-focused/focused.test.ts) as regressions.
describe('fix wave 1: replay before current-state guards, the live revision, the tab limit on the result', () => {
  it('replays a document create with a chosen handle (the handle check runs inside the idempotent operation)', async () => {
    const create = documentCreateTool(deps());
    const args = { kind: 'document', title: 'Once', handle: 'review-once', content: 'Text.' };
    const toolUseId = 'toolu_review_handle' as ToolUseId;
    const first = json(await call(create, args, { toolUseId }));
    const again = await call(create, args, { toolUseId });
    expect(json(again).artifactId).toBe(first.artifactId);
    expect(refusalOf(await call(create, args))).toMatchObject({ reason: 'handleTaken', handle: 'review-once' }); // a new call is still refused
  });

  it('replays an applied direct edit after the owner turned suggestions on (routing runs inside the idempotent operation)', async () => {
    const { id, revision } = await readSeed();
    const args = { artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'Once.' }] };
    const toolUseId = 'toolu_review_setting' as ToolUseId;
    const first = await edit(args, { toolUseId });
    await world.store.update(id, { agentEditsAsSuggestions: true });
    expect(await edit(args, { toolUseId })).toEqual(first);
    expect(json(await edit(args))).toMatchObject({ status: 'edited' }); // a new call is routed to suggestions
  });

  it('a retained-version read answers the live revision, the version’s own in its summary, and is no base for a batch', async () => {
    const id = await world.seeded();
    const versionId = (await world.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'Earlier' }))!;
    const versionSeq = world.store.revision(id);
    await world.service.writeAs(id, HUMAN, (doc) => transact(doc, () => nodeOf(doc, 'p1').insert(0, 'Later. ')));
    const answer = json<{ revision: number; version: { revision: number } }>(await read({ artifact: id, version: versionId }));
    expect(answer.revision).toBe(world.store.revision(id));
    expect(answer.version.revision).toBe(versionSeq);
    // the session saw only historical content: a replace_block from that revision is validated as from an unseen base
    expect(refusalOf(await edit({ artifact: id, baseRevision: answer.revision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'Over it.' }] })).reason).toBe('staleTargets');
  });

  async function nearlyFull(): Promise<{ id: string; revision: number }> {
    const id = await world.seeded();
    const extra = Array.from({ length: 1991 }, (_, i) => pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: `r${i}` }, content: [{ type: 'text', text: 'Small.' }] })));
    await world.service.writeAs(id, HUMAN, (doc) => transact(doc, () => body(doc).insert(8, extra)));
    const answer = json<{ revision: number; tabs: Array<{ blocks: number }> }>(await read({ artifact: id, count: 1 }));
    expect(answer.tabs[0].blocks).toBe(1999);
    return { id, revision: answer.revision };
  }
  const tops = (id: string) => DocIndex.of(live(id)).tops(TAB).length;

  it('refuses a batch whose inserts would take a tab past 2,000 blocks, writing nothing', async () => {
    const { id, revision } = await nearlyFull();
    expect(refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'One.\n\nTwo.' }] }))).toMatchObject({ reason: 'invalid', opIndex: 0 });
    expect(refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'One.' }, { op: 'insert', after: 'p1', markdown: 'Two.' }] }))).toMatchObject({ reason: 'invalid', opIndex: 1 });
    expect(tops(id)).toBe(1999);
    json(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'One.' }] })); // up to the limit lands
    expect(tops(id)).toBe(2000);
  });

  it('refuses a replace_block that expands a tab past 2,000 blocks; a batch that shrinks an over-full tab lands', async () => {
    const { id, revision } = await nearlyFull();
    expect(refusalOf(await edit({ artifact: id, baseRevision: revision, ops: [{ op: 'replace_block', id: 'p4', markdown: 'One.\n\nTwo.\n\nThree.' }] }))).toMatchObject({ reason: 'invalid' });
    expect(tops(id)).toBe(1999);
    await world.service.writeAs(id, HUMAN, (doc) => transact(doc, () => body(doc).insert(8, [pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'h2x' } })), pmnodeToDelta(schemaFor().nodeFromJSON({ type: 'paragraph', attrs: { id: 'h3x' } }))])));
    const { revision: over } = json<{ revision: number }>(await read({ artifact: id, count: 1 }));
    expect(tops(id)).toBe(2001); // the person may type past it; the agent may still edit without growing it
    json(await edit({ artifact: id, baseRevision: over, ops: [{ op: 'replace_text', block: 'p1', old: 'It has two sentences.', new: 'It has two.' }, { op: 'delete', id: 'h2x' }] }));
    expect(tops(id)).toBe(2000);
  });

  it('refuses a create whose content holds more than 2,000 top-level blocks, creating nothing', async () => {
    const content = Array.from({ length: 2001 }, (_, i) => `Paragraph ${i}.`).join('\n\n');
    expect(refusalOf(await call(documentCreateTool(deps()), { kind: 'document', title: 'Huge', content }))).toMatchObject({ reason: 'invalid' });
    expect(world.store.list({ kind: 'document' }).filter((artifact) => artifact.title === 'Huge')).toEqual([]);
  });
});

// M7's re-review, fix wave 2: the replay lookup by tool-use id comes before the handle is resolved (§4.3).
describe('fix wave 2: a call naming a deleted artifact by handle replays its recorded result', () => {
  it('replays edit, reply and resolve by their tool-use ids after the artifact named by handle was deleted; a new call is refused', async () => {
    const artifact = await world.store.create({ kind: 'document', title: 'Gone plan', handle: 'gone-plan' }, { kind: 'session', appSessionId: SELF });
    const seed = diffV1(seedDoc());
    await world.service.writeAs(artifact.id, HUMAN, (doc) => applyV1(doc, seed));
    const { revision } = json<{ revision: number }>(await read({ artifact: 'gone-plan' }));
    const calls: Array<[McpToolDefinition, Record<string, unknown>, ToolUseId]> = [
      [artifactEditTool(deps()), { artifact: 'gone-plan', baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'Once.' }] }, 'toolu_gone_edit' as ToolUseId],
      [artifactReplyTool(deps()), { artifact: 'gone-plan', threadId: 't1', body: 'Noted.' }, 'toolu_gone_reply' as ToolUseId],
      [artifactResolveTool(deps()), { artifact: 'gone-plan', threadId: 't2' }, 'toolu_gone_resolve' as ToolUseId],
    ];
    const first: McpToolResult[] = [];
    for (const [tool, args, toolUseId] of calls) first.push(await call(tool, args, { toolUseId }));
    for (const result of first) json(result);
    await world.store.delete(artifact.id);
    for (const [i, [tool, args, toolUseId]] of calls.entries()) expect(await call(tool, args, { toolUseId })).toEqual(first[i]);
    expect(refusalOf(await call(calls[0][0], calls[0][1]))).toMatchObject({ reason: 'notFound', artifact: 'gone-plan' });
  });
});
