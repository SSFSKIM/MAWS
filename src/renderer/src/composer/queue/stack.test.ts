// UX wave U4a M3 (Interfaces G): the stack's rows, read from the host's queue and the transcript's `unread` mark, so a
// waiting message is a row here exactly while the transcript does not draw it.
import { describe, expect, it } from 'vitest';
import type { PendingSteer, QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { askSteerText } from '@shared/maws/ask';
import type { SessionQueue } from '../../stores/queue';
import { consentMessage } from '@shared/engine/arrival'; // UX wave U1c
import { firstToSend, newestToTake, rowText, stackRows, type Read, type StackRow } from './stack';

const APP = 'app-1' as AppSessionId;
const U1 = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const U2 = '22222222-2222-4222-8222-222222222222' as MessageUuid;
const U3 = '33333333-3333-4333-8333-333333333333' as MessageUuid;
const at = (minute: number) => `2026-11-13T10:${String(minute).padStart(2, '0')}:00.000Z`;
const steer = (messageUuid: MessageUuid, minute: number, content = `steer ${minute}`): PendingSteer => ({ messageUuid, content, createdAt: at(minute) });
const entry = (queueId: string, minute: number, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId, appSessionId: APP, content: `entry ${queueId}`, createdAt: at(minute), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const queue = (over: Partial<SessionQueue> = {}): SessionQueue => ({ entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over });
const read = (unread: Read['unread'] = [], started: readonly MessageUuid[] = []): Read => ({ unread, started: (uuid) => started.includes(uuid) });
const NONE = new Set<string>();
const kinds = (rows: StackRow[]) => rows.map((row) => row.kind);
// an async ask's answer, as `parseAskSteer` reads it
const ANSWER = askSteerText('ask-1', [], []);

describe('the stack’s rows', () => {
  it('lists the steers at the next step, then the queue’s entries, in the order they will be read', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 1), steer(U2, 2)], entries: [entry('q-1', 3), entry('q-0', 0, { state: 'released' })] }), NONE, read());
    expect(rows.map((row) => [row.kind, row.key])).toEqual([['next', U1], ['next', U2], ['after', 'q-1']]);
  });

  it('marks every queued entry held in a paused queue, keeps the uncertain head’s row, and shows a submission only once it has lasted', () => {
    const q = queue({ paused: true, pauseReason: 'interrupt', entries: [entry('q-u', 0, { uncertain: true }), entry('q-1', 1), entry('q-s', 2, { state: 'submitting', submittedAt: at(2) })] });
    expect(kinds(stackRows(q, NONE, read()))).toEqual(['uncertain', 'held']);
    expect(kinds(stackRows(q, new Set(['q-s']), read()))).toEqual(['uncertain', 'held', 'sending']);
  });

  it('draws an unread message the queue does not list as a handed row, first, and a steer the transcript shows started as no row', () => {
    const q = queue({ steers: [steer(U1, 1), steer(U2, 2)] });
    const rows = stackRows(q, NONE, read([{ messageUuid: U3, text: 'sent now', at: at(3) }, { messageUuid: U2, text: 'steer 2', at: at(2) }], [U1]));
    expect(rows.map((row) => [row.kind, row.key])).toEqual([['handed', U3], ['next', U2]]);
    expect(rows[0]).toMatchObject({ kind: 'handed', text: 'sent now' });
  });

  it('draws a message once whether only its transcript row or only the queue’s snapshot has arrived', () => {
    // Enter while a turn runs: the row arrives before the snapshot lists the steer, then both, then the engine starts it
    expect(kinds(stackRows(queue(), NONE, read([{ messageUuid: U1, text: 'typed', at: at(1) }])))).toEqual(['handed']);
    expect(kinds(stackRows(queue({ steers: [steer(U1, 1)] }), NONE, read([{ messageUuid: U1, text: 'typed', at: at(1) }])))).toEqual(['next']);
    expect(kinds(stackRows(queue({ steers: [steer(U1, 1)] }), NONE, read([], [U1])))).toEqual([]);
  });

  it('draws a submission the queue still lists once, not also as a handed row', () => {
    const q = queue({ entries: [entry('q-1', 1, { state: 'submitting', messageUuid: U1, submittedAt: at(1) })] });
    expect(kinds(stackRows(q, new Set(['q-1']), read([{ messageUuid: U1, text: 'entry q-1', at: at(1) }])))).toEqual(['sending']);
  });

  it('knows an answer’s envelope', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 1, ANSWER)], entries: [entry('q-1', 2)] }), NONE, read());
    expect(rows.map((row) => 'answer' in row && row.answer)).toEqual([true, false]);
  });
});

describe('the rows the keys act on', () => {
  it('Esc sends the first row that can be sent; nothing on a sending, handed or uncertain row', () => {
    const rows = stackRows(queue({ paused: true, entries: [entry('q-u', 0, { uncertain: true }), entry('q-1', 1)] }), NONE, read([{ messageUuid: U3, text: 'sent now', at: at(3) }]));
    expect(firstToSend(rows)?.key).toBe('q-1');
    expect(firstToSend(stackRows(queue({ entries: [entry('q-s', 1, { state: 'submitting', submittedAt: at(1) })] }), new Set(['q-s']), read()))).toBeNull();
  });

  it('↑ takes the newest waiting message of either kind, and never an answer', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 5), steer(U2, 9, ANSWER)], entries: [entry('q-1', 7), entry('q-2', 3)] }), NONE, read());
    expect(newestToTake(rows)?.key).toBe('q-1');
    expect(newestToTake(stackRows(queue({ steers: [steer(U2, 9, ANSWER)] }), NONE, read()))).toBeNull();
    expect(newestToTake([])).toBeNull();
  });
});

// UX wave U1c (the U1c document, Interfaces §G; card 2): a waiting "Approve and retry" reads as the line it becomes.
describe('a grant’s row', () => {
  const GRANT = consentMessage('command', 'make build');
  it('a row whose whole text is one grant carries it and reads “You approved <the command>”, whichever wait it is in', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 1, GRANT)], entries: [entry('q-1', 2, { content: GRANT }), entry('q-u', 0, { content: GRANT, uncertain: true })] }), NONE, read());
    expect(rows.map((row) => [row.kind, 'grant' in row ? row.grant : undefined, rowText(row)])).toEqual([
      ['next', { kind: 'command', subject: 'make build' }, 'You approved make build'],
      ['after', { kind: 'command', subject: 'make build' }, 'You approved make build'],
      ['uncertain', { kind: 'command', subject: 'make build' }, 'You approved make build'],
    ]);
  });

  it('a row with only text (handed, sending) whose whole text is one grant reads so too', () => {
    const rows = stackRows(queue({ entries: [entry('q-s', 1, { content: GRANT, state: 'submitting', submittedAt: at(1) })] }), new Set(['q-s']), read([{ messageUuid: U3, text: GRANT, at: at(3) }]));
    expect(rows.map((row) => [row.kind, rowText(row)])).toEqual([['handed', 'You approved make build'], ['sending', 'You approved make build']]);
  });

  it('a message that holds a grant line among other words is the person’s own message: no grant, its own words', () => {
    const words = `Go ahead with this one.\n${GRANT}`;
    const [row] = stackRows(queue({ entries: [entry('q-1', 1, { content: words })] }), NONE, read());
    expect(row).toMatchObject({ kind: 'after', grant: null });
    expect(rowText(row!)).toBe(words);
  });

  it('an answer’s row is unchanged: no grant, its envelope’s words', () => {
    const [row] = stackRows(queue({ steers: [steer(U1, 1, ANSWER)] }), NONE, read());
    expect(row).toMatchObject({ kind: 'next', answer: true, grant: null });
  });

  it('↑ never takes a grant (an edited grant is no grant); Esc still sends it', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 5)], entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read());
    expect(newestToTake(rows)?.key).toBe(U1);
    expect(newestToTake(stackRows(queue({ entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read()))).toBeNull();
    expect(firstToSend(stackRows(queue({ entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read()))?.key).toBe('q-g');
  });
});
