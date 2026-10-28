// RL2's channel messages (RL3's subscriptions and calls, RL4's actions and queries, RL7's device capabilities), sealed
// JSON (Interfaces §B of docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md). The channel (channel.ts) carries any
// `{ t, … }` and handles `part` and `close` itself; `readMessage` sorts what it delivers into a known message, one of a
// kind this version doesn't know (a newer peer of the same major: ignored, OX1), or a malformed one (which closes).
// A known message's named fields are checked; others it carries pass, as additions within a major do.
import { isAction, type Action } from './action.ts';
import { isIsoMillis } from './names.ts';
import type { Right, DeviceClass, RootTransition, Signed, SignedOrgState } from './types.ts';

/** One vocabulary for `ack`, `result`, `ended` and `close`. */
export const REFUSAL_REASONS = [
  'stale', 'malformed', 'expired', 'replayed', 'context', 'digest-mismatch', 'op-conflict', 'no-ledger', 'not-offered', 'ungraded', 'no-rule',
  'no-target', 'grade', 'step-up', 'class', 'read-only', 'ceiling', 'unknown-checkout', 'spec-field', 'state-too-old', 'act-required',
  'unavailable', 'removed', 'restart', 'busy', 'behind',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
export const isRefusalReason = (value: unknown): value is RefusalReason => typeof value === 'string' && (REFUSAL_REASONS as readonly string[]).includes(value);

/** The largest byte credit a subscription holds (M8). */
export const SUB_CREDIT_MAX = 4 * 1024 * 1024;
export type Executor = 'sminos' | 'engine-host' | 'endpoint';
export type SessionRef = { lane: 'A' | 'B'; id: string };
/** A subscription's cursor: lane A's epoch is the endpoint's upstream subscription, lane B's the launch; `idx`, lane B's
 * only, is the event's index within its journal row. */
export type Cursor = { epoch: string; seq: number; idx?: number };
export type QueryState = 'done' | 'in-progress' | 'refused' | 'not-received' | 'expired' | 'unavailable';

export type CallMessage = { t: 'call'; id: string; name: string; input: unknown };
export type ActMessage = { t: 'act'; action: Action };
export type QueryMessage = { t: 'query'; opId: string; opCreated: string; executor: Executor };
export type SubMessage = { t: 'sub'; sub: string; session: SessionRef; view?: 'full' | 'cards'; cursor: Cursor | null; credit: number };
export type CreditMessage = { t: 'credit'; sub: string; bytes: number };
export type UnsubMessage = { t: 'unsub'; sub: string };

/** RL7's device half: what this device may do on the machine, sent after the handshake and on every change. */
export type CapsMessage = { t: 'caps'; member: string; device: string; clientClass: DeviceClass; machine: { grades: Right[] }; stateVersion: number };
export type ResultMessage = { t: 'result'; id: string; ok: true; output: unknown } | { t: 'result'; id: string; ok: false; error: { code: string; message?: string } };
export type AckMessage = { t: 'ack'; opId: string; state: 'accepted' } | { t: 'ack'; opId: string; state: 'refused'; reason: string };
export type DoneMessage = { t: 'done'; opId: string; outcome: unknown };
/** `reason`: why the endpoint said nothing of the operation (`grade`, `class`), with `state: 'refused'` and no `outcome`;
 * a `refused` with an `outcome` is the operation's own refusal by its executing side. */
export type QueriedMessage = { t: 'queried'; opId: string; state: QueryState; outcome?: unknown; reason?: string };
export type SubbedMessage = { t: 'subbed'; sub: string; mode: 'replay' | 'snapshot' | 'missing'; epoch: string; seq: number; idx?: number };
export type EvMessage = { t: 'ev'; sub: string; epoch: string; seq: number; idx?: number; body: unknown };
export type SnapMessage = { t: 'snap'; sub: string; epoch: string; seq: number; idx?: number; page: number; last: boolean; body: unknown };
export type PausedMessage = { t: 'paused'; sub: string; reason: string };
export type ResumedMessage = { t: 'resumed'; sub: string };
export type EndedMessage = { t: 'ended'; sub: string; reason: string };

export type StateMessage = { t: 'state'; states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
export type PingMessage = { t: 'ping'; at: number };
export type PongMessage = { t: 'pong'; at: number };
/** `stateVersion` rides with `behind` only (§A's catch-up). */
export type CloseMessage = { t: 'close'; reason: string; stateVersion?: number };

export type EitherMessage = StateMessage | PingMessage | PongMessage | CloseMessage;
export type DeviceMessage = CallMessage | ActMessage | QueryMessage | SubMessage | CreditMessage | UnsubMessage | EitherMessage;
export type EndpointMessage =
  | CapsMessage
  | ResultMessage
  | AckMessage
  | DoneMessage
  | QueriedMessage
  | SubbedMessage
  | EvMessage
  | SnapMessage
  | PausedMessage
  | ResumedMessage
  | EndedMessage
  | EitherMessage;

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v !== '' && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPositive = (v: unknown, max: number): v is number => isCount(v) && v >= 1 && v <= max;
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const OP_ID = /^[A-Za-z0-9_-]{16,128}$/;
const isOpId = (v: unknown) => typeof v === 'string' && OP_ID.test(v);
const position = (m: Fields) => isText(m.epoch) && isCount(m.seq) && optional(m.idx, isCount);

function isCursor(v: unknown, lane: 'A' | 'B'): boolean {
  return v === null || (isObject(v) && isText(v.epoch) && isCount(v.seq) && (v.idx === undefined || (lane === 'B' && isCount(v.idx))));
}

const isSessionRef = (v: unknown): v is SessionRef => isObject(v) && (v.lane === 'A' || v.lane === 'B') && isText(v.id);

const EITHER: Record<string, (m: Fields) => boolean> = {
  state: (m) => Array.isArray(m.states) && Array.isArray(m.transitions),
  ping: (m) => isCount(m.at),
  pong: (m) => isCount(m.at),
  close: (m) => isText(m.reason, 64) && optional(m.stateVersion, isCount),
};

const FROM_DEVICE: Record<string, (m: Fields) => boolean> = {
  ...EITHER,
  call: (m) => isText(m.id, 128) && isText(m.name, 128) && 'input' in m,
  act: (m) => isAction(m.action),
  query: (m) => isOpId(m.opId) && isIsoMillis(m.opCreated) && (m.executor === 'sminos' || m.executor === 'engine-host' || m.executor === 'endpoint'),
  sub: (m) =>
    isText(m.sub, 128) &&
    isSessionRef(m.session) &&
    optional(m.view, (v) => v === 'full' || v === 'cards') &&
    isCursor(m.cursor, m.session.lane) &&
    isPositive(m.credit, SUB_CREDIT_MAX),
  credit: (m) => isText(m.sub, 128) && isPositive(m.bytes, SUB_CREDIT_MAX),
  unsub: (m) => isText(m.sub, 128),
};

const GRADES = ['spawn', 'shell', 'machine-admin'];
const FROM_ENDPOINT: Record<string, (m: Fields) => boolean> = {
  ...EITHER,
  caps: (m) =>
    isText(m.member) &&
    isText(m.device) &&
    (m.clientClass === 'native-mac' || m.clientClass === 'web-cards') &&
    isObject(m.machine) &&
    Array.isArray(m.machine.grades) &&
    m.machine.grades.every((g) => GRADES.includes(g as string)) &&
    isCount(m.stateVersion),
  result: (m) => isText(m.id, 128) && (m.ok === true ? 'output' in m : m.ok === false && isObject(m.error) && isText(m.error.code, 64) && optional(m.error.message, (v) => typeof v === 'string')),
  ack: (m) => isOpId(m.opId) && (m.state === 'accepted' || (m.state === 'refused' && isText(m.reason, 64))),
  done: (m) => isOpId(m.opId) && 'outcome' in m,
  queried: (m) => isOpId(m.opId) && ['done', 'in-progress', 'refused', 'not-received', 'expired', 'unavailable'].includes(m.state as string) && optional(m.reason, (v) => isText(v, 64)),
  subbed: (m) => isText(m.sub, 128) && (m.mode === 'replay' || m.mode === 'snapshot' || m.mode === 'missing') && position(m),
  ev: (m) => isText(m.sub, 128) && position(m) && 'body' in m,
  snap: (m) => isText(m.sub, 128) && position(m) && isCount(m.page) && typeof m.last === 'boolean' && 'body' in m,
  paused: (m) => isText(m.sub, 128) && isText(m.reason, 64),
  resumed: (m) => isText(m.sub, 128),
  ended: (m) => isText(m.sub, 128) && isText(m.reason, 64),
};

/**
 * A delivered message, read as the vocabulary of the side that sent it: `message` when it is a known kind in its shape,
 * `unknown` for a kind this version doesn't know (ignore it), `malformed` for a known kind out of shape (close).
 */
export function readMessage(from: 'device', value: unknown): { kind: 'message'; message: DeviceMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' };
export function readMessage(from: 'endpoint', value: unknown): { kind: 'message'; message: EndpointMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' };
export function readMessage(from: 'device' | 'endpoint', value: unknown): { kind: 'message'; message: DeviceMessage | EndpointMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' } {
  if (!isObject(value) || typeof value.t !== 'string') return { kind: 'malformed' };
  const table = from === 'device' ? FROM_DEVICE : FROM_ENDPOINT;
  const check = Object.hasOwn(table, value.t) ? table[value.t] : undefined;
  if (check === undefined) return value.t === 'part' ? { kind: 'malformed' } : { kind: 'unknown', t: value.t };
  return check(value) ? { kind: 'message', message: value as DeviceMessage } : { kind: 'malformed' };
}
