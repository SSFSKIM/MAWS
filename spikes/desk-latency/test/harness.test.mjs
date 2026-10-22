// The harness's arithmetic, offline: percentiles as the desk's instrument takes them, daemon.log's lines parsed and
// paired, a run turned into milestones and joined into the baseline. `node --test spikes/desk-latency/test/*.test.mjs`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cohortOf, join, milestones, readRun, render, summarizeGroup } from '../join.mjs';
import { parseDaemonLog, parseRcDebug, parseTranscript } from '../machine.mjs';
import { describe, percentile } from '../lib/stats.mjs';

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

test('a repetition becomes milestones: its marks, frames, samples, and the machine by subscription and token', () => {
  const start = Date.parse('2026-10-21T15:00:00.000Z');
  const rep = {
    ok: true,
    token: 'lat3abcd',
    start: { type: 'keydown', wall: start },
    marks: { 'raise.card': { ms: 1500, wall: start + 1500 }, 'decide.gone': { ms: 80 }, early: { ms: 0, already: true } },
    net: { sent: 3, done: null },
    inApp: [
      { path: 'view.snapshot', ms: 50, at: start + 400, ref: 'subA' },
      { path: 'view.first-rows', ms: 120, at: start + 470, ref: 'subA' },
      { path: 'stream.chunk', ms: 9, at: start + 10 },
    ],
  };
  const machine = {
    daemon: { opens: [{ sub: 'subA', arrival: start + 300, at: start + 340 }], delivered: [] },
    transcripts: { s: [{ at: start + 1000, type: 'assistant', tokens: ['lat3abcd'], toolUses: [{ id: 't', name: 'Bash' }], toolResults: [] }] },
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
    'm:tool_use': 1000,
    'raise.machine': 500,
  });
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
