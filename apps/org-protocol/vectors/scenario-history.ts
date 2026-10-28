// The vectors' history re-attestations (O14 M4, Interfaces §D): a machine signing a checkpoint over one writer's phase-1
// events, judged against a head and a certificate set by `verifyHistoryAttestation`. One head lists `mini` (its key
// rotated, the old one retired at RETIRE_AT) and `builder`, and a delegation whose first VM `vm-1` was retired at
// RETIRE_AT and recreated under the same name and another ref. Each case names the record, the events the verifier is
// handed, the head, the certificates and the time, and the verdict. `digests` fix the digest's encoding on its own.
import { base64urlEncode } from '../src/base64url.ts';
import { historyDigest, type StoredEvent } from '../src/history.ts';
import { keyId } from '../src/keys.ts';
import { signRecord } from '../src/records.ts';
import { SIGNING_DOMAINS, type Certificates, type HistoryAttestation, type MachineCert, type OrgState, type Signed } from '../src/types.ts';
import type { KeyName, Keys } from './scenario.ts';

export type HistoryVerdict = { ok: true; by: { ref: string; name: string } } | { ok: false; reason: 'signature' | 'binding' | 'digest' | 'short' };
/**
 * `head` and `certificates` name entries of the section's `heads` and `certificates`; `events`, of its `logs`; `at` is
 * the project and writer the reader asks the record to attest.
 */
export type HistoryCase = { name: string; record: Signed<HistoryAttestation>; events: string; head: string; certificates: string; at: { project: string; writer: string }; now: string; expect: HistoryVerdict };
export type HistoryVectors = {
  heads: Record<string, OrgState>;
  certificates: Record<string, Certificates>;
  logs: Record<string, StoredEvent[]>;
  digests: Array<{ events: string; digest: string }>;
  cases: HistoryCase[];
};

const ORG = 'org-vectors';
const PROJECT = 'proj-1';
const ADMIN = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const REF_MINI = 'mref-mini-0000001';
const REF_BUILDER = 'mref-builder-00001';
const DLG = '3d4e5f60718293a4b5c6d7e8f9011223';
const REF_VM1 = `${DLG}_vm1AAAAAAAAAAAAAAAAAAA`;
const REF_VM1_NEXT = `${DLG}_vm1nextAAAAAAAAAAAAAAA`;
const at = (hour: number) => `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`;
const RETIRE_AT = at(5);
const NOW = '2026-10-28T00:00:00.000Z';
const SESSION = '0c5f3c86-5d2e-4b8f-9a61-3e2a1b0c9d8e';
const SESSION_2 = '7a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b';

/** The case names the package's suite looks for (test/history.test.ts). */
export const HISTORY_CASES = [
  'a machine attests its own writer',
  'an event changed after the attestation',
  'an event dropped inside the attested prefix',
  'the events served short of upTo',
  'a position served twice',
  "the writer's events served out of turn",
  'a digest folded over a forged event beside the genuine one at a position',
  "another project's record and events",
  "another writer's record",
  'the record altered after it was signed',
  'a record signed by a key the org never listed',
  "a retired machine key's attestation created before its notAfter",
  "a retired machine key's attestation created after its notAfter",
  "a revoked machine key's attestation",
  'a claimed former name no machine owns',
  'a former name the record does not claim',
  'a claimed name machineNames gives another ref',
  'a claimed name a live certificate holds for another ref',
  'a claimed name only a retired certificate holds, for another ref',
  "a retired certificate's attestation of its own writer, created before its retirement",
  "a retired certificate's attestation created after its retirement",
  "the recreated VM's attestation of its own writer under the same name",
  'a hub/ writer, which no machine attests',
  "another org's record",
] as const;

export async function buildHistoryScenario(k: Keys): Promise<HistoryVectors> {
  const kid = (name: KeyName) => keyId(k[name].pub);
  const head: OrgState = {
    org: ORG,
    version: 5,
    prev: base64urlEncode(new Uint8Array(32).fill(7)),
    issued: at(8),
    root: { keys: [await kid('a1StepUp')], recoveryPub: k.recovery.pub },
    members: [{ id: ADMIN, email: 'a@example.com', role: 'admin', devices: [{ id: 'dev-a1', class: 'native-mac', keyStorage: 'software', channelPub: k.a1Channel.pub, stepUpPub: k.a1StepUp.pub }] }],
    machines: [
      { name: 'mini', ref: REF_MINI, pub: k.miniRotated.pub, owners: [ADMIN] },
      { name: 'builder', ref: REF_BUILDER, pub: k.vmBuild.pub, owners: 'org' },
    ],
    machineNames: [
      { name: 'mini', ref: REF_MINI },
      { name: 'builder', ref: REF_BUILDER },
    ],
    retired: [{ keyId: await kid('mini'), pub: k.mini.pub, notAfter: RETIRE_AT, holder: { machine: REF_MINI } }],
    revoked: [],
    delegations: [{ id: DLG, pub: k.delegation.pub, prefix: 'vm-', expires: '2026-11-27T00:00:00.000Z', maxUses: 3, offlineRevokeS: 3600, owners: 'org' }],
    projects: [],
  };
  const revokedHead: OrgState = { ...head, retired: [], revoked: [{ keyId: await kid('mini'), holder: { machine: REF_MINI } }] };

  const cert = (machine: string, pub: KeyName, use: number, issued: string): Promise<Signed<MachineCert>> =>
    signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine, name: 'vm-1', pub: k[pub].pub, delegation: DLG, use, issued }, k.delegation.privateKey, k.delegation.pub);
  const vm1 = await cert(REF_VM1, 'vm1', 1, at(1));
  const vm1Next = await cert(REF_VM1_NEXT, 'vm1Next', 2, at(6));
  const vm1Retired = await signRecord(SIGNING_DOMAINS.certRetire, { org: ORG, keyId: await kid('vm1'), notAfter: RETIRE_AT }, k.delegation.privateKey, k.delegation.pub);

  const say = (writer: string, from: string, seq: number): StoredEvent => ({
    ts: `2026-10-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    writer,
    seq,
    kind: 'say',
    from,
    to: '*',
    text: `${from} says ${seq}`,
    mac: { nonce: base64urlEncode(new Uint8Array(16).fill(seq)), value: base64urlEncode(new Uint8Array(32).fill(seq)) },
  });
  const feed = (machine: string, session: string, n: number) => Array.from({ length: n }, (_, i) => say(`${machine}/${session}`, machine, i + 1));
  const logs: Record<string, StoredEvent[]> = {
    mini: feed('mini', SESSION, 3),
    oldmini: feed('oldmini', SESSION, 2),
    builder: feed('builder', SESSION, 2),
    'vm-1': feed('vm-1', SESSION, 2),
    'vm-1 next': feed('vm-1', SESSION_2, 2),
    hub: [{ kind: 'human', from: 'human', member: ADMIN, to: '*', text: 'hi', created: at(1), writer: `hub/${ADMIN}`, seq: 1, ts: at(1), mac: say('x/y', 'x', 1).mac }],
  };
  logs['mini changed'] = logs.mini.map((e) => (e.seq === 2 ? { ...e, text: 'not what was said' } : e));
  logs['mini dropped'] = logs.mini.filter((e) => e.seq !== 2);
  logs['mini short'] = logs.mini.slice(0, 2);
  logs['mini doubled'] = [logs.mini[0], logs.mini[1], { ...logs.mini[1], text: 'said twice' }, logs.mini[2]];
  logs['mini out of turn'] = [logs.mini[2], ...logs.builder, logs.mini[0], logs.mini[1]];
  logs['mini forged beside'] = [logs.mini[0], { ...logs.mini[0], text: 'never said' }];

  const record = async (signer: KeyName, log: string, over: Partial<HistoryAttestation> = {}) => {
    const events = logs[log];
    const body: HistoryAttestation = {
      org: ORG,
      project: PROJECT,
      writer: events[0].writer,
      names: ['mini'],
      upTo: events.length,
      digest: await historyDigest(events),
      created: at(7),
      ...over,
    };
    return signRecord(SIGNING_DOMAINS.historyAttest, body, k[signer].privateKey, k[signer].pub);
  };

  const cases: HistoryCase[] = [];
  const add = (name: (typeof HISTORY_CASES)[number], r: Signed<HistoryAttestation>, events: string, expect: HistoryVerdict, more: { head?: string; certificates?: string; at?: { project: string; writer: string } } = {}) =>
    cases.push({ name, record: r, events, head: more.head ?? 'head', certificates: more.certificates ?? 'both VMs', at: more.at ?? { project: r.body.project, writer: r.body.writer }, now: NOW, expect });
  const byMini: HistoryVerdict = { ok: true, by: { ref: REF_MINI, name: 'mini' } };

  const own = await record('miniRotated', 'mini');
  add('a machine attests its own writer', own, 'mini', byMini);
  add('an event changed after the attestation', own, 'mini changed', { ok: false, reason: 'digest' });
  add('an event dropped inside the attested prefix', own, 'mini dropped', { ok: false, reason: 'short' });
  add('the events served short of upTo', own, 'mini short', { ok: false, reason: 'short' });
  add('a position served twice', own, 'mini doubled', { ok: false, reason: 'digest' });
  add("the writer's events served out of turn", own, 'mini out of turn', { ok: false, reason: 'digest' });
  add('a digest folded over a forged event beside the genuine one at a position', await record('miniRotated', 'mini forged beside', { upTo: 1 }), 'mini forged beside', { ok: false, reason: 'digest' });
  add("another project's record and events", own, 'mini', { ok: false, reason: 'binding' }, { at: { project: 'proj-2', writer: own.body.writer } });
  add("another writer's record", own, 'mini', { ok: false, reason: 'binding' }, { at: { project: PROJECT, writer: `mini/${SESSION_2}` } });
  add('the record altered after it was signed', { body: { ...own.body, upTo: 2 }, sig: own.sig }, 'mini', { ok: false, reason: 'signature' });
  add('a record signed by a key the org never listed', await record('stranger', 'mini'), 'mini', { ok: false, reason: 'signature' });
  add("a retired machine key's attestation created before its notAfter", await record('mini', 'mini', { created: at(4) }), 'mini', byMini);
  add("a retired machine key's attestation created after its notAfter", await record('mini', 'mini', { created: at(6) }), 'mini', { ok: false, reason: 'signature' });
  add("a revoked machine key's attestation", await record('mini', 'mini', { created: at(4) }), 'mini', { ok: false, reason: 'signature' }, { head: 'mini revoked' });
  add('a claimed former name no machine owns', await record('miniRotated', 'oldmini', { names: ['mini', 'oldmini'] }), 'oldmini', byMini);
  add('a former name the record does not claim', await record('miniRotated', 'oldmini'), 'oldmini', { ok: false, reason: 'binding' });
  add('a claimed name machineNames gives another ref', await record('miniRotated', 'builder', { names: ['mini', 'builder'] }), 'builder', { ok: false, reason: 'binding' });
  add('a claimed name a live certificate holds for another ref', await record('miniRotated', 'vm-1', { names: ['mini', 'vm-1'] }), 'vm-1', { ok: false, reason: 'binding' });
  add('a claimed name only a retired certificate holds, for another ref', await record('miniRotated', 'vm-1', { names: ['mini', 'vm-1'] }), 'vm-1', { ok: false, reason: 'binding' }, { certificates: 'the retired VM' });
  const vmNames = { names: ['vm-1'] };
  add("a retired certificate's attestation of its own writer, created before its retirement", await record('vm1', 'vm-1', { ...vmNames, created: at(4) }), 'vm-1', { ok: true, by: { ref: REF_VM1, name: 'vm-1' } });
  add("a retired certificate's attestation created after its retirement", await record('vm1', 'vm-1', { ...vmNames, created: at(6) }), 'vm-1', { ok: false, reason: 'signature' });
  add("the recreated VM's attestation of its own writer under the same name", await record('vm1Next', 'vm-1 next', vmNames), 'vm-1 next', { ok: true, by: { ref: REF_VM1_NEXT, name: 'vm-1' } });
  add('a hub/ writer, which no machine attests', await record('miniRotated', 'hub'), 'hub', { ok: false, reason: 'binding' });
  add("another org's record", await record('miniRotated', 'mini', { org: 'org-other' }), 'mini', { ok: false, reason: 'signature' });

  return {
    heads: { head, 'mini revoked': revokedHead },
    certificates: { 'both VMs': { certs: [vm1, vm1Next], retirements: [vm1Retired] }, 'the retired VM': { certs: [vm1], retirements: [vm1Retired] } },
    logs,
    digests: [
      { events: 'mini', digest: await historyDigest(logs.mini) },
      { events: 'vm-1', digest: await historyDigest(logs['vm-1']) },
    ],
    cases,
  };
}
