// The inbound index written a page at a time (the first-download rate's fix): a page's new contents are on disk, in
// one append, before any of its events goes down to sminos or its snapshots feed the policy cache, and a copy later in
// the same page meets the earlier one in memory, so it is spent as `replayed` as it would be across pages. A batch whose
// write failed, or whose records were moved aside meanwhile, takes no effect; a retry and the hub's pages of a project
// are judged one after the other.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, signEvent, type Certificates } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import type { Frame } from './fake-sminos';

const ORG = 'org-inbound';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const MAC = 'm4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const S = '22222222-2222-4222-8222-222222222222';
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

/** An index that runs `hook` after each stage (a test's way into the middle of a page). */
class HookedIndex extends InboundIndex {
  hook: (n: number) => void = () => {};
  #n = 0;
  override stage(project: string, content: string, writer: string, seq: number) {
    const staged = super.stage(project, content, writer, seq);
    this.hook(++this.#n);
    return staged;
  }
}

async function scene() {
  const a1 = await newDevice('a1');
  const b1 = await newDevice('b1');
  const b2 = await newDevice('b2');
  const A = memberId();
  const B = memberId();
  const machine = await generateSigningKey();
  const mac = await generateSigningKey();
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
    s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: REF });
    s.machines.push({ name: 'mac', ref: MAC, pub: mac.pub, owners: [A] });
    s.machineNames.push({ name: 'mac', ref: MAC });
  });
  const state = EndpointState.open(scratch());
  let inbound = state.subdirectory('inbound');
  const index = new HookedIndex(() => inbound, Date.now);
  /** Each frame down, with the index's lines on disk as it left; and each policy change, in one order. */
  const down: Array<{ frame: Frame; onDisk: number }> = [];
  const calls: string[] = [];
  const lines: string[] = [];
  const onDisk = (dir = inbound) => (fs.existsSync(join(dir, `${P}.idx`)) ? fs.readFileSync(join(dir, `${P}.idx`), 'utf8').trim().split('\n').length : 0);
  const relay = new LogRelay({
    org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
    key: () => null,
    members: new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now }),
    ledger: new SignatureLedger(() => state.subdirectory('signatures')),
    index,
    legacy: new LegacyKey(() => state, () => ORG),
    hub: { openProject: () => () => {}, send: () => true },
    toSminos: (frame) => {
      calls.push(`down ${frame.t}`);
      down.push({ frame, onDisk: onDisk() });
    },
    opened: () => {},
    now: Date.now,
    log: (line) => void lines.push(line),
    policyChanged: (session) => void calls.push(`policy ${session}`),
  });
  relay.hello({ t: 'hello', project: P, name: 'maws', have: {} });
  /** Words B's device signed, as the hub posts them at `seq` (the signature leaves a `hub/` position out). */
  const words = async (text: string, device = b1) => {
    const created = new Date().toISOString();
    return signEvent({ org: ORG, project: P }, { kind: 'human', from: 'human', member: B, to: '*', text, created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }, device.channel.privateKey, device.channel.pub);
  };
  const at = (signed: object, seq: number) => ({ ...signed, writer: `hub/${B}`, seq, ts: (signed as { created: string }).created });
  /** A remote session's `joined` snapshot, signed by the machine `mac`. */
  const joined = async (seq: number) => {
    const created = new Date().toISOString();
    return signEvent({ org: ORG, project: P }, { ts: created, created, writer: `mac/${S}`, seq, kind: 'joined', session: S }, mac.privateKey, mac.pub);
  };
  /** `inbound/` moved aside, as an enrollment under another authority does (`Rl10.forgetRecords`). */
  const moveAside = () => {
    inbound = state.subdirectory('inbound-new');
    index.forget();
  };
  /** B's second device enters the head (what a `retry` follows). */
  const addDevice = async () => {
    head = await successor(head, [a1], (s) => void s.members.find((m) => m.id === B)!.devices.push(b2.device));
  };
  return { relay, index, inbound: () => inbound, down, calls, lines, onDisk, words, at, joined, moveAside, addDevice, b2, B };
}

describe('the inbound index, a page at a time', () => {
  it('spends a copy later in the same page as replayed, and has the page on disk before its events go down', async () => {
    const { relay, down, onDisk, words, at, B } = await scene();
    const one = await words('one');
    const two = await words('two');
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1), at(two, 2), at(one, 3)] });
    expect(down.map((d) => d.frame.t)).toEqual(['events', 'spent']);
    expect((down[0].frame.events as Array<{ event: { seq: number } }>).map((w) => w.event.seq)).toEqual([1, 2]);
    expect(down[0].onDisk).toBe(2);
    expect(down[1].frame).toEqual({ t: 'spent', project: P, writer: `hub/${B}`, seq: 3, reason: 'replayed' });
    expect(onDisk()).toBe(2);

    // The same page again (a later hello's backlog): each at its own position is `same`, delivered, and nothing more
    // is written; the copy is still a replay.
    down.length = 0;
    await relay.fromHub({ t: 'events', project: P, events: [at(one, 1), at(two, 2), at(one, 3)] });
    expect(down.map((d) => d.frame.t)).toEqual(['events', 'spent']);
    expect(onDisk()).toBe(2);
  });

  it('feeds a page’s snapshots only once its batch is on disk, before its events; a failed write feeds and sends nothing', async () => {
    const { relay, down, calls, joined, inbound } = await scene();
    const snapshot = await joined(1);
    fs.mkdirSync(inbound(), { recursive: true });
    fs.chmodSync(inbound(), 0o500);
    try {
      await expect(relay.fromHub({ t: 'events', project: P, events: [snapshot] })).rejects.toThrow();
    } finally {
      fs.chmodSync(inbound(), 0o700);
    }
    expect(calls).toEqual([]);
    expect(down).toEqual([]);
    // The hub's next page of it: new again, written, fed, then sent.
    await relay.fromHub({ t: 'events', project: P, events: [snapshot] });
    expect(calls).toEqual([`policy ${S}`, 'down events']);
  });

  it('drops the rest of a page whose inbound records were moved aside while it was judged: nothing written there, nothing sent', async () => {
    const { relay, index, down, lines, onDisk, words, at, moveAside, inbound } = await scene();
    const before = inbound();
    index.hook = (n) => n === 2 && moveAside();
    await relay.fromHub({ t: 'events', project: P, events: [at(await words('one'), 1), at(await words('two'), 2), at(await words('three'), 3)] });
    expect(down).toEqual([]);
    expect(onDisk(before)).toBe(0);
    expect(onDisk()).toBe(0);
    expect(lines.some((line) => line.includes('moved aside'))).toBe(true);
    // The next page is judged against the records read after the move.
    index.hook = () => {};
    await relay.fromHub({ t: 'events', project: P, events: [at(await words('four'), 4)] });
    expect(down.map((d) => d.frame.t)).toEqual(['events']);
    expect(onDisk()).toBe(1);
  });

  it('judges a retry and a hub page of a project one after the other: the first content at a position is the first written', async () => {
    const { relay, down, words, at, addDevice, b2, inbound, B } = await scene();
    // Words of B's second device, held while the head doesn't list it; the hub then posts the same words elsewhere.
    const held = await words('held', b2);
    await relay.fromHub({ t: 'events', project: P, events: [at(held, 1)] });
    expect(relay.holding).toBe(1);
    await addDevice();
    await Promise.all([relay.retry(), relay.fromHub({ t: 'events', project: P, events: [at(held, 2)] })]);
    expect(down.map((d) => d.frame.t)).toEqual(['events', 'spent']);
    expect((down[0].frame.events as Array<{ event: { seq: number } }>)[0].event.seq).toBe(1);
    expect(down[1].frame).toEqual({ t: 'spent', project: P, writer: `hub/${B}`, seq: 2, reason: 'replayed' });
    const reread = new InboundIndex(inbound, Date.now);
    expect(reread.at(P, `hub/${B}`, 1)).not.toBeNull();
    expect(reread.at(P, `hub/${B}`, 2)).toBeNull();
  });

  it('writes nothing of a batch abandoned or failed, and holds none of it: its contents are new again', async () => {
    const { index, inbound } = await scene();
    const staged = [index.stage(P, 'c1', 'hub/b', 1)!, index.stage(P, 'c2', 'hub/b', 2)!];
    expect(index.seen(P, 'c1', 'hub/b', 9)).toEqual({ kind: 'replayed', writer: 'hub/b', seq: 1 });
    expect(index.stage(P, 'c1', 'hub/b', 1)).toBeNull();
    fs.mkdirSync(inbound(), { recursive: true });
    fs.chmodSync(inbound(), 0o500);
    try {
      expect(() => index.commit(staged)).toThrow();
    } finally {
      fs.chmodSync(inbound(), 0o700);
    }
    expect(index.seen(P, 'c1', 'hub/b', 9)).toEqual({ kind: 'new' });
    expect(index.at(P, 'hub/b', 1)).toBeNull();
    // A handle let go is stale: committing it writes nothing, and the position is decided afresh.
    const fresh = index.stage(P, 'c3', 'hub/b', 1)!;
    expect(index.commit(staged)).toBe(false);
    expect(index.at(P, 'hub/b', 1)).toBe('c3');
    expect(index.commit([fresh])).toBe(true);
    const reread = new InboundIndex(inbound, Date.now);
    expect(reread.at(P, 'hub/b', 1)).toBe('c3');
    expect(reread.seen(P, 'c1', 'hub/b', 1)).toEqual({ kind: 'new' });
  });
});
