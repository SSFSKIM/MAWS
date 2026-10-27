// `deployment relay-measure`: U2, the hub relay's cost (O11 M8; P5's U2). A v2 machine is enrolled and listed in the
// org state by the test device (org-admin.ts), its endpoint (M6's fake endpoint, echoing) holds RL1, and the reference
// client's Machine socket (M7) opens channels to it through the Machine DO. Every frame is synthetic and RL2-sized
// (rl1.ts): the hub cannot tell it from a sealed one. It reports
// - a channel's opening, app → DO → endpoint and the DO's answer back, p50, p95 and p99;
// - a sealed frame's round trip, app → Machine DO → endpoint → back, one in flight, at 1 KiB and 64 KiB of plaintext,
//   p50, p95 and p99;
// - sustained throughput of 256 KiB frames, a few in flight, each echo checked byte for byte;
// and the tailnet verdict P5 asks of it: past 150 ms of p95 round trip for a 1 KiB frame (a delta's size), O10 makes the
// direct tailnet carrier the default where reachable; at or under it, the hub stays the default and the tailnet the
// fallback.
//
// stdin (readSecrets): DESK_ACCESS_TOKEN, the owner's Access app token. Options: --device-keys <file> (required: the
// admin device whose step-up key signs the org state, read and never printed), --test-org <id> (a throwaway org
// instead of the configuration's own, whose pinned genesis is otherwise required), --samples (round trips per size,
// default 200), --seconds (the throughput run, default 10), --window (256 KiB frames in flight, default 4). However it
// ends, a SIGINT or SIGTERM included (proof.ts, interruptible), the machine leaves the org state (its key retired) and is
// revoked, which deletes its service token.
import { hostname } from 'node:os';
import { join } from 'node:path';
import { RelayApp } from 'org-protocol/test-support';
import { readDeployConfig } from './config';
import { deployArgs, readSecrets } from './deploy';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin, type AdminDevice, type OrgScope } from './org-admin';
import { Cleanup, interruptible, isTestTarget, testOrgArg, type InterruptOptions } from './proof';
import { connectEndpoint, EchoReader, echoingEndpoint, frameSeq, openedChannel, SEALED_OVERHEAD, sameBytes, sealedFrame } from './rl1';

export const KIB = 1024;
/** P5's line for the tailnet verdict: the relay's p95 round trip for a delta-sized frame, from the owner's MacBook. */
export const VERDICT_P95_MS = 150;

export type Spread = { samples: number; p50: number; p95: number; p99: number; min: number; max: number };
export type RoundTrip = Spread & { plaintext: number; sealed: number };
export type Throughput = { plaintext: number; sealed: number; window: number; frames: number; seconds: number; framesPerSecond: number; mibPerSecond: number };
export type Measured = { opens: Spread; roundTrips: RoundTrip[]; throughput: Throughput };
export type MeasureOptions = { samples: number; seconds: number; window: number };

/** The nearest-rank `p`th percentile of `values`. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('no samples');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1];
}

export function spread(values: number[]): Spread {
  return { samples: values.length, p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), min: Math.min(...values), max: Math.max(...values) };
}

/** The tailnet verdict for a measured 1 KiB p95 round trip. */
export function tailnetVerdict(p95: number): string {
  return p95 > VERDICT_P95_MS
    ? `the relay's p95 round trip for a 1 KiB frame is ${p95.toFixed(1)} ms, over ${VERDICT_P95_MS} ms: O10 makes the direct tailnet carrier the default where it is reachable, the hub the fallback`
    : `the relay's p95 round trip for a 1 KiB frame is ${p95.toFixed(1)} ms, at or under ${VERDICT_P95_MS} ms: the hub stays the default carrier, the direct tailnet the fallback`;
}

const WARMUP = 5;

/** `count` channel openings and closings on `app`, timed from the open sent to the hub's answer. */
async function opens(app: RelayApp, count: number, signal?: AbortSignal): Promise<Spread> {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const started = performance.now();
    const channel = await openedChannel(app);
    times.push(performance.now() - started);
    app.closeChannel(channel);
  }
  return spread(times);
}

/** `count` round trips of one sealed frame of `plaintext` bytes on `channel`, one in flight, after a short warm-up. */
async function roundTrips(app: RelayApp, channel: number, plaintext: number, count: number, first: number, signal?: AbortSignal): Promise<RoundTrip> {
  const reader = new EchoReader(app, channel);
  const times: number[] = [];
  try {
    for (let i = 0; i < count + WARMUP; i++) {
      signal?.throwIfAborted();
      const frame = sealedFrame(plaintext, first + i);
      const started = performance.now();
      app.send(channel, frame);
      const back = await reader.next();
      const took = performance.now() - started;
      if (!sameBytes(back, frame)) throw new Error(`frame ${first + i} (${frame.length} B) came back altered or out of order`);
      if (i >= WARMUP) times.push(took);
    }
  } finally {
    reader.stop();
  }
  return { plaintext, sealed: plaintext + SEALED_OVERHEAD, ...spread(times) };
}

/** 256 KiB frames (or `plaintext`) sent for `seconds` with `window` in flight, each echo checked byte for byte. */
async function throughput(app: RelayApp, channel: number, plaintext: number, seconds: number, window: number, first: number, signal?: AbortSignal): Promise<Throughput> {
  const reader = new EchoReader(app, channel);
  const inFlight = new Map<number, Uint8Array>();
  let next = first;
  const send = () => {
    const frame = sealedFrame(plaintext, next);
    inFlight.set(next++, frame);
    app.send(channel, frame);
  };
  const started = performance.now();
  const deadline = started + seconds * 1000;
  let frames = 0;
  try {
    for (let i = 0; i < window; i++) send();
    while (inFlight.size > 0) {
      signal?.throwIfAborted();
      const back = await reader.next(30_000);
      const seq = frameSeq(back);
      const sent = inFlight.get(seq);
      if (!sent || seq !== Math.min(...inFlight.keys()) || !sameBytes(back, sent)) throw new Error(`frame ${seq} came back altered or out of order`);
      inFlight.delete(seq);
      frames++;
      if (performance.now() < deadline) send();
    }
  } finally {
    reader.stop();
  }
  const elapsed = (performance.now() - started) / 1000;
  return { plaintext, sealed: plaintext + SEALED_OVERHEAD, window, frames, seconds: elapsed, framesPerSecond: frames / elapsed, mibPerSecond: (frames * plaintext) / 2 ** 20 / elapsed };
}

/** The whole measurement on an app socket to an echoing endpoint, each part printed as it ends; `signal` stops it. */
export async function measure(app: RelayApp, options: MeasureOptions, log: (line: string) => void, signal?: AbortSignal): Promise<Measured> {
  const ms = (n: number) => n.toFixed(1);
  const opened = await opens(app, Math.min(20, options.samples), signal);
  log(`channel open: ${opened.samples} opens, p50 ${ms(opened.p50)} ms, p95 ${ms(opened.p95)} ms, p99 ${ms(opened.p99)} ms (min ${ms(opened.min)}, max ${ms(opened.max)})`);
  const channel = await openedChannel(app);
  const trips: RoundTrip[] = [];
  let seq = 0;
  for (const [plaintext, samples] of [
    [KIB, options.samples],
    [64 * KIB, Math.max(20, Math.ceil(options.samples / 2))],
  ]) {
    const trip = await roundTrips(app, channel, plaintext, samples, seq, signal);
    seq += samples + WARMUP;
    trips.push(trip);
    log(`round trip, ${plaintext / KIB} KiB frames (${trip.sealed} B sealed): ${trip.samples} samples, p50 ${ms(trip.p50)} ms, p95 ${ms(trip.p95)} ms, p99 ${ms(trip.p99)} ms (min ${ms(trip.min)}, max ${ms(trip.max)})`);
  }
  const through = await throughput(app, channel, 256 * KIB, options.seconds, options.window, seq, signal);
  log(
    `throughput, 256 KiB frames (${through.sealed} B sealed), ${through.window} in flight for ${through.seconds.toFixed(1)} s: ${through.frames} frames echoed byte-identical, ` +
      `${through.framesPerSecond.toFixed(1)} frames/s, ${through.mibPerSecond.toFixed(2)} MiB/s of plaintext each way`,
  );
  app.closeChannel(channel);
  return { opens: opened, roundTrips: trips, throughput: through };
}

/**
 * The run: the org's admin (`scope`), a machine listed for it whose endpoint echoes, the app's socket, the measurement
 * and the verdict. Everything it makes is undone through `cleanup`, which the caller runs.
 */
export async function relayMeasure(person: Person, scope: OrgScope, device: AdminDevice, options: MeasureOptions, cleanup: Cleanup, log: (line: string) => void = console.log): Promise<Measured> {
  const admin = await OrgAdmin.open(person, scope, device, log);
  const name = `m8-rm-${Math.random().toString(36).slice(2, 7)}`;
  const machine = await admin.listedMachine(name, cleanup);
  const endpoint = echoingEndpoint(person.hub, machine, { build: 'relay-measure' });
  cleanup.add('close the endpoint', async () => endpoint.close());
  const welcome = await connectEndpoint(endpoint);
  const app = await RelayApp.open(person.hub, machine.ref, person.headers);
  cleanup.add('close the app socket', async () => app.close());
  log(`relay-measure: ${person.hub} (org ${admin.org}), machine ${name} (ref ${machine.ref}, generation ${welcome.generation}); app and endpoint both on ${hostname()}`);
  const measured = await measure(app, options, log, cleanup.signal);
  log(`tailnet verdict: ${tailnetVerdict(measured.roundTrips[0].p95)}`);
  return measured;
}

/**
 * relayMeasure as the command runs it, under `interruptible`: its cleanup runs however the run ends, a signal included.
 * The command's status. `person`'s requests should pass `cleanup.check`, so an interrupted run's stop.
 */
export function runRelayMeasure(
  person: Person,
  scope: OrgScope,
  device: AdminDevice,
  options: MeasureOptions,
  cleanup: Cleanup,
  log: (line: string) => void = console.log,
  interrupt: InterruptOptions = {},
): Promise<number> {
  return interruptible(
    cleanup,
    async () => {
      await relayMeasure(person, scope, device, options, cleanup, log);
      return 0;
    },
    async (status) => ((await cleanup.run()).length ? 1 : status),
    interrupt,
  );
}

export async function main(argv: string[]): Promise<number> {
  const { config, values } = deployArgs(argv, {
    'device-keys': { type: 'string' },
    'test-org': { type: 'string' },
    samples: { type: 'string', default: '200' },
    seconds: { type: 'string', default: '10' },
    window: { type: 'string', default: '4' },
  });
  if (!isTestTarget(config)) return 2;
  const options = { samples: Number(values.samples), seconds: Number(values.seconds), window: Number(values.window) };
  if (!Object.values(options).every((n) => Number.isSafeInteger(n) && n > 0)) {
    console.error('--samples, --seconds and --window are positive integers');
    return 2;
  }
  if (!values['device-keys']) {
    console.error('--device-keys <file> is required: the admin device whose step-up key signs the org state');
    return 2;
  }
  let scope: OrgScope = { org: config.org.id, pinnedGenesis: config.orgGenesis };
  if (values['test-org'] !== undefined) {
    const own = readDeployConfig((values.config as string | undefined) ?? join(process.env.DESK_HUB_APP!, 'deploy', 'config.json')).org.id;
    const org = testOrgArg(values['test-org'] as string, own);
    if (!org) return 2;
    scope = { org, throwaway: true };
  }
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const device = await loadAdminDevice(values['device-keys'] as string);
  const cleanup = new Cleanup();
  return runRelayMeasure(new Person(`https://${config.host}`, secrets.DESK_ACCESS_TOKEN, () => cleanup.check()), scope, device, options, cleanup);
}
