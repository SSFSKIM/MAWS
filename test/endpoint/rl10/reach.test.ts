// `reach?` (P5 O18 D1–D3, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md M2): the receiving endpoint's table
// of who may message a session's agent. The org: A (admin, device a1) and B (device b1); machines `host` (this one,
// owned by A), `mini` (A's second) and `bm` (B's). The recipient is a session on `host` whose record each case sets.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, hubWriter, signEvent, streamWriter, type Certificates, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { Members } from '../../../src/endpoint/rl10/members';
import { decideReach } from '../../../src/endpoint/rl10/reach';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor, type TestDevice } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-reach';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const MINI = 'm1Hc2Wv9Kp0Lm8Tr1Xy7Zb';
const BM = 'b2Hc2Wv9Kp0Lm8Tr1Xy7Zc';
const S = '22222222-2222-4222-8222-222222222222';
const SENDER = '33333333-3333-4333-8333-333333333333';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10-reach-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Org = { a1: TestDevice; b1: TestDevice; A: string; B: string; head: SignedOrgState; mini: SigningKey; bm: SigningKey };

async function org(): Promise<Org> {
  const a1 = await newDevice('a1');
  const b1 = await newDevice('b1');
  const host = await generateSigningKey();
  const mini = await generateSigningKey();
  const bm = await generateSigningKey();
  const A = memberId();
  const B = memberId();
  let head = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
    s.machines.push({ name: 'host', ref: REF, pub: host.pub, owners: [A] }, { name: 'mini', ref: MINI, pub: mini.pub, owners: [A] }, { name: 'bm', ref: BM, pub: bm.pub, owners: [B] });
    s.machineNames.push({ name: 'host', ref: REF }, { name: 'mini', ref: MINI }, { name: 'bm', ref: BM });
  });
  return { a1, b1, A, B, head, mini, bm };
}

/** A `say` to S signed by `key` as machine `name`, from a session (attested to `owners`) or from its operator. */
async function remote(o: Org, key: SigningKey, name: string, owners: string[] | null, extra: Record<string, unknown> = {}) {
  const created = new Date().toISOString();
  const writer = owners === null ? `${name}/human` : `${name}/${SENDER}`;
  const body = {
    ts: created,
    created,
    writer,
    seq: 1,
    kind: 'say',
    from: name,
    to: [{ session: S, alias: 'bob' }],
    text: 'hi',
    ...(owners === null ? {} : { attest: { owners, ownersProof: [], origin: { kind: 'terminal' }, stateVersion: o.head.state.version } }),
  };
  return { ...(await signEvent({ org: ORG, project: P }, body, key.privateKey, key.pub)), ...extra } as Record<string, unknown>;
}

const memberFrame = (record: Record<string, unknown>) => ({ t: 'member', session: S, alias: 'bob', project: P, lane: 'A', state: 'idle', cwd: '/w', launch: 'L', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...record });

function members(): Members {
  return new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now });
}

async function decide(o: Org, event: Record<string, unknown>, record: Record<string, unknown>, extra: { held?: Members } = {}) {
  const held = extra.held ?? members();
  if (extra.held === undefined) await held.member(memberFrame(record));
  return decideReach(
    { org: () => ({ head: o.head.state, certificates: NO_CERTS, ref: REF }), machineOwners: async () => [o.A], members: held, ledger: new SignatureLedger(scratch), index: new InboundIndex(scratch, Date.now), now: Date.now },
    { t: 'reach?', id: 'r', project: P, session: S, event },
  );
}

describe('reach? (D1, D2)', () => {
  it('delivers a sender’s own session across machines, whatever its visibility', async () => {
    const o = await org();
    expect(await decide(o, await remote(o, o.mini, 'mini', [o.A]), { access: 'private' })).toBe('deliver');
    // Owners are per session: a session B owns on this machine (one B spawned here) is B's, not the machine's owner's.
    const held = members();
    await held.member(memberFrame({ access: 'private' }));
    await held.member({ ...memberFrame({}), session: SENDER, alias: 'b-agent', owners: [o.B] });
    const own = { ts: '2026-11-05T12:00:00.000Z', writer: `host/${SENDER}`, seq: 1, kind: 'say', from: 'b-agent', to: [{ session: S, alias: 'bob' }], text: 'hi' };
    expect(await decide(o, own, {}, { held })).toEqual({ refuse: 'not-reachable' });
    await held.member({ ...memberFrame({}), session: SENDER, alias: 'b-agent', owners: ['@machine'] });
    expect(await decide(o, own, {}, { held })).toBe('deliver');
  });

  it('takes an operator event as its machine’s owners: this machine’s `human`, and another’s', async () => {
    const o = await org();
    const own = { ts: '2026-11-05T12:00:00.000Z', writer: 'host/human', seq: 1, kind: 'say', from: 'human', to: [{ session: S, alias: 'bob' }], text: 'hi' };
    expect(await decide(o, own, { access: 'private' })).toBe('deliver');
    expect(await decide(o, await remote(o, o.mini, 'mini', null), { access: 'private' })).toBe('deliver');
    expect(await decide(o, await remote(o, o.bm, 'bm', null), { access: 'private' })).toEqual({ refuse: 'not-reachable' });
  });

  it('delivers any member’s agents to a listed or org-wide session', async () => {
    const o = await org();
    for (const access of [undefined, 'listed', 'org-view', 'org-converse']) {
      expect(await decide(o, await remote(o, o.bm, 'bm', [o.B]), access === undefined ? {} : { access })).toBe('deliver');
    }
  });

  it('delivers to a private session the sender is shared at any grade, `list` included, and refuses one shared with none', async () => {
    const o = await org();
    const from = await remote(o, o.bm, 'bm', [o.B]);
    expect(await decide(o, from, { access: 'private', shares: [{ member: o.B, grade: 'list' }] })).toBe('deliver');
    expect(await decide(o, from, { access: 'private', shares: [{ member: o.B, grade: 'view' }] })).toBe('deliver');
    expect(await decide(o, from, { access: 'private' })).toEqual({ refuse: 'not-reachable' });
  });

  it('takes a device’s words in its member’s stream (`hub/<member>~<digest>`) as that member’s', async () => {
    const o = await org();
    const audience = [o.A, o.B].sort();
    const created = new Date().toISOString();
    const draft = { kind: 'human', from: 'human', member: o.B, to: [{ session: S, alias: 'bob' }], text: 'hi', created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA', audience };
    const signed = await signEvent({ org: ORG, project: P }, draft, o.b1.channel.privateKey, o.b1.channel.pub);
    const words = { ...signed, writer: streamWriter(hubWriter(o.B), audience), seq: 1, ts: created };
    expect(await decide(o, words, { access: 'private', shares: [{ member: o.B, grade: 'list' }] })).toBe('deliver');
    expect(await decide(o, words, { access: 'private' })).toEqual({ refuse: 'not-reachable' });
  });

  it('lets an unverified sender reach only a session the whole org may message', async () => {
    const o = await org();
    const forged = await remote(o, o.bm, 'bm', [o.B], { text: 'words bm never signed' });
    expect(await decide(o, forged, { access: 'private', shares: [{ member: o.B, grade: 'converse' }] })).toEqual({ refuse: 'unverified' });
    expect(await decide(o, forged, { access: 'listed' })).toBe('deliver');
    const unsigned = { ts: '2026-11-05T12:00:00.000Z', writer: `bm/${SENDER}`, seq: 1, kind: 'say', from: 'bm', to: [{ session: S, alias: 'bob' }], text: 'hi' };
    expect(await decide(o, unsigned, { access: 'private' })).toEqual({ refuse: 'unverified' });
    // An attestation that fails verifies nobody, even a claimed owner.
    expect(await decide(o, await remote(o, o.bm, 'bm', [o.A]), { access: 'private' })).toEqual({ refuse: 'unverified' });
  });

  it('decides nothing for a recipient it holds no record of: the delivery stays owed', async () => {
    const o = await org();
    expect(await decide(o, await remote(o, o.mini, 'mini', [o.A]), {}, { held: members() })).toBeNull();
  });

  it('decides again when the recipient’s record moves while it decides, then answers from the record as it stands', async () => {
    const o = await org();
    const dir = scratch();
    const state = EndpointState.open(dir);
    let sminos: FakeSminos | null = null;
    let first = true;
    const rl10 = new Rl10({
      stateDir: () => dir,
      build: 'reach',
      state: () => state,
      head: () => ({ state: o.head.state as OrgState, certificates: NO_CERTS }),
      identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: 'host', ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
      key: () => null,
      policy: new EndpointPolicy(() => state),
      hub: { openProject: () => () => {}, send: () => true },
      listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
      notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
      machineOwners: async () => {
        // The first decision reads the owners, and B's share is removed under it.
        if (first) {
          first = false;
          await rl10.members.member(memberFrame({ access: 'private' }));
        }
        return [o.A];
      },
      dispatch: () => Promise.reject(new Error('none')),
      now: Date.now,
      log: () => {},
    });
    await rl10.serve();
    closers.push(() => rl10.unserve());
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos?.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['audience'], token: info.token, sminos: { version: 'reach' }, policy: { read_only: false, ceiling: 'settings' } });
    const welcome = await sminos.next((f) => f.t === 'welcome', 'the welcome');
    expect(welcome.capabilities).toEqual(['access', 'reach']);
    sminos.send(memberFrame({ access: 'private', shares: [{ member: o.B, grade: 'list' }] }));
    await sminos.next((f) => f.t === 'audience' && f.session === S, 'the audience frame');
    sminos.send({ t: 'reach?', id: 'r-race', project: P, session: S, event: await remote(o, o.bm, 'bm', [o.B]) });
    expect(await sminos.next((f) => f.t === 'reach' && f.id === 'r-race', 'the answer')).toEqual({ t: 'reach', id: 'r-race', verdict: 'refuse', reason: 'not-reachable' });
  });
});
