// The tab's copy of main's channel (P5 O8 M7a; the Decision Log's "M7a Task 1 … settles these points", 1 and 6): an
// open answer whole, then each `org.channel.changed` delta over it, so the tab holds exactly main's set. Task 2's fix
// wave: each change applies only past the open answer's `rev`. Fix round 2: a word's state is main's alone, drawn as
// main gives it; nothing about the words is remembered or inferred here.
import { describe, expect, it } from 'vitest';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelHost, ChannelMachine, ChannelWord } from '@shared/ipc/schema/org';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { applyChange, held, openedWith, tailOf, type ChannelHeld, type OpenHeld } from './state';

const P = 'proj';
const e = (offset: number, label: ChannelEvent['label'] = 'verified', extra: Record<string, unknown> = {}): ChannelEvent => ({ offset, writer: 'mini/s', seq: offset, event: { kind: 'say', text: `t${offset}`, ...extra }, label });
const open = (events: ChannelEvent[], over: Partial<Extract<ChannelAnswer, { ok: true }>> = {}): ChannelAnswer => ({ ok: true, rev: 10, events, sessions: [], pending: [], unverified: 0, asOf: null, live: true, ...over });
let rev = 10;
const delta = (over: Partial<Extract<ChannelChanged, { ok: true }>>): ChannelChanged => ({ project: P, ok: true, rev: (rev += 1), upserts: [], removed: [], sessions: [], pending: [], unverified: 0, asOf: null, live: true, ...over });
/** An open answer's copy, as the words' functions take it. */
const opened = (answer: ChannelAnswer): OpenHeld => {
  const h = openedWith(answer);
  if (h.phase !== 'open') throw new Error('not open');
  return h;
};
const offsets = (h: ChannelHeld) => (h.phase === 'open' ? h.events.map((x) => [x.offset, x.label]) : h.phase);

describe('the held copy', () => {
  it('takes the open answer whole, then upserts by offset, drops what is removed, and takes the rest whole', () => {
    let h = openedWith(open([e(1), e(2), e(3)]));
    h = applyChange(h, delta({ upserts: [e(2, 'legacy'), e(5)], removed: [1], unverified: 2, asOf: '2026-11-06T12:00:00.000Z', live: false }));
    expect(offsets(h)).toEqual([[2, 'legacy'], [3, 'verified'], [5, 'verified']]);
    expect(h).toMatchObject({ phase: 'open', unverified: 2, asOf: '2026-11-06T12:00:00.000Z', live: false });
  });

  it('a reset replaces every event with its upserts; a closed change closes; the next open change after it starts over', () => {
    let h = openedWith(open([e(1), e(2)]));
    h = applyChange(h, delta({ upserts: [e(2, 'migrated')], reset: true }));
    expect(offsets(h)).toEqual([[2, 'migrated']]);
    h = applyChange(h, { project: P, ok: false, reason: 'unknown-project', rev: (rev += 1) });
    expect(h).toEqual({ phase: 'closed', reason: 'unknown-project', rev });
    h = applyChange(h, delta({ upserts: [e(7)], reset: true }));
    expect(offsets(h)).toEqual([[7, 'verified']]);
  });

  it('applies no change numbered at or before what it holds: an early reset told before a newer open answer changes nothing', () => {
    const early = { ...delta({ upserts: [e(1)], reset: true, unverified: 5, live: false }), rev: 7 };
    const h = openedWith(open([e(1, 'migrated'), e(2)], { rev: 8, unverified: 1 }));
    expect(applyChange(h, early)).toBe(h);
    expect(applyChange(h, { project: P, ok: false, reason: 'no-hub', rev: 8 })).toBe(h);
    const next = applyChange(h, { ...delta({ upserts: [e(3)] }), rev: 9 });
    expect(offsets(next)).toEqual([[1, 'migrated'], [2, 'verified'], [3, 'verified']]);
    expect(next).toMatchObject({ rev: 9 });
  });

  it('a closed open answer reads closed; an unanswered open is opening', () => {
    expect(openedWith({ ok: false, reason: 'signed-out', rev: 3 })).toEqual({ phase: 'closed', reason: 'signed-out', rev: 3 });
    expect(held()).toEqual({ phase: 'opening' });
  });
});

describe('the words after the log', () => {
  const word = (nonce: string, state: ChannelWord['state'] = 'sending'): ChannelWord => ({ nonce, text: `w-${nonce}`, to: '*', state });

  it('are main’s pending, in its order, each in the state main gives it', () => {
    const h = opened(open([], { pending: [word('p1'), word('p2', { refused: 'not-reachable' }), word('p3', 'sent'), word('p4', 'not-sent')] }));
    expect(tailOf(h)).toEqual([
      { key: 'p1', text: 'w-p1', to: '*', state: 'sending' },
      { key: 'p2', text: 'w-p2', to: '*', state: { refused: 'not-reachable' } },
      { key: 'p3', text: 'w-p3', to: '*', state: 'sent' },
      { key: 'p4', text: 'w-p4', to: '*', state: 'not-sent' },
    ]);
    expect(tailOf(opened(open([], { pending: [] })))).toEqual([]);
  });
});

// UX wave U11a M4 (S-09; Interfaces §F): the channel's own reach and the hub's refusal of it, told with every answer and
// change while the channel isn't live, and absent otherwise.
describe('the channel’s reach and refusal', () => {
  it('holds them as the open answer gives them, and takes them whole from each change: one a change leaves out is gone', () => {
    let h = openedWith(open([], { live: false, reach: 'unreachable', refused: 'credentials' }));
    expect(h).toMatchObject({ live: false, reach: 'unreachable', refused: 'credentials' });
    h = applyChange(h, delta({ live: false, reach: 'connecting' }));
    expect(h).toMatchObject({ live: false, reach: 'connecting', refused: null });
    h = applyChange(h, delta({ live: true }));
    expect(h).toMatchObject({ live: true, reach: null, refused: null });
    expect(openedWith(open([]))).toMatchObject({ reach: null, refused: null });
  });
});

// M7b: every machine's to-human entries, held by key as the events are by offset, and the machines whole.
describe('the to-human entries', () => {
  const h = (id: string, order = 0): ChannelHost => ({ key: `${OTHER_MACHINE} ${id}`, machine: OTHER_MACHINE, id, lane: 'A', session: 'la-1', kind: 'message', text: id, at: '2026-11-06T12:00:00.000Z', src: id, order });
  const mini: ChannelMachine = { machine: OTHER_MACHINE, name: 'mini', state: 'live', asOf: null };
  const keys = (held: ChannelHeld) => (held.phase === 'open' ? held.hosts.map((x) => x.id) : held.phase);

  it('takes them whole from the open answer (none when it carries none), then by key: new ones in, gone ones out, a reset whole', () => {
    expect(opened(open([]))).toMatchObject({ hosts: [], machines: [] });
    let held = openedWith(open([], { hosts: [h('a'), h('b')], machines: [mini] }));
    held = applyChange(held, delta({ hosts: { upserts: [h('c')], removed: [`${OTHER_MACHINE} a`] }, machines: [{ ...mini, state: 'offline', asOf: '2026-11-06T13:00:00.000Z' }] }));
    expect(keys(held)).toEqual(['b', 'c']);
    expect(held).toMatchObject({ machines: [{ state: 'offline', asOf: '2026-11-06T13:00:00.000Z' }] });
    held = applyChange(held, delta({ upserts: [e(1)] })); // a change of the log's alone keeps them
    expect(keys(held)).toEqual(['b', 'c']);
    held = applyChange(held, delta({ hosts: { reset: true, upserts: [h('d')], removed: [] }, machines: [mini] }));
    expect(keys(held)).toEqual(['d']);
    held = applyChange(held, { project: P, ok: false, reason: 'no-hub', rev: (rev += 1) });
    held = applyChange(held, delta({ upserts: [], reset: true }));
    expect(keys(held)).toEqual([]);
  });

  it('keeps main’s order at one time across a change: an older page’s entry goes before those it already holds', () => {
    let held = openedWith(open([], { hosts: [h('q2', 10), h('q3', 11)], machines: [mini] }));
    held = applyChange(held, delta({ hosts: { upserts: [h('q1', -1), h('q4', 12)], removed: [] } }));
    expect(keys(held)).toEqual(['q1', 'q2', 'q3', 'q4']);
  });
});
