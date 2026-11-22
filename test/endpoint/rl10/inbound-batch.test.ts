// The inbound index fsynced a page at a time (the first-download rate's fix): each arriving event's line is written as
// it is judged, memory with it, and the files written are fsynced once before each events frame goes down to sminos,
// not once an event. A copy later in the same page meets the earlier line, so it is spent as `replayed`.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, signEvent, type Certificates } from 'org-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import type { Frame } from './fake-sminos';

/** Every fsync, counted into the scene's order of calls. */
const fsyncs = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  const fsyncSync = (fd: number) => {
    fsyncs.calls.push('fsync');
    real.fsyncSync(fd);
  };
  return { ...real, fsyncSync, default: { ...real, fsyncSync } };
});

const ORG = 'org-inbound';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10i-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function scene() {
  const a1 = await newDevice('a1');
  const b1 = await newDevice('b1');
  const A = memberId();
  const B = memberId();
  const machine = await generateSigningKey();
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
  });
  const state = EndpointState.open(scratch());
  const inbound = state.subdirectory('inbound');
  /** Each fsync and each frame down, in one order. */
  const calls = fsyncs.calls;
  calls.length = 0;
  const down: Frame[] = [];
  const relay = new LogRelay({
    org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
    key: () => null,
    members: new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now }),
    ledger: new SignatureLedger(() => state.subdirectory('signatures')),
    index: new InboundIndex(() => inbound, Date.now),
    legacy: new LegacyKey(() => state, () => ORG),
    hub: { openProject: () => () => {}, send: () => true },
    toSminos: (frame) => {
      calls.push(`down ${frame.t}`);
      down.push(frame);
    },
    opened: () => {},
    now: Date.now,
    log: () => {},
  });
  relay.hello({ t: 'hello', project: P, name: 'maws', have: {} });
  /** Words B's device signed, as the hub posts them at `seq` (the signature leaves a `hub/` position out). */
  const words = async (text: string) => {
    const created = new Date().toISOString();
    return signEvent({ org: ORG, project: P }, { kind: 'human', from: 'human', member: B, to: '*', text, created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }, b1.channel.privateKey, b1.channel.pub);
  };
  const at = (signed: object, seq: number) => ({ ...signed, writer: `hub/${B}`, seq, ts: (signed as { created: string }).created });
  const lines = () => fs.readFileSync(join(inbound, `${P}.idx`), 'utf8').trim().split('\n').length;
  return { relay, inbound, calls, down, words, at, lines, B };
}

describe('the inbound index, fsynced a page at a time', () => {
  it('spends a copy later in the same page as replayed', async () => {
    const { relay, down, words, at, lines, B } = await scene();
    const one = await words('one');
    const two = await words('two');
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1), at(two, 2), at(one, 3)] });
    expect(down.map((f) => f.t)).toEqual(['events', 'spent']);
    expect((down[0].events as Array<{ event: { seq: number } }>).map((w) => w.event.seq)).toEqual([1, 2]);
    expect(down[1]).toEqual({ t: 'spent', project: P, writer: `hub/${B}`, seq: 3, reason: 'replayed' });
    expect(lines()).toBe(2);
    // The same page again (a later hello's backlog): each at its own position is `same`, delivered, nothing more written.
    down.length = 0;
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1), at(two, 2), at(one, 3)] });
    expect(down.map((f) => f.t)).toEqual(['events', 'spent']);
    expect(lines()).toBe(2);
  });

  it('fsyncs once a page, not once an event, and before the page’s events go down', async () => {
    const { relay, calls, words, at, lines } = await scene();
    // The index file made first (its creation fsyncs the directory too).
    await relay.fromHub({ t: 'events', project: P, events: [at(await words('first'), 1)] });
    calls.length = 0;
    const page = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((text) => words(text)));
    await relay.fromHub({ t: 'events', project: P, events: page.map((w, i) => at(w, i + 2)) });
    expect(calls).toEqual(['fsync', 'down events']);
    expect(lines()).toBe(6);
    // A page split by a spent position: each events frame after its own fsync.
    calls.length = 0;
    const [f, g] = [await words('f'), await words('g')];
    await relay.fromHub({ t: 'events', project: P, events: [at(f, 7), at(page[0], 8), at(g, 9)] });
    expect(calls).toEqual(['fsync', 'down events', 'down spent', 'fsync', 'down events']);
  });

  it('fsyncs nothing for a page that writes nothing', async () => {
    const { relay, calls, words, at } = await scene();
    const one = await words('one');
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1)] });
    calls.length = 0;
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1)] });
    expect(calls).toEqual(['down events']);
  });
});
