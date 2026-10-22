// The harness's arithmetic, offline: percentiles as the desk's instrument takes them, daemon.log's lines parsed and
// paired, a run turned into milestones and joined into the baseline. `node --test spikes/desk-latency/test/*.test.mjs`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cohortOf, join, milestones, readRun, render, summarizeGroup } from '../join.mjs';
import { parseDaemonLog, parseRcDebug, parseTranscript } from '../machine.mjs';
import { describe, percentile } from '../lib/stats.mjs';
import { classifyDesk, DESK } from '../lib/desk-selectors.mjs';
import { startNet } from '../lib/net.mjs';
import { classifyRc, RC, RC_NET } from '../lib/rc-selectors.mjs';
import { deskSurface, rcSurface } from '../lib/surfaces.mjs';

// build.mjs inlines every lib module into one scope, where the surfaces read the selectors as free names.
Object.assign(globalThis, { DESK, RC, RC_NET });

test('percentiles by nearest rank, as the instrument takes them', () => {
  const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(sorted, 50), 10);
  assert.equal(percentile(sorted, 95), 19);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(describe([3, 1, 2, Number.NaN, null]), { n: 3, p50: 2, p95: 3, max: 3, low: true });
});

const LOG = [
  '2026-10-21T14:38:45.107Z plane: open RwvaPH5bu6XtOX7WzY_gFQ of b4948247: bridge snapshot after 0.04 s from the subscribe\'s arrival (bridge: snapshot arrived 0.00 s, taken 0.01 s; build: warm 0 ms 31107 rows, cut on disk; waits 0)',
  '2026-10-20T05:07:51.574Z plane: open iRr0MNX32-sEYAwnRIJyaw of a6dee14b: bridge snapshot after 5.40 s (the bridge\'s snapshot at 1.43 s)',
  '2026-10-21T14:40:00.000Z uplink: the stream closed: the hub ended the stream',
  '2026-10-21T14:40:01.350Z uplink: connected to https://hub as macbook (stream 7)',
  '2026-10-21T14:50:00.000Z uplink: a POST was not delivered (503 delivery-failed): reconnecting, to redo the handshake',
  '2026-10-21T14:50:00.100Z uplink: the stream closed: Connection reset by peer',
  '2026-10-21T14:50:02.000Z uplink: started (pid 42) for https://hub as macbook',
  '2026-10-21T14:50:03.000Z uplink: connected to https://hub as macbook (stream 8)',
  '2026-10-21T14:51:00.000Z uplink: delivered 1 in MAWS to lat-ask',
  '2026-10-21T14:52:00.000Z uplink: session lane closed connection #9 after 12 POSTs (idle)',
  'a derive line with no stamp',
].join('\n');

test("daemon.log: the open line in both formats, the stream's recycles paired, a restart told apart", () => {
  const d = parseDaemonLog(LOG, 0, Date.parse('2026-10-22T00:00:00Z'));
  assert.equal(d.opens.length, 2);
  assert.deepEqual(
    { sub: d.opens[0].sub, ms: d.opens[0].ms, arrival: d.opens[0].arrival, build: d.opens[0].build },
    { sub: 'RwvaPH5bu6XtOX7WzY_gFQ', ms: 40, arrival: Date.parse('2026-10-21T14:38:45.067Z'), build: { how: 'warm', cpuMs: 0, rows: 31107 } },
  );
  assert.equal(d.opens[1].bridgeArrivedMs, 1430);
  assert.deepEqual(
    d.recycles.map((r) => [r.cause, r.ms, r.restarted]),
    [
      ['closed', 1350, false],
      ['post-not-delivered', 3000, true],
    ],
  );
  assert.equal(d.delivered[0].to, 'lat-ask');
  assert.deepEqual(d.lanes, { dialled: 0, closed: 1, posts: 12, reasons: { idle: 1 } });
});

test('a Remote Control debug log and a transcript, by the ids and tokens a repetition carries', () => {
  const rc = parseRcDebug(
    ['2026-10-21T15:00:00.010Z [DEBUG] [bridge:repl] Ingress message type=user uuid=u-1', '2026-10-21T15:00:00.020Z [DEBUG] [bridge:repl] Sent control_response for interrupt request_id=interrupt-1-x result=success'].join('\n'),
    0,
    Infinity,
  );
  assert.deepEqual(rc.map((e) => e.kind), ['ingress', 'control_response']);
  const rows = parseTranscript(
    [
      JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-21T15:00:01.000Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'touch /tmp/desk-lat/lat3abcd' } }] } }),
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-21T15:00:00.500Z', message: { content: 'Run … lat3abcd' } }),
    ].join('\n'),
    0,
    Infinity,
  );
  assert.deepEqual(rows.map((r) => [r.type, r.tokens, r.toolUses.map((t) => t.name)]), [
    ['assistant', ['lat3abcd'], ['Bash']],
    ['user', ['lat3abcd'], []],
  ]);
});

/** A permission repetition: the prompt's Enter at `enter`, its card painted `cardMs` after it, the decision `dwellMs` later. */
function permissionRep(enter, cardMs, dwellMs) {
  const start = enter + cardMs + dwellMs;
  return {
    ok: true,
    token: 'lat3abcd',
    start: { type: 'click', wall: start },
    marks: { 'raise.card': { ms: cardMs, wall: enter + cardMs }, 'decide.gone': { ms: 80, wall: start + 80 }, early: { ms: 0, already: true } },
    raise: { start: { type: 'keydown', wall: enter } },
  };
}
const toolCall = (at) => ({ at, type: 'assistant', tokens: ['lat3abcd'], toolUses: [{ id: 't', name: 'Bash' }], toolResults: [] });

test('a repetition becomes milestones: its marks, frames, samples, and the machine by subscription and token', () => {
  const enter = Date.parse('2026-10-21T15:00:00.000Z');
  const rep = permissionRep(enter, 1500, 450);
  const start = rep.start.wall;
  rep.net = { sent: 3, done: null };
  rep.inApp = [
    { path: 'view.snapshot', ms: 50, at: start + 400, ref: 'subA' },
    { path: 'view.first-rows', ms: 120, at: start + 470, ref: 'subA' },
    { path: 'stream.chunk', ms: 9, at: start + 10 },
  ];
  rep.marks.actionable = { ms: 40, wall: start - 900, from: 'online' }; // counted from the network back: not a milestone
  const machine = {
    daemon: { opens: [{ sub: 'subA', arrival: start + 300, at: start + 340 }], delivered: [] },
    transcripts: { s: [toolCall(enter + 1000)] },
  };
  const ms = milestones(rep, { load: 'permission' }, [machine]);
  assert.deepEqual(ms, {
    'raise.card': 1500,
    'decide.gone': 80,
    'net.sent': 3,
    'app:view.snapshot': 400,
    'app:view.first-rows': 470,
    'app:subscribed': 350,
    'm:arrival': 300,
    'm:snapshot': 340,
    'm:tool_use': -950,
    'raise.machine': 500,
  });
});

test("the raise is the card's paint less the tool call's row, both wall times, however long the decision waited", () => {
  const enter = Date.parse('2026-10-21T15:00:00.000Z');
  // The call's row 700 ms after the Enter, its card 500 ms later, the decision 2.5 s after that.
  const rep = permissionRep(enter, 1200, 2500);
  const ms = milestones(rep, { load: 'permission' }, [{ transcripts: { s: [toolCall(enter + 700)] } }]);
  assert.equal(ms['raise.machine'], 500);
  assert.equal(ms['m:tool_use'], -3000);
  // The decision's timeline holds no raise mark, whose origins are the Enter and the machine's row.
  const g = summarizeGroup([ms], 'decide.gone');
  assert.deepEqual(g.timeline, [['decide.gone', 80]]);
});

test("daemon.log's delivery lines name no item: counted per window, never a repetition's milestone", () => {
  const d = parseDaemonLog(LOG, 0, Date.parse('2026-10-22T00:00:00Z'));
  const start = Date.parse('2026-10-21T14:50:59.900Z'); // 100 ms before the delivered line
  const runs = [{ target: 'desk', load: 'send', config: {}, reps: [{ ok: true, token: 'lat0abcd', start: { type: 'keydown', wall: start }, marks: { echo: { ms: 4 } } }] }];
  const machines = [{ machine: 'macbook', daemon: d }];
  assert.deepEqual(milestones(runs[0].reps[0], runs[0], machines), { echo: 4 });
  assert.match(render(join(runs, machines), machines, runs), /- deliveries .*: 1 lines, 1 events/);
});

/** A frame list as the network half keeps it: each desk frame labelled by the classifier, at its time. */
const deskNet = (frames) => {
  const events = frames.flatMap(([at, dir, frame]) => {
    const label = classifyDesk(dir, 'wss://hub/api/projects/p/socket', typeof frame === 'string' ? frame : JSON.stringify(frame));
    return label ? [{ dir, at, ...label }] : [];
  });
  return { first: (since, match) => events.find((e) => e.at >= since && match(e)) ?? null };
};

test("a send's hops chain by its ids: its ack by nonce, the delivery by the event the ack named, in the rep's session", () => {
  const session = 's-1';
  const mac = (nonce) => ({ event: { mac: { nonce } } });
  const delivery = (writer, seq, s) => ({ t: 'session', message: { kind: 'delivery', session: s, sub: null, n: null, machine: 'm', body: { event: { writer, seq }, session: s, outcome: 'delivered' } } });
  const chunk = (s) => ({ t: 'session', message: { kind: 'chunk', session: s, sub: 'x', n: 3, machine: 'm', body: { t: 1 } } });
  const net = deskNet([
    [10, 'out', { t: 'human', ...mac('A') }], // the repetition's send
    [12, 'out', { t: 'human', ...mac('B') }], // an outbox resend
    [15, 'in', { t: 'human-ack', nonce: 'B', offset: 7, writer: 'web/o', seq: 2 }],
    [20, 'in', { t: 'human-ack', nonce: 'A', offset: 8, writer: 'web/o', seq: 3 }],
    [25, 'in', delivery('web/o', 2, session)],
    [26, 'in', chunk('s-2')],
    [30, 'in', delivery('web/o', 3, session)],
    [35, 'in', chunk(session)],
  ]);
  const hops = deskSurface({ url: 'http://x', project: 'p' }).hops(net, 0, 'send', session);
  assert.deepEqual(hops.times, { sent: 10, ack: 20, delivery: 30, firstChunk: 35 });
  assert.deepEqual(hops.ids, { nonce: 'A', writer: 'web/o', seq: 3, session });
});

test("a frame over the bound is labelled once its parts are joined, at the last part's time, and the open's snapshot matched by its sub", () => {
  const snapshot = JSON.stringify({ t: 'session', message: { kind: 'snapshot', session: 's-1', sub: 'sub-1', n: 0, machine: 'm', body: { rows: ['x'.repeat(90)] } } });
  const third = Math.ceil(snapshot.length / 3);
  const part = (index) => JSON.stringify({ t: 'part', id: 'p-1', index, count: 3, data: snapshot.slice(index * third, (index + 1) * third) });
  const net = deskNet([
    [10, 'out', { t: 'subscribe', machine: 'm', session: 's-2', agentId: null, sub: 'sub-2' }],
    [11, 'out', { t: 'subscribe', machine: 'm', session: 's-1', agentId: null, sub: 'sub-1' }],
    [20, 'in', part(2)], // the parts come in any order
    [21, 'in', part(0)],
    [27, 'in', part(1)],
  ]);
  const hops = deskSurface({ url: 'http://x', project: 'p' }).hops(net, 0, 'open', 's-1');
  assert.deepEqual(hops.times, { subscribe: 11, snapshot: 27 });
  assert.deepEqual(hops.ids, { sub: 'sub-1', session: 's-1' });
});

/** RC's frames as the network half keeps them: `[at, dir, url, text, rid?]`, each line labelled by the classifier. */
const rcNet = (frames) => {
  const labels = (dir, url, text) => (dir === 'ws-open' ? [{}] : [classifyRc(dir, url, text) ?? []].flat());
  const events = frames.flatMap(([at, dir, url, text, rid]) => labels(dir, url, text).map((label) => ({ dir, url, at, ...(rid && { rid }), ...label })));
  return { first: (since, match) => events.find((e) => e.at >= since && match(e)) ?? null };
};
const API = 'https://api.example/v1/sessions/cse_abc/events';
const WS = 'wss://api.example/v1/sessions/ws/cse_abc/subscribe';

test("RC's hops chain by the ids the page sent: a batch's user uuid, its own POST's end, a control's request id", () => {
  const batch = JSON.stringify({ events: [{ payload: { type: 'control_request', uuid: 'settings-uuid', request_id: 'set-1', request: { subtype: 'set_model' } } }, { payload: { type: 'user', uuid: 'u-1' } }] });
  const net = rcNet([
    [10, 'req', API, `POST ${batch}`, 'r-post'],
    [12, 'done', 'https://api.example/v1/code/sessions?x', 'GET', 'r-list'], // another request ending first
    [14, 'done', API, 'GET', 'r-history'],
    [20, 'in', WS, JSON.stringify({ type: 'user', uuid: 'other' })],
    [25, 'in', WS, JSON.stringify({ type: 'user', uuid: 'u-1', isReplay: true })],
    [30, 'done', API, 'POST', 'r-post'],
  ]);
  const steer = rcSurface({}).hops(net, 0, 'steer');
  assert.deepEqual(steer.times, { post: 10, posted: 30, consumed: 25, firstDelta: null });
  assert.equal(steer.ids.uuid, 'u-1');
});

test("RC's initialize reply is the one to the page's own initialize, and the list's freshness is its own", async () => {
  const init = JSON.stringify({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize' } });
  const net = rcNet([
    [10, 'ws-open', WS, null],
    [12, 'out', WS, init],
    [15, 'in', WS, JSON.stringify({ type: 'control_response', response: { request_id: 'perm-9', subtype: 'success' } })], // another client's
    [40, 'in', WS, JSON.stringify({ type: 'control_response', response: { request_id: 'init-1', subtype: 'success' } })],
    [50, 'done', 'https://api.example/v1/code/sessions', 'GET', 'r-list'],
  ]);
  const rc = rcSurface({});
  assert.deepEqual(rc.hops(net, 0, 'open').times, { history: null, socket: 10, initialized: 40 });
  const ctx = { net };
  assert.equal(await rc.freshAt(ctx, 'session', 0), 40);
  assert.equal(await rc.freshAt(ctx, 'list', 0), 50);
});

test("without CDP, a request's start and end still share an id, so its own end is told from another's", async () => {
  const on = {};
  const page = { context: () => ({ newCDPSession: async () => Promise.reject(new Error('refused')) }), on: (name, f) => (on[name] = f), evaluate: async () => null };
  const net = await startNet(page, classifyRc);
  const request = (method, url) => ({ url: () => url, method: () => method, postData: () => (method === 'POST' ? JSON.stringify({ events: [{ type: 'user', uuid: 'u-1' }] }) : null) });
  const post = request('POST', API);
  const meta = request('GET', API);
  on.request(post);
  on.request(meta);
  on.requestfinished(meta);
  on.requestfinished(post);
  const started = net.first(0, (e) => e.dir === 'req' && e.method === 'POST');
  const ended = net.first(0, (e) => e.dir === 'done' && e.rid === started.rid);
  assert.equal(net.mode, 'playwright');
  assert.equal(ended.method, 'POST');
});

test("a group's timeline in median order, and its costliest hop up to the end mark", () => {
  const g = summarizeGroup([{ a: 10, b: 100, useful: 130, late: 900 }, { a: 12, b: 110, useful: 150, late: 950 }], 'useful');
  assert.deepEqual(g.timeline, [['a', 10], ['b', 100], ['useful', 130]]);
  assert.deepEqual(g.costliest, { from: 'a', to: 'b', ms: 90 });
});

test('runs join per cohort and target, and render with both apps side by side', () => {
  const run = (target, ms) => ({ target, load: 'session', config: { cohort: 'cold' }, reps: ms.map((v) => ({ ok: true, start: { wall: 0 }, marks: { content: { ms: v / 2 }, useful: { ms: v } } })) });
  assert.equal(cohortOf({ load: 'send', config: {} }), 'warm');
  assert.equal(cohortOf({ load: 'app', config: {} }), 'cold');
  const runs = [run('desk', [1000, 1200, 3000]), readRun(JSON.stringify(JSON.stringify(run('rc', [400, 500, 600]))))];
  const groups = join(runs, []);
  const md = render(groups, [], runs);
  assert.match(md, /## cold/);
  assert.match(md, /\| session \| useful \| 3 \| 1200 \| 3000\* \| 3 \| 500 \| 600\* \| 700 \| 2400 \|/);
  assert.match(md, /### cold session: Δp95 2400, Δp50 700/);
});

test("a load's partial runs (a pass stopped and resumed) pool into one group", () => {
  const run = (ms) => ({ target: 'desk', load: 'session', variant: 'idle', config: { cohort: 'cold' }, reps: ms.map((v) => ({ ok: true, start: { wall: 0 }, marks: { useful: { ms: v } } })) });
  const groups = join([run([100, 200]), run([300]), { ...run([900]), variant: 'ended' }], []);
  assert.deepEqual(groups.map((g) => [g.variant, g.n, g.stats.useful.p50]), [['idle', 3, 200], ['ended', 1, 900]]);
});
