// A session's reach from the app (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces
// §Q): `org.policy.get`, `org.policy.set` and M5b's `org.owners.add`. Each reads, or changes, a session's general access
// and shares on its own machine: another machine's over its RL2 link (`record.policy`, and the `record.*` acts as step-up
// acts), this Mac's over its own endpoint's local door (`endpoint.local.call` and `.act`, through mawsd's machine socket).
//
// - The act names its target in its args, exactly one of `{session}` (a lane A session, by its engine session id) or
//   `{appSessionId}` (lane B), beside the change, and carries no `session` and no `context`: a record act doesn't depend
//   on how the session was launched. Another machine's session's lane is its row's (rows.ts); this Mac's sessions here
//   are its app sessions (lane B). Its executor is sminos, and every one is stepped up.
// - A save is a list of acts in the sheet's order: the access if it changed, then each share added, changed or removed.
//   They are signed under one confirmation (`actMany`; the door's `signActions`), then sent in order, each after the last
//   one's outcome, and the first that doesn't run stops the rest (`not-sent`), so each line shows what went through.
// - The revision check is best effort: the act carries no expected revision, so the save reads `record.policy` again
//   before Touch ID and once more after it, before the first act, and sends nothing if `policyRev` moved from the one the
//   sheet opened on (`changed-elsewhere`). A change landing between that read and an act is applied over: each `done`
//   carries the revision it left, and a line whose revision skipped one is marked `elsewhere`. After the acts the
//   machine's policies are read again whole, told (`org.policies.changed`) and the session's returned as it stands.
//   After each act's outcome the rows read the machine's channel listings again (a private session's audience moved).
// - A read belongs to the sign-in it started under (who is signed in, and which sign-in it is, as rows.ts binds its
//   channel answers to their reader): one that answers after a sign-out or another sign-in, the same member's again
//   included, tells nothing and answers `signed-out`, so no window is refilled with a reader's policies once they're gone.
//   A save is that reader's too, its acts signed by their key: once the sign-in it began under ends, during Touch ID or
//   between two acts, the next line reads refused `signed-out` and those after it `not-sent`, for good (a new sign-in,
//   the same member's included, sends none of them), and no policy is read back for it.
// - A refusal is passed on in its refuser's own words (the endpoint's `no-session` is plain text, as any other): only
//   step-up's `step-up-cancelled` reads `cancelled`, and the ledger's `not-received` (`not-sent`) reads `tombstoned`.
//
// Electron-free: main injects the links, the door and the rows.
import { isAddress, machineOf, bareOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { RecordPolicyAnswerSchema, type RecordPolicyAnswer, type RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import type { OrgPolicy, OrgPolicyLine, OrgPolicyOutcome, OrgPolicySetInput, OrgPolicySetResult } from '@shared/ipc/schema/org';
import type { Action } from '../../../apps/org-protocol/src/index.ts';
import type { ActRequest } from '../machines/remote/acts';
import type { RemoteLink } from '../machines/remote/link';
import type { OrgSession } from './session';

/** What a save reads and acts through on another machine. */
export type PolicyLink = Pick<RemoteLink, 'call' | 'actMany'>;
/** This Mac's own endpoint, through its local door. */
export interface LocalPolicyDoor {
  /** `endpoint.local.act`: the act's outcome as `done` carries it, or its refusal. */
  act(action: Action): Promise<unknown>;
  /** `endpoint.local.call` for `record.policy`. */
  call(input: { session: string } | null): Promise<{ ok: true; output: unknown } | { ok: false; code: string }>;
}

export interface OrgPoliciesDeps {
  session: OrgSession;
  local: MachineRef;
  /** A roster machine's link (`Machines.remote`), null when there is none. */
  remote(ref: MachineRef): PolicyLink | null;
  door: LocalPolicyDoor;
  /** Another machine's session's lane, as its row says (rows.ts); null when no row holds it. */
  laneOf(machine: MachineRef, session: string): 'A' | 'B' | null;
  /** After each act's outcome: the machine's channel listings read again (rows.ts's `refreshChannel`). */
  acted(machine: MachineRef): void;
  /** `org.policies.changed`. */
  emit(policy: OrgPolicy): void;
  log(line: string): void;
}

export interface OrgPolicies {
  get(input: { machine: MachineRef } | { address: string }): Promise<OrgPolicy>;
  set(input: OrgPolicySetInput): Promise<OrgPolicySetResult>;
  /** M5b's. */
  addOwner(input: { address: string; member: string }): Promise<OrgPolicySetResult>;
}

/** The target as the act's args name it. */
type Target = { machine: MachineRef; session: string; args: { session: string } | { appSessionId: string } };
/** A machine's way in: its policies' read, and a save's acts signed under one confirmation, each sent when asked. */
type Door = {
  read(session: string | null): Promise<{ ok: true; answer: RecordPolicyAnswer } | { ok: false; reason: string }>;
  sign(acts: readonly { action: RecordAct['action']; args: Record<string, unknown> }[]): Promise<{ ok: true; sends: Array<() => Promise<unknown>> } | { ok: false; reason: string }>;
};
/** One line of a save: its act, the change its args carry beside the target, and the line the sheet showed. */
type RecordAct = { action: 'record.access' | 'record.shares' | 'record.owners'; change: Record<string, unknown>; line: OrgPolicyLine };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refused = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** A line's outcome from an act's, `prev` the revision before it (null: none known, nothing to mark). */
function outcomeOf(line: OrgPolicyLine, outcome: unknown, prev: number | null): OrgPolicyOutcome {
  const state = isObject(outcome) ? outcome.state : undefined;
  if (state === 'done') {
    const result = isObject(outcome) ? outcome.result : undefined;
    // a `done` that says no change and revision is read as one that may have run, never as a change: it stops the save
    if (!isObject(result) || typeof result.changed !== 'boolean' || !Number.isInteger(result.policyRev) || (result.policyRev as number) < 0) return { line, state: 'unknown', reason: 'malformed' };
    const policyRev = result.policyRev as number;
    // a change bumps the revision by one, a no-op by none: anything past that is another's change between
    const elsewhere = prev !== null && policyRev > prev + (result.changed ? 1 : 0);
    return { line, state: 'done', changed: result.changed, policyRev, elsewhere };
  }
  const reason = isObject(outcome) && typeof outcome.reason === 'string' ? outcome.reason : null;
  if (state === 'refused') return { line, state: 'refused', reason: reason === 'step-up-cancelled' ? 'cancelled' : (reason ?? 'refused') };
  if (state === 'not-sent') return { line, state: 'refused', reason: 'tombstoned' }; // the ledger's not-received: nothing ran, nor will
  if (state === 'failed') return { line, state: 'failed', reason: reason ?? 'failed' };
  return { line, state: 'unknown', reason: reason ?? 'unknown' };
}

/** The session's entry in a read, or why it can't be saved over. */
function entryOf(answer: RecordPolicyAnswer, session: string): { ok: true; entry: Extract<RecordPolicyEntry, { policyRev: number }> } | { ok: false; reason: string } {
  if (!answer.supported) return refused('not-supported');
  const entry = answer.policies.find((p) => p.session === session);
  if (entry === undefined || 'unavailable' in entry) return refused('unavailable');
  return { ok: true, entry };
}

export function createOrgPolicies(deps: OrgPoliciesDeps): OrgPolicies {
  const log = (line: string) => deps.log(`[org-policy] ${line}`);

  // The sign-in a read starts under: who is signed in, and its generation, bumped whenever that changes (a sign-out
  // included), so a sign-in after one that ended is another even for the same member. A new head adopted is no change.
  const readerOf = () => {
    const current = deps.session.current();
    return current === null ? null : `${current.identity.org}\n${current.identity.member}`;
  };
  let reader = readerOf();
  let generation = 0;
  deps.session.onChanged(() => {
    if (readerOf() === reader) return;
    reader = readerOf();
    generation++;
  });
  const signIn = () => ({ reader: readerOf(), generation });
  const stands = (at: ReturnType<typeof signIn>) => at.reader !== null && at.generation === generation && readerOf() === at.reader;

  /** The machine's way in, or null when it has none (signed out; no link). */
  function doorOf(machine: MachineRef): Door | null {
    const current = deps.session.current();
    if (current === null) return null;
    const parse = (output: unknown) => {
      const parsed = RecordPolicyAnswerSchema.safeParse(output);
      if (!parsed.success) log(`${machine}'s record.policy answer is not a policy read`);
      return parsed.success ? { ok: true as const, answer: parsed.data } : refused('malformed');
    };
    const input = (session: string | null) => (session === null ? null : { session });
    if (machine === deps.local) {
      return {
        async read(session) {
          const result = await deps.door.call(input(session));
          return result.ok ? parse(result.output) : refused(result.code);
        },
        async sign(acts) {
          const signed = await current.stepUp.signActions(acts.map((act) => ({ machine, action: act.action, args: act.args })));
          if (!signed.ok) return refused(signed.reason === 'malformed' ? 'malformed' : 'cancelled');
          // the save sends each only while the sign-in it began under stands (save's fence)
          const send = (action: Action) => deps.door.act(action).catch((error: unknown) => ({ state: 'unknown', reason: (error as Error).message }));
          return { ok: true, sends: signed.actions.map((action) => () => send(action)) };
        },
      };
    }
    const link = deps.remote(machine);
    if (link === null) return null;
    return {
      async read(session) {
        const result = await link.call('record.policy', input(session));
        return result.ok ? parse(result.output) : refused(result.error.code);
      },
      async sign(acts) {
        const signed = await link.actMany(acts.map((act): ActRequest => ({ action: act.action, args: act.args, executor: 'sminos', stepUp: 'required' })));
        if (!signed.ok) return refused(signed.reason === 'step-up-cancelled' ? 'cancelled' : signed.reason);
        return { ok: true, sends: signed.acts.map((act) => () => act.send().outcome) };
      },
    };
  }

  /** The act's target for a session's address: this Mac's app session, or another machine's by its row's lane. */
  function targetOf(address: string): { ok: true; target: Target } | { ok: false; reason: string } {
    if (!isAddress(address)) return refused('malformed');
    const machine = machineOf(address);
    const session = bareOf(address);
    const lane = machine === deps.local ? 'B' : deps.laneOf(machine, session);
    if (lane === null) return refused('no-session');
    return { ok: true, target: { machine, session, args: lane === 'A' ? { session } : { appSessionId: session } } };
  }

  /** Reads the machine's policies whole and tells them, or reads one session's. */
  async function read(machine: MachineRef, session: string | null): Promise<OrgPolicy> {
    const at = signIn();
    if (at.reader === null) return { ok: false, machine, reason: 'signed-out' };
    const door = doorOf(machine);
    if (door === null) return { ok: false, machine, reason: 'offline' };
    const result = await door.read(session);
    if (!stands(at)) return { ok: false, machine, reason: 'signed-out' };
    if (!result.ok) return { ok: false, machine, reason: result.reason };
    const policy: OrgPolicy = result.answer.supported ? { ok: true, machine, supported: true, policies: result.answer.policies } : { ok: true, machine, supported: false };
    if (session === null) deps.emit(policy);
    return policy;
  }

  /**
   * A save's acts, under one confirmation, then in order, each after the last one's outcome; `policyRev`, the revision
   * the sheet opened on (null: none, for M5b's add, which reads nothing before).
   */
  async function save(address: string, acts: RecordAct[], policyRev: number | null): Promise<OrgPolicySetResult> {
    // the sign-in the save is made under: its acts are that reader's, signed by their key, and none goes once it ends
    const at = signIn();
    if (at.reader === null) return refused('signed-out');
    const target = targetOf(address);
    if (!target.ok) return target;
    if (acts.length === 0) return refused('empty');
    const { machine, session } = target.target;
    const door = doorOf(machine);
    if (door === null) return refused('offline');
    const requests = acts.map(({ action, change }) => ({ action, args: { ...target.target.args, ...change } }));
    // the revision as the sheet opened on it, read on Save before Touch ID, and again after it before the first act
    const unmoved = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (policyRev === null) return { ok: true };
      const result = await door.read(session);
      if (!result.ok) return result;
      const entry = entryOf(result.answer, session);
      if (!entry.ok) return entry;
      return entry.entry.policyRev === policyRev ? { ok: true } : refused('changed-elsewhere');
    };
    const before = await unmoved();
    if (!before.ok) return before;
    if (!stands(at)) return refused('signed-out');
    const signed = await door.sign(requests);
    if (!signed.ok) return signed;
    // signed out (or another sign-in) during the confirmation: the acts are stopped below, line by line
    const after = stands(at) ? await unmoved() : ({ ok: true } as const);
    if (!after.ok) return after;
    const results: OrgPolicyOutcome[] = [];
    let prev = policyRev;
    for (let i = 0; i < acts.length; i++) {
      const line = acts[i].line;
      if (results.some((r) => r.state !== 'done')) {
        results.push({ line, state: 'not-sent' });
        continue;
      }
      // the sign-in it was signed under has ended: this line, and every one after it, stays unsent for good
      if (!stands(at)) {
        results.push({ line, state: 'refused', reason: 'signed-out' });
        continue;
      }
      const outcome = outcomeOf(line, await signed.sends[i](), prev);
      deps.acted(machine);
      results.push(outcome);
      if (outcome.state === 'done') prev = outcome.policyRev;
    }
    // read for the save's own reader alone: another sign-in's read is no answer to this save
    const now = stands(at) ? await read(machine, null) : null;
    const policy = now !== null && now.ok && now.supported ? (now.policies.find((p) => p.session === session) ?? null) : null;
    return { ok: true, results, policy };
  }

  return {
    get(input) {
      if ('machine' in input) return read(input.machine, null);
      if (!isAddress(input.address)) return Promise.resolve<OrgPolicy>({ ok: false, machine: deps.local, reason: 'malformed' });
      return read(machineOf(input.address), bareOf(input.address));
    },
    set(input) {
      const acts: RecordAct[] = [];
      if (input.access !== undefined) acts.push({ action: 'record.access', change: { access: input.access }, line: { kind: 'access', access: input.access } });
      for (const { member, grade } of input.shares ?? []) acts.push({ action: 'record.shares', change: { member, grade }, line: { kind: 'share', member, grade } });
      const members = (input.shares ?? []).map((share) => share.member);
      if (new Set(members).size !== members.length) return Promise.resolve(refused('malformed'));
      return save(input.address, acts, input.policyRev);
    },
    addOwner({ address, member }) {
      return save(address, [{ action: 'record.owners', change: { add: true, member }, line: { kind: 'owner', member } }], null);
    },
  };
}
