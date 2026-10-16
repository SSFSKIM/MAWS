// P3-C M7 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Acceptance 4's agent half): B's three thread
// tools as `mawsTools` serves them, wrapped so a presentation answers from the deck's threads in B's names and result
// shapes (`slideId` and `elementId` where B has `tab` and `block`) and every other kind passes to B unchanged; over A's
// real store and SQLite file with B's document kind and this child's presentation kind registered.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_PATH, slidePath } from '@artifacts/slides/deck';
import { deckFiles, deleteElementTree, moveSlide, setStyle } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { addThread, getThread } from '@artifacts/slides/threads';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { AskTable } from '../tool-server/asks';
import { HostBridge } from '../tool-server/bridge';
import { DocumentToolSession, documentTools, type DocumentToolDeps } from '../tool-server/documents';
import { PaneBridge } from '../tool-server/panes';
import { mawsTools } from '../tool-server/tools';
import type { McpToolContext, McpToolDefinition, McpToolResult } from '../tool-server/server';
import { registerPresentations, type Presentations } from '.';
import { presentationThreadTools } from './threads';

const SELF = 'app-self' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;
let world: DocumentWorld;
let presentations: Presentations;
let calls = 0;
beforeEach(() => {
  world = openDocumentWorld();
  presentations = registerPresentations({ documents: world, chain: null, refresh: () => {} });
});
afterEach(() => {
  presentations.close();
  world.close();
});

const deps = (over: Partial<DocumentToolDeps> = {}): DocumentToolDeps => ({ artifacts: () => world.store, session: new DocumentToolSession(), now: () => 5_000, ...over });
const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const textOf = (result: McpToolResult): string => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as T;
};
const refusalOf = (result: McpToolResult): Record<string, unknown> => {
  expect(result.isError).toBe(true);
  const text = textOf(result);
  return JSON.parse(text.slice(text.indexOf(' {"reason":') + 1)) as Record<string, unknown>;
};
/** The tools as `mawsTools` lists them: B's four, the thread tools wrapped. */
const tools = (over: Partial<DocumentToolDeps> = {}): Record<string, McpToolDefinition> => {
  const d = deps(over);
  return Object.fromEntries(presentationThreadTools(d, documentTools(d)).map((tool) => [tool.name, tool]));
};
const call = (name: string, args: unknown, over: Partial<McpToolContext> = {}) => tools()[name]!.call(args, ctx(over));
const live = (id: string) => world.service.live(id);

const index = (order: string[]) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3', cover: 's1', order });
const S1 = `<section id="s1" style="background:#ffffff; padding:128px"><h2 id="title" style="font-size:64px">Plan</h2><p id="body" style="position:absolute; left:100px; top:300px; width:400px">One path</p></section>`;
const S2 = `<section id="s2" style="background:#ffffff; padding:128px"><p id="lead" style="font-size:32px">Second</p></section>`;

/** A deck with three threads: t1 on s1/body with the owner's message, t2 on s2/lead by another session, t3 on s1/title. */
async function deck(): Promise<string> {
  const created = await world.store.create({ kind: 'presentation', title: 'Q3' }, HUMAN);
  await world.service.writeAs(created.id, HUMAN, (doc) => {
    publishDeck(doc, deckFiles(doc), { [DECK_PATH]: index(['s1', 's2']), [slidePath('s1')]: S1, [slidePath('s2')]: S2, [slidePath('cover')]: null }, true);
    addThread(doc, { threadId: 't1', slideId: 's1', elementId: 'body', quote: 'One path', by: HUMAN, at: 1_000, body: 'Shorter?' });
    addThread(doc, { threadId: 't2', slideId: 's2', elementId: 'lead', quote: 'Second', by: { kind: 'session', appSessionId: OTHER }, at: 2_000, body: 'Is this right?' });
    addThread(doc, { threadId: 't3', slideId: 's1', elementId: 'title', quote: 'Plan', by: HUMAN, at: 3_000, body: 'Bigger' });
  });
  return created.id;
}

interface Listed {
  threadId: string;
  status: string;
  orphaned: boolean;
  slideId: string;
  elementId: string;
  quote: string;
  createdBy: { by: string; appSessionId?: string };
  createdAt: string;
  resolvedAt?: string;
  messages: Array<{ id: string; at: string; body: string; by: string; appSessionId?: string }>;
}

describe('the thread tools on a presentation (D9)', () => {
  it('artifact_comments lists the open threads, orphans included, by slide and element, with their messages; resolved and all on request', async () => {
    const id = await deck();
    // the element moves, restyles, its slide re-orders; t3's element is deleted
    await world.service.writeAs(id, HUMAN, (doc) => {
      setStyle(doc, 's1', 'body', { left: '600px', color: '#ff0000' });
      moveSlide(doc, 's1', 's2');
      deleteElementTree(doc, 's1', 'title');
    });
    const open = json<{ status: string; artifactId: string; revision: number; threads: Listed[] }>(await call('artifact_comments', { artifact: id }));
    expect(open).toMatchObject({ status: 'listed', artifactId: id, revision: world.store.revision(id) });
    expect(open.threads).toEqual([
      { threadId: 't1', status: 'open', orphaned: false, slideId: 's1', elementId: 'body', quote: 'One path', createdBy: { by: 'user' }, createdAt: new Date(1_000).toISOString(), messages: [{ id: 't1:m0', at: new Date(1_000).toISOString(), body: 'Shorter?', by: 'user' }] },
      expect.objectContaining({ threadId: 't2', orphaned: false, slideId: 's2', elementId: 'lead', createdBy: { by: 'another session', appSessionId: OTHER } }),
      expect.objectContaining({ threadId: 't3', orphaned: true, slideId: 's1', elementId: 'title', quote: 'Plan' }),
    ]);
    expect(open.threads[0]).not.toHaveProperty('tab');
    json(await call('artifact_resolve', { artifact: id, threadId: 't2' }));
    expect(json<{ threads: Listed[] }>(await call('artifact_comments', { artifact: id, status: 'resolved' })).threads).toEqual([
      expect.objectContaining({ threadId: 't2', status: 'resolved', resolvedAt: new Date(5_000).toISOString() }),
    ]);
    expect(json<{ threads: Listed[] }>(await call('artifact_comments', { artifact: id, status: 'all' })).threads.map((t) => t.threadId)).toEqual(['t1', 't2', 't3']);
  });

  it('artifact_reply posts as the session at one new revision; a repeated tool-use id answers the first result; an unknown thread is refused', async () => {
    const id = await deck();
    const before = world.store.revision(id);
    const first = await call('artifact_reply', { artifact: id, threadId: 't1', body: 'Cut to four words.' }, { toolUseId: 'toolu_reply' as ToolUseId });
    const answer = json<{ status: string; threadId: string; messageId: string; threadStatus: string; revision: number; line: string }>(first);
    expect(answer).toMatchObject({ status: 'replied', artifactId: id, threadId: 't1', threadStatus: 'open', line: 'replied on c:t1' });
    expect(answer.revision).toBeGreaterThan(before);
    expect(getThread(live(id), 't1')!.messages.at(-1)).toEqual({ id: answer.messageId, by: { kind: 'session', appSessionId: SELF }, at: 5_000, body: 'Cut to four words.' });
    // the replay: the same answer, no second message
    expect(json(await call('artifact_reply', { artifact: id, threadId: 't1', body: 'Cut to four words.' }, { toolUseId: 'toolu_reply' as ToolUseId }))).toEqual(answer);
    expect(getThread(live(id), 't1')!.messages).toHaveLength(2);
    // the session's own message reads as its own
    const listed = json<{ threads: Listed[] }>(await call('artifact_comments', { artifact: id }));
    expect(listed.threads[0]!.messages.at(-1)).toMatchObject({ by: 'this session', body: 'Cut to four words.' });
    expect(refusalOf(await call('artifact_reply', { artifact: id, threadId: 'nope', body: 'x' }))).toMatchObject({ reason: 'notFound', threadId: 'nope' });
    expect(textOf(await call('artifact_reply', { artifact: id, threadId: 't1' }))).toMatch(/^artifact_reply: invalid arguments: body/);
  });

  it('artifact_resolve resolves and reopens as the session; resolving a resolved thread writes nothing', async () => {
    const id = await deck();
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 't1' }))).toMatchObject({ status: 'resolved', threadId: 't1', line: 'resolved c:t1' });
    expect(getThread(live(id), 't1')).toMatchObject({ status: 'resolved', resolvedBy: { kind: 'session', appSessionId: SELF }, resolvedAt: 5_000 });
    const revision = world.store.revision(id);
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 't1' }))).toMatchObject({ status: 'resolved', revision });
    expect(world.store.revision(id)).toBe(revision);
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 't1', reopen: true }))).toMatchObject({ status: 'reopened', line: 'reopened c:t1' });
    expect(getThread(live(id), 't1')).toMatchObject({ status: 'open', reopenedBy: { kind: 'session', appSessionId: SELF } });
  });

  it('ends the session’s turn with a version naming its thread answers', async () => {
    const id = await deck();
    json(await call('artifact_reply', { artifact: id, threadId: 't1', body: 'Done.' }));
    json(await call('artifact_resolve', { artifact: id, threadId: 't1' }));
    await world.store.endTurn(SELF);
    expect(world.store.listVersions(id).at(-1)).toMatchObject({ kind: 'turn', summary: 'replied on c:t1\nresolved c:t1' });
  });

  it('passes every other kind to B’s tools unchanged: a document’s threads by tab and block, an html artifact refused in B’s words', async () => {
    const doc = await world.seeded();
    const listed = json<{ threads: Array<{ threadId: string; tab: string; block: string | null }> }>(await call('artifact_comments', { artifact: doc }));
    expect(listed.threads.map((t) => t.threadId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(listed.threads[0]).toHaveProperty('tab');
    expect(json(await call('artifact_reply', { artifact: doc, threadId: 't2', body: 'ok' }))).toMatchObject({ status: 'replied', threadId: 't2' });
    const html = await world.store.create({ kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>x</p>'), name: 'index.html' } }, HUMAN);
    expect(refusalOf(await call('artifact_comments', { artifact: html.id }))).toMatchObject({ reason: 'invalid', kind: 'html' });
    expect(refusalOf(await call('artifact_comments', { artifact: 'nope' }))).toMatchObject({ reason: 'notFound' });
    // B's list kept: its names, order and descriptions; the edit tool B's own
    const d = deps();
    const b = documentTools(d);
    const wrapped = presentationThreadTools(d, b);
    expect(wrapped.map((tool) => [tool.name, tool.description])).toEqual(b.map((tool) => [tool.name, tool.description]));
    expect(wrapped[0]).toBe(b[0]);
  });

  it('refuses a deck’s thread tools while the store is unavailable, in B’s words', async () => {
    const result = await tools({ artifacts: () => null }).artifact_comments!.call({ artifact: 'x' }, ctx());
    expect(refusalOf(result)).toMatchObject({ reason: 'unavailable' });
  });

  it('is what the maws server serves: the wired list answers a deck from its threads', async () => {
    const id = await deck();
    const wired = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store });
    const comments = wired.find((tool) => tool.name === 'artifact_comments')!;
    expect(json<{ threads: Listed[] }>(await comments.call({ artifact: id }, ctx())).threads.map((t) => [t.threadId, t.slideId, t.elementId])).toEqual([
      ['t1', 's1', 'body'],
      ['t2', 's2', 'lead'],
      ['t3', 's1', 'title'],
    ]);
  });
});
