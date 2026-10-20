// P4-A2 M4 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md R1, R5 to R8; X35): the host's provisional
// emitter over A's real store with the document kind registered. A raw replica end on the document reads what the
// layer's frames say and in which order they arrive beside the write's own frames; the agent's presence is read on the
// session's replica. Proves: presence from the tick in which `artifact` resolves; the streamed ops cumulative, by name
// and by quote; the committed notice of a real `artifact_edit` ahead of its update, naming the update's seq; the layer
// dropped on a refusal, a `tool.result`, the turn's end and the process's exit; suggest mode moving the layer; nothing
// for another tool or an unjoined delta; nothing written by a tick. Then the same path on a session: the engine's
// deltas and `tools/call` over a scripted transport.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Frame } from '@artifacts/provider/frames';
import { stateVector } from '@artifacts/yjs';
import { ArtifactProvisionalSchema, PROVISIONAL_TICK_MS, type ArtifactProvisional } from '@shared/artifacts/provisional';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { scriptedSession } from '../conformance/session-harness';
import { HUMAN, openDocumentWorld, sessionActor, type DocumentWorld, type RawEnd } from '../documents/kinds/document-world.fixture';
import { artifactEditTool, documentReadTool, DocumentToolSession, type DocumentToolDeps } from './documents';
import { openPath, ProvisionalEmitter } from './provisional';
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

/** The pieces of one call's input, each fed as a delta and given its tick. */
async function feed(toolUseId: ToolUseId, ...pieces: string[]): Promise<void> {
  for (const piece of pieces) {
    emitter.delta(toolUseId, 'artifact_edit', piece);
    await tick();
  }
}
/** The provisional frames a raw end received, as their shape parses. */
const layer = (end: RawEnd): ArtifactProvisional[] => end.received.filter((frame): frame is Extract<Frame, { type: 'provisional' }> => frame.type === 'provisional').map((frame) => ArtifactProvisionalSchema.parse(JSON.parse(frame.json)));
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

  it('reads a publish’s files and a dataset’s id (host-side, for G2’s layers), and nothing of a call to a kind its tool does not write', async () => {
    const deck = (await world.store.create({ kind: 'presentation', title: 'Deck' }, HUMAN)).id;
    const end = world.connect(deck, HUMAN);
    const publish = id('toolu_publish');
    for (const piece of [`{"artifact":"${deck}","baseRevision":1,"files":{"slides/01.html":"<section>One`, `</section>","slides/02.html":null,"slides/03.html":"<sec`]) {
      emitter.delta(publish, 'artifact_publish', piece);
      await tick();
    }
    expect(layer(end).map((frame) => frame.ops)).toEqual([
      [{ op: 'file', path: 'slides/01.html', text: '<section>One' }],
      [{ op: 'file', path: 'slides/01.html', text: '<section>One</section>' }, { op: 'file', path: 'slides/03.html', text: '<sec' }],
    ]);
    expect(layer(end)[0]).toMatchObject({ kind: 'presentation', artifactId: deck });
    const page = (await world.store.create({ kind: 'html', title: 'Page', content: { bytes: Buffer.from('<p>Hi</p>'), name: 'index.html' } }, HUMAN)).id;
    emitter.delta(id('toolu_page'), 'artifact_publish', `{"artifact":"${page}","baseRevision":1,"files":{"index.html":"<p>Bye`);
    emitter.delta(id('toolu_edit_deck'), 'artifact_edit', `{"artifact":"${deck}","baseRevision":1,"ops":[{"op":"delete","id":"p4"}]}`);
    await tick();
    expect(world.service.loaded(page)).toBeNull(); // no replica, no presence, no frame
    expect(layer(end)).toHaveLength(2);
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

  it('announces a real artifact_edit’s commit ahead of its update, naming the update’s seq and the answered revision', async () => {
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
    expect(committed).toMatchObject({ state: 'committed', commitSeq: answer.revision, artifactId: doc, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday' }] });
    expect(committed.commitSeq).toBe(Math.max(...updates.map((update) => update.seq ?? 0)));
    // the tool's own commit took the outline over (its cursor, the blocks it touched), held its 4 s
    expect(presence(doc)).toMatchObject({ editing: { blocks: ['p2'] } });
    expect(emitter.presenting(doc)).toBe(false);
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

describe('openPath', () => {
  it('names the member the text ends inside, down to the innermost open container; null once whole', () => {
    expect(openPath('{"artifact":"pla')).toEqual(['artifact']);
    expect(openPath('{"artifact":"plan"')).toEqual([]);
    expect(openPath('{"artifact":"plan","ops":[{"op":"replace_text","old":"ab')).toEqual(['ops', 0, 'old']);
    expect(openPath('{"ops":[{"op":"x"},{"old":"a\\"b"')).toEqual(['ops', 1]);
    expect(openPath('{"ops":[{"op":"x"}')).toEqual(['ops']);
    expect(openPath('{"ops":[{"op":"x"}],"baseRevision":12')).toEqual(['baseRevision']);
    expect(openPath('{"ops":[[1,2],[3')).toEqual(['ops', 1, 0]);
    expect(openPath('{"a":{"b":"c"}}')).toBeNull();
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
    expect(frames.at(-1)).toMatchObject({ toolUseId: 'toolu_live', appSessionId: 'app-s', commitSeq: answer.revision, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', text: 'Monday' }] });
    const committedAt = end.received.findIndex((frame) => frame.type === 'provisional' && JSON.parse(frame.json).state === 'committed');
    expect(end.received.findIndex((frame) => frame.type === 'update')).toBeGreaterThan(committedAt);

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
