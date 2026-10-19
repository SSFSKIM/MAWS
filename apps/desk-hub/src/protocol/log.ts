// DX1 — log events (docs/doperpowers/specs/2026-10-15-desk-design.md): smns §3's events, carried by the hub exactly as
// received. The hub reads `writer`, `seq`, `kind`, `to`, and `member`; every other field passes through, which is why an
// event is typed as an open object.
import { isMemberId } from './identity';
import type { JsonObject } from './json';

/**
 * The authentication code: a 128-bit nonce, never repeated under one org key, and HMAC-SHA256 with the org key, both
 * base64url. The nonce is random from a browser; a machine's own log events may instead carry one derived from the org
 * key and the event (`deriveLogNonce`), so an upload resent after a lost answer carries the same bytes. A verifier
 * cannot tell the two apart and needs not to.
 */
export type Mac = { nonce: string; value: string };

export type Recipient = { session: string; alias: string };

export type LogEvent = JsonObject & {
  ts: string;
  writer: string;
  seq: number;
  kind: string;
  mac: Mac;
};

/**
 * A web `human` before the hub sequences it: the browser seals this (DX1 leaves `writer`, `seq`, and `ts` out of a
 * `hub/` event's code), and the hub stores it with those three added and nothing else changed.
 */
export type HumanDraft = {
  kind: 'human';
  from: 'human';
  member: string;
  to: '*' | Recipient[];
  text: string;
  created: string;
  wake?: boolean;
};

export type HumanEvent = HumanDraft & { mac: Mac };

/** `{writer: max seq}` for one project: the version vector of the log handshake (DX2). */
export type Vector = Record<string, number>;

export const HUB_WRITER_PREFIX = 'hub/';
export const LEGACY_WRITER_PREFIX = 'legacy/';

export const hubWriter = (member: string) => `${HUB_WRITER_PREFIX}${member}`;
export const isHubWriter = (writer: string) => writer.startsWith(HUB_WRITER_PREFIX);

/** A log `seq`: a JSON number whose value is a positive integer no larger than 2^53 − 1. */
export function isLogSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 1;
}

const ISO_MILLIS = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.[0-9]{3}Z$/;

/**
 * An ISO 8601 UTC time with milliseconds, `YYYY-MM-DDTHH:MM:SS.mmmZ`, naming a real calendar day (leap years by the
 * Gregorian rule), an hour below 24, and minutes and seconds below 60. Checked by these rules alone, not by a date
 * library, so the daemon's Python and this agree on every string.
 */
export function isIsoMillis(ts: unknown): ts is string {
  if (typeof ts !== 'string') return false;
  const m = ISO_MILLIS.exec(ts);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60;
}

/**
 * A `hub/` event's position — `writer`, `seq`, `ts`, which the hub assigns and its code leaves out — checked by shape
 * (DX1): the writer is exactly `hub/` and the event's own `member` (32 lowercase hex, which the code covers), the seq a
 * positive integer, the time ISO 8601 UTC with milliseconds. sminos's delivery writes the writer into the frame a
 * session reads, so an unchecked writer could carry text no code covers. `verify` applies it to every `hub/` event.
 */
export function isHubPosition(event: { writer?: unknown; seq?: unknown; ts?: unknown; member?: unknown }): boolean {
  return (
    typeof event.member === 'string' &&
    isMemberId(event.member) &&
    event.writer === hubWriter(event.member) &&
    isLogSeq(event.seq) &&
    isIsoMillis(event.ts)
  );
}

/** A `hub/` event as the browser sealed it: the stored event without the `writer`, `seq`, and `ts` the hub assigned. */
export function withoutPosition<T extends object>(event: T): Omit<T, 'writer' | 'seq' | 'ts'> {
  const out = { ...event } as Record<string, unknown>;
  delete out.writer;
  delete out.seq;
  delete out.ts;
  return out as Omit<T, 'writer' | 'seq' | 'ts'>;
}

/** The machine a writer belongs to (`<machine>/<session uuid>` or `<machine>/human`), or null for `hub/` and `legacy/`. */
export function writerMachine(writer: string): string | null {
  if (isHubWriter(writer) || writer.startsWith(LEGACY_WRITER_PREFIX)) return null;
  const slash = writer.indexOf('/');
  return slash > 0 ? writer.slice(0, slash) : null;
}

/** What one log event does to the async questions its session holds open (`questionEffect`). */
export type QuestionEffect = { kind: 'question' | 'answered'; machine: string; session: string; ask: string } | { kind: 'retired'; session: string };

/**
 * What a log event does to the async questions its session holds open, which the hub's waiting count and the web's
 * "waiting on you" both read (owner, 2026-10-18). An async ask (the ask mod's with `async`, MAWS's `mcp__maws__ask`
 * with `blocking` false) reaches the log as a `question` from the asking session's feed, `src` the ask's id (its call
 * id, or MAWS's askId), and its answer as an `answered` from the same feed with the same `src`. The session's `retired`
 * from its own feed (as smns reads membership) ends every ask it holds: an ask dies with its process. Null for any other
 * event, and for a feed that is no session's (`hub/`, `legacy/`, a machine's `human`).
 */
export function questionEffect(event: LogEvent): QuestionEffect | null {
  const machine = writerMachine(event.writer);
  const session = machine === null ? 'human' : event.writer.slice(machine.length + 1);
  if (machine === null || session === 'human') return null;
  if (event.kind === 'retired') return event.session === session ? { kind: 'retired', session } : null;
  // An ask's id is a request's when a bridge raised it too (DX4 `raised.request`, at most 512 characters).
  const ask = event.src;
  if ((event.kind === 'question' || event.kind === 'answered') && typeof ask === 'string' && ask !== '' && ask.length <= 512) return { kind: event.kind, machine, session, ask };
  return null;
}
