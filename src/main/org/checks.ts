// The checks before signing and the superseded states' revocations (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M3's "The checks before signing" and "The superseded states' revocations", Interfaces §K; P5
// Decision Logs 26, 30 and 31; M4a's "The pre-sign function"). One pure module the signer runs on every edit before
// Touch ID, M4a's included.
//
// `checkSuccessor` names, before a fingerprint is asked for, what the package's `verifySuccessor` would refuse after it,
// what P5 adds on top (a renewal must extend), and what the owner should see in the prompt (a dropped delegation,
// revocations a recovery lost). The package's own pre-sign function, `successorProblems`, runs first: every check
// `verifySuccessor` makes but the signatures, each problem a refusal by the package's code (a revoked key made current,
// an empty root set, a member, email or device id taken, a later device unendorsed, a key unaccounted for, …). Then this
// module's own rows: the delegation rules, directional where the package's are not (until M4c moves `prefixProblem`
// into the package), the renewal rules and the superseded offer's warning. The package stays the judge: these findings
// are early words, and the signer still verifies the signed state.
//
// `supersededRevocations` offers, after a recovery, the revocations the discarded branch signed honestly and the
// recovered line lacks, each with the whole closure the package needs (`keysAccounted`, `stateInvariants`) so the
// signed successor passes `verifySuccessor`. Where a key sits in the head decides its closure, and every holder written
// is the head's, since `keysAccounted` judges a new entry against the holder the predecessor held the key by.
//
// Electron-free: vitest's node project runs it.
import {
  keyId,
  machineNameKey,
  successorProblems,
  type Delegation,
  type Device,
  type KeyHolder,
  type MachineEntry,
  type Member,
  type OrgState,
  type ProblemCode,
  type RevokedKey,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';

/** This module's own rows. The package's codes (`ProblemCode`) arrive beside them. */
export type CheckCode =
  | 'prefix-equal'
  | 'prefix-nested'
  | 'prefix-covers'
  | 'prefix-names-machine'
  | 'delegation-id-used'
  | 'renew-expired'
  | 'renew-not-extension'
  | 'drops-delegation'
  | 'superseded-keys';
/**
 * What a change may not do whatever the state says (edits.ts's composers, M4a): change or remove yourself, remove this
 * Mac's own device or its member, sign a change that changes nothing, take an email outside the grammar, make a root of
 * a device that can't sign org states.
 */
export type ChangeCode = 'self' | 'this-mac' | 'no-change' | 'bad-email' | 'not-signing-device';
export type FindingCode = CheckCode | ProblemCode | ChangeCode;
export type Finding = { level: 'refuse' | 'warn'; code: FindingCode; detail: string };

export type SupersededOffer = {
  /** The whole closure, applied to the successor. */
  edit(draft: OrgState): void;
  /** Each candidate and each consequence, for the prompt; empty when every candidate is withheld. */
  lines: string[];
  /** Own keys, the last root: the superseded entries no offer carries, for the owner to settle by other means. */
  withheld: RevokedKey[];
} | null;

/**
 * `endorsing`: the devices the signer endorses inside the same Touch ID that signs the state, under its step-up key
 * `kid` (the package counts each as endorsed when `kid` is one of its member's own step-up keys in `head`).
 */
export type CheckOptions = { endorsing?: { kid: string; devices: string[] } };

const refuse = (code: FindingCode, detail: string): Finding => ({ level: 'refuse', code, detail });
const warn = (code: FindingCode, detail: string): Finding => ({ level: 'warn', code, detail });

/**
 * Every finding on `next` as the successor of `head`, refusals and warnings alike: the package's problems first, then
 * this module's rows in the table's order. A row of this module whose code the package already named is left out (the
 * same rule, held twice until M4c), and a finding repeated word for word is named once.
 */
export async function checkSuccessor(head: OrgState, next: OrgState, superseded: readonly SignedOrgState[], now: Date, options: CheckOptions = {}): Promise<Finding[]> {
  const problems = await successorProblems(head, next, options.endorsing === undefined ? {} : { endorsing: options.endorsing });
  const named = new Set<FindingCode>(problems.map((p) => p.code));
  const own = [...delegationFindings(head, next, now), ...(await supersededLeftOut(head, next, superseded))].filter((f) => !named.has(f.code));
  const seen = new Set<string>();
  return [...problems.map((p) => refuse(p.code, p.detail ?? p.code)), ...own].filter((f) => {
    const key = `${f.level}|${f.code}|${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- The keys a state holds -------------------------------------------------------------------------------------------

type Current =
  | { kind: 'device'; member: Member; device: Device; key: 'channel' | 'step-up' }
  | { kind: 'machine'; entry: MachineEntry }
  | { kind: 'delegation'; delegation: Delegation };

/** The keys `state` holds as current, by key id: devices' channel and step-up keys, machines', delegations'. */
async function currentKeys(state: OrgState): Promise<Map<string, Current>> {
  const out = new Map<string, Current>();
  for (const member of state.members) {
    for (const device of member.devices) {
      out.set(await keyId(device.channelPub), { kind: 'device', member, device, key: 'channel' });
      if (device.stepUpPub !== undefined) out.set(await keyId(device.stepUpPub), { kind: 'device', member, device, key: 'step-up' });
    }
  }
  for (const entry of state.machines) out.set(await keyId(entry.pub), { kind: 'machine', entry });
  for (const delegation of state.delegations) out.set(await keyId(delegation.pub), { kind: 'delegation', delegation });
  return out;
}

/** A holder in words, its machine named where the state's `machineNames` gives the ref one. */
export function describeHolder(state: OrgState, holder: RevokedKey['holder']): string {
  if ('delegation' in holder) return `delegation ${holder.delegation} (prefix ${holder.prefix})`;
  if ('machine' in holder) {
    const name = state.machineNames.find((n) => n.ref === holder.machine)?.name;
    return name === undefined ? `machine ${holder.machine}` : `machine ${name} (${holder.machine})`;
  }
  const email = state.members.find((m) => m.id === holder.member)?.email ?? `member ${holder.member}`;
  return `the ${holder.key} key of ${email}'s device ${holder.device}`;
}

// --- Delegations ------------------------------------------------------------------------------------------------------

type KnownDelegation = { id: string; prefix: string; dropped: boolean; entry: Delegation | null };

/** The delegations a state dropped: their ids and prefixes, reserved for the life of the org (RL DL 26). */
const dropped = (state: OrgState): KnownDelegation[] =>
  state.revoked.flatMap((r) => ('delegation' in r.holder ? [{ id: r.holder.delegation, prefix: r.holder.prefix, dropped: true, entry: null }] : []));

const whose = (d: KnownDelegation) => (d.dropped ? `the dropped delegation ${d.id}'s ${d.prefix}, reserved for the life of the org` : `delegation ${d.id}'s ${d.prefix}`);

/**
 * The delegation rows of the table. A delegation of `next` is new unless `head` lists it with the same id, key and
 * prefix (which the package never lets change). Prefixes compare raw and case-folded, as `stateInvariants` and
 * `prefixProblem` compare them, so `dc-` and `dc-prod-` collide.
 */
function delegationFindings(head: OrgState, next: OrgState, now: Date): Finding[] {
  const findings: Finding[] = [];
  const held = new Map(head.delegations.map((d) => [d.id, d]));
  const isNew = (d: Delegation) => {
    const was = held.get(d.id);
    return was === undefined || was.pub !== d.pub || was.prefix !== d.prefix;
  };
  const fresh = next.delegations.filter(isNew);

  // Every delegation either state knows, live or dropped, once each by its id and prefix (the head's entry first, so
  // one dropped by this very state reads as itself, not twice).
  const known: KnownDelegation[] = [];
  const seen = new Set<string>();
  for (const k of [
    ...head.delegations.map((d) => ({ id: d.id, prefix: d.prefix, dropped: false, entry: d })),
    ...dropped(head),
    ...next.delegations.map((d) => ({ id: d.id, prefix: d.prefix, dropped: false, entry: d })),
    ...dropped(next),
  ]) {
    const key = `${k.id}|${k.prefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    known.push(k);
  }

  // Prefixes and ids: each new delegation against every other, a pair of new ones named once.
  const pairs = new Set<string>();
  for (const d of fresh) {
    const n = machineNameKey(d.prefix);
    for (const other of known) {
      if (other.entry === d) continue;
      const pair = [d.id + d.prefix, other.id + other.prefix].sort().join('|');
      if (fresh.some((f) => f === other.entry) && pairs.has(pair)) continue;
      pairs.add(pair);
      const p = machineNameKey(other.prefix);
      if (n === p) findings.push(refuse('prefix-equal', `the prefix ${d.prefix} of delegation ${d.id} is ${whose(other)}`));
      else if (n.startsWith(p)) findings.push(refuse('prefix-nested', `the prefix ${d.prefix} of delegation ${d.id} nests in ${whose(other)}`));
      else if (p.startsWith(n)) findings.push(refuse('prefix-covers', `the prefix ${d.prefix} of delegation ${d.id} covers ${whose(other)}`));
    }
    const used = known.filter((other) => other.entry !== d && other.id === d.id);
    if (used.length > 0) findings.push(refuse('delegation-id-used', `delegation id ${d.id} is ${used[0].dropped ? "a dropped delegation's, reserved for the life of the org" : "a live delegation's"}`));
  }

  // Machine names under a prefix: a new prefix over any name an entry or `machineNames` holds, and a new name under any
  // prefix (the package refuses both alike; a certificate's name is the one kind that sits under a prefix).
  const names = new Map<string, string>();
  for (const n of [...head.machines, ...head.machineNames, ...next.machines, ...next.machineNames]) names.set(machineNameKey(n.name), n.name);
  const headNames = new Set([...head.machines, ...head.machineNames].map((n) => machineNameKey(n.name)));
  for (const d of fresh) {
    const n = machineNameKey(d.prefix);
    for (const [key, name] of names) if (key.startsWith(n)) findings.push(refuse('prefix-names-machine', `the machine ${name} is named under the prefix ${d.prefix} of delegation ${d.id}`));
  }
  for (const [key, name] of names) {
    if (headNames.has(key)) continue;
    for (const other of known) {
      if (other.entry !== null && fresh.includes(other.entry)) continue;
      if (key.startsWith(machineNameKey(other.prefix))) findings.push(refuse('prefix-names-machine', `the machine ${name} is named under ${whose(other)}`));
    }
  }

  // Renewals: a kept delegation's `expires` moves only while both values are later than the successor (`keysAccounted`)
  // and the clock, and only forward (P5 Decision Log 30: renewal extends).
  const at = [next.issued, now.toISOString()].sort()[1];
  for (const was of head.delegations) {
    const kept = next.delegations.find((d) => d.id === was.id && !isNew(d));
    if (kept === undefined) {
      if (!next.delegations.some((d) => d.id === was.id)) {
        findings.push(warn('drops-delegation', `delegation ${was.id} (prefix ${was.prefix}) is dropped: its key and its certificates' keys are revoked, and its id and prefix stay reserved`));
      }
      continue;
    }
    if (kept.expires === was.expires) continue;
    if (was.expires <= at) findings.push(refuse('renew-expired', `delegation ${was.id} (prefix ${was.prefix}) expired at ${was.expires}: only a live delegation is renewed`));
    else if (kept.expires <= at) findings.push(refuse('renew-expired', `delegation ${was.id} (prefix ${was.prefix}) would expire at ${kept.expires}, not later than ${at}`));
    else if (kept.expires <= was.expires) findings.push(refuse('renew-not-extension', `delegation ${was.id} (prefix ${was.prefix}) would expire at ${kept.expires}, not later than its ${was.expires}: a renewal extends`));
  }
  return findings;
}

// --- The superseded states' revocations -------------------------------------------------------------------------------

type Effect = (draft: OrgState) => void;

/** One holder's closure: the candidates it carries, what it does to a successor, and what it revokes and unroots. */
type Plan = {
  candidates: RevokedKey[];
  /** The candidate's own line, then each consequence. */
  lines: string[];
  effects: Effect[];
  /** Every key id the closure puts in `revoked`. */
  revokes: string[];
  /** Root key ids the closure takes out of `root.keys`. */
  unroots: string[];
};

const revoke =
  (entry: RevokedKey): Effect =>
  (draft) => {
    if (!draft.revoked.some((r) => r.keyId === entry.keyId)) draft.revoked.push(structuredClone(entry));
  };

/** A `retired` entry moved to `revoked` under its own holder, as `keysAccounted` permits. */
const unretire =
  (kid: string): Effect =>
  (draft) => {
    const entry = draft.retired.find((r) => r.keyId === kid);
    if (entry === undefined) return;
    draft.retired = draft.retired.filter((r) => r !== entry);
    revoke({ keyId: kid, holder: entry.holder })(draft);
  };

const deviceHolder = (member: Member, device: Device, key: 'channel' | 'step-up'): Extract<KeyHolder, { key: unknown }> => ({ member: member.id, device: device.id, class: device.class, key });

/**
 * The closure of revoking `candidate` on the successor of `head`, by where its key sits there (M3's rules):
 * - current as a device's key: the device leaves its member, both its keys revoked, its step-up kid out of `root.keys`;
 * - current as a machine's: the machine leaves `machines`, its key revoked;
 * - current as a delegation's: the delegation is dropped, its key revoked, its certificates' retirements revoked;
 * - retired: the entry moves from `retired` to `revoked`;
 * - none of these, under a machine holder: the entry alone (a delegated certificate's key lives in the hub's set);
 * - otherwise nothing, since `keysAccounted` refuses a new revocation of a key the predecessor neither held nor retired.
 * `taken` holds the key ids earlier plans already revoke, which a delegation's closure leaves to them.
 */
async function closure(head: OrgState, current: Map<string, Current>, candidate: RevokedKey, taken: ReadonlySet<string>): Promise<Plan | null> {
  const kid = candidate.keyId;
  const c = current.get(kid);
  if (c?.kind === 'device') {
    const { member, device } = c;
    const channel = { keyId: await keyId(device.channelPub), holder: deviceHolder(member, device, 'channel') };
    const stepUp = device.stepUpPub === undefined ? null : { keyId: await keyId(device.stepUpPub), holder: deviceHolder(member, device, 'step-up') };
    const keys = [channel, ...(stepUp ? [stepUp] : [])];
    const unroots = stepUp && head.root.keys.includes(stepUp.keyId) ? [stepUp.keyId] : [];
    const lines = [`revoke ${member.email}'s device ${device.id}, which the recovery listed again: its ${c.key} key ${kid} was revoked before it`];
    for (const k of keys) if (k.keyId !== kid) lines.push(`its ${k.holder.key} key ${k.keyId} is revoked with it`);
    for (const r of unroots) lines.push(`${r} leaves the root set`);
    return {
      candidates: [candidate],
      lines,
      revokes: keys.map((k) => k.keyId),
      unroots,
      effects: [
        (draft) => {
          const m = draft.members.find((x) => x.id === member.id);
          if (m) m.devices = m.devices.filter((x) => x.id !== device.id);
          draft.root.keys = draft.root.keys.filter((k) => !unroots.includes(k));
        },
        ...keys.map(revoke),
      ],
    };
  }
  if (c?.kind === 'machine') {
    const { entry } = c;
    return {
      candidates: [candidate],
      lines: [`revoke machine ${entry.name} (${entry.ref}), which the recovery listed again: its key ${kid} was revoked before it, and it leaves the org`],
      revokes: [kid],
      unroots: [],
      effects: [(draft) => void (draft.machines = draft.machines.filter((m) => m.ref !== entry.ref)), revoke({ keyId: kid, holder: { machine: entry.ref } })],
    };
  }
  if (c?.kind === 'delegation') {
    const { delegation } = c;
    const certs = head.retired.filter((r) => 'machine' in r.holder && r.holder.machine.startsWith(`${delegation.id}_`) && !taken.has(r.keyId));
    return {
      candidates: [candidate],
      lines: [
        `drop delegation ${delegation.id} (prefix ${delegation.prefix}), which the recovery listed again: its key ${kid} was revoked before it`,
        ...certs.map((r) => `its certificate's retired key ${r.keyId} (${describeHolder(head, r.holder)}) moves to revoked`),
      ],
      revokes: [kid, ...certs.map((r) => r.keyId)],
      unroots: [],
      effects: [
        (draft) => void (draft.delegations = draft.delegations.filter((d) => d.id !== delegation.id)),
        revoke({ keyId: kid, holder: { delegation: delegation.id, prefix: delegation.prefix } }),
        ...certs.map((r) => unretire(r.keyId)),
      ],
    };
  }
  const retired = head.retired.find((r) => r.keyId === kid);
  if (retired !== undefined) {
    return {
      candidates: [candidate],
      lines: [`move the retired key ${kid} (${describeHolder(head, retired.holder)}) to revoked: it was revoked before the recovery`],
      revokes: [kid],
      unroots: [],
      effects: [unretire(kid)],
    };
  }
  if ('machine' in candidate.holder) {
    const holder = { machine: candidate.holder.machine };
    return {
      candidates: [candidate],
      lines: [`revoke the key ${kid} of ${describeHolder(head, holder)} (a certificate's): it was revoked before the recovery`],
      revokes: [kid],
      unroots: [],
      effects: [revoke({ keyId: kid, holder })],
    };
  }
  return null;
}

/**
 * The plans for every revocation a superseded state signed that `head.revoked` lacks, in the superseded states' order,
 * each key once. A candidate whose key an earlier plan already revokes (a device's other key, a delegation's retired
 * certificate) joins that plan.
 */
async function plans(head: OrgState, superseded: readonly SignedOrgState[]): Promise<Plan[]> {
  const inHead = new Set(head.revoked.map((r) => r.keyId));
  const current = await currentKeys(head);
  const all: Plan[] = [];
  const byKid = new Map<string, Plan>();
  for (const { state } of superseded) {
    for (const candidate of state.revoked) {
      if (inHead.has(candidate.keyId)) continue;
      const covering = byKid.get(candidate.keyId);
      if (covering !== undefined) {
        if (!covering.candidates.some((c) => c.keyId === candidate.keyId)) covering.candidates.push(candidate);
        continue;
      }
      const plan = await closure(head, current, candidate, new Set(byKid.keys()));
      if (plan === null) continue;
      all.push(plan);
      for (const kid of plan.revokes) byKid.set(kid, plan);
    }
  }
  return all;
}

/**
 * The revocations the superseded states signed that the recovered line lost, offered as one edit (P5 Decision Log 30).
 * A plan whose closure would revoke this device's own keys, or leave `root.keys` empty, is withheld: named, never
 * applied. Null when there is no candidate at all.
 */
export async function supersededRevocations(head: OrgState, superseded: readonly SignedOrgState[], self: { channelKid: string; stepUpKid: string }): Promise<SupersededOffer> {
  const all = await plans(head, superseded);
  if (all.length === 0) return null;
  const own = new Set([self.channelKid, self.stepUpKid]);
  let roots = new Set(head.root.keys);
  const offered: Plan[] = [];
  const withheld: RevokedKey[] = [];
  for (const plan of all) {
    const left = [...roots].filter((k) => !plan.unroots.includes(k));
    if (plan.revokes.some((kid) => own.has(kid)) || left.length === 0) {
      withheld.push(...plan.candidates);
      continue;
    }
    roots = new Set(left);
    offered.push(plan);
  }
  return {
    lines: offered.flatMap((plan) => plan.lines),
    withheld,
    edit(draft) {
      for (const plan of offered) for (const effect of plan.effects) effect(draft);
    },
  };
}

/**
 * `superseded-keys`: each revocation a superseded state signed that the head lacks, that some successor could carry,
 * and that `next.revoked` doesn't (withheld ones included: the owner settles those by other means, and each prompt says
 * they are still open).
 */
async function supersededLeftOut(head: OrgState, next: OrgState, superseded: readonly SignedOrgState[]): Promise<Finding[]> {
  if (superseded.length === 0) return [];
  const carried = new Set(next.revoked.map((r) => r.keyId));
  const findings: Finding[] = [];
  for (const plan of await plans(head, superseded)) {
    for (const c of plan.candidates) {
      if (!carried.has(c.keyId)) findings.push(warn('superseded-keys', `${describeHolder(head, c.holder)} (${c.keyId}) was revoked on the branch the recovery discarded, and this state doesn't revoke it`));
    }
  }
  return findings;
}
