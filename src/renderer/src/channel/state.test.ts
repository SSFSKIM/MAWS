// The tab's copy of main's channel (P5 O8 M7a; the Decision Log's "M7a Task 1 … settles these points", 1 and 6): an
// open answer whole, then each `org.channel.changed` delta over it, so the tab holds exactly main's set; and the words
// this renderer sent, followed until the log holds them, so one main let go reads "Not sent". Task 2's fix wave: each
// change applies only past the open answer's `rev`; an ack is main's word (`sent`), never inferred here.
import { describe, expect, it } from 'vitest';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelWord } from '@shared/ipc/schema/org';
import { applyChange, held, openedWith, splitLost, tailOf, trackSent, type ChannelHeld, type OpenHeld, type SentWord } from './state';

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

describe('the words this renderer sent', () => {
  const word = (nonce: string, state: ChannelWord['state'] = 'sending'): ChannelWord => ({ nonce, text: `w-${nonce}`, to: '*', state });
  const logged = (nonce: string, offset: number) => e(offset, 'verified', { kind: 'human', nonce, member: 'me' });
  const sent = (nonce: string, over: Partial<SentWord> = {}): SentWord => ({ nonce, text: `w-${nonce}`, to: null, acked: false, ...over });

  it('reads the ack from main’s pending (`sent`), keeps a word that leaves pending unlogged as it was, and forgets one logged', () => {
    let book = [sent('n1'), sent('n2')];
    book = trackSent(book, opened(open([], { pending: [word('n1', 'sent'), word('n2')] }))); // acked before any publication listed it sending
    expect(book).toEqual([sent('n1', { acked: true, to: '*' }), sent('n2', { to: '*' })]);
    book = trackSent(book, opened(open([], { pending: [] })));
    expect(book.map((w) => [w.nonce, w.acked])).toEqual([['n1', true], ['n2', false]]); // nothing inferred from leaving pending
    book = trackSent(book, opened(open([logged('n1', 4)])));
    expect(book.map((w) => w.nonce)).toEqual(['n2']);
  });

  it('at a new open, a word main lists no more, the log doesn’t hold and that never read sent is lost', () => {
    const book = [sent('gone'), sent('acked', { acked: true }), sent('kept'), sent('logged')];
    const { kept, lost } = splitLost(book, opened(open([logged('logged', 3)], { pending: [word('kept')] })));
    expect(lost.map((w) => w.nonce)).toEqual(['gone']);
    expect(kept.map((w) => w.nonce)).toEqual(['acked', 'kept']);
  });

  it('the tail: main’s pending in its order, then this page’s words main lists no more, and the lost the log doesn’t hold yet', () => {
    const h = opened(open([logged('late', 9)], { pending: [word('p1'), word('p2', { refused: 'not-reachable' }), word('p3', 'sent')] }));
    const tail = tailOf(h, [sent('p1'), sent('a1', { acked: true }), sent('fresh')], [sent('l1'), sent('late')]);
    expect(tail).toEqual([
      { key: 'p1', text: 'w-p1', to: '*', state: 'sending' },
      { key: 'p2', text: 'w-p2', to: '*', state: { refused: 'not-reachable' } },
      { key: 'p3', text: 'w-p3', to: '*', state: 'sent' },
      { key: 'a1', text: 'w-a1', to: null, state: 'sent' },
      { key: 'fresh', text: 'w-fresh', to: null, state: 'sending' }, // its send answered before main's first publication of it
      { key: 'l1', text: 'w-l1', to: null, state: 'not-sent' },
    ]);
  });
});
