// The tab's copy of main's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, the Decision
// Log's "M7a Task 1 … settles these points", 1 and 6). Pure.
//
// `org.channel.open` answers main's verified events whole; each `org.channel.changed` after it is a delta: `upserts`
// replace what the tab holds at their offsets, `removed` are offsets main no longer draws, and the sessions, the pending
// words, `unverified`, `asOf` and `live` come whole. `reset` replaces every event with its upserts, and a closed change
// closes the copy (the next open change after one is a reset). So the tab holds exactly main's bounded set.
//
// The words this renderer sent are followed here too, since main keeps them in memory only. A word is `seen` once main's
// pending lists it, and acknowledged when it leaves pending while the tab holds the channel (only an ack, or the word
// reaching the log, takes it out then); the log holding its nonce ends it. A word main no longer holds at a later open,
// that nobody acknowledged and the log doesn't hold, was dropped with the channel (released 30 s after its last tab):
// it reads "Not sent" for that tab's life, and is forgotten.
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelRecipients, ChannelSession, ChannelWord } from '@shared/ipc/schema/org';
import type { TailWord } from './project';

type Closed = Extract<ChannelAnswer, { ok: false }>['reason'];
export type OpenHeld = {
  phase: 'open';
  events: ChannelEvent[]; // by offset
  sessions: ChannelSession[];
  pending: ChannelWord[];
  unverified: number;
  asOf: string | null;
  live: boolean;
};
export type ChannelHeld = { phase: 'opening' } | { phase: 'closed'; reason: Closed } | OpenHeld;

export const held = (): ChannelHeld => ({ phase: 'opening' });

const byOffset = (a: ChannelEvent, b: ChannelEvent) => a.offset - b.offset;

export function openedWith(answer: ChannelAnswer): ChannelHeld {
  if (!answer.ok) return { phase: 'closed', reason: answer.reason };
  const { events, sessions, pending, unverified, asOf, live } = answer;
  return { phase: 'open', events: [...events].sort(byOffset), sessions, pending, unverified, asOf, live };
}

export function applyChange(current: ChannelHeld, change: ChannelChanged): ChannelHeld {
  if (!change.ok) return { phase: 'closed', reason: change.reason };
  const { upserts, removed, sessions, pending, unverified, asOf, live } = change;
  const base = change.reset === true || current.phase !== 'open' ? [] : current.events;
  const events = new Map(base.map((event) => [event.offset, event]));
  for (const offset of removed) events.delete(offset);
  for (const event of upserts) events.set(event.offset, event);
  return { phase: 'open', events: [...events.values()].sort(byOffset), sessions, pending, unverified, asOf, live };
}

export type SentWord = { nonce: string; text: string; to: ChannelRecipients | null; seen: boolean; acked: boolean };

const loggedNonces = (h: OpenHeld): Set<string> =>
  new Set(h.events.flatMap(({ event }) => (event.kind === 'human' && typeof event.nonce === 'string' ? [event.nonce] : [])));

/** While the tab holds the channel: each word's place in main's pending, and the log's. */
export function trackSent(sent: readonly SentWord[], h: OpenHeld): SentWord[] {
  const logged = loggedNonces(h);
  const pending = new Map(h.pending.map((w) => [w.nonce, w]));
  return sent.flatMap((word) => {
    if (logged.has(word.nonce)) return [];
    const there = pending.get(word.nonce);
    if (there !== undefined) return [{ ...word, seen: true, to: there.to }];
    return [word.seen && !word.acked ? { ...word, acked: true } : word];
  });
}

/** At an open: the words main dropped (not pending, not logged, never acknowledged), and the rest. */
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

/** The words after the log: main's pending in its order, then this renderer's that main no longer holds. */
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
