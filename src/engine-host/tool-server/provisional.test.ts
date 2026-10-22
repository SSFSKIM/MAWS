// P4-A2 M4 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md R1, R5 to R8; X35): the host's provisional
// emitter over A's real store with the document kind registered. A raw replica end on the document reads what the
// layer's frames say and in which order they arrive beside the write's own frames; the agent's presence is read on the
// session's replica. Proves: presence from the tick in which `artifact` resolves; the streamed ops cumulative, by name
// and by quote (matched on the blocks' markdown, as the tool matches it); the committed notice of a real `artifact_edit`
// ahead of its update, naming the edit's own row (not a later row of the kind's hooks); the layer dropped on a refusal,
// a `tool.result`, the turn's end and the process's exit, and at once from the frame of a write that changed nothing
// (an edit or a publish); suggest mode moving the layer; nothing for another tool or an unjoined delta; nothing written
// by a tick. Then the same path on a session: the engine's deltas and `tools/call` over a scripted transport. G2.1
// (G-R1, G-R7): a deck's publish frame by frame, each listing only the files that changed, restated whole to a view that
// syncs mid-stream, committed by the publish's own row; a dataset's id once whole, outlining the charts bound to it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { DECK_PATH } from '@artifacts/slides/deck';
import { newDoc, stateVector } from '@artifacts/yjs';
import { ArtifactProvisionalSchema, PROVISIONAL_TICK_MS, type ArtifactProvisional } from '@shared/artifacts/provisional';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { scriptedSession } from '../conformance/session-harness';
import { registerDashboards, type Dashboards } from '../dashboards';
import { HUMAN, openDocumentWorld, sessionActor, type DocumentWorld, type RawEnd } from '../documents/kinds/document-world.fixture';
import type { HostPort } from '../documents/ports';
import { registerPresentations, type Presentations } from '../presentations';
import { ArtifactSession, type ArtifactToolDeps } from './artifact-context';
import { artifactPublishTool } from './artifact-publish';
import { artifactCreateTool, artifactReadTool } from './artifact-tools';
import { artifactDatasetTool } from './datasets';
import { artifactEditTool, documentCreateTool, documentReadTool, DocumentToolSession, type DocumentToolDeps } from './documents';
import { ProvisionalEmitter } from './provisional';
import type { McpToolContext, McpToolResult } from './server';

const SELF = 'app-self' as AppSessionId;
let world: DocumentWorld;
let session: DocumentToolSession;
let emitter: ProvisionalEmitter;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  session = new DocumentToolSession();
  emitter = new ProvisionalEmitter({ store: () => world.store, appSessionId: SELF, log: (line) => world.logs.push(line) });
});
afterEach(() => {
  emitter.processExited();
  world.close();
});

const deps = (over: Partial<DocumentToolDeps> = {}): DocumentToolDeps => ({ artifacts: () => world.store, session, presenceEditingMs: 20, provisional: emitter, ...over });
const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  const text = (result.content[0] as { text: string }).text;
  if (result.isError) throw new Error(`a refusal: ${text}`);
  return JSON.parse(text) as T;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, PROVISIONAL_TICK_MS + 15));
const id = (n: string) => n as ToolUseId;
const toolUse = id; // where `id` names an artifact

/** The pieces of one call's input, each fed as a delta and given its tick. */
async function feed(toolUseId: ToolUseId, ...pieces: string[]): Promise<void> {
  for (const piece of pieces) {
    emitter.delta(toolUseId, 'artifact_edit', piece);
    await tick();
  }
}
/** The provisional frames a raw end received, as their shape parses. */
const layer = (end: Pick<RawEnd, 'received'>): ArtifactProvisional[] => end.received.filter((frame): frame is Extract<Frame, { type: 'provisional' }> => frame.type === 'provisional').map((frame) => ArtifactProvisionalSchema.parse(JSON.parse(frame.json)));
const presence = (docKey: string) => world.store.service.replica(SELF, docKey).provider.awareness.getLocalState() as { name?: string; editing?: { blocks: string[] } } | null;

describe('the streamed layer', () => {
  it('shows the agent from the tick in which `artifact` resolves, then each op as far as it parses, by name, cumulatively', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const call = id('toolu_named');
    await feed(call, `{"artifact":"${doc.slice(0, 8)}`); // a ref still streaming is not looked up
    expect(layer(end)).toEqual([]);
    expect(presence(doc) ?? {}).toEqual({}); // a replica that never showed anything
    await feed(call, `${doc.slice(8)}"`);
    expect(presence(doc)).toMatchObject({ name: 'Claude', editing: { blocks: [] } });
    expect(layer(end)).toEqual([]); // nothing to draw yet
    await feed(call, ',"baseRevision":3,"ops":[{"op":"replace_text","block":"p2","old":"Friday","new":"Mon');
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2'] } });
    await feed(call, 'day mor', 'ning"}');
    const frames = layer(end);
    expect(frames.map((frame) => frame.ops)).toEqual([
      [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Mon' }],
      [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday mor' }],
      [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday morning' }],
    ]);
    expect(frames[0]).toMatchObject({ toolUseId: call, appSessionId: SELF, artifactId: doc, kind: 'document', state: 'streaming', name: 'Claude' });
    expect(frames[0].color).toMatch(/^--author-\d$/);
    await feed(call, ',{"op":"delete","id":"p'); // a block id still streaming is not named
    expect(layer(end)).toHaveLength(3);
    await feed(call, '4"}');
    expect(layer(end).at(-1)!.ops.at(-1)).toEqual({ op: 'delete', block: 'p4' });
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2', 'p4'] } });
  });

  it('resolves a handle only once it is whole: `plan` on its way to `plan-2` is not looked up', async () => {
    const created = async (handle: string) => (await world.store.create({ kind: 'document', title: handle, handle }, sessionActor(SELF))).id;
    const plan = await created('plan');
    const plan2 = await created('plan-2');
    const call = id('toolu_handle');
    await feed(call, '{"artifact":"plan');
    expect(presence(plan) ?? {}).toEqual({});
    await feed(call, '-2"');
    expect(presence(plan2)).toMatchObject({ editing: { blocks: [] } });
    expect(presence(plan) ?? {}).toEqual({});
  });

  it('places an unscoped quote on the first block holding it once the quote is whole, and on none when no block does', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const call = id('toolu_quote');
    await feed(call, `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"replace_text","old":"scheduled for Fri`);
    expect(presence(doc)).toMatchObject({ editing: { blocks: [] } });
    await feed(call, 'day"');
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2'] } });
    expect(layer(end)).toEqual([]); // its `new` has not started
    await feed(call, ',"new":"moved to Mon', 'day"},{"op":"replace_text","old":"nowhere in the document","new":"x"}');
    expect(layer(end).at(-1)!.ops).toEqual([
      { op: 'replace_text', block: 'p2', old: 'scheduled for Friday', text: 'moved to Monday' },
      { op: 'replace_text', block: null, old: 'nowhere in the document', text: 'x' },
    ]);
  });

  it('places an unscoped quote by the blocks’ markdown, as the tool matches it: formatting, links and comment milestones', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const quotes = ['over the **lazy**', '[dog](https://example.com)', 'item with **bold**', '<c:t3>scheduled for Friday</c:t3>', 'the lazy dog'];
    const ops = quotes.map((old) => ({ op: 'replace_text', old, new: 'x' }));
    await feed(id('toolu_markdown'), JSON.stringify({ artifact: doc, baseRevision: 3, ops }));
    // p1's bold and its link, the list holding the bold item, p2's commented passage; the plain words of a formatted
    // passage are not its markdown, so the tool finds them nowhere
    expect(layer(end).at(-1)!.ops).toMatchObject([{ block: 'p1' }, { block: 'p1' }, { block: 'l1' }, { block: 'p2' }, { block: null }]);
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p1', 'l1', 'p2'] } });
  });

  it('draws inserts, cells, replaced blocks and moves as their fields parse', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    await feed(id('toolu_ops'), `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"insert","after":"p1","markdown":"New para`, `"},{"op":"set_cell","table":"tb1","row":1,"col":1,"markdown":"9`, `"},{"op":"replace_block","id":"p3","markdown":"Whole"},{"op":"move","id":"c1","after":"h1"}]}`);
    expect(layer(end).at(-1)!.ops).toEqual([
      { op: 'insert', after: 'p1', text: 'New para' },
      { op: 'set_cell', table: 'tb1', row: 1, col: 1, text: '9' },
      { op: 'replace_block', block: 'p3', text: 'Whole' },
      { op: 'move', block: 'c1' },
    ]);
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['tb1', 'p3', 'c1'] } }); // an insert's anchor is not edited
  });

  it('never writes: the document, its revision and its versions are as they were', async () => {
    const doc = await world.seeded();
    const revision = world.store.revision(doc);
    const versions = world.store.listVersions(doc).length;
    const sv = stateVector(world.service.live(doc));
    await feed(id('toolu_still'), `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"replace_text","block":"p2","old":"Friday","new":"Monday"},{"op":"delete","id":"p4"}]}`);
    await world.store.service.whenCommitted();
    expect(world.store.revision(doc)).toBe(revision);
    expect(world.store.listVersions(doc)).toHaveLength(versions);
    expect(stateVector(world.service.live(doc))).toEqual(sv);
  });

  it('reads nothing past 2 MB of input', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const call = id('toolu_huge');
    await feed(call, `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"insert","after":"p1","markdown":"start`);
    expect(layer(end)).toHaveLength(1);
    await feed(call, 'x'.repeat(2 * 1024 * 1024), 'more');
    expect(layer(end)).toHaveLength(1);
  });
});

describe('the layer’s endings', () => {
  async function streamed(call: ToolUseId, ops = '[{"op":"replace_text","block":"p2","old":"Friday","new":"Monday"}]') {
    const doc = await world.seeded();
    const { revision } = json<{ revision: number }>(await documentReadTool(deps()).call({ artifact: doc }, ctx()));
    const end = world.connect(doc, HUMAN);
    const args = { artifact: doc, baseRevision: revision, ops: JSON.parse(ops) as unknown[] };
    const text = JSON.stringify(args);
    await feed(call, text.slice(0, text.length - 5), text.slice(text.length - 5));
    expect(layer(end).map((frame) => frame.state)).toEqual(['streaming', 'streaming']);
    return { doc, end, args };
  }

  it('announces a real artifact_edit’s commit ahead of its updates, naming the edit’s own row; the answer names the write’s revision', async () => {
    const call = id('toolu_commit');
    const { doc, end, args } = await streamed(call);
    end.received.length = 0;
    const answer = json<{ revision: number }>(await artifactEditTool(deps()).call(args, ctx({ toolUseId: call })));
    const committedAt = end.received.findIndex((frame) => frame.type === 'provisional');
    const updates = end.received.flatMap((frame, at) => (frame.type === 'update' ? [{ at, seq: frame.seq }] : []));
    expect(committedAt).toBeGreaterThanOrEqual(0);
    expect(updates.length).toBeGreaterThan(0);
    expect(committedAt).toBeLessThan(updates[0].at);
    const [committed, ...after] = layer(end);
    expect(after).toEqual([]); // no streaming or dropped frame after the commit
    expect(committed).toMatchObject({ state: 'committed', commitSeq: updates[0].seq, artifactId: doc, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday' }] });
    expect(answer.revision).toBe(Math.max(...updates.map((update) => update.seq ?? 0)));
    // the tool's own commit took the outline over (its cursor, the blocks it touched), held its 4 s
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2'] } });
    expect(emitter.presenting(doc)).toBe(false);
  });

  it('names the edit’s own row when the kind’s hooks write after it (a commented passage replaced whole), not the write’s last', async () => {
    const call = id('toolu_anchor');
    const { end, args } = await streamed(call, '[{"op":"replace_text","block":"p2","old":"scheduled for Friday","new":"moved"}]');
    end.received.length = 0;
    json(await artifactEditTool(deps()).call(args, ctx({ toolUseId: call })));
    const seqs = end.received.flatMap((frame) => (frame.type === 'update' ? [frame.seq ?? 0] : []));
    expect(seqs.length).toBeGreaterThan(1); // the edit's row, then the thread's (its passage gone)
    expect(layer(end)).toMatchObject([{ state: 'committed', commitSeq: seqs[0] }]);
    expect(seqs[0]).toBeLessThan(Math.max(...seqs));
  });

  it('withdraws at once the layer of a batch that writes no row, leaving the tool its outline', async () => {
    const call = id('toolu_unchanged');
    const { doc, end, args } = await streamed(call, '[{"op":"replace_text","block":"p2","old":"Friday","new":"Friday"}]');
    const revision = world.store.revision(doc);
    end.received.length = 0;
    json(await artifactEditTool(deps()).call(args, ctx({ toolUseId: call })));
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2'] } }); // the tool's own, held its 4 s
    expect(emitter.presenting(doc)).toBe(false);
    expect(world.store.revision(doc)).toBe(revision); // no row: none the owner's replica could wait for
    expect(end.received.filter((frame) => frame.type === 'update')).toEqual([]);
    expect(layer(end)).toMatchObject([{ toolUseId: call, state: 'dropped', ops: [] }]);
  });

  it('releases a design system publish’s outline when it changes no file, sending no frame (no view draws its files)', async () => {
    const artifactDeps = { artifacts: () => world.store, session: new ArtifactSession(), provisional: emitter };
    const created = json<{ artifactId: string }>(await artifactCreateTool(artifactDeps).call({ kind: 'design_system', title: 'Site', files: { 'a.html': 'A' } }, ctx()));
    const site = created.artifactId;
    const { revision } = json<{ revision: number }>(await artifactReadTool(artifactDeps).call({ artifact: site }, ctx()));
    const end = world.connect(site, HUMAN);
    const call = id('toolu_same_files');
    for (const piece of [`{"artifact":"${site}","baseRevision":${revision},"files":{"a.html":"`, 'A"}}']) {
      emitter.delta(call, 'artifact_publish', piece);
      await tick();
    }
    expect(layer(end)).toEqual([]);
    expect(presence(site)).toMatchObject({ editing: { blocks: [] } });
    end.received.length = 0;
    expect(json(await artifactPublishTool(artifactDeps).call({ artifact: site, baseRevision: revision, files: { 'a.html': 'A' } }, ctx({ toolUseId: call })))).toMatchObject({ changed: [], revision });
    expect(end.received.filter((frame) => frame.type === 'update')).toEqual([]);
    expect(layer(end)).toEqual([]);
    expect(presence(site)?.editing).toBeUndefined();
  });

  it('drops the layer of a refused call and releases the outline to the idle name', async () => {
    const call = id('toolu_refused');
    const { doc, end, args } = await streamed(call);
    const refused = await artifactEditTool(deps()).call({ ...args, baseRevision: 9_999 }, ctx({ toolUseId: call }));
    expect(refused.isError).toBe(true);
    expect(layer(end).map((frame) => frame.state)).toEqual(['streaming', 'streaming', 'dropped']);
    expect(layer(end).at(-1)).toMatchObject({ toolUseId: call, artifactId: doc, ops: [] });
    expect(presence(doc)).toEqual({ name: 'Claude', color: expect.stringMatching(/^--author-\d$/) as unknown });
  });

  it('drops the layer on a tool.result no commit preceded, on the turn’s end and on the process’s exit', async () => {
    for (const end of ['result', 'turn', 'exit'] as const) {
      const call = id(`toolu_end_${end}`);
      const { doc, end: raw } = await streamed(call);
      if (end === 'result') emitter.observe([{ kind: 'tool.result', toolUseId: call } as unknown as SessionEvent]);
      else if (end === 'turn') emitter.turnEnded();
      else emitter.processExited();
      expect(layer(raw).map((frame) => frame.state), end).toEqual(['streaming', 'streaming', 'dropped']);
      expect(presence(doc)?.editing, end).toBeUndefined();
      emitter.delta(call, 'artifact_edit', ' '); // an ended call's late delta is not read again
      await tick();
      expect(layer(raw), end).toHaveLength(3);
    }
  });

  it('moves the layer to the suggestion doc when `mode: "suggest"` parses late, and starts there under the owner’s setting', async () => {
    const doc = await world.seeded();
    const main = world.connect(doc, HUMAN);
    const proposals = world.connect(world.store.service.suggestionDoc(doc), HUMAN);
    const suggestionKey = world.store.service.suggestionDoc(doc);
    await feed(id('toolu_late'), `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"replace_text","block":"p2","old":"Friday","new":"Monday"}]`, ',"mode":"suggest"}');
    expect(layer(main).map((frame) => frame.state)).toEqual(['streaming', 'dropped']);
    expect(layer(proposals)).toMatchObject([{ state: 'streaming', artifactId: suggestionKey, ops: [{ op: 'replace_text', block: 'p2', text: 'Monday' }] }]);
    expect(presence(doc)?.editing).toBeUndefined();
    expect(presence(suggestionKey)).toMatchObject({ editing: { blocks: ['p2'] } });

    await world.store.update(doc, { agentEditsAsSuggestions: true });
    main.received.length = 0;
    proposals.received.length = 0;
    await feed(id('toolu_setting'), `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"delete","id":"p4"}]}`);
    expect(layer(main)).toEqual([]);
    expect(layer(proposals)).toMatchObject([{ state: 'streaming', ops: [{ op: 'delete', block: 'p4' }] }]);
  });

  it('shows nothing for a tool it does not read, an unjoined delta, another server’s tool, or a ref naming nothing', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const input = `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"delete","id":"p4"}]}`;
    const delta = (toolUseId: string | null, toolName: string | null) => ({ kind: 'assistant.block.delta', blockType: 'tool_use', toolUseId, toolName, inputJsonDelta: input }) as unknown as SessionEvent;
    emitter.observe([delta('toolu_read', 'mcp__maws__artifact_read'), delta(null, 'mcp__maws__artifact_edit'), delta('toolu_other', 'mcp__other__artifact_edit'), delta('toolu_bare', 'artifact_edit')]);
    emitter.delta(id('toolu_unknown'), 'artifact_edit', '{"artifact":"no-such-handle","ops":[{"op":"delete","id":"p4"}]}');
    await tick();
    expect(layer(end)).toEqual([]);
    expect(presence(doc) ?? {}).toEqual({}); // a replica that never showed anything
    emitter.observe([delta('toolu_ours', 'mcp__maws__artifact_edit')]); // the engine's name for the `maws` tool
    await tick();
    expect(layer(end)).toMatchObject([{ toolUseId: 'toolu_ours', ops: [{ op: 'delete', block: 'p4' }] }]);
  });

  it('leaves the outline to a later call still streaming when an earlier batch’s hold ends', async () => {
    const call = id('toolu_first');
    const { doc, args } = await streamed(call);
    json(await artifactEditTool(deps({ presenceEditingMs: 30 })).call(args, ctx({ toolUseId: call })));
    await feed(id('toolu_second'), `{"artifact":"${doc}","baseRevision":3,"ops":[{"op":"delete","id":"p4"}]}`);
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p4'] } });
    await new Promise((resolve) => setTimeout(resolve, 60)); // the first batch's hold ends
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p4'] } });
  });
});

// G2.1 (G-R1, G-R9): a deck's publish streams its files, each frame listing the files whose text changed since the frame
// before; a connection completing its sync mid-stream is restated every file so far; the publish's own write commits
// the layer, a refusal drops it.
describe('a publish’s files (G2)', () => {
  let presentations: Presentations;
  let artifactDeps: ArtifactToolDeps & { provisional: ProvisionalEmitter };
  beforeEach(() => {
    presentations = registerPresentations({ documents: world, chain: null, refresh: () => {} });
    artifactDeps = { artifacts: () => world.store, session: new ArtifactSession(), provisional: emitter };
  });
  afterEach(() => presentations.close());

  const S1 = 'project/slides/s1.html';
  const S2 = 'project/slides/s2.html';
  const S3 = 'project/slides/s3.html';
  const slide = (id: string, body: string) => `<section id="${id}" style="padding:128px">\n${body}\n</section>`;
  const DECK = {
    [DECK_PATH]: JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3 review', cover: 's1', order: ['s1', 's2'] }),
    [S1]: slide('s1', '<h2 id="title" style="font-size:64px">Plan</h2>'),
    [S2]: slide('s2', '<h2 id="t2" style="font-size:64px">Numbers</h2>'),
  };
  async function deck(): Promise<{ id: string; revision: number }> {
    const { artifactId } = json<{ artifactId: string }>(await artifactCreateTool(artifactDeps).call({ kind: 'presentation', title: 'Q3 review', files: DECK }, ctx()));
    const { revision } = json<{ revision: number }>(await artifactReadTool(artifactDeps).call({ artifact: artifactId }, ctx()));
    return { id: artifactId, revision };
  }
  /** The input's text cut at each marker's end, fed piece by piece to the call, each given its tick. */
  async function publishing(toolUseId: ToolUseId, input: Record<string, unknown>, ...cuts: string[]): Promise<string> {
    const text = JSON.stringify(input);
    let from = 0;
    for (const cut of [...cuts, null]) {
      const to = cut === null ? text.length : text.indexOf(cut, from) + cut.length;
      expect(to, cut ?? 'the end').toBeGreaterThan(from);
      emitter.delta(toolUseId, 'artifact_publish', text.slice(from, to));
      from = to;
      await tick();
    }
    return text;
  }
  const files = (frame: ArtifactProvisional) => frame.ops.map((op) => (op.op === 'file' ? [op.path, op.text] : [op.op, '']));
  /** A replica end that attaches now and completes its sync (its step 1 answered) once `sync` is called. */
  function attaching(docKey: string) {
    let onMessage: ((data: unknown) => void) | null = null;
    const received: Frame[] = [];
    const port: HostPort = { send: (frame) => void received.push(decodeFrame(frame)), close: () => {}, onMessage: (listener) => void (onMessage = listener), onClose: () => {} };
    world.store.service.attach(docKey, port, HUMAN);
    return { received, sync: () => onMessage!(encodeFrame({ type: 'step1', sv: stateVector(newDoc()) })) };
  }

  it('streams each file’s growth: a frame lists, in input order, only the files whose text changed since the frame before; a null file is never drawn', async () => {
    const { id, revision } = await deck();
    const end = world.connect(id, HUMAN);
    const s1 = slide('s1', '<h2 id="title" style="font-size:64px">Plan for Q4</h2>');
    const s3 = slide('s3', '<h2 id="t3">Three</h2>');
    await publishing(toolUse('toolu_files'), { artifact: id, baseRevision: revision, files: { [S1]: s1, [S2]: null, [S3]: s3 }, force: false }, `"baseRevision":${revision}`, 'Plan fo', 'id=\\"t3\\">Th', 'ree</h2>', '"}', ',"force":false');
    expect(presence(id)).toMatchObject({ name: 'Claude', editing: { blocks: [] } });
    const frames = layer(end);
    expect(frames.every((frame) => frame.state === 'streaming' && frame.artifactId === id && frame.kind === 'presentation')).toBe(true);
    expect(frames.map((frame) => frame.ops.map((op) => (op.op === 'file' ? op.path : op.op)))).toEqual([[S1], [S1, S3], [S3], [S3]]); // the force flag adds none
    expect(files(frames[0])).toEqual([[S1, s1.slice(0, s1.indexOf('Plan fo') + 7)]]);
    expect(files(frames[1])).toEqual([[S1, s1], [S3, s3.slice(0, s3.indexOf('Th') + 2)]]);
    expect(files(frames.at(-1)!)).toEqual([[S3, s3]]);
    // each path's text a prefix of its next
    const texts = new Map<string, string[]>();
    for (const frame of frames) for (const op of frame.ops) if (op.op === 'file') texts.set(op.path, [...(texts.get(op.path) ?? []), op.text]);
    for (const [path, seen] of texts) seen.slice(1).forEach((text, k) => expect(text.startsWith(seen[k]!), path).toBe(true));
  });

  it('restates every file streamed so far, to a connection completing its sync mid-stream alone, after its step 2', async () => {
    const { id, revision } = await deck();
    const end = world.connect(id, HUMAN);
    const call = toolUse('toolu_attach');
    const s2 = slide('s2', '<h2 id="t2">Numbers, again</h2>');
    const input = JSON.stringify({ artifact: id, baseRevision: revision, files: { [DECK_PATH]: DECK[DECK_PATH], [S1]: DECK[S1], [S2]: s2 } });
    // one file a frame: the index, the first slide, then the second as far as `aga`
    const cuts = [input.indexOf(`"${S1}"`), input.indexOf(`"${S2}"`), input.indexOf('again') + 3];
    for (const [k, cut] of cuts.entries()) {
      emitter.delta(call, 'artifact_publish', input.slice(k === 0 ? 0 : cuts[k - 1], cut));
      await tick();
    }
    expect(layer(end).map((frame) => frame.ops.map((op) => (op.op === 'file' ? op.path : op.op)))).toEqual([[DECK_PATH], [S1], [S2]]);
    end.received.length = 0;
    const late = attaching(id);
    await tick();
    late.received.length = 0; // its attach's own frames
    late.sync();
    await tick();
    expect(late.received.map((frame) => frame.type)).toEqual(['step2', 'provisional']);
    const [restated] = layer(late);
    expect(restated).toMatchObject({ toolUseId: call, state: 'streaming', artifactId: id });
    expect(files(restated)).toEqual([[DECK_PATH, DECK[DECK_PATH]], [S1, DECK[S1]], [S2, s2.slice(0, s2.indexOf('again') + 3)]]); // all three
    expect(end.received).toEqual([]); // the other connection is told nothing again
    // the stream goes on to both alike: the file that grew alone
    emitter.delta(call, 'artifact_publish', input.slice(cuts.at(-1)));
    await tick();
    expect(files(layer(end).at(-1)!)).toEqual([[S2, s2]]);
    expect(layer(late).at(-1)).toEqual(layer(end).at(-1));
    // once the call ended, a sync restates nothing
    emitter.dropped(call);
    await tick(); // the drop and the outline's release reach it first
    late.received.length = 0;
    late.sync();
    await tick();
    expect(late.received.map((frame) => frame.type)).toEqual(['step2']);
  });

  it('announces the publish’s commit ahead of its update, naming the publish’s own row and carrying no new files; a refusal drops the layer', async () => {
    const { id, revision } = await deck();
    const end = world.connect(id, HUMAN);
    const call = toolUse('toolu_publish');
    const args = { artifact: id, baseRevision: revision, files: { [S1]: slide('s1', '<h2 id="title" style="font-size:64px">Plan for Q4</h2>') } };
    await publishing(call, args, 'Plan');
    end.received.length = 0;
    const answer = json<{ changed: string[] }>(await artifactPublishTool(artifactDeps).call(args, ctx({ toolUseId: call })));
    expect(answer.changed).toEqual([S1]);
    const committedAt = end.received.findIndex((frame) => frame.type === 'provisional');
    const firstUpdate = end.received.findIndex((frame) => frame.type === 'update');
    expect(committedAt).toBeGreaterThanOrEqual(0);
    expect(firstUpdate).toBeGreaterThan(committedAt);
    expect(layer(end)).toEqual([expect.objectContaining({ toolUseId: call, state: 'committed', commitSeq: (end.received[firstUpdate] as { seq?: number }).seq, ops: [] })]);
    expect(presence(id)?.editing).toBeUndefined(); // the publish's outline ends with it

    const refused = toolUse('toolu_stale');
    await publishing(refused, { ...args, baseRevision: 1 }, 'Plan');
    expect((await artifactPublishTool(artifactDeps).call({ ...args, baseRevision: 1 }, ctx({ toolUseId: refused }))).isError).toBe(true);
    expect(layer(end).filter((frame) => frame.toolUseId === refused).map((frame) => [frame.state, frame.ops.length])).toEqual([['streaming', 1], ['streaming', 1], ['dropped', 0]]);
  });

  it('shows nothing of a page’s publish, nor of a document batch aimed at a deck', async () => {
    const { id } = await deck();
    const end = world.connect(id, HUMAN);
    const page = (await world.store.create({ kind: 'html', title: 'Page', content: { bytes: Buffer.from('<p>Hi</p>'), name: 'index.html' } }, HUMAN)).id;
    emitter.delta(toolUse('toolu_page'), 'artifact_publish', `{"artifact":"${page}","baseRevision":1,"files":{"index.html":"<p>Bye`);
    emitter.delta(toolUse('toolu_edit_deck'), 'artifact_edit', `{"artifact":"${id}","baseRevision":1,"ops":[{"op":"delete","id":"p4"}]}`);
    await tick();
    expect(world.service.loaded(page)).toBeNull(); // no replica, no presence, no frame
    expect(layer(end)).toEqual([]);
  });
});

// G2.1 (G-R7): a dataset call names its id once whole, and outlines the chart blocks whose source names it
describe('a dataset’s call (G2)', () => {
  let dashboards: Dashboards;
  let artifactDeps: ArtifactToolDeps & { provisional: ProvisionalEmitter };
  beforeEach(() => {
    dashboards = registerDashboards({ documents: world });
    artifactDeps = { artifacts: () => world.store, session: new ArtifactSession(), provisional: emitter };
  });
  afterEach(() => dashboards.close());

  const chart = (id: string, dataset: string) => [`:::chart {spec-json='{"view":"table","title":"${id}"}'}`, dataset, ':::', `^${id}`, ''];
  const MARKDOWN = ['# Sales ^h1', '', 'Revenue by region. ^p1', '', ...chart('c1', 'sales'), ...chart('c2', 'costs'), ...chart('c3', 'sales')].join('\n');

  it('names the dataset once its id is whole, outlines the charts bound to it, and commits from the dataset’s write', async () => {
    const create = documentCreateTool(deps(), artifactCreateTool(artifactDeps));
    const { artifactId: board } = json<{ artifactId: string }>(await create.call({ kind: 'dashboard', title: 'Sales board', content: MARKDOWN }, ctx()));
    const { revision } = json<{ revision: number }>(await documentReadTool(deps(), artifactReadTool(artifactDeps)).call({ artifact: board }, ctx()));
    writeFileSync(join(world.dir, 'sales.csv'), 'region,sales\nSeoul,120\nBusan,98\n');
    const end = world.connect(board, HUMAN);
    const call = toolUse('toolu_dataset');
    const args = { artifact: board, baseRevision: revision, id: 'sales', path: 'sales.csv' };
    const text = JSON.stringify(args);
    const cut = text.indexOf('"sal') + 4;
    emitter.delta(call, 'artifact_dataset', text.slice(0, cut));
    await tick();
    expect(layer(end)).toEqual([]); // `sal` on its way to `sales` names nothing
    expect(presence(board)).toMatchObject({ editing: { blocks: [] } });
    emitter.delta(call, 'artifact_dataset', text.slice(cut));
    await tick();
    expect(layer(end)).toEqual([expect.objectContaining({ toolUseId: call, state: 'streaming', kind: 'dashboard', artifactId: board, ops: [{ op: 'dataset', dataset: 'sales', text: '' }] })]);
    expect(presence(board)).toMatchObject({ editing: { blocks: ['c1', 'c3'] } });
    end.received.length = 0;
    json(await artifactDatasetTool(artifactDeps).call(args, ctx({ toolUseId: call })));
    const committedAt = end.received.findIndex((frame) => frame.type === 'provisional');
    const firstUpdate = end.received.findIndex((frame) => frame.type === 'update');
    expect(firstUpdate).toBeGreaterThan(committedAt);
    expect(layer(end)).toEqual([expect.objectContaining({ state: 'committed', commitSeq: (end.received[firstUpdate] as { seq?: number }).seq, ops: [{ op: 'dataset', dataset: 'sales', text: '' }] })]);
    expect(presence(board)?.editing).toBeUndefined();
  });
});

// The same path on a session: the engine's tool_use block and its deltas, then the `tools/call` under the block's id,
// over a scripted transport and the session's real `maws` server.
describe('on an engine session', () => {
  it('streams the engine’s deltas to the document and announces the call’s commit ahead of its update; a denied call’s result drops its layer', async () => {
    const doc = await world.seeded();
    const end = world.connect(doc, HUMAN);
    const run = scriptedSession({ spec: { cwd: world.dir }, session: { appVersion: '0.9.0', artifacts: () => world.store } });
    await run.session.start();
    const until = async (check: () => boolean, what: string) => {
      for (let k = 0; k < 2_000 && !check(); k++) await new Promise((resolve) => setTimeout(resolve, 5));
      if (!check()) throw new Error(`timed out waiting for ${what}`);
    };
    let n = 0;
    const answerOf = (requestId: string) => run.transport.writes.find((w) => w.type === 'control_response' && (w as { response: { request_id: string } }).response.request_id === requestId) as { response: { response: { mcp_response: { result: { content: { text: string }[] } } } } } | undefined;
    const callTool = async (name: string, args: unknown, toolUseId: string) => {
      const requestId = `mcp-${++n}`;
      run.transport.push({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': toolUseId } } } } });
      await until(() => answerOf(requestId) !== undefined, `the answer to ${name}`);
      return JSON.parse(answerOf(requestId)!.response.response.mcp_response.result.content[0].text) as { revision: number };
    };
    const stream = (event: Record<string, unknown>, k: number) => run.transport.push({ type: 'stream_event', event, session_id: '33333333-3333-4333-8333-333333333333', parent_tool_use_id: null, uuid: `se-${k}` });

    const { revision } = await callTool('artifact_read', { artifact: doc }, 'toolu_read');
    const args = JSON.stringify({ artifact: doc, baseRevision: revision, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' }] });
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_live', name: 'mcp__maws__artifact_edit', input: {} } }, 0);
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(0, -10) } }, 1);
    await until(() => layer(end).length === 1, 'the first streaming frame');
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(-10) } }, 2);
    stream({ type: 'content_block_stop', index: 0 }, 3);
    const answer = await callTool('artifact_edit', JSON.parse(args), 'toolu_live');
    const frames = layer(end);
    expect(frames.map((frame) => frame.state)).toEqual(['streaming', 'streaming', 'committed']);
    const committedAt = end.received.findIndex((frame) => frame.type === 'provisional' && JSON.parse(frame.json).state === 'committed');
    const firstUpdate = end.received.findIndex((frame) => frame.type === 'update');
    expect(firstUpdate).toBeGreaterThan(committedAt);
    const editRow = (end.received[firstUpdate] as { seq?: number }).seq;
    expect(frames.at(-1)).toMatchObject({ toolUseId: 'toolu_live', appSessionId: 'app-s', commitSeq: editRow, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday' }] });
    expect(editRow).toBeLessThanOrEqual(answer.revision);

    // a call the engine denied: its tool_use streamed, no `tools/call`, its result an error
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_denied', name: 'mcp__maws__artifact_edit', input: {} } }, 4);
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: `{"artifact":"${doc}","baseRevision":1,"ops":[{"op":"delete","id":"p4"}]}` } }, 5);
    await until(() => layer(end).length === 4, 'the denied call’s streaming frame');
    run.transport.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_denied', content: 'denied', is_error: true }] }, parent_tool_use_id: null, session_id: '33333333-3333-4333-8333-333333333333', uuid: 'u-denied' });
    await until(() => layer(end).length === 5, 'the denied call’s drop');
    expect(layer(end).at(-1)).toMatchObject({ toolUseId: 'toolu_denied', state: 'dropped' });
    run.transport.exit(0);
  });
});
