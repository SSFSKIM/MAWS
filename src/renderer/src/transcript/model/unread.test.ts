// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M3; decisions 12 and 32; Acceptance 7): a
// prompt's row is `unread` exactly while the message waited behind a turn and has neither started nor been dropped, over
// the probes' recorded sessions mapped by the engine host's own normaliser (spikes/protocol-probe/fixtures/uxwave/).
// `pending` and its captions are left as they were (decision 16): the mark covers the gap they do not, after the turn
// that held the message back has ended and before the message starts.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';
import { builder, uuid } from './test-events';

type UserRow = Extract<Row, { kind: 'user' }>;

const journal = (name: string) => loadUxwaveJournal(name);
const through = (rows: JournalRow[], seq: number) => rows.filter((row) => row.seq <= seq);
const reduce = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const users = (rows: Row[]) => rows.filter((row): row is UserRow => row.kind === 'user');
const usersAt = (name: string, seq: number) => users(rowsOf(withAllExpanded(reduce(journalToEvents(through(journal(name), seq))))));
const uuidAt = (name: string, seq: number) => (journal(name).find((row) => row.seq === seq)!.frame as { uuid: MessageUuid }).uuid;
const rowOf = (rows: UserRow[], uuid: MessageUuid) => rows.find((row) => row.messageUuid === uuid);
const marks = (row: UserRow | undefined) => ({ unread: row?.unread, pending: row?.pending });

describe('a waiting message’s row is unread until it starts or is dropped (decision 12)', () => {
  const A = 'u4p1-a-seeded-1';

  it('u4p1-a-seeded-1: written while the turn runs, unread and pending; after the cut turn closes (46) and before it starts (48), unread and no pending; from 48, neither', () => {
    const waiting = uuidAt(A, 36);
    expect(marks(rowOf(usersAt(A, 40), waiting))).toEqual({ unread: true, pending: 'next' });
    for (const seq of [46, 47]) expect(marks(rowOf(usersAt(A, seq), waiting))).toEqual({ unread: true, pending: undefined });
    for (const seq of [48, 60]) {
      const row = rowOf(usersAt(A, seq), waiting);
      expect(row).toBeDefined();
      expect(marks(row)).toEqual({ unread: undefined, pending: undefined });
    }
  });

  it('a prompt written with no turn running is never unread: the session’s first prompt, before and after it starts', () => {
    const first = uuidAt(A, 12);
    for (const seq of [12, 15, 16, 60]) expect(rowOf(usersAt(A, seq), first)?.unread).toBeUndefined();
  });

  it('a prompt written while an earlier one has not started is unread until its own start; the earlier one never is', () => {
    const b = builder();
    const prompt = (u: string, text: string) => b.emit('user.message', { messageUuid: uuid(u), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    prompt('p1', 'First thing');
    prompt('p2', 'Second thing');
    const at = () => users(rowsOf(reduce(b.events)));
    expect(at().map((row) => [row.messageUuid, row.unread])).toEqual([['p1', undefined], ['p2', true]]);
    b.emit('command.lifecycle', { commandUuid: uuid('p1'), state: 'started' });
    b.emit('turn.started', { userMessageUuid: uuid('p1'), origin: 'human' });
    expect(at().map((row) => [row.messageUuid, row.unread])).toEqual([['p1', undefined], ['p2', true]]);
    b.emit('command.lifecycle', { commandUuid: uuid('p2'), state: 'started' }); // taken into the running turn: a steer
    expect(at().map((row) => [row.messageUuid, row.unread, row.steer])).toEqual([['p1', undefined, false], ['p2', undefined, true]]);
  });

  it('a waiting message the engine dropped is not unread: it reads Not sent where it stood', () => {
    const b = builder();
    b.turn('u1', 'Count slowly');
    b.emit('user.message', { messageUuid: uuid('s1'), content: 'Look at b too', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    expect(rowOf(users(rowsOf(reduce(b.events))), uuid('s1'))?.unread).toBe(true);
    b.emit('command.lifecycle', { commandUuid: uuid('s1'), state: 'cancelled' });
    expect(marks(rowOf(users(rowsOf(reduce(b.events))), uuid('s1')))).toEqual({ unread: undefined, pending: undefined });
    expect(rowOf(users(rowsOf(reduce(b.events))), uuid('s1'))?.dropped).toBe(true);
  });
});

describe('messages the engine joins (decision 32): each is unread until its own start, then one bubble', () => {
  const TWO = 'u4p2-two-1-1';

  it('u4p2-two-1-1: after the cut turn ends (51) both rows are unread; at 54 only the second; after 55 neither; at 60 one bubble with both texts and no unread', () => {
    const [first, second] = [uuidAt(TWO, 37), uuidAt(TWO, 40)];
    const at51 = usersAt(TWO, 51);
    expect([rowOf(at51, first)?.unread, rowOf(at51, second)?.unread]).toEqual([true, true]);
    const at54 = usersAt(TWO, 54);
    expect([rowOf(at54, first)?.unread, rowOf(at54, second)?.unread]).toEqual([undefined, true]);
    const at55 = usersAt(TWO, 55);
    expect([rowOf(at55, first), rowOf(at55, second)].map((row) => [row !== undefined, row?.unread])).toEqual([[true, undefined], [true, undefined]]);
    const at60 = usersAt(TWO, 60).filter((row) => row.messageUuid === first || row.messageUuid === second);
    expect(at60).toHaveLength(1);
    expect(at60[0]).toMatchObject({ messageUuid: second, text: expect.stringContaining('PINEAPPLE') });
    expect(at60[0]!.text).toContain('MANGO');
    expect(at60[0]!.unread).toBeUndefined();
  });
});
