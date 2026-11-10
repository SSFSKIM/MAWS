// What a reach scene's devices ask of a machine over their channels, as a member's MAWS asks it (P5 O8 M6b,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces §P and §Q): the owner's record acts
// (`record.access`, `record.shares`, and `record.owners`'s add, O8 M5b), each signed by the device's step-up key, and their read, `record.policy`; a
// member's reading and draft of a lane B session (`session.reader.update`, `session.drafts.get` and `.set`, M6a), and
// the owner's read of theirs (`session.get`); and a lane A act sent only to be refused at its grade.
//
// The record acts are how a reach scene widens once its machine's endpoint says `record` in its RL10 welcome: sminos
// 1.39.0 and later then refuse every widening at the terminal ("use MAWS") and keep narrowing (sminos_visibility's
// THROUGH_APP). Each answer is checked to its shape here, and anything else throws, named.
import type { Remote } from './endpoint-remote';

export type Level = 'private' | 'listed' | 'org-view' | 'org-converse';
export type ShareGrade = 'list' | 'view' | 'converse' | 'approve';
/** A record act's target: a lane A session by its engine session id, or a lane B session by its app session id. */
export type RecordTarget = { session: string } | { appSessionId: string };
/** A record act's change: the access, one member's share (null removes it), or one more owner (`record.owners`, O8 M5b). */
export type RecordChange = { access: Level } | { member: string; grade: ShareGrade | null } | { add: true; member: string };
/** A record act's `done` (§Q): whether it changed the policy, and the revision it left. */
export type RecordResult = { changed: boolean; policyRev: number };
/** A session's policy as `record.policy` answers it. */
export type Policy = { access: string; shares: Array<{ member: string; grade: string }>; policyRev: number };
/** A member's reading of a session: what `session.reader.update` answers and `session.get`'s record carries. */
export type Reading = { pinned: unknown; unread: unknown; lastSeen: unknown };

/** What these acts and reads use of a device's channel (endpoint-remote.ts's Remote). */
export type ActChannel = Pick<Remote, 'device' | 'act' | 'done' | 'call'>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const shown = (value: unknown) => JSON.stringify(value ?? null).slice(0, 300);

/** A record act's outcome as §Q's `done` carries it: `{state: 'done', result: {changed, policyRev}}`; else throws. */
export function recordResult(name: string, outcome: unknown): RecordResult {
  const result = isObject(outcome) && outcome.state === 'done' && isObject(outcome.result) ? outcome.result : null;
  if (result === null || typeof result.changed !== 'boolean' || !Number.isSafeInteger(result.policyRev) || (result.policyRev as number) < 0) throw new Error(`${name} answered ${shown(outcome)}`);
  return { changed: result.changed, policyRev: result.policyRev as number };
}

/** A record act about `target` on `machine`, stepped up by the channel's device: its result, or throws its refusal. */
export async function recordAct(remote: ActChannel, machine: string, target: RecordTarget, change: RecordChange): Promise<RecordResult> {
  const name = 'access' in change ? 'record.access' : 'add' in change ? 'record.owners' : 'record.shares';
  const action = await remote.device.stepUp(remote.device.action({ machine, action: name, args: { ...target, ...change } }));
  const ack = await remote.act(action);
  if (ack !== 'accepted') throw new Error(`${name} refused ${ack}`);
  return recordResult(name, await remote.done(action.opId));
}

/** `session`'s entry in a `record.policy` answer; throws for an unsupported machine or a policy it can't read. */
export function policyOf(output: unknown, session: string): Policy {
  if (!isObject(output) || output.supported !== true || !Array.isArray(output.policies)) throw new Error(`record.policy answered ${shown(output)}`);
  const entry = (output.policies as unknown[]).find((p) => isObject(p) && p.session === session);
  if (!isObject(entry) || typeof entry.access !== 'string' || !Array.isArray(entry.shares) || !Number.isSafeInteger(entry.policyRev)) throw new Error(`record.policy has no readable policy of ${session}: ${shown(entry)}`);
  return { access: entry.access, shares: entry.shares as Policy['shares'], policyRev: entry.policyRev as number };
}

/** The session's policy as its owner reads it (`record.policy {session}`, the listing's id). */
export async function recordPolicy(remote: ActChannel, session: string): Promise<Policy> {
  const answer = await remote.call('record.policy', { session });
  if (!answer.ok) throw new Error(`record.policy refused ${answer.code}`);
  return policyOf(answer.output, session);
}

/** A call's output, or throws its refusal. */
export async function callOutput(remote: ActChannel, name: string, input: unknown): Promise<unknown> {
  const answer = await remote.call(name, input);
  if (!answer.ok) throw new Error(`${name} refused ${answer.code}`);
  return answer.output;
}

/** A machine act (the endpoint's own, no step-up: `session.drafts.set`): its `done` outcome, or throws its refusal. */
export async function machineAct(remote: ActChannel, machine: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const action = remote.device.action({ machine, action: name, args });
  const ack = await remote.act(action);
  if (ack !== 'accepted') throw new Error(`${name} refused ${ack}`);
  return remote.done(action.opId);
}

/** A lane A act on `session` at its launch, sent for its acknowledgement alone: `accepted`, or the refusal's reason. */
export function laneAAck(remote: ActChannel, machine: string, session: { session: string; launch: string }, name: string, args: Record<string, unknown>): Promise<string> {
  return remote.act(remote.device.action({ machine, action: name, session: session.session, context: { lane: 'A', session: session.session, launch: session.launch }, args: { session: session.session, ...args } }));
}

/** A composer draft of one paragraph, `text`, as the app saves one. */
export function draftOf(text: string, at = new Date().toISOString()): { doc: unknown; attachments: never[]; updatedAt: string } {
  return { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, attachments: [], updatedAt: at };
}

/** The reading a `ReaderState` or a session record carries; throws for anything without one. */
export function readingOf(value: unknown): Reading {
  if (!isObject(value) || !('pinned' in value) || !('unread' in value) || !('lastSeen' in value)) throw new Error(`no reading in ${shown(value)}`);
  return { pinned: value.pinned, unread: value.unread, lastSeen: value.lastSeen };
}
