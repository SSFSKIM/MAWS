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
// M7b: every machine's to-human entries the same way, by key (`hosts`: upserts in, removed out, `hosts.reset` whole; a
// change without `hosts` keeps them), and the machines whole; the log's reset doesn't touch them, main tells their own.
//
// A word's state is main's alone (Task 2's fix round 2): main lists the signed-in member's words the log doesn't hold
// yet, `sending`, `sent`, `not-sent` or refused, and the tab draws them as given. Nothing is remembered or inferred here.
//
// UX wave U11a M4 (S-09; Interfaces §F): the channel's own `reach` and the hub's `refused`, whole from each answer and
// change as the rest is; null where main told none (live, or no refusal standing).
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelHost, ChannelMachine, ChannelSession, ChannelWord } from '@shared/ipc/schema/org';
import type { TailWord } from './project';

type Closed = Extract<ChannelAnswer, { ok: false }>['reason'];
type Open = Extract<ChannelAnswer, { ok: true }>;
export type OpenHeld = {
  phase: 'open';
  rev: number;
  events: ChannelEvent[]; // by offset
  sessions: ChannelSession[];
  pending: ChannelWord[];
  unverified: number;
  asOf: string | null;
  live: boolean;
  reach: NonNullable<Open['reach']> | null;
  refused: NonNullable<Open['refused']> | null;
  hosts: ChannelHost[]; // M7b: oldest first, as main orders them
  machines: ChannelMachine[];
};
export type ChannelHeld = { phase: 'opening' } | { phase: 'closed'; reason: Closed; rev: number } | OpenHeld;

export const held = (): ChannelHeld => ({ phase: 'opening' });

const byOffset = (a: ChannelEvent, b: ChannelEvent) => a.offset - b.offset;

export function openedWith(answer: ChannelAnswer): ChannelHeld {
  if (!answer.ok) return { phase: 'closed', reason: answer.reason, rev: answer.rev };
  const { rev, events, sessions, pending, unverified, asOf, live, reach, refused } = answer;
  return {
    phase: 'open',
    rev,
    events: [...events].sort(byOffset),
    sessions,
    pending,
    unverified,
    asOf,
    live,
    reach: reach ?? null,
    refused: refused ?? null,
    hosts: answer.hosts ?? [],
    machines: answer.machines ?? [],
  };
}

/** The to-human entries after a change: by key over what is held, in main's order (time, machine, the machine's `order`). */
function hostsAfter(current: ChannelHeld, change: Extract<ChannelChanged, { ok: true }>): ChannelHost[] {
  const held = current.phase === 'open' ? current.hosts : [];
  const delta = change.hosts;
  if (delta === undefined) return held;
  if (delta.reset === true || current.phase !== 'open') return [...delta.upserts];
  const removed = new Set(delta.removed);
  const byKey = new Map(held.filter((host) => !removed.has(host.key)).map((host) => [host.key, host]));
  for (const host of delta.upserts) byKey.set(host.key, host);
  const time = (host: ChannelHost) => Date.parse(host.at) || 0;
  return [...byKey.values()].sort((a, b) => time(a) - time(b) || (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0) || a.order - b.order); // main's order
}

export function applyChange(current: ChannelHeld, change: ChannelChanged): ChannelHeld {
  if (current.phase !== 'opening' && change.rev <= current.rev) return current;
  if (!change.ok) return { phase: 'closed', reason: change.reason, rev: change.rev };
  const { rev, upserts, removed, sessions, pending, unverified, asOf, live, reach, refused } = change;
  const base = change.reset === true || current.phase !== 'open' ? [] : current.events;
  const events = new Map(base.map((event) => [event.offset, event]));
  for (const offset of removed) events.delete(offset);
  for (const event of upserts) events.set(event.offset, event);
  const machines = change.machines ?? (current.phase === 'open' ? current.machines : []);
  return {
    phase: 'open',
    rev,
    events: [...events.values()].sort(byOffset),
    sessions,
    pending,
    unverified,
    asOf,
    live,
    reach: reach ?? null,
    refused: refused ?? null,
    hosts: hostsAfter(current, change),
    machines,
  };
}

/** The words after the log: main's pending, in its order. */
export const tailOf = (h: OpenHeld): TailWord[] => h.pending.map((w) => ({ key: w.nonce, text: w.text, to: w.to, state: w.state }));
