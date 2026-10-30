// The log plane's uploads against a hub that stops reading (O10, the carriers' bound after M8): sminos's `events` go up
// RL1 only while the hub link's socket is under its soft cap, waiting in the relay's capped uplink queue; past the cap an
// upload is let go, and sminos is asked from the first position let go as the queue drains. RL10 is read on meanwhile,
// so what the endpoint handles locally (a `query`'s answer) is never held behind the uplink. Once the hub reads again, or
// the link gives the stalled connection up and its next welcome compares the hub's `have` with the ledger, every event
// reaches the hub, in a run the hub stores with no gap (its acceptance: each writer's next seq only).
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId, type Certificates } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HubLink } from '../../../src/endpoint/hub-link';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { UPLINK_BYTES } from '../../../src/endpoint/rl10/uplink';
import type { SendLimits } from '../../../src/endpoint/send-buffer';
import { EndpointState } from '../../../src/endpoint/state/store';
import { FakeHub, until } from '../fake-hub';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-uplink';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const FRAMES = 96;
const PER_FRAME = 4;
const TOTAL = FRAMES * PER_FRAME;
const TEXT = 'u'.repeat(64 * 1024);
const UPLOAD = PER_FRAME * TEXT.length;

/**
 * A served RL10 with sminos connected, its relay's uplink on a real hub link to the stand-in hub, the project opened,
 * the hub's socket paused, and sminos's whole burst (24 MiB, frames of 4 events of 64 KiB, its batch being 256 KiB)
 * taken by the endpoint, each frame written once the last was taken (sminos's lane). `answer()` makes the stand-in
 * sminos answer each `resend` from the position asked to its head, a later one rewinding it again, as sminos does.
 * `stored(conn)` is what the hub stores of what reached it, as desk-hub does: the writer's run from seq 1 with no gap,
 * and the gaps it met (each a `resend` desk-hub would send; the stand-in sends none, so the endpoint must leave none).
 */
async function scene(limits: SendLimits) {
  const a1 = await newDevice('a1');
  const machine = await generateSigningKey();
  const A = memberId();
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
  });
  const kid = await keyId(machine.pub);

  const hub = await new FakeHub().start();
  closers.push(() => hub.close());
  hub.heartbeatMs = 60_000;
  let rl10: Rl10 | null = null;
  const link = new HubLink({
    target: () => ({ hub: hub.url, credentials: { clientId: 'id', clientSecret: 'secret' }, ref: REF }),
    build: 'uplink',
    log: () => {},
    sendLimits: limits,
    hooks: { welcome: () => rl10?.hubWelcomed() },
  });
  closers.push(() => link.stop());
  link.start();
  await until(() => link.connected, 'the welcome');

  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10u-'));
  fs.chmodSync(dir, 0o700);
  closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = EndpointState.open(dir);
  /** The most the hub link's socket held right after an upload went into it. */
  const seen = { peak: 0 };
  const lines: string[] = [];
  rl10 = new Rl10({
    stateDir: () => dir,
    build: 'uplink',
    state: () => state,
    head: () => ({ state: head.state, certificates: NO_CERTS }),
    identity: () => ({ org: ORG, hub: hub.url, name: NAME, ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
    key: () => ({ key: machine, keyId: kid }),
    policy: new EndpointPolicy(() => state),
    hub: {
      openProject: (project, handler) => link.openProject(project, handler),
      send: (frame) => {
        const sent = link.send(frame as Parameters<HubLink['send']>[0]);
        if (frame.t === 'events') seen.peak = Math.max(seen.peak, link.buffered);
        return sent;
      },
      writable: () => link.writable(),
    },
    listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
    notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
    machineOwners: async () => [],
    dispatch: () => Promise.reject(new Error('none')),
    now: Date.now,
    log: (line) => void lines.push(line),
  });
  const served = rl10;
  await served.serve();
  closers.push(() => served.unserve());
  const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
  const sminos = await FakeSminos.open(info.socket);
  closers.push(() => sminos.close());
  sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'uplink' }, policy: { read_only: false, ceiling: 'settings' } });
  await sminos.next((f) => f.t === 'welcome', 'the welcome');
  sminos.send({ t: 'hello', project: P, name: 'maws', have: {} });
  await until(() => hub.frames('hello').some((r) => r.frame.project === P), 'the project’s hello at the hub');

  const event = (seq: number) => ({ ts: '2026-10-27T18:02:11.482Z', writer: `${NAME}/human`, seq, kind: 'human', from: 'human', to: '*', text: TEXT });
  const upload = (from: number) => sminos.write({ t: 'events', project: P, events: Array.from({ length: Math.min(PER_FRAME, TOTAL - from + 1) }, (_, i) => event(from + i)) });
  hub.current.pause();
  let taken = 0;
  const sending = (async () => {
    for (let from = 1; from <= TOTAL; from += PER_FRAME) {
      await upload(from);
      taken++;
    }
  })();
  // The endpoint reads RL10 on: sminos's lane is taken whole while the hub reads nothing.
  await until(() => taken === FRAMES, 'sminos’s whole burst taken', 15_000);
  await sending;

  const answered = new Set<number>();
  let drawing = 0;
  const answer = () => {
    const timer = setInterval(() => {
      for (const [i, f] of sminos.received.entries()) {
        if (f.t !== 'resend' || answered.has(i)) continue;
        answered.add(i);
        const mine = ++drawing;
        void (async () => {
          for (let from = f.from as number; from <= TOTAL && drawing === mine; from += PER_FRAME) await upload(from);
        })();
      }
    }, 10);
    closers.push(() => clearInterval(timer));
  };
  const stored = (conn?: number) => {
    let last = 0;
    let gaps = 0;
    for (const r of hub.frames('events')) {
      if (conn !== undefined && r.conn !== conn) continue;
      for (const { seq } of r.frame.events as Array<{ seq: number }>) {
        if (seq === last + 1) last = seq;
        else if (seq > last + 1) {
          gaps++;
          break;
        }
      }
    }
    return { last, gaps };
  };
  return { hub, link, rl10: served, sminos, lines, seen, answer, stored };
}

describe('the log plane’s uploads, against a hub that stops reading', () => {
  it('wait in a capped queue, never holding RL10’s local control, and all reach the hub once it reads', async () => {
    const limits: SendLimits = { soft: 256 * 1024, budget: 4 * 1024 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 60_000 };
    const { hub, rl10, sminos, lines, seen, answer, stored } = await scene(limits);
    // A local question answered now, while the uploads wait on the hub.
    const opId = 'q'.repeat(22);
    const asked = Date.now();
    const answering = rl10.query(opId);
    const query = await sminos.next((f) => f.t === 'query' && f.opId === opId, 'the query');
    sminos.send({ t: 'queried', opId: query.opId, state: 'done' });
    expect((await answering).state).toBe('done');
    expect(Date.now() - asked).toBeLessThan(2000);
    // What the endpoint holds for the hub is bounded: its queue at its cap, the rest let go and owed.
    expect(rl10.relay.uplinkQueued).toBeLessThanOrEqual(UPLINK_BYTES);
    expect(lines.some((line) => line.includes('let go'))).toBe(true);

    // The hub reads again: the queue drains, sminos is asked for what was let go, and the hub stores every event.
    answer();
    hub.current.resume();
    await until(() => stored().last === TOTAL, 'every event stored at the hub', 20_000);
    expect(stored().gaps).toBe(0);
    expect(sminos.received.filter((f) => f.t === 'resend')).toHaveLength(1);
    // Its socket held the soft cap and about an upload past it (signed, a little larger), the whole time.
    expect(seen.peak).toBeLessThanOrEqual(limits.soft + 2 * UPLOAD);
  }, 60_000);

  it('are let go with a connection given up as stalled, and the next welcome’s `have` asks for every one again', async () => {
    const limits: SendLimits = { soft: 256 * 1024, budget: 4 * 1024 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 500 };
    const { hub, link, rl10, stored, answer } = await scene(limits);
    answer();
    await until(() => link.generation === 2, 'a new connection', 15_000);
    expect(rl10.relay.uplinkQueued).toBe(0);
    // The new connection's hello for the project, answered with what the hub holds: nothing, its first socket unread.
    await until(() => hub.frames('hello').some((r) => r.conn > 0 && r.frame.project === P), 'the project’s hello again');
    hub.current.send(JSON.stringify({ t: 'have', project: P, have: {} }));
    await until(() => stored(hub.sockets.length - 1).last === TOTAL, 'every event stored from the new connection', 20_000);
    expect(stored(hub.sockets.length - 1).gaps).toBe(0);
  }, 60_000);
});
