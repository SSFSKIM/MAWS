// The signer's audiences (P5 O18 D4–D7, D9, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md M2): every own
// event signed with the audience the endpoint computes, refused `audience` where sminos's writer disagrees, held where
// the cache or the hub can't decide yet; and what comes down from the hub: tombstones, refusals, the policy cache fed,
// and nothing naming a stream to an sminos without `audience`.
//
// The org: A (admin), B and C. This machine, `host`, is A's; `mini` is C's. Local sessions on `host`: S, A's private
// session shared with B ({A, B}); R, A's private session shared with C ({A, C}); L and L2, listed; K, a listed child S
// spawned. Remote: Q on `mini`, private to {A, C}, known to the cache from its snapshot.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, hubWriter, signEvent, streamWriter, verifyEvent, type Certificates, type SignedOrgState } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { InboundIndex } from '../../../src/endpoint/rl10/inbound-index';
import { LegacyKey } from '../../../src/endpoint/rl10/legacy';
import { LogRelay } from '../../../src/endpoint/rl10/log-relay';
import { Members } from '../../../src/endpoint/rl10/members';
import { PolicyCache } from '../../../src/endpoint/rl10/policy-cache';
import { SignatureLedger } from '../../../src/endpoint/rl10/signature-ledger';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import type { Frame } from './fake-sminos';

const ORG = 'org-signing';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const MINI = 'm1Hc2Wv9Kp0Lm8Tr1Xy7Zb';
const NO_CERTS: Certificates = { certs: [], retirements: [] };
const S = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const L = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';
const K = '55555555-5555-4555-8555-555555555555';
const Q = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '77777777-7777-4777-8777-777777777777';

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10-aud-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sorted = (m: string[]) => [...new Set(m)].sort();
let clock = Date.UTC(2026, 10, 5, 12);
const ts = () => new Date(++clock).toISOString();

const member = (session: string, alias: string, record: Record<string, unknown>) => ({ t: 'member', session, alias, project: P, lane: 'A', state: 'idle', cwd: '/w', launch: 'L', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...record });

async function scene(options: { rebuilding?: boolean; hubStreams?: boolean; streamsDown?: boolean; askMs?: number; writable?: () => Promise<void> } = {}) {
  const a1 = await newDevice('a1');
  const b1 = await newDevice('b1');
  const host = await generateSigningKey();
  const mini = await generateSigningKey();
  const A = memberId();
  const B = memberId();
  const C = memberId();
  let head: SignedOrgState = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }, { id: C, email: 'c@example.com', role: 'member', devices: [] });
    s.machines.push({ name: 'host', ref: REF, pub: host.pub, owners: [A] }, { name: 'mini', ref: MINI, pub: mini.pub, owners: [C] });
    s.machineNames.push({ name: 'host', ref: REF }, { name: 'mini', ref: MINI });
  });
  const state = EndpointState.open(scratch());
  const members = new Members({ dispatch: () => Promise.reject(new Error('none')), listings: { report: async () => {}, gone: async () => {} }, listed: () => [], forget: () => {}, log: () => {}, now: Date.now });
  const cache = new PolicyCache(() => state.subdirectory('policy'), () => {});
  const ledger = new SignatureLedger(() => state.subdirectory('signatures'));
  const toHub: Frame[] = [];
  const toSminos: Frame[] = [];
  const flags = { rebuilding: options.rebuilding ?? false, hubStreams: options.hubStreams ?? true, streamsDown: options.streamsDown ?? true };
  const relay = new LogRelay({
    org: () => ({ head: head.state, certificates: NO_CERTS, ref: REF, name: 'host' }),
    key: () => ({ key: host, keyId: 'k' }),
    members,
    ledger,
    index: new InboundIndex(() => state.subdirectory('inbound'), Date.now),
    legacy: new LegacyKey(() => state, () => ORG),
    hub: { openProject: () => () => {}, send: (f) => (toHub.push(structuredClone(f) as Frame), true), ...(options.writable === undefined ? {} : { writable: options.writable }) },
    toSminos: (f) => void toSminos.push(structuredClone(f) as Frame),
    opened: () => {},
    now: Date.now,
    log: () => {},
    cache,
    rebuilding: () => flags.rebuilding,
    hubStreams: () => flags.hubStreams,
    streamsDown: () => flags.streamsDown,
    ...(options.askMs === undefined ? {} : { uplink: { bytes: 8 * 1024 * 1024, reserve: 1024 * 1024, askMs: options.askMs } }),
  });
  relay.hello({ t: 'hello', project: P, name: 'host', have: {} });
  /** A member frame, its audience at its policyRev remembered as link.ts does. */
  const record = async (session: string, alias: string, fields: Record<string, unknown>) => {
    await members.member(member(session, alias, fields));
    const m = members.get(session)!;
    const owners = m.owners.includes('@machine') ? [A] : m.owners;
    cache.remember(session, m.policyRev ?? 0, m.access === 'private' ? sorted([...owners, ...(m.shares ?? []).map((x) => x.member)]) : null);
  };
  await record(S, 'secret', { access: 'private', shares: [{ member: B, grade: 'list' }], policyRev: 1 });
  await record(R, 'room', { access: 'private', shares: [{ member: C, grade: 'view' }], policyRev: 1 });
  await record(L, 'open', {});
  await record(L2, 'open2', {});
  await record(K, 'child', { origin: { kind: 'sminos', spawnerSession: S } });
  cache.take({ session: Q, machine: MINI, audience: sorted([A, C]), policyRev: 2, created: ts(), owners: [C] });
  const sent = (writer: string, seq: number) => toHub.flatMap((f) => (f.t === 'events' ? (f.events as Array<Record<string, unknown>>) : [])).filter((e) => e.writer === writer && e.seq === seq);
  const refused = (writer: string, seq: number) => toSminos.filter((f) => f.t === 'refused' && (f.refusal as { writer?: string; seq?: number }).writer === writer && (f.refusal as { seq?: number }).seq === seq).map((f) => f.refusal as { reason: string; message?: string });
  const upload = (events: Array<Record<string, unknown>>) => relay.events({ t: 'events', project: P, events });
  const verifies = async (e: Record<string, unknown>) => (await verifyEvent({ org: ORG, project: P }, head.state, e as never, NO_CERTS, new Date())).ok;
  /** A snapshot signed by `mini`, plain or in its audience's stream. */
  const miniEvent = async (fields: Record<string, unknown>, writer: string, seq: number) => {
    const created = ts();
    return signEvent({ org: ORG, project: P }, { ts: created, created, writer, seq, ...fields }, mini.privateKey, mini.pub) as Promise<Record<string, unknown>>;
  };
  /** B's device's words into `session` toward `audience`, as the hub posts them in B's stream at `seq` (D8). */
  const deviceWords = async (session: string, audience: string[], seq: number) => {
    const created = ts();
    const draft = { kind: 'human', from: 'human', member: B, to: [{ session, alias: 'bob' }], text: 'do it', created, nonce: 'AAAAAAAAAAAAAAAAAAAAAA', audience };
    const signed = await signEvent({ org: ORG, project: P }, draft, b1.channel.privateKey, b1.channel.pub);
    return { ...signed, writer: streamWriter(hubWriter(B), audience), seq, ts: created } as Record<string, unknown>;
  };
  return { A, B, C, head, relay, members, cache, ledger, toHub, toSminos, flags, record, sent, refused, upload, verifies, miniEvent, deviceWords };
}

const say = (writer: string, seq: number, to: string[], text = 'hi', extra: Record<string, unknown> = {}) => ({ ts: ts(), writer, seq, kind: 'say', from: 'x', to: to.map((session) => ({ session, alias: session.slice(0, 4) })), text, ...extra });

describe('signing an audience stream', () => {
  it('refuses a writer whose digest is not the audience the endpoint computes (`audience`, a stop)', async () => {
    const t = await scene();
    await t.upload([say(`host/${S}`, 1, [])]);
    expect(t.refused(`host/${S}`, 1)[0]?.reason).toBe('audience');
    await t.upload([say(streamWriter(`host/${S}`, [t.A]), 1, [])]);
    expect(t.refused(streamWriter(`host/${S}`, [t.A]), 1)[0]?.reason).toBe('audience');
    // A listed session's event under a stream, too.
    await t.upload([say(streamWriter(`host/${L}`, [t.A]), 1, [])]);
    expect(t.refused(streamWriter(`host/${L}`, [t.A]), 1)[0]?.reason).toBe('audience');
    expect(t.toHub.filter((f) => f.t === 'events')).toHaveLength(0);
  });

  it('signs the intersection for a private sender to a private recipient (D4’s S→R): {A, B} and {A, C} give {A}', async () => {
    const t = await scene();
    const writer = streamWriter(`host/${S}`, [t.A]);
    await t.upload([say(writer, 1, [R])]);
    const [event] = t.sent(writer, 1);
    expect(event.audience).toEqual([t.A]);
    expect(await t.verifies(event)).toBe(true);
    // The writing session's stream is attested, its owners resolved.
    expect((event.attest as { owners: string[] }).owners).toEqual([t.A]);
    // A remote recipient's audience comes from the cache: Q is {A, C}.
    await t.upload([say(writer, 2, [Q])]);
    expect(t.sent(writer, 2)[0].audience).toEqual([t.A]);
    // {A, B} alone, under its own stream.
    const own = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    await t.upload([say(own, 1, [L])]);
    expect(t.sent(own, 1)[0].audience).toEqual(sorted([t.A, t.B]));
  });

  it('refuses a say whose recipients give differing audiences', async () => {
    const t = await scene();
    await t.upload([say(`host/${L}`, 1, [L2, R])]);
    expect(t.refused(`host/${L}`, 1)[0]?.reason).toBe('audience');
    await t.upload([say(streamWriter(`host/${L}`, sorted([t.A, t.C])), 1, [L2, R])]);
    expect(t.refused(streamWriter(`host/${L}`, sorted([t.A, t.C])), 1)[0]?.reason).toBe('audience');
    // Recipients that agree go together.
    await t.upload([say(streamWriter(`host/${L}`, sorted([t.A, t.C])), 2, [R, Q])]);
    expect(t.refused(streamWriter(`host/${L}`, sorted([t.A, t.C])), 2)).toEqual([]);
  });

  it('signs an operator’s say to a private session under `<machine>/human~<digest>`, with no attestation', async () => {
    const t = await scene();
    const writer = streamWriter('host/human', sorted([t.A, t.C]));
    await t.upload([say(writer, 1, [R])]);
    const [event] = t.sent(writer, 1);
    expect(event.audience).toEqual(sorted([t.A, t.C]));
    expect(event.attest).toBeUndefined();
    expect(await t.verifies(event)).toBe(true);
    await t.upload([say('host/human', 1, [R])]);
    expect(t.refused('host/human', 1)[0]?.reason).toBe('audience');
  });

  it('keeps the audience across a resend: byte for byte, frozen at first signing', async () => {
    const t = await scene();
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    const e = say(writer, 1, []);
    await t.upload([e]);
    const first = JSON.stringify(t.sent(writer, 1)[0]);
    // B's share is removed; the position was signed under the old audience and is resent as it went.
    await t.record(S, 'secret', { access: 'private', policyRev: 2 });
    await t.upload([e]);
    const copies = t.sent(writer, 1).map((x) => JSON.stringify(x));
    expect(copies).toEqual([first, first]);
    // sminos's own claim of an audience or policyRev is never what is signed.
    await t.upload([{ ...e, audience: [t.C], policyRev: 9 }]);
    expect(JSON.stringify(t.sent(writer, 1)[2])).toBe(first);
  });

  it('gives a snapshot its record’s policyRev, and a notice none but its own', async () => {
    const t = await scene();
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    await t.upload([{ ts: ts(), writer, seq: 1, kind: 'joined', session: S, alias: 'secret' }]);
    expect(t.sent(writer, 1)[0].policyRev).toBe(1);
    await t.upload([{ ts: ts(), writer: `host/${L}`, seq: 1, kind: 'state', session: L, state: 'idle' }]);
    expect(t.sent(`host/${L}`, 1)[0].policyRev).toBeUndefined();
  });

  it('signs an `unlisted` notice only with the members its change withdraws', async () => {
    const t = await scene();
    // B's share removed: rev 2, {A}. The notice withdraws {B}.
    await t.record(S, 'secret', { access: 'private', policyRev: 2 });
    const notice = (writer: string, seq: number) => ({ ts: ts(), writer, seq, kind: 'unlisted', session: S });
    await t.upload([notice(streamWriter(`host/${S}`, sorted([t.A, t.B])), 1)]);
    expect(t.refused(streamWriter(`host/${S}`, sorted([t.A, t.B])), 1)[0]?.reason).toBe('audience');
    const right = streamWriter(`host/${S}`, [t.B]);
    await t.upload([notice(right, 1)]);
    const [signed] = t.sent(right, 1);
    expect(signed).toMatchObject({ kind: 'unlisted', session: S, policyRev: 2, audience: [t.B] });
    expect((signed.attest as { origin: Record<string, unknown> }).origin.spawnerSession).toBeUndefined();
    // Going private withdraws everyone else in the org: L at rev 1 goes private to {A}.
    await t.record(L, 'open', { access: 'private', policyRev: 1 });
    const all = streamWriter(`host/${L}`, sorted([t.B, t.C]));
    await t.upload([notice(all, 1)].map((n) => ({ ...n, session: L })));
    expect(t.sent(all, 1)[0]?.audience).toEqual(sorted([t.B, t.C]));
  });

  it('redacts a private spawner from a listed child’s snapshot and attestation, and resends and echoes it as signed', async () => {
    const t = await scene();
    const joined = { ts: ts(), writer: `host/${K}`, seq: 1, kind: 'joined', session: K, alias: 'child', origin: { kind: 'sminos', spawnerSession: S } };
    await t.upload([joined]);
    const [first] = t.sent(`host/${K}`, 1);
    expect((first.origin as { spawnerSession: unknown }).spawnerSession).toBeNull();
    expect((first.attest as { origin: Record<string, unknown> }).origin).toEqual({ kind: 'sminos' });
    expect(await t.verifies(first)).toBe(true);
    await t.upload([joined]);
    expect(JSON.stringify(t.sent(`host/${K}`, 1)[1])).toBe(JSON.stringify(first));
    // The echo of what was signed goes down; it is no hub's invention.
    await t.relay.fromHub({ t: 'events', project: P, events: [first] });
    const down = t.toSminos.find((f) => f.t === 'events');
    expect((down?.events as Array<{ event: { writer: string } }>)[0].event.writer).toBe(`host/${K}`);
    // A child whose spawner's audience contains its own keeps the reference: one S spawned that is private to {A, B}.
    await t.record(L2, 'open2', { access: 'private', shares: [{ member: t.B, grade: 'view' }], policyRev: 1, origin: { kind: 'sminos', spawnerSession: S } });
    const writer = streamWriter(`host/${L2}`, sorted([t.A, t.B]));
    await t.upload([{ ...joined, writer, session: L2 }]);
    expect((t.sent(writer, 1)[0].origin as { spawnerSession: unknown }).spawnerSession).toBe(S);
    expect((t.sent(writer, 1)[0].attest as { origin: Record<string, unknown> }).origin.spawnerSession).toBe(S);
  });

  it('signs a void whose claimed audience hashes to its writer’s digest, and refuses any other', async () => {
    const t = await scene();
    // A revived human stream whose first position was refused: nothing of it was ever signed.
    const writer = streamWriter('host/human', sorted([t.A, t.C]));
    await t.upload([{ ts: ts(), writer, seq: 1, kind: 'void', of: 1, audience: [t.A] }]);
    expect(t.refused(writer, 1)[0]?.reason).toBe('audience');
    await t.upload([{ ts: ts(), writer, seq: 1, kind: 'void', of: 1, audience: sorted([t.A, t.C]) }]);
    expect(t.sent(writer, 1)[0]).toMatchObject({ kind: 'void', of: 1, audience: sorted([t.A, t.C]) });
    // A void is content-free and exactly so.
    await t.upload([{ ts: ts(), writer, seq: 2, kind: 'void', of: 1, audience: sorted([t.A, t.C]) }]);
    expect(t.refused(writer, 2)[0]?.reason).toBe('malformed');
    await t.upload([{ ts: ts(), writer, seq: 2, kind: 'void', of: 2, audience: sorted([t.A, t.C]), text: 'x' }]);
    expect(t.refused(writer, 2)[1]?.reason).toBe('malformed');
    // Under a plain writer it carries no audience.
    await t.upload([{ ts: ts(), writer: `host/${L}`, seq: 1, kind: 'void', of: 1 }]);
    expect(t.sent(`host/${L}`, 1)[0].audience).toBeUndefined();
  });
});

describe('holding what can’t be decided yet', () => {
  it('holds stream events, unsigned, while the hub’s welcome lacks `audience`, and asks for them once it has it', async () => {
    const t = await scene({ hubStreams: false });
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    const held = [say(writer, 1, []), say(writer, 2, [])];
    await t.upload(held);
    expect(t.sent(writer, 1)).toEqual([]);
    expect(t.ledger.get(P, writer, 1)).toBeNull();
    expect(t.relay.heldAt(P, writer)).toBe(1);
    expect(t.refused(writer, 1)).toEqual([]);
    // The plain writers go on meanwhile.
    await t.upload([say(`host/${L}`, 1, [])]);
    expect(t.sent(`host/${L}`, 1)).toHaveLength(1);
    t.flags.hubStreams = true;
    t.relay.release();
    expect(t.toSminos.some((f) => f.t === 'resend' && f.writer === writer && f.from === 1)).toBe(true);
    await t.upload(held);
    expect(t.sent(writer, 1)).toHaveLength(1);
    expect(t.sent(writer, 2)).toHaveLength(1);
  });

  it('holds an upload naming a session the cache hasn’t confirmed while its rebuild is incomplete, then signs it', async () => {
    const t = await scene({ rebuilding: true });
    const e = say(`host/${L}`, 1, [UNKNOWN]);
    await t.upload([e]);
    expect(t.sent(`host/${L}`, 1)).toEqual([]);
    expect(t.refused(`host/${L}`, 1)).toEqual([]);
    expect(t.relay.heldAt(P, `host/${L}`)).toBe(1);
    // A known session's upload isn't held.
    await t.upload([say(`host/${L2}`, 1, [L])]);
    expect(t.sent(`host/${L2}`, 1)).toHaveLength(1);
    // The rebuild completes: unknown means no audience, and the position is asked for and signed plain.
    t.flags.rebuilding = false;
    t.relay.release();
    expect(t.toSminos.some((f) => f.t === 'resend' && f.writer === `host/${L}` && f.from === 1)).toBe(true);
    await t.upload([e]);
    expect(t.sent(`host/${L}`, 1)).toHaveLength(1);
  });

  it('holds a stream position the ledger signed already, resent while the hub’s welcome lacks `audience`', async () => {
    const t = await scene();
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    const e = say(writer, 1, []);
    await t.upload([e]);
    expect(t.sent(writer, 1)).toHaveLength(1);
    // A reconnect to a hub rolled back past the capability: sminos's resend of the signed position is held, not sent.
    t.flags.hubStreams = false;
    await t.upload([e]);
    expect(t.sent(writer, 1)).toHaveLength(1);
    expect(t.relay.heldAt(P, writer)).toBe(1);
    expect(t.refused(writer, 1)).toEqual([]);
    // The capability back: asked again, and resent byte for byte.
    t.flags.hubStreams = true;
    t.relay.release();
    expect(t.toSminos.some((f) => f.t === 'resend' && f.writer === writer && f.from === 1)).toBe(true);
    await t.upload([e]);
    const copies = t.sent(writer, 1).map((x) => JSON.stringify(x));
    expect(copies).toHaveLength(2);
    expect(copies[1]).toBe(copies[0]);
  });

  it('sends no queued stream event over a connection whose hub lacks `audience`: it is held, the plain writers go', async () => {
    let open: () => void = () => {};
    const room = new Promise<void>((resolve) => (open = () => resolve()));
    const t = await scene({ writable: () => room });
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    await t.upload([say(writer, 1, []), say(`host/${L}`, 1, [])]);
    // Signed and queued on a capable hub's connection; the link is replaced by one to a hub without the capability.
    expect(t.ledger.get(P, writer, 1)).not.toBeNull();
    t.flags.hubStreams = false;
    open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.sent(writer, 1)).toEqual([]);
    expect(t.sent(`host/${L}`, 1)).toHaveLength(1);
    expect(t.relay.heldAt(P, writer)).toBe(1);
  });
});

describe('from the hub', () => {
  it('passes a tombstone down as `spent {reason: withheld}` in stream order, and rejects nothing for it', async () => {
    const t = await scene();
    const one = await t.miniEvent({ kind: 'say', from: 'mini', to: [{ session: L, alias: 'open' }], text: 'one' }, `mini/${Q}`, 1);
    const three = await t.miniEvent({ kind: 'say', from: 'mini', to: [{ session: L, alias: 'open' }], text: 'three' }, `mini/${Q}`, 3);
    await t.relay.fromHub({ t: 'events', project: P, events: [one, { writer: `mini/${Q}`, seq: 2, withheld: true }, three] });
    const down = t.toSminos.filter((f) => f.t === 'events' || f.t === 'spent');
    expect(down.map((f) => (f.t === 'spent' ? `spent ${String(f.seq)} ${String(f.reason)}` : `events ${(f.events as Array<{ event: { seq: number } }>).map((w) => w.event.seq).join(',')}`))).toEqual(['events 1', 'spent 2 withheld', 'events 3']);
    expect(t.toHub.filter((f) => f.t === 'rejected')).toEqual([]);
  });

  it('settles a `not-reachable` refusal: passed down, and the writer goes on uploading', async () => {
    const t = await scene();
    await t.upload([say(`host/${L}`, 1, [])]);
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'not-reachable', writer: `host/${L}`, seq: 1 } });
    expect(t.toSminos.some((f) => f.t === 'refused' && (f.refusal as { reason: string }).reason === 'not-reachable')).toBe(true);
    await t.upload([say(`host/${L}`, 2, [])]);
    expect(t.sent(`host/${L}`, 2)).toHaveLength(1);
  });

  it('asks a `state-unavailable` position of sminos again after the wait, with no reconnect and no further write', async () => {
    const t = await scene({ askMs: 200 });
    const e = say(`host/${L}`, 1, []);
    await t.upload([e]);
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'state-unavailable', writer: `host/${L}`, seq: 1, message: 'registry' } });
    expect(t.toSminos.some((f) => f.t === 'resend' && f.writer === `host/${L}`)).toBe(false);
    const asked = () => t.toSminos.some((f) => f.t === 'resend' && f.writer === `host/${L}` && f.from === 1);
    for (let waited = 0; !asked() && waited < 2000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked()).toBe(true);
    // Its filling goes up byte for byte.
    await t.upload([e]);
    expect(t.sent(`host/${L}`, 1)).toHaveLength(2);
  });

  it('sends an sminos without `audience` nothing naming a stream, while the cache still takes the stream’s snapshot', async () => {
    const t = await scene({ streamsDown: false });
    const stream = streamWriter(`mini/${Q}`, sorted([t.A, t.C]));
    const snapshot = await t.miniEvent({ kind: 'state', session: Q, state: 'busy', policyRev: 5, audience: sorted([t.A, t.C]) }, stream, 1);
    const plain = await t.miniEvent({ kind: 'say', from: 'mini', to: [{ session: L, alias: 'open' }], text: 'plain' }, `mini/${L2}`, 1);
    await t.relay.fromHub({ t: 'events', project: P, events: [snapshot, { writer: stream, seq: 2, withheld: true }, plain] });
    await t.relay.fromHub({ t: 'have', project: P, have: { [stream]: 2, [`mini/${L2}`]: 1 }, withheld: { [streamWriter(`host/${S}`, [t.A])]: [1] } });
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'not-reachable', writer: streamWriter(`host/${S}`, [t.A]), seq: 1 } });
    const text = JSON.stringify(t.toSminos);
    expect(text).not.toContain('~');
    expect(t.toSminos.filter((f) => f.t === 'events').flatMap((f) => (f.events as Array<{ event: { writer: string } }>).map((w) => w.event.writer))).toEqual([`mini/${L2}`]);
    expect(t.toSminos.find((f) => f.t === 'have')?.have).toEqual({ [`mini/${L2}`]: 1 });
    expect(t.cache.get(Q)).toMatchObject({ machine: MINI, audience: sorted([t.A, t.C]), policyRev: 5 });
  });

  it('feeds the cache only from a verified snapshot of the session’s own machine', async () => {
    const t = await scene();
    const forged = await t.miniEvent({ kind: 'state', session: Q, state: 'busy', policyRev: 9 }, `mini/${Q}`, 1);
    await t.relay.fromHub({ t: 'events', project: P, events: [{ ...forged, state: 'idle' }] });
    expect(t.cache.get(Q)?.policyRev).toBe(2);
    await t.relay.fromHub({ t: 'events', project: P, events: [forged] });
    expect(t.cache.get(Q)).toMatchObject({ audience: null, policyRev: 9 });
  });

  it('verifies a device’s words in its member’s stream as the member’s, and delivers them', async () => {
    const t = await scene();
    const words = await t.deviceWords(S, sorted([t.A, t.B]), 1);
    await t.relay.fromHub({ t: 'events', project: P, events: [words] });
    const down = t.toSminos.find((f) => f.t === 'events');
    expect((down?.events as Array<{ signer: unknown }> | undefined)?.[0]?.signer).toMatchObject({ kind: 'device', member: t.B, device: 'b1' });
    expect(t.relay.holding).toBe(0);
  });

  it('asks a revived stream again: its `audience` stop lifted once the void at the stopped position is signed', async () => {
    const t = await scene({ askMs: 200 });
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    await t.upload([say(writer, 1, [])]);
    // Position 2 held while the hub lacks `audience`; B's share is removed before it is asked again.
    t.flags.hubStreams = false;
    const two = say(writer, 2, []);
    await t.upload([two]);
    await t.record(S, 'secret', { access: 'private', policyRev: 2 });
    t.flags.hubStreams = true;
    t.relay.release();
    await t.upload([two]);
    expect(t.refused(writer, 2)[0]?.reason).toBe('audience');
    // B's share is back, the digest current again: sminos voids 2 and the writer continues.
    await t.record(S, 'secret', { access: 'private', shares: [{ member: t.B, grade: 'list' }], policyRev: 3 });
    await t.upload([{ ts: ts(), writer, seq: 2, kind: 'void', of: 2, audience: sorted([t.A, t.B]) }]);
    expect(t.sent(writer, 2)).toHaveLength(1);
    const three = say(writer, 3, []);
    await t.upload([three]);
    expect(t.sent(writer, 3)).toHaveLength(1);
    // The registry is down at 3: asked again after the wait, as any writer's.
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'state-unavailable', writer, seq: 3, message: 'registry' } });
    const asked = () => t.toSminos.some((f) => f.t === 'resend' && f.writer === writer && f.from === 3);
    for (let waited = 0; !asked() && waited < 2000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked()).toBe(true);
  });

  it('keeps the hub’s `audience` refusal of a signed position a stop: no void revives it', async () => {
    const t = await scene({ askMs: 50 });
    const writer = streamWriter(`host/${S}`, sorted([t.A, t.B]));
    const two = say(writer, 2, []);
    await t.upload([say(writer, 1, []), two]);
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'audience', writer, seq: 2, message: 'mismatch' } });
    // The signed position uploaded again (its bytes rebuilt) lifts nothing, and the hole the registry opens there stays unasked.
    await t.upload([two]);
    await t.relay.fromHub({ t: 'refused', project: P, refusal: { reason: 'state-unavailable', writer, seq: 2, message: 'registry' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.toSminos.some((f) => f.t === 'resend' && f.writer === writer)).toBe(false);
  });
});
