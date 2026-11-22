// The inbound index written a page at a time (the first-download rate's fix): a page's new contents are on disk, in
// one append, before any of its events goes down to sminos, and a copy later in the same page meets the earlier one
// in memory, so it is spent as `replayed` as it would be across pages. A write that fails leaves nothing held.
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
  const index = new InboundIndex(() => inbound, Date.now);
  /** Each frame down, with the index's lines on disk as it left. */
  const down: Array<{ frame: Frame; onDisk: number }> = [];
  const onDisk = () => (fs.existsSync(join(inbound, `${P}.idx`)) ? fs.readFileSync(join(inbound, `${P}.idx`), 'utf8').trim().split('\n').length : 0);
  const relay = new LogRelay({
    org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
    key: () => null,
    members: new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now }),
    ledger: new SignatureLedger(() => state.subdirectory('signatures')),
    index,
    legacy: new LegacyKey(() => state, () => ORG),
    hub: { openProject: () => () => {}, send: () => true },
    toSminos: (frame) => void down.push({ frame, onDisk: onDisk() }),
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
  return { relay, index, inbound, down, onDisk, words, at, B };
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

  it('holds nothing of a page whose write failed, so the same content is new again', async () => {
    const { index, inbound } = await scene();
    const staged = [index.stage(P, 'c1', 'hub/b', 1)!, index.stage(P, 'c2', 'hub/b', 2)!];
    expect(index.seen(P, 'c1', 'hub/b', 9)).toEqual({ kind: 'replayed', writer: 'hub/b', seq: 1 });
    fs.chmodSync(inbound, 0o500);
    try {
      expect(() => index.commit(staged)).toThrow();
    } finally {
      fs.chmodSync(inbound, 0o700);
    }
    expect(index.seen(P, 'c1', 'hub/b', 9)).toEqual({ kind: 'new' });
    expect(index.at(P, 'hub/b', 1)).toBeNull();
    // Another caller that delivered on the staged content commits it itself.
    index.commit(staged);
    expect(index.seen(P, 'c2', 'hub/b', 2)).toEqual({ kind: 'same' });
    expect(new InboundIndex(() => inbound, Date.now).seen(P, 'c1', 'hub/b', 1)).toEqual({ kind: 'same' });
  });
});
