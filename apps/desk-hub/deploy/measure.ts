// `deployment measure`: DC3.G6, the session plane's throughput through one project's object, on the deployment.
//
// Three machines each hold one streaming session and post the chunks of every 100 ms as one batch (a POST, as the
// daemon batches); browsers subscribe to all three sessions (one sub per browser and session, as M3 built it: the
// machine sends each chunk once per sub). Each chunk carries the time its machine queued it, so the latency is from a
// machine's post to a browser's receipt (one clock: everything runs here).
//
// Two series, each step a whole wall-clock minute so the account's per-minute analytics attribute CPU to it:
//   - fan-out: K chunks per batch fixed, browsers 1, 2, 4, 8 — the cost per subscriber;
//   - ramp: 4 browsers, K doubling from 1 — until p95 passes 1 s or anything errs (a refused POST, a gap in a sub's n, an
//     end, a closed socket), which stops the run.
//
// stdin: DESK_ACCESS_TOKEN (the owner's Access app token). Options: --out <file.json>, --ramp-max <K> (default 256),
// --fanout-k <K> (default 4), --step-s <s> (default 60), --skip-fanout.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import type { Link } from '../fake-machine/link';
import type { DownFrame, UpFrame } from '../src/protocol/machine';
import { newNonce } from '../src/protocol/codes';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enroll, machineLink, Person, sleep, until, type Socket } from './hub';
import { join } from 'node:path';

type Sub = { sub: string; n: number };
type Machine = { name: string; session: string; link: Link; frames: DownFrame[]; subs: Map<string, Sub>; buffer: UpFrame[]; chunkIndex: number };
type Step = {
  series: 'fanout' | 'ramp';
  k: number;
  browsers: number;
  start: string;
  end: string;
  chunksPerSecond: number;
  relayedPerSecond: number;
  latency: { p50: number; p95: number; p99: number; max: number; count: number };
  post: { p50: number; p95: number; max: number; count: number; avgFrames: number };
  loopLagMax: number;
  /** This machine's load average (1, 5, 15 minutes) at the step's end: the client shares the Mac with other work. */
  load: number[];
  errors: string[];
};

const TEXT = 'the quick brown fox jumps over the lazy dog';
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') },
      out: { type: 'string' },
      'ramp-max': { type: 'string', default: '256' },
      'fanout-k': { type: 'string', default: '4' },
      'step-s': { type: 'string', default: '60' },
      'skip-fanout': { type: 'boolean', default: false },
    },
  });
  const config = readDeployConfig(values.config!);
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const hub = `https://${config.host}`;
  const owner = new Person(hub, secrets.DESK_ACCESS_TOKEN);
  const tag = Math.random().toString(36).slice(2, 7);
  const project = randomUUID();
  const stepMs = Number(values['step-s']) * 1000;

  // The machines.
  const machines: Machine[] = [];
  for (let i = 1; i <= 3; i++) {
    const name = `ms-${i}-${tag}`;
    const { link, frames } = await machineLink(hub, await enroll(owner, name));
    const m: Machine = { name, session: randomUUID(), link, frames, subs: new Map(), buffer: [], chunkIndex: 0 };
    machines.push(m);
    await link.post([{ t: 'hello', project, name: `dc3-m5 measure ${tag}`, have: {} }]);
    await until(() => frames.find((f) => f.t === 'have'), 'have');
    await link.post([
      { t: 'session', message: { project, machine: name, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] } } },
      { t: 'session', message: { project, machine: name, session: m.session, kind: 'presence', sub: null, n: null, body: { record: { status: 'busy' }, bridge: true } } },
    ]);
  }
  console.log(`machines ${machines.map((m) => m.name).join(', ')} on project ${project}`);

  // Each machine serves subscriptions: a snapshot at n 0, then its chunks, numbered per sub.
  let errors: string[] = [];
  const seen = machines.map(() => 0);
  const serve = () => {
    machines.forEach((m, i) => {
      for (; seen[i] < m.frames.length; seen[i]++) {
        const f = m.frames[seen[i]];
        if (f.t === 'subscribe') {
          m.subs.set(f.sub, { sub: f.sub, n: 1 });
          m.buffer.push({
            t: 'session',
            message: { project, machine: m.name, session: m.session, kind: 'snapshot', sub: f.sub, n: 0, body: { rows: [], more: false, subagents: [], presence: { record: { status: 'busy' }, bridge: true }, streaming: [], usage: null } },
          });
        } else if (f.t === 'unsubscribe') m.subs.delete(f.sub);
      }
    });
  };

  // The batches: every 100 ms each machine queues K chunks per sub; one POST in flight per machine, carrying whatever
  // queued meanwhile (so a slow hub sees bigger, later batches, as it would from a daemon).
  let k = 0;
  const posts: Array<{ at: number; ms: number; frames: number }> = [];
  let running = true;
  const tick = setInterval(() => {
    serve();
    if (!k) return;
    for (const m of machines) {
      const sentAt = Date.now();
      for (let c = 0; c < k; c++) {
        const chunkIndex = m.chunkIndex++;
        for (const s of m.subs.values()) {
          m.buffer.push({
            t: 'session',
            message: { project, machine: m.name, session: m.session, kind: 'chunk', sub: s.sub, n: s.n++, body: { turnId: 'turn-1', agentId: null, step: 1, chunkIndex, chunk: { type: 'text', text: TEXT, sentAt } } },
          });
        }
      }
    }
  }, 100);
  const senders = machines.map((m) =>
    (async () => {
      while (running) {
        serve();
        if (!m.buffer.length) {
          await sleep(5);
          continue;
        }
        const frames = m.buffer.splice(0);
        const at = Date.now();
        try {
          await m.link.post(frames);
          posts.push({ at, ms: Date.now() - at, frames: frames.length });
        } catch (error) {
          errors.push(`${m.name}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
          await sleep(1000);
        }
      }
    })(),
  );

  // The browsers.
  type Browser = { socket: Socket; subs: Map<string, number> };
  const browsers: Browser[] = [];
  const latencies: Array<{ at: number; ms: number }> = [];
  const openBrowser = async (): Promise<Browser> => {
    const socket = await owner.socket(`/api/projects/${project}/socket`);
    await socket.next((f) => f.t === 'welcome', 'welcome');
    const b: Browser = { socket, subs: new Map() };
    socket.onFrame = (frame, at) => {
      if (frame.t !== 'session') return;
      const message = frame.message as { kind: string; sub: string | null; n: number; body: { chunk?: { sentAt: number }; reason?: string } };
      if (!message.sub || !b.subs.has(message.sub)) return;
      if (message.kind === 'end') return void errors.push(`sub ended: ${message.body.reason}`);
      const expected = b.subs.get(message.sub)!;
      if (message.n !== expected) errors.push(`a gap in a sub: n ${message.n} for ${expected}`);
      b.subs.set(message.sub, message.n + 1);
      if (message.kind === 'chunk') latencies.push({ at, ms: at - message.body.chunk!.sentAt });
    };
    return b;
  };
  const subscribe = async (b: Browser) => {
    for (const m of machines) {
      const sub = newNonce();
      b.subs.set(sub, 0);
      b.socket.send({ t: 'subscribe', machine: m.name, session: m.session, agentId: null, sub });
    }
    await until(() => ([...b.subs.values()].every((n) => n > 0) ? true : undefined), 'snapshots');
  };
  const unsubscribe = (b: Browser) => {
    for (const sub of b.subs.keys()) b.socket.send({ t: 'unsubscribe', sub });
    b.subs.clear();
  };
  for (let i = 0; i < 8; i++) browsers.push(await openBrowser());

  // The event loop's lag, so the client's own saturation is told apart from the hub's.
  let lagMax = 0;
  let last = Date.now();
  const lag = setInterval(() => {
    const now = Date.now();
    lagMax = Math.max(lagMax, now - last - 50);
    last = now;
  }, 50);

  const steps: Step[] = [];
  const toMinute = async () => {
    const now = Date.now();
    await sleep(60_000 - (now % 60_000) + 200);
  };
  const runStep = async (series: Step['series'], kNow: number, active: number): Promise<Step> => {
    for (const [i, b] of browsers.entries()) {
      if (i < active && b.subs.size === 0) await subscribe(b);
      if (i >= active && b.subs.size > 0) unsubscribe(b);
    }
    if (stepMs >= 60_000) await toMinute();
    k = kNow;
    errors = [];
    lagMax = 0;
    const start = Date.now();
    const warm = start + 5000;
    await sleep(stepMs - 1000);
    const end = Date.now();
    const lat = latencies.filter((l) => l.at >= warm && l.at < end).map((l) => l.ms).sort((a, b) => a - b);
    const ps = posts.filter((p) => p.at >= warm && p.at < end);
    const postMs = ps.map((p) => p.ms).sort((a, b) => a - b);
    const seconds = (end - warm) / 1000;
    const step: Step = {
      series,
      k: kNow,
      browsers: active,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      chunksPerSecond: 3 * 10 * kNow,
      relayedPerSecond: Math.round(lat.length / seconds),
      latency: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.at(-1) ?? NaN, count: lat.length },
      post: { p50: pct(postMs, 50), p95: pct(postMs, 95), max: postMs.at(-1) ?? NaN, count: ps.length, avgFrames: Math.round(ps.reduce((s, p) => s + p.frames, 0) / Math.max(1, ps.length)) },
      loopLagMax: lagMax,
      load: loadavg().map((l) => Math.round(l)),
      errors: [...new Set(errors)].slice(0, 5),
    };
    console.log(
      `${series} K=${kNow} browsers=${active}: ${step.chunksPerSecond} chunks/s, ${step.relayedPerSecond} relayed/s, latency p50 ${step.latency.p50} p95 ${step.latency.p95} p99 ${step.latency.p99} ms; ` +
        `POST p95 ${step.post.p95} ms (${step.post.avgFrames} frames); client lag ≤ ${lagMax} ms; load ${step.load.join('/')}${step.errors.length ? `; errors ${step.errors.join(' | ')}` : ''}`,
    );
    steps.push(step);
    // Drain between steps: no chunk, so the next step starts from an empty pipe.
    k = 0;
    await until(() => (machines.every((m) => m.buffer.length === 0) ? true : undefined), 'a drained pipe', 120_000).catch(() => {});
    await sleep(2000);
    return step;
  };

  let verdict = 'the ramp reached its maximum without passing the threshold';
  try {
    if (!values['skip-fanout']) for (const active of [1, 2, 4, 8]) await runStep('fanout', Number(values['fanout-k']), active);
    for (let kNow = 1; kNow <= Number(values['ramp-max']); kNow *= 2) {
      const step = await runStep('ramp', kNow, 4);
      if (step.latency.p95 > 1000 || step.errors.length || Number.isNaN(step.latency.p95)) {
        verdict = `stopped at K=${kNow}: ${step.latency.p95 > 1000 ? `p95 ${step.latency.p95} ms` : `errors: ${step.errors.join(' | ') || 'no chunk arrived'}`}`;
        break;
      }
    }
  } finally {
    running = false;
    clearInterval(tick);
    clearInterval(lag);
    await Promise.all(senders);
    for (const b of browsers) b.socket.close();
    for (const m of machines) await m.link.drop();
    for (const m of machines) console.log(`revoked ${m.name}: ${(await owner.fetch(`/api/machines/${m.name}`, { method: 'DELETE' })).status}`);
  }
  console.log(verdict);
  if (values.out) writeFileSync(values.out, JSON.stringify({ hub, project, machines: machines.map((m) => m.name), verdict, steps }, null, 2));
  return 0;
}
