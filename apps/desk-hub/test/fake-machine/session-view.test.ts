// DC9's acceptance recording (recordings/session-view: two-subagents extended by session-view.py) replayed by the fake
// machine as DC8's producer: DX4's widened `subagents` body as the replay proceeds, a cold open agreeing with an open
// subscription, `output` in each of its variants, and a subscription that outlives the session, answering `rows` to the
// first row and `output`. The derivation itself is pinned by DC8's vectors (jobs-parity.test.ts); this is the fake
// machine around it, and the same over the local hub.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, SESSION_VIEW, SNAPSHOT_ROW_BUDGET, TWO_SUBAGENTS, type Recording, type Step } from '../../fake-machine';
import { SessionDepth, type Producer } from '../../fake-machine/session';
import { newNonce } from '../../src/protocol/codes';
import type { JsonObject } from '../../src/protocol/json';
import type { SessionBodies, SessionMessage, SubagentMeta, TaskOutput } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

const where = { project: '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f', machine: 'fake' };
const recording = loadRecording(SESSION_VIEW);
const original = loadRecording(TWO_SUBAGENTS);
const recorded = JSON.parse(readFileSync(join(SESSION_VIEW, 'recorded.json'), 'utf8')) as { synthesized: { rows: Record<string, { source: string; uuids: string[] }> } };

const ALPHA = 'ad435b3acfda88bfa';
const BETA = 'afa43b5c4f84309b6';
const NESTED = Object.keys(recording.meta).find((a) => recording.meta[a].parentAgentId === ALPHA)!;
const [SUITE, SERVE, WATCH, MONITOR] = ['bsuite7k2', 'bserve4q9', 'bwatch8m1', 'bmon3x7a0'];

/** The session's depth over `rec`, as `producer`, its steps applied by `play`, and what it sent. */
function replay(rec: Recording = recording, producer: Producer = 'dc8', steps: Step[] = rec.steps) {
  const sent: SessionMessage[] = [];
  const depth = new SessionDepth(rec.session, rec, (m) => sent.push(m), where, true, 'main', producer);
  let cursor = 0;
  const play = (until?: (s: Step) => boolean) => {
    while (cursor < steps.length) {
      const step = steps[cursor++];
      depth.apply(step);
      if (until?.(step)) return step;
    }
    return null;
  };
  const of = <K extends SessionMessage['kind']>(sub: string, kind: K) => sent.filter((m): m is Extract<SessionMessage, { kind: K }> => m.sub === sub && m.kind === kind);
  const output = (sub: string, taskId: string, tail = 4096): TaskOutput => {
    depth.output(sub, taskId, tail);
    const answer = sent.at(-1)!;
    if (answer.kind !== 'output') throw new Error(`no output for ${taskId}`);
    return answer.body;
  };
  /** The tree, the jobs and the MCP names a subscription holds now: its snapshot's, then each `subagents` message's. */
  const held = (sub: string): SessionBodies['subagents'] => {
    const snapshot = of(sub, 'snapshot')[0].body;
    return of(sub, 'subagents').at(-1)?.body ?? { subagents: snapshot.subagents, jobs: snapshot.jobs, mcp: snapshot.mcp };
  };
  return { depth, sent, play, of, output, held, get cursor() { return cursor; } };
}

const isRow = (uuid: string) => (s: Step) => s.k === 'row' && s.row.uuid === uuid;
const entry = (body: SessionBodies['subagents'], agentId: string) => body.subagents.find((a) => a.agentId === agentId) as SubagentMeta & { status: string; evidence: string };
const statusOf = (body: SessionBodies['subagents']) => Object.fromEntries(body.subagents.map((a) => [a.agentId, `${a.status}/${a.evidence}`]));
const jobsOf = (body: SessionBodies['subagents']) => Object.fromEntries((body.jobs ?? []).map((j) => [j.taskId, j.status]));
const synthesized = (group: string) => recorded.synthesized.rows[group].uuids;

describe('the session-view recording', () => {
  it('is two-subagents as recorded, every row in its order, with rows added around them', () => {
    const extended = recording.rows.main.map((r) => JSON.stringify(r));
    let at = -1;
    for (const row of original.rows.main) {
      const next = extended.indexOf(JSON.stringify(row));
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    const alpha = recording.rows.agents[ALPHA].map((r) => JSON.stringify(r));
    for (const row of original.rows.agents[ALPHA]) expect(alpha).toContain(JSON.stringify(row));
    expect(recording.rows.agents[BETA]).toEqual(original.rows.agents[BETA]);
    // Every synthesized row is listed under its group and its source, and nothing else is new.
    const added = new Set(Object.values(recorded.synthesized.rows).flatMap((g) => g.uuids));
    const all = [...recording.rows.main, ...Object.values(recording.rows.agents).flat()].map((r) => r.uuid);
    const before = new Set([...original.rows.main, ...Object.values(original.rows.agents).flat()].map((r) => r.uuid));
    expect(new Set(all.filter((u) => !before.has(u)))).toEqual(added);
    for (const group of Object.values(recorded.synthesized.rows)) expect(group.source.length).toBeGreaterThan(20);
  });

  it('holds what the acceptance needs', () => {
    // More than one snapshot of history at the default budget, older rows first.
    const bytes = recording.rows.main.reduce((n, r) => n + JSON.stringify(r).length, 0);
    expect(bytes).toBeGreaterThan(SNAPSHOT_ROW_BUDGET);
    expect(recording.rows.main.slice(0, synthesized('older history').length).map((r) => r.uuid)).toEqual(synthesized('older history'));
    // An automatic compaction inside the older history, its boundary and summary as the engine writes them, with rows
    // before it in the same file, and far enough back that a snapshot at the default budget never reaches it: paging to
    // the first row crosses it (DC9's G2, the plan's M6).
    const boundary = recording.rows.main.findIndex((r) => r.type === 'system' && r.subtype === 'compact_boundary');
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(synthesized('older history').length);
    expect(recording.rows.main[boundary]).toMatchObject({ parentUuid: null, logicalParentUuid: recording.rows.main[boundary - 1].uuid, compactMetadata: { trigger: 'auto' } });
    expect(recording.rows.main[boundary + 1]).toMatchObject({ type: 'user', isCompactSummary: true, parentUuid: recording.rows.main[boundary].uuid });
    const newer = recording.rows.main.slice(boundary).reduce((n, r) => n + JSON.stringify(r).length, 0);
    expect(newer).toBeGreaterThan(SNAPSHOT_ROW_BUDGET);
    // A nested agent, spawned by alpha, its meta and the bridge's spawn naming its parent.
    expect(recording.meta[NESTED]).toMatchObject({ parentAgentId: ALPHA, spawnDepth: 2, requestShape: 'background' });
    expect(recording.steps.find((s) => s.k === 'agent' && s.agentId === NESTED)).toMatchObject({ spawn: { parentAgentId: ALPHA, background: true } });
    // The ask mod's async question: raised under its toolu_plugin_ id naming the transcript's call, answered from the
    // web, and its `question` and `answered` in the session's log by that call.
    const raised = recording.steps.find((s) => s.k === 'raised' && s.draft.async === true);
    if (raised?.k !== 'raised') throw new Error('no async question');
    expect(raised.draft).toMatchObject({ tool: 'mcp__doperpowers__AskUserQuestion', request: expect.stringMatching(/^toolu_plugin_/) });
    const call = raised.draft.toolUseId!;
    expect(recording.rows.main.some((r) => JSON.stringify(r.message ?? '').includes(`"id":"${call}","name":"mcp__doperpowers__AskUserQuestion"`))).toBe(true);
    expect(recording.steps.find((s) => s.k === 'settled' && s.draft.request === raised.draft.request)).toMatchObject({ draft: { winner: 'web', outcome: 'answered' } });
    const log = recording.steps.flatMap((s) => (s.k === 'log' ? [s.event] : []));
    expect(log.filter((e) => e.src === call).map((e) => e.kind)).toEqual(['question', 'answered']);
    // The session ends, and then a send to it is recorded undelivered.
    const end = recording.steps.findIndex((s) => s.k === 'presence' && s.record === null);
    expect(end).toBeGreaterThan(recording.steps.findLastIndex((s) => s.k === 'row'));
    const human = recording.steps.findIndex((s) => s.k === 'log' && s.event.kind === 'human');
    expect(human).toBeGreaterThan(end);
    expect(recording.steps.find((s) => s.k === 'delivery' && s.outcome === 'recorded')).toBeTruthy();
    // The shells' and the monitor's files: one present, one named and absent; the watcher's row names another session.
    expect(existsSync(join(SESSION_VIEW, 'tasks', `${SUITE}.output`))).toBe(true);
    expect(existsSync(join(SESSION_VIEW, 'tasks', `${MONITOR}.output`))).toBe(true);
    expect(existsSync(join(SESSION_VIEW, 'tasks', `${SERVE}.output`))).toBe(false);
  });
});

describe('a DC8 producer replaying it', () => {
  it('carries each agent’s status and the jobs as the replay proceeds, and exited once the session ends', async () => {
    const t = replay();
    await t.depth.subscribe('main', null);
    t.play((s) => s.k === 'agent' && s.agentId === NESTED);
    expect(entry(t.held('main'), NESTED)).toMatchObject({ status: 'running', evidence: 'bridge', running: true, spawn: { parentAgentId: ALPHA } });
    expect(jobsOf(t.held('main'))).toEqual({ [SUITE]: 'running', [SERVE]: 'running', [WATCH]: 'running', [MONITOR]: 'running' });
    expect(t.held('main').jobs?.find((j) => j.taskId === MONITOR)?.outputFile).toBeNull();
    // The nested agent's notification is in alpha's transcript, not the loop's.
    t.play(isRow(synthesized("the nested agent, in its parent's transcript").at(-1)!));
    expect(entry(t.held('main'), NESTED)).toMatchObject({ status: 'completed', evidence: 'rows', outcome: { raw: 'completed' } });
    t.play((s) => s.k === 'presence' && s.record === null);
    const end = t.held('main');
    expect(statusOf(end)).toEqual({ [ALPHA]: 'completed/rows', [BETA]: 'completed/rows', [NESTED]: 'completed/rows' });
    expect(jobsOf(end)).toEqual({ [SUITE]: 'completed', [SERVE]: 'stopped', [WATCH]: 'exited', [MONITOR]: 'exited' });
    expect(end.jobs?.find((j) => j.taskId === SERVE)).toMatchObject({ endedAt: expect.any(String), summary: 'Task "Serve the mockups" was stopped by the user' });
    expect(end.jobs?.find((j) => j.taskId === MONITOR)?.outputFile).toMatch(new RegExp(`/${recording.session}/tasks/${MONITOR}\\.output$`));
    expect(end.mcp).toEqual([{ name: 'doperpowers' }, { name: 'plugin:cua:cua_repl' }]);
    expect(end.subagents.every((a) => !('running' in a))).toBe(true);
    // Sent only when something changed.
    const bodies = t.of('main', 'subagents').map((m) => JSON.stringify(m.body));
    expect(bodies.every((b, i) => i === 0 || b !== bodies[i - 1])).toBe(true);
  });

  it('gives a cold open the statuses a subscription open all along reached', async () => {
    const live = replay();
    await live.depth.subscribe('main', null);
    const cuts: Array<(s: Step) => boolean> = [
      (s) => s.k === 'agent' && s.agentId === NESTED,
      (s) => s.k === 'agent-stop' && s.agentId === ALPHA,
      (s) => s.k === 'settled',
      (s) => s.k === 'presence' && s.record === null,
    ];
    for (const cut of cuts) {
      live.play(cut);
      const cold = replay();
      cold.play(cut);
      await cold.depth.subscribe('cold', null);
      expect(cold.held('cold')).toEqual(live.held('main'));
    }
  });

  it('answers output in each of its variants, from the rows’ paths and the recording’s tasks', async () => {
    const t = replay();
    await t.depth.subscribe('main', null);
    t.play((s) => s.k === 'agent' && s.agentId === NESTED);
    // A monitor just started has no file named yet.
    expect(t.output('main', MONITOR)).toEqual({ taskId: MONITOR, result: 'missing', path: null });
    t.play();
    const suite = readFileSync(join(SESSION_VIEW, 'tasks', `${SUITE}.output`), 'utf8');
    const path = (task: string, session = recording.session) => `/private/tmp/claude-501/-private-tmp-fmr-wd4sp6---work/${session}/tasks/${task}.output`;
    expect(t.output('main', SUITE, 524_288)).toEqual({ taskId: SUITE, result: 'ok', path: path(SUITE), size: suite.length, from: 0, text: suite, truncated: false });
    const window = t.output('main', SUITE, 300);
    if (window.result !== 'ok') throw new Error(window.result);
    expect(window).toMatchObject({ truncated: true, size: suite.length });
    expect(suite.slice(window.from)).toBe(window.text);
    expect(suite[window.from - 1]).toBe('\n');
    expect(window.from).toBeGreaterThan(suite.length - 300);
    expect(t.output('main', MONITOR)).toMatchObject({ result: 'ok', text: 'FAIL test_plane\n' });
    expect(t.output('main', SERVE)).toEqual({ taskId: SERVE, result: 'missing', path: path(SERVE) });
    const refused = t.output('main', WATCH);
    expect(refused).toMatchObject({ taskId: WATCH, result: 'refused', path: path(WATCH, '5e0c1f2a-7b3d-4e8f-9a6b-1c2d3e4f5a6b'), reason: expect.stringMatching(/\w/) });
    expect(t.output('main', 'bnotatask')).toEqual({ taskId: 'bnotatask', result: 'unknown-task' });
    // Nothing a path could be made of is answered at all.
    const before = t.sent.length;
    t.depth.output('main', '../x', 100);
    t.depth.output('main', SUITE, 0);
    expect(t.sent.length).toBe(before);
  });

  it('keeps a subscription open after the session ends, answering rows to the first row, and output', async () => {
    const t = replay();
    await t.depth.subscribe('main', null);
    t.play();
    expect(t.depth.presence).toBeNull();
    const snapshot = t.of('main', 'snapshot')[0].body;
    expect(snapshot.rows).toEqual([]);
    // A later subscription to the ended session: its snapshot holds less than the whole transcript, and pages bring
    // the rest, to the first row.
    await t.depth.subscribe('late', null);
    const late = t.of('late', 'snapshot')[0].body;
    expect(late.more).toBe(true);
    const drawn = [...late.rows].reverse().map((r) => r.uuid);
    for (let more = true; more; ) {
      t.depth.page('late', String(drawn[0]), 40);
      const page = t.of('late', 'rows').at(-1)!.body;
      drawn.unshift(...[...page.rows].reverse().map((r) => r.uuid));
      more = page.more;
    }
    expect(drawn).toEqual(recording.rows.main.map((r) => r.uuid));
    expect(t.output('late', SUITE)).toMatchObject({ result: 'ok' });
    expect(t.sent.filter((m) => m.kind === 'end')).toEqual([]);
    expect(t.of('late', 'output').map((m) => m.n)).toEqual([t.of('late', 'rows').length + 1]);
  });

  it('takes a reloaded module’s seed as the bridge’s agent state, and the rows outrank it', async () => {
    // A module that loaded after both subagents spawned: no spawn records, no stops, its seed from $.agent.list().
    const seed: Step = {
      at: 0,
      k: 'agents',
      agents: [ALPHA, BETA].map((agentId) => ({ agentId, parentAgentId: null, subagentType: 'general-purpose', description: String(recording.meta[agentId].description), running: true })),
    };
    const steps = recording.steps.flatMap((s): Step[] => (s.k === 'agent-stop' ? [] : s.k === 'agent' ? [{ at: s.at, k: 'agent', agentId: s.agentId }] : [s]));
    const t = replay(recording, 'dc8', steps);
    await t.depth.subscribe('main', null);
    t.play((s) => s.k === 'agent' && s.agentId === BETA);
    expect(entry(t.held('main'), ALPHA)).toMatchObject({ status: 'running', evidence: 'rows' });
    t.depth.apply(seed);
    expect(entry(t.held('main'), ALPHA)).toMatchObject({ status: 'running', evidence: 'bridge', running: true, spawn: { parentAgentId: null, subagentType: 'general-purpose' } });
    expect('name' in (entry(t.held('main'), ALPHA) as { spawn: object }).spawn).toBe(false);
    t.play();
    expect(statusOf(t.held('main'))).toEqual({ [ALPHA]: 'completed/rows', [BETA]: 'completed/rows', [NESTED]: 'completed/rows' });
  });

  it('builds the tree from a seed alone, and from an agent’s first row, with no spawn ever seen', async () => {
    // A recording that begins with the module's seed and holds no spawn event at all.
    const seed: Step = {
      at: 0,
      k: 'agents',
      agents: [ALPHA, BETA].map((agentId) => ({ agentId, parentAgentId: null, subagentType: 'general-purpose', description: String(recording.meta[agentId].description), running: true })),
    };
    const steps = [seed, ...recording.steps.filter((s) => s.k !== 'agent' && s.k !== 'agent-stop' && s.k !== 'agents')];
    const t = replay(recording, 'dc8', steps);
    t.play((s) => s === seed);
    await t.depth.subscribe('early', null);
    expect(t.held('early').subagents.map((a) => [a.agentId, a.meta])).toEqual([ALPHA, BETA].map((a) => [a, recording.meta[a]]));
    expect(statusOf(t.held('early'))).toEqual({ [ALPHA]: 'running/bridge', [BETA]: 'running/bridge' });
    t.play();
    // The nested agent, which no seed named, joins at its first row.
    expect(statusOf(t.held('early'))).toEqual({ [ALPHA]: 'completed/rows', [BETA]: 'completed/rows', [NESTED]: 'completed/rows' });
    await t.depth.subscribe('late', null);
    expect(t.held('late')).toEqual(t.held('early'));
  });

  it('gives an agent-scope subscription that agent’s own jobs and MCP names, in its snapshot and as they change', async () => {
    const agent = 'a0000000000000aa';
    const row = (uuid: string, s: number, fields: JsonObject): Step => ({ at: s, k: 'row', agentId: agent, row: { uuid, timestamp: `2026-10-17T09:00:0${s}.000Z`, isSidechain: true, agentId: agent, ...fields } });
    const rec: Recording = { ...recording, rows: { main: [], agents: {} }, meta: { [agent]: { agentType: 'general-purpose', description: 'Watch', toolUseId: 'toolu_W' } }, steps: [] };
    const steps: Step[] = [
      { at: 0, k: 'agent', agentId: agent },
      row('w1', 1, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_M', name: 'Monitor', input: { command: 'tail -F x', description: 'x' } }] } }),
      row('w2', 2, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_M', content: 'Monitor started (task bagent001).' }] }, toolUseResult: { taskId: 'bagent001', timeoutMs: 1000, persistent: false } }),
      row('w3', 3, { type: 'attachment', attachment: { type: 'mcp_instructions_delta', addedNames: ['plugin:agent:only'], removedNames: [] } }),
      row('w4', 4, { type: 'attachment', attachment: { type: 'task_status', taskId: 'bagent001', status: 'running', deltaSummary: null, outputFilePath: `/private/tmp/claude-501/-x/${recording.session}/tasks/bagent001.output` } }),
    ];
    const t = replay(rec, 'dc8', steps);
    await t.depth.subscribe('main', null);
    t.play((s) => s.k === 'row' && s.row.uuid === 'w3');
    await t.depth.subscribe('agent', agent);
    const snapshot = t.of('agent', 'snapshot')[0].body;
    expect(snapshot).toMatchObject({ subagents: [], mcp: [{ name: 'plugin:agent:only' }], jobs: [{ taskId: 'bagent001', kind: 'monitor', status: 'running', outputFile: null }] });
    t.play();
    expect(t.of('agent', 'subagents').map((m) => m.body.jobs?.[0]?.outputFile)).toEqual([`/private/tmp/claude-501/-x/${recording.session}/tasks/bagent001.output`]);
    t.depth.presence = null;
    expect(t.of('agent', 'subagents').at(-1)?.body.jobs?.[0]?.status).toBe('exited');
    // The main loop's are its own: none of the agent's.
    expect(t.held('main')).toMatchObject({ jobs: [], mcp: [] });
    expect(t.output('agent', 'bagent001')).toMatchObject({ result: 'refused' }); // its row names a root of no slug this recording knows
  });

  it('as an older producer, sends each agent’s id and meta alone, and passes output by', async () => {
    const t = replay(recording, 'dc3');
    await t.depth.subscribe('main', null);
    t.play();
    const snapshot = t.of('main', 'snapshot')[0].body;
    expect('jobs' in snapshot || 'mcp' in snapshot).toBe(false);
    const spawned = recording.steps.flatMap((s) => (s.k === 'agent' ? [s.agentId] : []));
    expect(t.of('main', 'subagents').at(-1)?.body).toEqual({ subagents: spawned.map((agentId) => ({ agentId, meta: recording.meta[agentId] })) });
    const before = t.sent.length;
    t.depth.output('main', SUITE, 100);
    expect(t.sent.length).toBe(before);
  });
});

describe('the fake machine replaying it through the local hub', () => {
  let hub: LocalHub;
  let member: string;
  beforeAll(async () => {
    hub = await startLocalHub();
    member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  });
  afterAll(() => hub?.close());

  async function until(test: () => boolean, what: string, ms = 10_000) {
    const deadline = Date.now() + ms;
    while (!test()) {
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('relays the widened body, answers output, and pages an ended session to its first row', async () => {
    const project = '8b2d0a8e-3b2d-4c5e-9f70-0000000dc902';
    const machine = `fm-sv-${Math.random().toString(36).slice(2, 6)}`;
    const fm = new FakeMachine({ hub: hub.url, machine, credentials: await enroll(hub, ADMIN, machine), orgKey: new Uint8Array(32).fill(7), project, recordings: [loadRecording(SESSION_VIEW)], member, producer: 'dc8' });
    await fm.connect();
    const b = await BrowserClient.open(hub, ADMIN, project);
    const sub = newNonce();
    const mine = () => b.frames.flatMap((f) => (f.t === 'session' && f.message.sub === sub ? [f.message] : []));
    b.send({ t: 'subscribe', machine, session: recording.session, agentId: null, sub });
    await until(() => mine().length > 0, 'the snapshot');
    await fm.play({ speed: 0 });
    await until(() => b.frames.some((f) => f.t === 'session' && f.message.kind === 'presence' && f.message.session === recording.session && f.message.body.record === null), 'the session’s end');
    const tree = () => mine().filter((m) => m.kind === 'subagents').at(-1)?.body as SessionBodies['subagents'] | undefined;
    await until(() => tree()?.jobs?.some((j) => j.status === 'exited') === true, 'the exited jobs');
    const last = tree()!;
    expect(statusOf(last)).toEqual({ [ALPHA]: 'completed/rows', [BETA]: 'completed/rows', [NESTED]: 'completed/rows' });

    // After the replay: `output` and `rows` are answered on the open subscription, numbered on from where it stood.
    b.send({ t: 'output', sub, taskId: SUITE, tail: 64 });
    b.send({ t: 'output', sub, taskId: WATCH, tail: 64 });
    await until(() => mine().filter((m) => m.kind === 'output').length === 2, 'two outputs');
    expect(mine().filter((m) => m.kind === 'output').map((m) => (m.body as TaskOutput).result)).toEqual(['ok', 'refused']);
    const first = String(recording.rows.main[1].uuid);
    b.send({ t: 'rows', sub, before: first, limit: 10 });
    await until(() => mine().some((m) => m.kind === 'rows'), 'a page');
    expect(mine().find((m) => m.kind === 'rows')?.body).toEqual({ rows: [recording.rows.main[0]], before: first, more: false });
    const ns = mine().map((m) => m.n);
    expect(ns).toEqual(ns.map((_, i) => i));
    expect(mine().some((m) => m.kind === 'end')).toBe(false);
    b.close();
    await fm.close();
  });
});
