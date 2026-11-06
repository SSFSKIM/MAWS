// A small org for the project channel's unit suites (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M7a's Proves): A (the owner) with the app's device, B with a device of their own, and the machine `mini` that A owns,
// which phase 1 knew as `oldmini`. Its events and records are made with the protocol package's own signing, as the hub
// would store them: a device's `human`, a machine's v2 `say` with its owners attested, a phase-1 (DX1) `say`, and
// `mini`'s history attestation over a writer's DX1 events.
import {
  base64urlEncode,
  generateSigningKey,
  historyDigest,
  NO_CERTIFICATES,
  signEvent,
  signRecord,
  SIGNING_DOMAINS,
  type HistoryAttestation,
  type OrgState,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import type { Checkpoint, Judging } from '../../src/main/org/channel/verify';
import { genesis, iso, memberId, newDevice, successor, type TestDevice } from '../endpoint/org-fixtures';

export const ORG = 'org-channel';
export const PROJECT = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
export const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
export const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
export const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');

export type Machine = { name: string; ref: string; key: SigningKey };
export type Event = Record<string, unknown> & { writer: string; seq: number };

export class ChannelOrg {
  A = memberId();
  B = memberId();
  app!: TestDevice;
  bDevice!: TestDevice;
  mini!: Machine;
  chain: SignedOrgState[] = [];

  static async make(): Promise<ChannelOrg> {
    const o = new ChannelOrg();
    o.app = await newDevice('app');
    o.bDevice = await newDevice('b-app');
    o.mini = await o.machine('mini');
    o.chain = [await genesis(ORG, o.A, o.app, await generateSigningKey(), iso(NOW - 3_600_000))];
    await o.adopt((s) => {
      s.members[0].email = 'sam.owner@example.com';
      s.members.push({ id: o.B, email: 'ana@example.com', role: 'member', devices: [o.bDevice.device] });
      s.machines.push({ name: 'mini', ref: o.mini.ref, pub: o.mini.key.pub, owners: [o.A] });
      s.machineNames.push({ name: 'mini', ref: o.mini.ref });
    });
    return o;
  }

  async machine(name: string): Promise<Machine> {
    return { name, ref: `${name}${random(20)}`, key: await generateSigningKey() };
  }

  head(): SignedOrgState {
    return this.chain[this.chain.length - 1];
  }

  async adopt(edit: (s: OrgState) => void): Promise<SignedOrgState> {
    const next = await successor(this.head(), [this.app], edit, iso(NOW - 1_800_000));
    this.chain.push(next);
    return next;
  }

  judging(checkpoints: ReadonlyMap<string, Checkpoint> = new Map(), project = PROJECT): Judging {
    return { ctx: { org: ORG, project }, state: this.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW), checkpoints };
  }

  /** A device's `human` as the hub stores it: signed by `device` before the hub gives it a position. */
  async human(member: string, device: TestDevice, seq: number, text: string, writerMember = member): Promise<Event> {
    const draft = { kind: 'human', from: 'human', member, to: '*', text, created: iso(NOW - 60_000), nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
    const signed = await signEvent({ org: ORG, project: PROJECT }, draft, device.channel.privateKey, device.channel.pub);
    return { ts: iso(NOW - 59_000), writer: `hub/${writerMember}`, seq, ...signed };
  }

  /** A machine's v2 `say` from its session, attesting `owners`. */
  async say(machine: Machine, seq: number, text: string, owners: string[] = [this.A], session = S1): Promise<Event> {
    const event = {
      ts: iso(NOW - 30_000),
      created: iso(NOW - 30_000),
      writer: `${machine.name}/${session}`,
      seq,
      kind: 'say',
      from: machine.name,
      to: '*',
      text,
      attest: { owners, ownersProof: [], origin: { kind: 'spawn' }, stateVersion: 2 },
    };
    return signEvent({ org: ORG, project: PROJECT }, event, machine.key.privateKey, machine.key.pub) as Promise<Event>;
  }

  /** A machine's v2 `joined`: its session's alias in the project, from the session's own writer. */
  joined(machine: Machine, seq: number, alias: string, session = S1): Promise<Event> {
    const event = { ts: iso(NOW - 40_000), created: iso(NOW - 40_000), writer: `${machine.name}/${session}`, seq, kind: 'joined', session, alias, machine: machine.name, cwd: '/w' };
    return signEvent({ org: ORG, project: PROJECT }, event, machine.key.privateKey, machine.key.pub) as Promise<Event>;
  }

  /** A phase-1 `say` under a former name, with a code nothing in the app checks. */
  dx1(name: string, seq: number, text = `${name} says ${seq}`, session = S2): Event {
    return {
      ts: `2026-10-15T08:00:${String(seq % 60).padStart(2, '0')}.000Z`,
      writer: `${name}/${session}`,
      seq,
      kind: 'say',
      from: name,
      to: '*',
      text,
      mac: { nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
    };
  }

  /** `mini`'s attestation of `events` (a writer's, from seq 1), naming its former name. */
  async attest(events: Event[], upTo = events.length): Promise<Signed<HistoryAttestation>> {
    const body: HistoryAttestation = { org: ORG, project: PROJECT, writer: events[0].writer, names: ['mini', 'oldmini'], upTo, digest: await historyDigest(events.slice(0, upTo)), created: iso(NOW - 600_000) };
    return signRecord(SIGNING_DOMAINS.historyAttest, body, this.mini.key.privateKey, this.mini.key.pub);
  }
}
