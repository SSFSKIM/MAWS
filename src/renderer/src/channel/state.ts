// The tab's copy of main's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, the Decision
// Log's "M7a Task 1 … settles these points", 1 and 6). Pure.
//
// `org.channel.open` answers main's verified events whole; each `org.channel.changed` after it is a delta: `upserts`
// replace what the tab holds at their offsets, `removed` are offsets main no longer draws, and the sessions, the pending
// words, `unverified`, `asOf` and `live` come whole. `reset` replaces every event with its upserts, and a closed change
// closes the copy (the next open change after one is a reset). So the tab holds exactly main's bounded set. Every answer
// and change carries main's `rev`, and a change numbered at or before what the copy holds is dropped: it was told before
// the answer (a tab hears changes from its mount on, the answer after), so it describes an older state.
//
// The words this renderer sent are followed here too, since main keeps them in memory only. Main lists each in its
// pending, `sending`, then `sent` once the hub acknowledged it, until the log holds it; a word that pending ever showed
// `sent` is acknowledged here. The log holding its nonce ends it. A word main no longer lists at a later open, that
// never read `sent` and the log doesn't hold, was dropped with the channel (released 30 s after its last tab): it reads
// "Not sent" for that tab's life, and is forgotten. Nothing is inferred from a word leaving pending.
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelRecipients, ChannelSession, ChannelWord } from '@shared/ipc/schema/org';
import type { TailWord } from './project';

type Closed = Extract<ChannelAnswer, { ok: false }>['reason'];
export type OpenHeld = {
  phase: 'open';
  rev: number;
  events: ChannelEvent[]; // by offset
  sessions: ChannelSession[];
  pending: ChannelWord[];
  unverified: number;
  asOf: string | null;
  live: boolean;
};
export type ChannelHeld = { phase: 'opening' } | { phase: 'closed'; reason: Closed; rev: number } | OpenHeld;

export const held = (): ChannelHeld => ({ phase: 'opening' });

const byOffset = (a: ChannelEvent, b: ChannelEvent) => a.offset - b.offset;

export function openedWith(answer: ChannelAnswer): ChannelHeld {
  if (!answer.ok) return { phase: 'closed', reason: answer.reason, rev: answer.rev };
  const { rev, events, sessions, pending, unverified, asOf, live } = answer;
  return { phase: 'open', rev, events: [...events].sort(byOffset), sessions, pending, unverified, asOf, live };
}

export function applyChange(current: ChannelHeld, change: ChannelChanged): ChannelHeld {
  if (current.phase !== 'opening' && change.rev <= current.rev) return current;
  if (!change.ok) return { phase: 'closed', reason: change.reason, rev: change.rev };
  const { rev, upserts, removed, sessions, pending, unverified, asOf, live } = change;
  const base = change.reset === true || current.phase !== 'open' ? [] : current.events;
  const events = new Map(base.map((event) => [event.offset, event]));
  for (const offset of removed) events.delete(offset);
  for (const event of upserts) events.set(event.offset, event);
  return { phase: 'open', rev, events: [...events.values()].sort(byOffset), sessions, pending, unverified, asOf, live };
}

export type SentWord = { nonce: string; text: string; to: ChannelRecipients | null; acked: boolean };

const loggedNonces = (h: OpenHeld): Set<string> =>
  new Set(h.events.flatMap(({ event }) => (event.kind === 'human' && typeof event.nonce === 'string' ? [event.nonce] : [])));

/** At each copy: a word main lists `sent` is acknowledged; one the log holds is forgotten. */
export function trackSent(sent: readonly SentWord[], h: OpenHeld): SentWord[] {
  const logged = loggedNonces(h);
  const pending = new Map(h.pending.map((w) => [w.nonce, w]));
  return sent.flatMap((word) => {
    if (logged.has(word.nonce)) return [];
    const there = pending.get(word.nonce);
    return there === undefined ? [word] : [{ ...word, to: there.to, acked: word.acked || there.state === 'sent' }];
  });
}

/** At an open: the words main dropped (not listed, not logged, never read `sent`), and the rest. */
export function splitLost(sent: readonly SentWord[], h: OpenHeld): { kept: SentWord[]; lost: SentWord[] } {
  const logged = loggedNonces(h);
  const pending = new Set(h.pending.map((w) => w.nonce));
  const kept: SentWord[] = [];
  const lost: SentWord[] = [];
  for (const word of sent) {
    if (logged.has(word.nonce)) continue;
    (pending.has(word.nonce) || word.acked ? kept : lost).push(word);
  }
  return { kept, lost };
}

/**
 * The words after the log: main's pending in its order, then this page's that main lists no more (acknowledged, or sent
 * just now and not yet published), then the lost.
 */
export function tailOf(h: OpenHeld, sent: readonly SentWord[], lost: readonly SentWord[]): TailWord[] {
  const logged = loggedNonces(h);
  const pending = new Set(h.pending.map((w) => w.nonce));
  const tail: TailWord[] = h.pending.map((w) => ({ key: w.nonce, text: w.text, to: w.to, state: w.state }));
  for (const word of sent) {
    if (pending.has(word.nonce) || logged.has(word.nonce)) continue;
    tail.push({ key: word.nonce, text: word.text, to: word.to, state: word.acked ? 'sent' : 'sending' });
  }
  for (const word of lost) if (!logged.has(word.nonce)) tail.push({ key: word.nonce, text: word.text, to: word.to, state: 'not-sent' });
  return tail;
}
