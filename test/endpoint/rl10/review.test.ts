// RL10's review findings on O10 M6 (reviewer-high on 0f8d57192), each pinned where it bites: words for a member who
// left, words past the head's backstop, words decided across a head that moved, an upload signed twice across a
// connection's replacement, a torn ledger line that swallows the next, another org's legacy key, a departure that
// never withdraws, a withdrawal that forgets before it settles, a host mark moved before its `wrote` went, and a
// delegated machine's signer named by another certificate's ref.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eventSigningInput,
  generateSigningKey,
  keyId,
  signEvent,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { decideWords } from '../../../src/endpoint/rl10/words';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, iso, memberId, newDevice, retiredDevice, successor, type TestDevice } from '../org-fixtures';
import { FakeSminos, type Frame } from './fake-sminos';

const ORG = 'org-review';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const S = '22222222-2222-4222-8222-222222222222';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10r-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** An org of admin A (device a1) and member B (device b1); the machine `host` owned by `owners`. */
async function org(options: { owners?: (a: string, b: string) => string[]; issued?: string } = {}) {
  const a1 = await newDevice('a1');
  const b1 = await newDevice('b1');
  const machine = await generateSigningKey();
  const A = memberId();
  const B = memberId();
  const recovery = await generateSigningKey();
  let head = await genesis(ORG, A, a1, recovery, options.issued);
  head = await successor(
    head,
    [a1],
    (s) => {
      s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
      s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: options.owners?.(A, B) ?? [A] });
      s.machineNames.push({ name: NAME, ref: REF });
    },
    options.issued,
  );
  return { a1, b1, machine, A, B, head };
}

/** Words B's device signed into session S, as the hub posts them at `seq`. */
async function words(device: TestDevice, member: string, seq: number, created = new Date().toISOString()) {
  const draft = { kind: 'human', from: 'human', member, to: [{ session: S, alias: 'bob' }], text: 'do it', created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' };
  const signed = await signEvent({ org: ORG, project: P }, draft, device.channel.privateKey, device.channel.pub);
  return { ...signed, writer: `hub/${member}`, seq, ts: created } as Record<string, unknown> & { writer: string; seq: number };
}

const contentOf = (event: object) => createHash('sha256').update(eventSigningInput({ org: ORG, project: P }, event)).digest('base64url');

function members(): Members {
  return new Members({
    dispatch: () => Promise.reject(new Error('none')),
    listings: { report: async () => {}, gone: async () => {} },
    listed: () => [],
    forget: () => {},
    log: () => {},
    now: Date.now,
  });
}
const memberFrame = (extra: Record<string, unknown> = {}) => ({ t: 'member', session: S, alias: 'bob', project: P, lane: 'A', state: 'idle', cwd: '/w', launch: 'L', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...extra });

describe('words?', () => {
  async function decide(head: SignedOrgState, event: Record<string, unknown> & { writer: string; seq: number }, owners: string[], record: Record<string, unknown>) {
    const held = members();
    await held.member(memberFrame(record));
    const index = new InboundIndex(scratch, Date.now);
    index.record(P, contentOf(event), event.writer, event.seq);
    return decideWords(
      { org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF }), machineOwners: async () => owners, members: held, ledger: new SignatureLedger(scratch), index, now: Date.now },
      { t: 'words?', id: 'w', project: P, session: S, event },
    );
  }

  it('gives no standing to a member the head no longer holds, though their retired key still verifies (finding 1)', async () => {
    const { a1, b1, A, B, head } = await org();
    const event = await words(b1, B, 1, iso(Date.now() - 60_000));
    const left = await successor(head, [a1], async (s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.retired.push(...(await retiredDevice(B, b1.device, s.issued)));
    });
    expect(await decide(left, event, [A], { access: 'org-converse', shares: [{ member: B, grade: 'converse' }] })).toBe('peer');
  });

  it('answers no remote words past the head’s 30-day backstop (finding 2)', async () => {
    const issued = iso(Date.now() - 31 * 86_400_000);
    const { b1, A, B, head } = await org({ issued });
    const event = await words(b1, B, 1);
    expect(await decide(head, event, [A], { access: 'org-converse' })).toBe('peer');
  });
});

describe('the upload', () => {
  async function relay(dir: string) {
    const { head, machine } = await org();
    const state = EndpointState.open(dir);
    const ledger = new SignatureLedger(() => state.subdirectory('signatures'));
    const toHub: Frame[] = [];
    const r = new LogRelay({
      org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: NAME }),
      key: () => ({ key: machine, keyId: 'k' }),
      members: members(),
      ledger,
      index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
      legacy: new LegacyKey(() => state, () => ORG),
      hub: { openProject: () => () => {}, send: (f) => (toHub.push(f), true) },
      toSminos: () => {},
      opened: () => {},
      now: Date.now,
      log: () => {},
    });
    return { r, toHub, dir: join(dir, 'signatures') };
  }
  const up = { t: 'events', project: P, events: [{ ts: '2026-10-27T18:02:11.482Z', writer: `${NAME}/human`, seq: 1, kind: 'human', from: 'human', to: '*', text: 'hi' }] };

  it('signs a position once, though a replaced connection’s upload of it is still signing (finding 4)', async () => {
    const { r, toHub, dir } = await relay(scratch());
    await Promise.all([r.events(up), r.events(up)]);
    const sent = toHub.map((f) => JSON.stringify((f.events as unknown[])[0]));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(fs.readFileSync(join(dir, `${P}.jsonl`), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('keeps the line after a torn one across a restart (finding 5)', async () => {
    const state = scratch();
    const first = await relay(state);
    await first.r.events(up);
    fs.appendFileSync(join(first.dir, `${P}.jsonl`), '{"writer":"host/human","seq":2,"ha');
    const second = await relay(state);
    await second.r.events({ ...up, events: [{ ...up.events[0], seq: 3 }] });
    const third = new SignatureLedger(() => first.dir);
    expect(third.get(P, `${NAME}/human`, 3)).not.toBeNull();
    expect(third.get(P, `${NAME}/human`, 1)).not.toBeNull();
  });
});

describe('arriving events', () => {
  it('names a delegated machine’s signer by the certificate whose key signed, not another bearing its name (finding 10)', async () => {
    const { a1, head } = await org();
    const old = await generateSigningKey();
    const now = await generateSigningKey();
    const d1 = await generateSigningKey();
    const d2 = await generateSigningKey();
    const [dOld, dNew] = [memberId(), memberId()];
    const [refOld, refNew] = [`${dOld}_${'o'.repeat(22)}`, `${dNew}_${'n'.repeat(22)}`];
    const later = await successor(head, [a1], (s) => {
      s.delegations.push({ id: dOld, pub: d1.pub, prefix: 'vm-', expires: iso(Date.now() - 60_000), maxUses: 5, offlineRevokeS: 0, owners: [s.members[0].id] });
      s.delegations.push({ id: dNew, pub: d2.pub, prefix: 'vm-', expires: iso(Date.now() + 86_400_000), maxUses: 5, offlineRevokeS: 0, owners: [s.members[0].id] });
    });
    const cert = (machine: string, pub: string, delegation: string, key: SigningKey) => signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine, name: 'vm-one', pub, delegation, use: 1, issued: iso(Date.now() - 120_000) }, key.privateKey, key.pub);
    const certificates: Certificates = { certs: [await cert(refOld, old.pub, dOld, d1), await cert(refNew, now.pub, dNew, d2)], retirements: [] };
    const created = new Date().toISOString();
    const event = { ...(await signEvent({ org: ORG, project: P }, { ts: created, created, writer: 'vm-one/human', seq: 1, kind: 'human', from: 'human', to: '*', text: 'hi' }, now.privateKey, now.pub)) };
    const dir = scratch();
    const state = EndpointState.open(dir);
    const down: Frame[] = [];
    const lines: string[] = [];
    const r = new LogRelay({
      org: () => ({ head: later.state, certificates, ref: REF, name: NAME }),
      key: () => null,
      members: members(),
      ledger: new SignatureLedger(() => state.subdirectory('signatures')),
      index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
      legacy: new LegacyKey(() => state, () => ORG),
      hub: { openProject: () => () => {}, send: () => true },
      toSminos: (f) => void down.push(f),
      opened: () => {},
      now: Date.now,
      log: (l) => void lines.push(l),
    });
    r.hello({ t: 'hello', project: P, name: 'maws', have: {} });
    await r.fromHub({ t: 'events', project: P, events: [event] });
    expect(lines).toEqual([]);
    expect(down).toEqual([{ t: 'events', project: P, events: [{ event, signer: { kind: 'machine', ref: refNew, name: 'vm-one', keyId: await keyId(now.pub) } }] }]);
  });
});

/** A served RL10 on a scratch state directory, with sminos connected and welcomed. */
async function served(options: {
  head: () => { state: OrgState; certificates: Certificates };
  machineOwners?: () => Promise<string[]>;
  listed?: () => string[];
  hostMessage?: (message: unknown, sent?: () => void) => void;
  legacy?: { org: string; key: string };
  engineSessions?: () => Array<{ appSessionId: string; engineSessionId: string }>;
}) {
  const dir = scratch();
  const state = EndpointState.open(dir);
  if (options.legacy !== undefined) state.setLegacy(options.legacy);
  const calls: string[] = [];
  const rl10 = new Rl10({
    stateDir: () => dir,
    build: 'review',
    state: () => state,
    head: options.head,
    identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: NAME, ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
    key: () => null,
    policy: new EndpointPolicy(() => state),
    hub: { openProject: () => () => {}, send: () => true },
    listings: {
      report: async (report) => void calls.push(`report ${report.session}`),
      gone: async (session) => void calls.push(`gone ${session}`),
      refresh: async () => {},
      listedSessions: () => options.listed?.() ?? [],
    },
    notifier: { pendingSet: () => {}, hostMessage: (m, sent) => options.hostMessage?.(m, sent), forget: (session) => void calls.push(`forget ${session}`) },
    machineOwners: options.machineOwners ?? (async () => []),
    dispatch: async () =>
      options.engineSessions === undefined ? Promise.reject(new Error('none')) : { t: 'res' as const, id: '0', ok: true as const, value: options.engineSessions() },
    now: Date.now,
    log: () => {},
  });
  await rl10.serve();
  closers.push(() => rl10.unserve());
  const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
  /** A sminos connection, hello'd and welcomed (a new one replaces the last). */
  const connect = async () => {
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'review' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'the welcome');
    return sminos;
  };
  const sminos = await connect();
  return { rl10, sminos, state, calls, dir, connect };
}

describe('the session lane', () => {
  it('decides words? again when the head moved while it was decided (finding 3)', async () => {
    const { a1, b1, A, B, head } = await org({ owners: (a, b) => [a, b] });
    const without = await successor(head, [a1], (s) => void (s.machines[0].owners = [A]));
    let current = head;
    let calls = 0;
    const { rl10, sminos } = await served({
      head: () => ({ state: current.state, certificates: NO_CERTS }),
      machineOwners: async () => {
        // The first decision reads the owners, and the head moves under it.
        const owners = current.state.machines[0].owners as string[];
        if (calls++ === 0) current = without;
        return owners;
      },
    });
    sminos.send({ t: 'hello', project: P, name: 'maws', have: {} });
    sminos.send(memberFrame());
    const event = await words(b1, B, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rl10.relay.fromHub({ t: 'events', project: P, events: [event] });
    sminos.send({ t: 'words?', id: 'w-race', project: P, session: S, event });
    expect((await sminos.next((f) => f.t === 'words' && f.id === 'w-race', 'the answer')).verdict).toBe('peer');
  });

  it('withdraws an ordinary departure (finding 7)', async () => {
    const { head } = await org();
    const { sminos, calls } = await served({ head: () => ({ state: head.state, certificates: NO_CERTS }) });
    sminos.send(memberFrame());
    sminos.send({ t: 'member', session: S, gone: true });
    await expect.poll(() => calls).toEqual([`report ${S}`, `gone ${S}`, `forget ${S}`]);
  });

  it('settles a session held only as a listing before forgetting it (finding 8)', async () => {
    const { head } = await org();
    const { sminos, calls } = await served({ head: () => ({ state: head.state, certificates: NO_CERTS }), listed: () => ['app-left'] });
    sminos.send({ t: 'restated' });
    await expect.poll(() => calls).toEqual(['gone app-left', 'forget app-left']);
  });

  it('moves the host mark only once the wrote went (finding 9)', async () => {
    const { head } = await org();
    let sent: (() => void) | undefined;
    const { sminos, state } = await served({ head: () => ({ state: head.state, certificates: NO_CERTS }), hostMessage: (_m, done) => (sent = done) });
    sminos.send({ t: 'session', message: { project: P, machine: NAME, session: S, kind: 'host', sub: null, n: null, body: { id: { writer: `${NAME}/${S}`, seq: 1 }, event: { writer: `${NAME}/${S}`, seq: 1, kind: 'message', text: 'done' } } } });
    await expect.poll(() => sent).toBeDefined();
    expect(state.hosts[P]?.[`${NAME}/${S}`]).toBeUndefined();
    sent!();
    expect(state.hosts[P]?.[`${NAME}/${S}`]).toBe(1);
  });

  it('takes a legacy key kept for another org as none: removed, and the enrollment’s org’s asked for (finding 6)', async () => {
    const { head } = await org();
    const { sminos, state, rl10 } = await served({ head: () => ({ state: head.state, certificates: NO_CERTS }), legacy: { org: 'org-before', key: 'k'.repeat(43) } });
    await sminos.next((f) => f.t === 'legacy-key?', 'the ask');
    expect(rl10.legacy.held).toBe(false);
    expect(state.legacyKey).toBeNull();
  });
});

describe('round 2', () => {
  it('keeps a whole record that lost only its newline, through the next append and a reopen (finding 1, round 2)', () => {
    const dir = scratch();
    const sig = (n: number) => ({ hash: `h${n}`, sig: { kid: 'AAAAAAAAAAAAAAAAAAAAAA', value: Buffer.alloc(64, n).toString('base64url') } });
    new SignatureLedger(() => dir).put(P, 'host/human', 1, sig(1));
    const path = join(dir, `${P}.jsonl`);
    fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace(/\n$/, ''));
    const reopened = new SignatureLedger(() => dir);
    expect(reopened.get(P, 'host/human', 1)).toEqual(sig(1));
    reopened.put(P, 'host/human', 2, sig(2));
    const again = new SignatureLedger(() => dir);
    expect(again.get(P, 'host/human', 1)).toEqual(sig(1));
    expect(again.get(P, 'host/human', 2)).toEqual(sig(2));

    const index = scratch();
    new InboundIndex(() => index, Date.now).record(P, 'c1', 'hub/b', 1);
    const idx = join(index, `${P}.idx`);
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/\n$/, ''));
    const held = new InboundIndex(() => index, Date.now);
    expect(held.seen(P, 'c1', 'hub/b', 2)).toEqual({ kind: 'replayed', writer: 'hub/b', seq: 1 });
    held.record(P, 'c2', 'hub/b', 3);
    expect(new InboundIndex(() => index, Date.now).seen(P, 'c1', 'hub/b', 2)).toEqual({ kind: 'replayed', writer: 'hub/b', seq: 1 });
  });

  it('never withdraws a lane B listing whose app restated under a new engine session (finding 2, round 2)', async () => {
    const { head } = await org();
    const [E1, E2] = ['e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222'];
    let engines = [{ appSessionId: 'app-1', engineSessionId: E1 }];
    let listed: string[] = [];
    const { calls, sminos, connect } = await served({ head: () => ({ state: head.state, certificates: NO_CERTS }), engineSessions: () => engines, listed: () => listed });
    const laneB = (session: string) => ({ ...memberFrame({ session, lane: 'B' }), launch: undefined });
    sminos.send(laneB(E1));
    await expect.poll(() => calls).toEqual(['report app-1']);
    listed = ['app-1'];
    // sminos away; the app's engine session changes; sminos back, restating the new one only.
    sminos.close();
    engines = [{ appSessionId: 'app-1', engineSessionId: E2 }];
    const back = await connect();
    back.send(laneB(E2));
    back.send({ t: 'restated' });
    await expect.poll(() => calls.length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual(['report app-1', 'report app-1']);
  });

  describe('expired (ruling 3)', () => {
    async function judge(signer: 'retired-state-key' | 'expired-certificate') {
      const { a1, head } = await org();
      const key = await generateSigningKey();
      const delegationKey = await generateSigningKey();
      const delegation = memberId();
      const created = iso(Date.now() - 60_000);
      let certificates: Certificates = NO_CERTS;
      let name = 'other';
      const later = await successor(head, [a1], async (s) => {
        if (signer === 'retired-state-key') {
          s.machineNames.push({ name, ref: 'r'.repeat(22) });
          s.retired.push({ keyId: await keyId(key.pub), pub: key.pub, notAfter: iso(Date.now() - 120_000), holder: { machine: 'r'.repeat(22) } });
        } else {
          name = 'vm-one';
          s.delegations.push({ id: delegation, pub: delegationKey.pub, prefix: 'vm-', expires: iso(Date.now() - 120_000), maxUses: 5, offlineRevokeS: 0, owners: [s.members[0].id] });
        }
      });
      if (signer === 'expired-certificate') {
        const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: `${delegation}_${'c'.repeat(22)}`, name, pub: key.pub, delegation, use: 1, issued: iso(Date.now() - 600_000) }, delegationKey.privateKey, delegationKey.pub);
        certificates = { certs: [cert], retirements: [] };
      }
      const event = await signEvent({ org: ORG, project: P }, { ts: created, created, writer: `${name}/human`, seq: 1, kind: 'human', from: 'human', to: '*', text: 'hi' }, key.privateKey, key.pub);
      const dir = scratch();
      const state = EndpointState.open(dir);
      const down: Frame[] = [];
      const up: Frame[] = [];
      const r = new LogRelay({
        org: () => ({ head: later.state, certificates, ref: REF, name: NAME }),
        key: () => null,
        members: members(),
        ledger: new SignatureLedger(() => state.subdirectory('signatures')),
        index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
        legacy: new LegacyKey(() => state, () => ORG),
        hub: { openProject: () => () => {}, send: (f) => (up.push(f), true) },
        toSminos: (f) => void down.push(f),
        opened: () => {},
        now: Date.now,
        log: () => {},
      });
      r.hello({ t: 'hello', project: P, name: 'maws', have: {} });
      await r.fromHub({ t: 'events', project: P, events: [event] });
      return { r, down, up };
    }

    it('is final for a key the state retired: spent, and rejected up', async () => {
      const { down, up, r } = await judge('retired-state-key');
      expect(down).toEqual([{ t: 'spent', project: P, writer: 'other/human', seq: 1, reason: 'expired' }]);
      expect(up.map((f) => f.reason)).toEqual(['bad-code']);
      expect(r.holding).toBe(0);
    });

    it('is held for a machine certificate, whose renewal may not have reached the endpoint yet', async () => {
      const { down, up, r } = await judge('expired-certificate');
      expect(down).toEqual([]);
      expect(up).toEqual([]);
      expect(r.holding).toBe(1);
    });
  });
});
