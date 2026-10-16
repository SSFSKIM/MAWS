// `deployment measure`: DC3.G6, the session plane's throughput through one project's object, on the deployment.
//
// Three machines each hold one streaming session and post the chunks of every 100 ms as one batch (a POST, as the
// daemon batches); browsers subscribe to all three sessions (one sub per browser and session, as M3 built it: the
// machine sends each chunk once per sub). Each chunk carries the time its machine queued it, so the latency is from a
// machine's post to a browser's receipt (one clock: everything runs here).
//
// Three series, each step a whole wall-clock minute so the account's per-minute analytics attribute CPU to it:
//   - budget (the phase-1 budget, the composite writer's ruling): one session streaming 150 chunks/s (a main loop and a
//     subagent) watched by 1, 2, and 3 browsers, chunk latency p95 within 1 s; meanwhile another machine's presence
//     change and log event every 2 s, each reaching a browser within 2 s;
//   - fan-out: all three machines streaming K chunks per batch, browsers 1, 2, 4, 8 — the cost per subscriber;
//   - ramp: 4 browsers, K doubling from 1 — until p95 passes 1 s or anything errs (a refused POST, a gap in a sub's n, an
//     end, a closed socket), which stops the series.
//
// stdin: DESK_ACCESS_TOKEN (the owner's Access app token). Options: --test-org <throwaway org> (required, proof.ts), --out <file.json>, --ramp-max <K> (default 256),
// --fanout-k <K> (default 1), --step-s <s> (default 60), --series budget,fanout,ramp (default all). Each series stops at its first step past the
// threshold; the results are written after every step.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import type { Link } from '../fake-machine/link';
import type { DownFrame, UpFrame } from '../src/protocol/machine';
import { importOrgKey, newNonce, seal } from '../src/protocol/codes';
import type { LogEvent } from '../src/protocol/log';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enroll, machineLink, newOrgKey, Person, sleep, until, type Socket } from './hub';
import { Cleanup, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';
import { join } from 'node:path';

type Sub = { sub: string; n: number };
type Machine = { name: string; session: string; link: Link; frames: DownFrame[]; subs: Map<string, Sub>; buffer: UpFrame[]; chunkIndex: number };
type Step = {
  series: 'budget' | 'fanout' | 'ramp';
  /** Chunks per 100 ms batch, per machine. */
  rates: number[];
  browsers: number;
  start: string;
  end: string;
  chunksPerSecond: number;
  relayedPerSecond: number;
  latency: { p50: number; p95: number; p99: number; max: number; count: number };
  post: { p50: number; p95: number; max: number; count: number; avgFrames: number };
  /** Another machine's presence changes and log events, from its post to a browser's receipt (budget steps only). */
  cross?: { presence: { count: number; p95: number; max: number }; log: { count: number; p95: number; max: number } };
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
      'fanout-k': { type: 'string', default: '1' },
      'step-s': { type: 'string', default: '60' },
      series: { type: 'string', default: 'budget,fanout,ramp' },
      ...TEST_ORG_OPTION,
    },
  });
  const config = readDeployConfig(values.config!);
  const org = testOrgArg(values['test-org'], config.org.id);
  if (!org) return 2;
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const hub = `https://${config.host}`;
  const owner = new Person(hub, secrets.DESK_ACCESS_TOKEN);
  if (!(await servesOrg(owner, org))) return 2;
  const cleanup = new Cleanup();
  let code: number;
  try {
    code = await measureRun(owner, hub, values, cleanup);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    code = 1;
  }
  return (await cleanup.run()).length ? 1 : code;
}

type MeasureOptions = { out?: string; 'ramp-max'?: string; 'fanout-k'?: string; 'step-s'?: string; series?: string };

async function measureRun(owner: Person, hub: string, values: MeasureOptions, cleanup: Cleanup): Promise<number> {
  const tag = Math.random().toString(36).slice(2, 7);
  const project = randomUUID();
  const stepMs = Number(values['step-s']) * 1000;

  // The machines.
  const machines: Machine[] = [];
  for (let i = 1; i <= 3; i++) {
    const name = `ms-${i}-${tag}`;
    cleanup.add(`revoke ${name}`, () => revoke(owner, name));
    const { link, frames } = await machineLink(hub, await enroll(owner, name));
    cleanup.add(`drop ${name}'s stream`, () => link.drop());
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
  let rates = machines.map(() => 0);
  // The event loop's lag, so the client's own saturation is told apart from the hub's.
  let lagMax = 0;
  let last = Date.now();
  const posts: Array<{ at: number; ms: number; frames: number }> = [];
  let running = true;
  const tick = setInterval(() => {
    serve();
    for (const [i, m] of machines.entries()) {
      const sentAt = Date.now();
      for (let c = 0; c < rates[i]; c++) {
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
  const lag = setInterval(() => {
    const now = Date.now();
    lagMax = Math.max(lagMax, now - last - 50);
    last = now;
  }, 50);
  let cross: ReturnType<typeof setInterval> | undefined;
  cleanup.add('stop the machines', async () => {
    running = false;
    clearInterval(tick);
    clearInterval(cross);
    clearInterval(lag);
    await Promise.all(senders);
  });
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
  const crossPresence: Array<{ at: number; ms: number }> = [];
  const crossLog: Array<{ at: number; ms: number }> = [];
  const openBrowser = async (): Promise<Browser> => {
    const socket = await owner.socket(`/api/projects/${project}/socket`);
    cleanup.add(`close browser ${browsers.length + 1}`, async () => socket.close());
    await socket.next((f) => f.t === 'welcome', 'welcome');
    const b: Browser = { socket, subs: new Map() };
    socket.onFrame = (frame, at) => {
      if (frame.t === 'log' && b === browsers[0]) {
        for (const { event } of frame.events as Array<{ event: { sentAt?: number } }>) if (typeof event.sentAt === 'number') crossLog.push({ at, ms: at - event.sentAt });
      }
      if (frame.t !== 'session') return;
      const shown = frame.message as { kind: string; body: { record?: { at?: number } } };
      if (shown.kind === 'presence' && typeof shown.body.record?.at === 'number' && b === browsers[0]) crossPresence.push({ at, ms: at - shown.body.record.at });
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
  const subscribe = async (b: Browser, watched: Machine[]) => {
    for (const m of watched) {
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
  // The first browser follows the log, as a project view does.
  browsers[0].socket.send({ t: 'resume', after: 0 });

  // Cross traffic for the budget: the second machine changes its session's presence and writes a log event every 2 s.
  const key = await importOrgKey(newOrgKey());
  let crossSeq = 0;
  const startCross = () => {
    const m = machines[1];
    cross = setInterval(() => {
      void (async () => {
        const at = Date.now();
        const event = await seal(key, 'log', project, { ts: new Date(at).toISOString(), writer: `${m.name}/budget`, seq: ++crossSeq, kind: 'say', from: m.name, to: '*', text: 'cross', sentAt: at });
        m.buffer.push(
          { t: 'session', message: { project, machine: m.name, session: m.session, kind: 'presence', sub: null, n: null, body: { record: { status: crossSeq % 2 ? 'busy' : 'waiting', at }, bridge: true } } },
          { t: 'events', project, events: [event as unknown as LogEvent] },
        );
      })();
    }, 2000);
  };


  const steps: Step[] = [];
  let verdict = 'the ramp reached its maximum without passing the threshold';
  const save = () => values.out && writeFileSync(values.out, JSON.stringify({ hub, project, machines: machines.map((m) => m.name), verdict, steps }, null, 2));
  const toMinute = async () => {
    const now = Date.now();
    await sleep(60_000 - (now % 60_000) + 200);
  };
  const runStep = async (series: Step['series'], stepRates: number[], active: number, watched: Machine[] = machines): Promise<Step> => {
    errors = [];
    for (const [i, b] of browsers.entries()) {
      if (i >= active || b.subs.size !== watched.length) unsubscribe(b);
      if (i < active && b.subs.size === 0) {
        try {
          await subscribe(b, watched);
        } catch (error) {
          errors.push(`subscribing browser ${i + 1}: ${(error as Error).message}`);
        }
      }
    }
    if (stepMs >= 60_000) await toMinute();
    rates = stepRates;
    if (series === 'budget') startCross();
    lagMax = 0;
    const start = Date.now();
    const warm = start + 5000;
    await sleep(stepMs - 1000);
    const end = Date.now();
    clearInterval(cross);
    const within = (xs: Array<{ at: number; ms: number }>) => {
      const sorted = xs.filter((x) => x.at >= warm && x.at < end).map((x) => x.ms).sort((a, b) => a - b);
      return { count: sorted.length, p95: pct(sorted, 95), max: sorted.at(-1) ?? NaN };
    };
    const lat = latencies.filter((l) => l.at >= warm && l.at < end).map((l) => l.ms).sort((a, b) => a - b);
    const ps = posts.filter((p) => p.at >= warm && p.at < end);
    const postMs = ps.map((p) => p.ms).sort((a, b) => a - b);
    const seconds = (end - warm) / 1000;
    const step: Step = {
      series,
      rates: stepRates,
      browsers: active,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      chunksPerSecond: 10 * stepRates.reduce((sum, r) => sum + r, 0),
      relayedPerSecond: Math.round(lat.length / seconds),
      latency: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.at(-1) ?? NaN, count: lat.length },
      post: { p50: pct(postMs, 50), p95: pct(postMs, 95), max: postMs.at(-1) ?? NaN, count: ps.length, avgFrames: Math.round(ps.reduce((s, p) => s + p.frames, 0) / Math.max(1, ps.length)) },
      ...(series === 'budget' ? { cross: { presence: within(crossPresence), log: within(crossLog) } } : {}),
      loopLagMax: lagMax,
      load: loadavg().map((l) => Math.round(l)),
      errors: [...new Set(errors)].slice(0, 5),
    };
    console.log(
      `${series} rates=${stepRates.join('/')} browsers=${active}: ${step.chunksPerSecond} chunks/s, ${step.relayedPerSecond} relayed/s, latency p50 ${step.latency.p50} p95 ${step.latency.p95} p99 ${step.latency.p99} ms; ` +
        `POST p95 ${step.post.p95} ms (${step.post.avgFrames} frames); ${step.cross ? `cross presence p95 ${step.cross.presence.p95} max ${step.cross.presence.max} ms (${step.cross.presence.count}), log p95 ${step.cross.log.p95} max ${step.cross.log.max} ms (${step.cross.log.count}); ` : ''}client lag ≤ ${lagMax} ms; load ${step.load.join('/')}${step.errors.length ? `; errors ${step.errors.join(' | ')}` : ''}`,
    );
    steps.push(step);
    save();
    // Drain between steps: no chunk, so the next step starts from an empty pipe.
    rates = machines.map(() => 0);
    await until(() => (machines.every((m) => m.buffer.length === 0) ? true : undefined), 'a drained pipe', 120_000).catch(() => {});
    await sleep(2000);
    return step;
  };

  const past = (step: Step) => step.latency.p95 > 1000 || step.errors.length > 0 || Number.isNaN(step.latency.p95);
  const series = new Set(values.series!.split(','));
  {
    if (series.has('budget')) {
      for (const active of [1, 2, 3]) {
        const step = await runStep('budget', [15, 0, 0], active, [machines[0]]);
        const missed = past(step) || !(step.cross!.presence.max <= 2000 && step.cross!.log.max <= 2000);
        console.log(`  budget with ${active} browser(s): ${missed ? 'MISSED' : 'met'}`);
      }
    }
    if (series.has('fanout')) {
      const kf = Number(values['fanout-k']);
      for (const active of [1, 2, 4, 8]) if (past(await runStep('fanout', [kf, kf, kf], active))) break;
    }
    for (let kNow = 1; series.has('ramp') && kNow <= Number(values['ramp-max']); kNow *= 2) {
      const step = await runStep('ramp', [kNow, kNow, kNow], 4);
      if (past(step)) {
        verdict = `stopped at K=${kNow}: ${step.latency.p95 > 1000 ? `p95 ${step.latency.p95} ms` : `errors: ${step.errors.join(' | ') || 'no chunk arrived'}`}`;
        break;
      }
    }
  }
  console.log(verdict);
  save();
  return 0;
}
