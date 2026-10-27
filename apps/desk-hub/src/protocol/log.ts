// DX1 — log events (docs/doperpowers/specs/2026-10-15-desk-design.md): smns §3's events, carried by the hub exactly as
// received. The hub reads `writer`, `seq`, `kind`, `to`, and `member`; every other field passes through, which is why an
// event is typed as an open object.
import { isHubPosition, isHubWriter, isIsoMillis, isLogSeq, hubWriter, HUB_WRITER_PREFIX, LEGACY_WRITER_PREFIX, writerMachine, type Sig } from 'org-protocol';
import type { JsonObject } from './json';

// The writer grammar and the ISO time rule live in the protocol package (apps/org-protocol), which the v2 writer-to-
// signer rule shares; they are re-exported here under their names.
export { isHubPosition, isHubWriter, isIsoMillis, isLogSeq, hubWriter, HUB_WRITER_PREFIX, LEGACY_WRITER_PREFIX, writerMachine };

/**
 * The authentication code: a 128-bit nonce, never repeated under one org key, and HMAC-SHA256 with the org key, both
 * base64url. The nonce is random from a browser; a machine's own log events may instead carry one derived from the org
 * key and the event (`deriveLogNonce`), so an upload resent after a lost answer carries the same bytes. A verifier
 * cannot tell the two apart and needs not to.
 */
export type Mac = { nonce: string; value: string };

export type Recipient = { session: string; alias: string };

/**
 * A log event. `mac` is DX1's code; `sig` is RL8's v2 signature (apps/org-protocol), made first when an event carries
 * both (dual coding), so the mac covers it. During the migration the hub also carries v2-only events, whose `mac` is
 * absent although the type keeps it: DX1's readers (the daemon's import, desk-web's `isLogEvent`) refuse such an event
 * as malformed. `nonce` is a v2 `hub/<member>` event's own: 16 random bytes in canonical base64url, inside its
 * signature, by which a resend is known (a dual-coded one carries it too).
 */
export type LogEvent = JsonObject & {
  ts: string;
  writer: string;
  seq: number;
  kind: string;
  mac: Mac;
  sig?: Sig;
  nonce?: string;
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

/**
 * A device's `human` (RL8, O11 M5): the draft signed by one of its member's devices before the hub positions it, with
 * its own `nonce` (inside the signature), and DX1's `mac` too when it is dual-coded. It arrives as DX3's `human`
 * message does, `{t: 'human', event}`, and is answered by `human-ack` naming its `nonce`; DX3's `ProjectUp` keeps
 * typing the sealed web one, which desk-web sends.
 */
export type SignedHumanEvent = HumanDraft & { nonce: string; sig: Sig; mac?: Mac };

/** `{writer: max seq}` for one project: the version vector of the log handshake (DX2). */
export type Vector = Record<string, number>;

/** A `hub/` event as the browser sealed it: the stored event without the `writer`, `seq`, and `ts` the hub assigned. */
export function withoutPosition<T extends object>(event: T): Omit<T, 'writer' | 'seq' | 'ts'> {
  const out = { ...event } as Record<string, unknown>;
  delete out.writer;
  delete out.seq;
  delete out.ts;
  return out as Omit<T, 'writer' | 'seq' | 'ts'>;
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
