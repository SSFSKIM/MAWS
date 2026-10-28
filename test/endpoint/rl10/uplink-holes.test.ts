// The uplink's recovery from a dropped upload (log-relay.ts), against models of both ends: the hub's acceptance (a
// writer's event stored only at its next seq, a copy passed over, a gap answered by `resend` from its next seq and the
// rest of that writer's batch let go: desk-hub's `Project.upload`), and sminos's lane (it uploads on from its cursor, and
// a `resend` rewinds the cursor: `HubLog.on_resend`). The hub takes one upload for each of sminos's passes of two, so
// the relay's queue overflows again and again: the backlog must still reach the hub whole, with no gap and few resends.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, type Certificates } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';

const ORG = 'org-holes';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const NO_CERTS: Certificates = { certs: [], retirements: [] };
const WRITERS = [`${NAME}/human`, `${NAME}/a`];
const CAP = 64 * 1024;
const RESERVE = 32 * 1024;
const PER = 4; // events a frame
const TEXT = 'x'.repeat(4 * 1024); // so a frame is about 16 KiB, four to the queue

type Frame = { t: string } & Record<string, unknown>;
type Event = { writer: string; seq: number };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A relay signing as `host`, its hub a model of desk-hub's acceptance whose socket takes a frame when `take()`n. */
async function scene(writers = WRITERS) {
  const a1 = await newDevice('a1');
  const machine = await generateSigningKey();
  const A = memberId();
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
  });
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10h-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  const state = EndpointState.open(dir);

  // The hub: each writer's last stored seq, a run with no gap; a gap answered by `resend`, the writer's batch let go.
  const hub = { last: new Map<string, number>(writers.map((w) => [w, 0])), gaps: 0, replies: [] as Frame[], up: true };
  const accept = (frame: Frame) => {
    const stopped = new Set<string>();
    for (const e of frame.events as Event[]) {
      if (stopped.has(e.writer)) continue;
      const at = hub.last.get(e.writer)!;
      if (e.seq <= at) continue;
      if (e.seq === at + 1) hub.last.set(e.writer, e.seq);
      else {
        stopped.add(e.writer);
        hub.gaps++;
        hub.replies.push({ t: 'resend', project: P, writer: e.writer, from: at + 1 });
      }
    }
  };
  let room = true;
  let waiting: (() => void) | null = null;
  const take = () => {
    room = true;
    waiting?.();
    waiting = null;
  };

  // sminos: each writer's cursor (its last uploaded seq), rewound by a `resend`.
  const cursor = new Map<string, number>(writers.map((w) => [w, 0]));
  const toSminos: Frame[] = [];
  const relay = new LogRelay({
    org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
    key: () => ({ key: machine, keyId: 'k' }),
    members: new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now }),
    ledger: new SignatureLedger(() => state.subdirectory('signatures')),
    index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
    legacy: new LegacyKey(() => state, () => ORG),
    hub: {
      openProject: () => () => {},
      send: (frame) => {
        if (!hub.up) return false;
        room = false;
        if (frame.t === 'events') accept(frame);
        return true;
      },
      writable: () => (room || !hub.up ? Promise.resolve() : new Promise<void>((resolve) => (waiting = resolve))),
    },
    toSminos: (frame) => {
      toSminos.push(frame);
      if (frame.t === 'resend') cursor.set(frame.writer as string, (frame.from as number) - 1);
    },
    opened: () => {},
    now: Date.now,
    log: () => {},
    uplink: { bytes: CAP, reserve: RESERVE },
  });
  relay.hello({ t: 'hello', project: P, name: 'maws', have: {} });

  /** The most the uplink queue held: it grows only as an upload is taken, so it is read after each. */
  const queue = { peak: 0 };
  const event = (writer: string, seq: number) => ({ ts: '2026-10-27T18:02:11.482Z', writer, seq, kind: 'human', from: 'human', to: '*', text: TEXT });
  /** An upload of `events` as sminos (or anything holding its connection) sends it. */
  const submit = async (events: unknown[]) => {
    await relay.events({ t: 'events', project: P, events });
    queue.peak = Math.max(queue.peak, relay.uplinkQueued);
  };
  /** sminos's next frame for `writer` from its cursor, up to `total`; false once it has none. */
  const upload = async (writer: string, total: number) => {
    const from = cursor.get(writer)! + 1;
    if (from > total) return false;
    const events = Array.from({ length: Math.min(PER, total - from + 1) }, (_, i) => event(writer, from + i));
    cursor.set(writer, from + events.length - 1);
    await submit(events);
    return true;
  };
  /** The hub's replies so far, on to the relay as RL1 would deliver them. */
  const reply = async () => {
    for (const frame of hub.replies.splice(0)) await relay.fromHub(frame as Frame & { project: string });
  };
  return { relay, hub, take, upload, submit, event, queue, reply, toSminos, resends: () => toSminos.filter((f) => f.t === 'resend') };
}

describe('the uplink’s recovery from a dropped upload', () => {
  // Two shapes of a backlog 32 times the queue (2 MiB): two writers a frame each a pass, and one writer two a pass.
  it.each([
    { writers: WRITERS, total: 256, burst: 1 },
    { writers: WRITERS.slice(0, 1), total: 512, burst: 2 },
  ])('converges for $writers.length writer(s) sending $burst frame(s) a pass: the hub stores it in one run, no gap there, resends bounded', async ({ writers, total, burst }) => {
    const s = await scene();
    let passes = 0;
    while (writers.some((w) => s.hub.last.get(w)! < total)) {
      await s.reply();
      // Each pass leads with the other writer, so neither is starved by the order alone.
      for (const writer of passes % 2 === 0 ? writers : [...writers].reverse()) for (let i = 0; i < burst; i++) await s.upload(writer, total);
      s.take();
      await turn();
      if (++passes > 4000) throw new Error(`no convergence after ${passes} passes: the hub holds ${writers.map((w) => s.hub.last.get(w)).join(', ')}`);
    }
    expect(writers.map((w) => s.hub.last.get(w))).toEqual(writers.map(() => total));
    expect(s.hub.gaps).toBe(0);
    expect(s.queue.peak).toBeLessThanOrEqual(CAP + RESERVE);
    // Each resend is asked with half the queue free, so each recovers about that much: 2 MiB over 32 KiB.
    expect(s.resends().length).toBeLessThanOrEqual((writers.length * total * TEXT.length) / (CAP / 2));
  }, 60_000);

  it('answers a gap the hub names for a writer it already holds a hole in itself, rather than passing each resend to sminos', async () => {
    const s = await scene();
    const [writer] = WRITERS;
    // Five frames: the hub takes none, so the fifth overflows and leaves a hole at seq 17.
    for (let i = 0; i < 5; i++) await s.upload(writer, 100);
    expect(s.relay.uplinkQueued).toBeGreaterThan(CAP - 20 * 1024);
    // The hub names the same gap three times: the relay holds that hole already, so none goes to sminos.
    for (let i = 0; i < 3; i++) await s.relay.fromHub({ t: 'resend', project: P, writer, from: 17 });
    expect(s.resends()).toEqual([]);
    // Later uploads past the hole wait unsent; once half the queue is free, sminos is asked once, from the hole.
    await s.upload(writer, 100);
    for (let i = 0; i < 3; i++) {
      s.take();
      await turn();
    }
    expect(s.resends()).toEqual([{ t: 'resend', project: P, writer, from: 17 }]);
    expect(s.hub.gaps).toBe(0);
  });

  it('asks sminos only through the next welcome while RL1 is down, then recovers from the hub’s have', async () => {
    const s = await scene();
    const [writer] = WRITERS;
    await s.upload(writer, 100);
    await turn();
    s.hub.up = false;
    for (let i = 0; i < 3; i++) await s.upload(writer, 100);
    await turn();
    expect(s.resends()).toEqual([]);
    s.hub.up = true;
    s.take();
    s.relay.hubWelcomed();
    await s.relay.fromHub({ t: 'have', project: P, have: { [writer]: 4 } });
    expect(s.resends()).toEqual([{ t: 'resend', project: P, writer, from: 5 }]);
    for (let i = 0; i < 6; i++) {
      await s.upload(writer, 100);
      s.take();
      await turn();
    }
    expect(s.hub.last.get(writer)).toBe(28);
    expect(s.hub.gaps).toBe(0);
    expect(s.resends()).toHaveLength(1);
  });
  it('holds no more than its cap and reserve against an adversary resubmitting held positions while the hub reads nothing', async () => {
    const s = await scene();
    const [writer] = WRITERS;
    // The hub takes the first upload and nothing after.
    await s.submit([s.event(writer, 1)]);
    await turn();
    // One event, over and over; then forty positions in turn, each let go over the cap and resubmitted unasked.
    for (let i = 0; i < 1000; i++) await s.submit([s.event(writer, 2)]);
    for (let i = 0; i < 1000; i++) await s.submit([s.event(writer, 3 + (i % 40))]);
    expect(s.queue.peak).toBeLessThanOrEqual(CAP);
    expect(s.resends()).toEqual([]);
  }, 60_000);

  it('bounds many writers’ fillings together by the reserve, though every one was asked at once, and still brings each whole', async () => {
    const writers = Array.from({ length: 32 }, (_, i) => `${NAME}/w${i}`);
    const s = await scene(writers);
    const TOTAL = 32; // each writer's: 128 KiB, 4 MiB in all
    // Each writer's first frame, the hub reading only the first: past the cap the rest are let go, holes left.
    for (const writer of writers) await s.upload(writer, TOTAL);
    await turn();
    // A welcome whose `have` holds nothing: every writer asked from 1 at once, and each fills at once.
    s.relay.hubWelcomed();
    await s.relay.fromHub({ t: 'have', project: P, have: {} });
    expect(s.resends()).toHaveLength(writers.length);
    for (const writer of writers) await s.upload(writer, TOTAL);
    expect(s.queue.peak).toBeLessThanOrEqual(CAP + RESERVE);
    // Then the hub reads, a frame a pass: every writer's whole run is stored, the queue bounded throughout.
    let passes = 0;
    while (writers.some((w) => s.hub.last.get(w)! < TOTAL)) {
      await s.reply();
      for (const writer of writers) await s.upload(writer, TOTAL);
      s.take();
      await turn();
      if (++passes > 4000) throw new Error(`no convergence after ${passes} passes: the hub holds ${writers.map((w) => s.hub.last.get(w)).join(', ')}`);
    }
    expect(s.hub.gaps).toBe(0);
    expect(s.queue.peak).toBeLessThanOrEqual(CAP + RESERVE);
    expect(s.resends().length).toBeLessThanOrEqual(writers.length + (writers.length * TOTAL * TEXT.length) / (CAP / 2));
  }, 60_000);
});
