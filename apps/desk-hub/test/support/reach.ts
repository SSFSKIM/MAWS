// Message reach on the local hub (P5 O18, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md M1): an org of two
// members, A (the admin) and B, whose machines speak RL1 with the `audience` capability (or without, an old endpoint),
// and the events their sessions write: `joined` snapshots, `say`s, `unlisted` notices, plain or in their audience's
// stream. The hub checks no code on these, so each carries a random one in canonical base64url, as log.test.ts's do.
import { streamWriter } from 'org-protocol';
import { base64urlEncode } from '../../src/protocol/base64url';
import { newNonce } from '../../src/protocol/codes';
import type { LogEvent } from '../../src/protocol/log';
import type { DownFrame, Refusal } from '../../src/protocol/machine';
import type { LocalHub } from './local';
import { memberId, newDevice, type TestDevice } from './org';
import { TestOrg, type Rl1Machine } from './rl1';

export const AUDIENCE = ['audience'];

export type ReachOrg = { org: TestOrg; A: string; B: string; bEmail: string; bDevice: TestDevice };

/** The suite's org: its admin A, and a member B with one device, signed in as `bEmail`. */
export async function reachOrg(hub: LocalHub, bEmail = 'b@example.com'): Promise<ReachOrg> {
  const org = await TestOrg.root(hub);
  const B = memberId();
  const bDevice = await newDevice('b-1');
  await org.accept((s) => s.members.push({ id: B, email: bEmail, role: 'member', devices: [bDevice.device] }));
  return { org, A: org.admin, B, bEmail, bDevice };
}

let clock = 0;
/** A time later than every one before it in the suite, so `created` orders snapshots as they were made. */
export const later = () => new Date(Date.UTC(2026, 10, 5, 12, 0, 0) + ++clock).toISOString();

const sorted = (members: string[]) => [...new Set(members)].sort();

/** An event of `session` on `machine`, plain or in the stream of `audience`, kept in the machine's mirror. */
export function event(machine: Rl1Machine, project: string, session: string, seq: number, fields: Record<string, unknown>, audience?: string[]): LogEvent {
  const base = `${machine.name}/${session}`;
  const created = later();
  const members = audience === undefined ? undefined : sorted(audience);
  const e = {
    ts: created,
    created,
    writer: members === undefined ? base : streamWriter(base, members),
    seq,
    kind: 'say',
    from: machine.name,
    ...fields,
    ...(members === undefined ? {} : { audience: members }),
    mac: { nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
  } as unknown as LogEvent;
  machine.store(project, e);
  return e;
}

/** The session's `joined` snapshot at `policyRev`, in its audience's stream when it has one. */
export const joined = (machine: Rl1Machine, project: string, session: string, seq: number, audience?: string[], policyRev?: number, fields: Record<string, unknown> = {}) =>
  event(machine, project, session, seq, { kind: 'joined', session, alias: `s-${session.slice(0, 4)}`, ...(policyRev === undefined ? {} : { policyRev }), ...fields }, audience);

/** A `say` of `session` to `to`, in the stream of `audience` when given. */
export const say = (machine: Rl1Machine, project: string, session: string, seq: number, to: string[], audience?: string[], text = 'hi') =>
  event(machine, project, session, seq, { kind: 'say', to: to.map((s) => ({ session: s, alias: `r-${s.slice(0, 4)}` })), text }, audience);

/** The `unlisted` notice of `session` at `policyRev`, withdrawing `withdrawn`. */
export const unlisted = (machine: Rl1Machine, project: string, session: string, seq: number, policyRev: number, withdrawn: string[]) =>
  event(machine, project, session, seq, { kind: 'unlisted', session, policyRev }, withdrawn);

/** Uploads `events` and answers the refusals the hub sent for them, once it has applied them. */
export async function upload(machine: Rl1Machine, project: string, events: LogEvent[]): Promise<Refusal[]> {
  const from = machine.frames.length;
  machine.send([{ t: 'events', project, events }]);
  await machine.settled(project);
  return machine.frames.slice(from).flatMap((f) => (f.t === 'refused' && f.project === project ? [f.refusal] : []));
}

/** The latest `have` the machine was sent for `project`. */
export function lastHave(machine: Rl1Machine, project: string): Extract<DownFrame, { t: 'have' }> {
  const haves = machine.frames.filter((f): f is Extract<DownFrame, { t: 'have' }> => f.t === 'have' && f.project === project);
  return haves[haves.length - 1];
}

export const newSession = () => crypto.randomUUID();
