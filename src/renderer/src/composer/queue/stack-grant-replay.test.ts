// UX wave U1c (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md, Decision Log 53): a stack row reads
// as a grant exactly where the transcript records one. A message the engine holds and the queue does not list (a handed
// row) takes the classification the transcript's reader made on the original message, as its row's consent marks hold
// it, never a reading of the row's presentation text. Probe B's recording `u1c-b-1` (a grant written at the next step
// while the blocked call's turn runs: written at 137, queued at 143, started at 206), the grant swapped for the message
// under test in every frame that carries it, through the engine host's normaliser, the transcript's reducer and
// derivation, the store and the stack's model, as the window reads them.
import { afterEach, describe, expect, it } from 'vitest';
import { consentMessage } from '@shared/engine/arrival';
import { carriedOf } from '@shared/engine/arrival-schema';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { askSteerText } from '@shared/maws/ask';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import type { SessionQueue } from '../../stores/queue';
import { useTranscriptStore } from '../../stores/transcript';
import { journalToEvents } from '../../transcript/dev/journal';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { answerWords, rowText, stackRows, type StackRow } from './stack';
import { readOf } from './stack-acts';

type UserRow = Extract<Row, { kind: 'user' }>;

const APP = 'app-u1c' as AppSessionId;
const RECORDING = 'u1c-b-1';
const WRITTEN = 137; // MAWS writes the grant at the next step; the engine starts it at 206
const WAITING = 150; // queued, not started: the transcript holds its row unread
const MARKER = 'curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"';
const GRANT = consentMessage('command', MARKER);
// an invented async ask's answer envelope, as MAWS writes it
const LAYOUT = { id: 'q1', question: 'Which layout should the gallery use?', header: 'Layout', modality: 'choice' as const, options: [{ label: 'Grid' }, { label: 'List' }] };
const ENVELOPE = askSteerText('toolu_a', [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
// A, a line break, G, a line break, A: three parts, as the split draws a person's message (board ticket 704), the
// person's part G and each envelope an answer of its own; rule R reads the grant on the whole joined text, so the
// transcript records the approval and the handed row, which carries the transcript's classification, reads it. A waiting
// row reads a grant only where the sentence is the whole message (Decision Log 44), so the queued rows read none (the
// architect's ruling 1 of 2026-11-16; the stack's rows are left to the wave's ruling 5)
const SPANNING = `${ENVELOPE}\n${GRANT}\n${ENVELOPE}`;

const uuid = (loadUxwaveJournal(RECORDING).find((row) => row.seq === WRITTEN)!.frame as { uuid: MessageUuid }).uuid;

/** The recording through `seq`, the grant swapped for `message` in every frame whose content is the grant. */
function eventsOf(message: string, seq = Number.POSITIVE_INFINITY): SessionEvent[] {
  return journalToEvents(loadUxwaveJournal(RECORDING).filter((row) => row.seq <= seq).map((row) => {
    const frame = row.frame as { message?: { content?: unknown } };
    return frame.message?.content === GRANT ? ({ ...row, frame: { ...(row.frame as object), message: { ...frame.message, content: message } } } as JournalRow) : row;
  }));
}

/** What the transcript makes of the message: the consents its events carry, its rows (the message's own and any beside it). */
function transcriptOf(message: string, seq?: number) {
  const events = eventsOf(message, seq);
  const state = applyEvents(createState(null, null), events);
  const rows = rowsOf(state);
  useTranscriptStore.setState({ entries: { [APP]: { state, rows } as never } });
  const consents = events.flatMap((event) => (event.kind === 'user.message' && event.messageUuid === uuid ? carriedOf(event.arrival).filter((entry) => entry.class === 'consent') : []));
  const own = rows.filter((row): row is UserRow => row.kind === 'user' && (row.messageUuid === uuid || row.beside === uuid));
  return { consents, own, approvals: own.filter((row) => row.consent !== undefined) };
}

const queue = (over: Partial<SessionQueue> = {}): SessionQueue => ({ entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over });
const entry = (content: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId: 'q-1', appSessionId: APP, content, createdAt: '2026-11-15T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const grantOf = (row: StackRow) => ('grant' in row ? row.grant : undefined);

afterEach(() => useTranscriptStore.setState({ entries: {} }));

describe('a handed row reads as a grant exactly where the transcript records one (Decision Log 53)', () => {
  it('the grant alone, held by the engine and not listed by the queue: the transcript’s approval row, and the handed row reads “You approved …”', () => {
    const { consents, own, approvals } = transcriptOf(GRANT, WAITING);
    expect(consents).toEqual([{ class: 'consent', kind: 'command', subject: MARKER }]);
    expect(own.map((row) => [row.unread, row.consent])).toEqual([[true, { kind: 'command', subject: MARKER }]]);
    expect(approvals).toHaveLength(1);
    const rows = stackRows(queue(), new Set(), readOf(APP));
    expect(rows.map((row) => [row.kind, row.key, grantOf(row), rowText(row)])).toEqual([['handed', uuid, { kind: 'command', subject: MARKER }, `You approved ${MARKER}`]]);
  });

  it('A + G + A, handed: three parts, the transcript records the approval, and the handed row reads “You approved …” as the grant alone does', () => {
    const { consents, own, approvals } = transcriptOf(SPANNING, WAITING);
    expect(consents, 'the reader: the grant, on the person’s part').toEqual([{ class: 'consent', kind: 'command', subject: MARKER }]);
    expect(own.map((row) => [row.unread, row.text, row.consent]), 'the person’s part is the grant, unread; the envelopes draw no bubble').toEqual([[true, GRANT, { kind: 'command', subject: MARKER }]]);
    expect(approvals).toHaveLength(1);
    const rows = stackRows(queue(), new Set(), readOf(APP));
    expect(rows.map((row) => [row.kind, row.key, grantOf(row), rowText(row)])).toEqual([['handed', uuid, { kind: 'command', subject: MARKER }, `You approved ${MARKER}`]]);
  });

  it('A + G + A, queued at the next step: the queue’s steer is the row, no answer and no grant (the sentence is not the whole message), while the transcript records the approval', () => {
    const { approvals } = transcriptOf(SPANNING, WAITING);
    expect(approvals).toHaveLength(1);
    const rows = stackRows(queue({ steers: [{ messageUuid: uuid, content: SPANNING, createdAt: '2026-11-15T10:00:00.000Z' }] }), new Set(), readOf(APP));
    expect(rows.map((row) => [row.kind, 'answer' in row ? row.answer : undefined, grantOf(row)])).toEqual([['next', null, null]]);
    expect(rowText(rows[0]!)).not.toMatch(/^You approved /);
  });

  it('A + G + A, waiting after the turn and on its way: no grant on either row, and once delivered the transcript records the approval', () => {
    const rows = stackRows(queue({ entries: [entry(SPANNING), entry(SPANNING, { queueId: 'q-s', state: 'submitting', submittedAt: '2026-11-15T10:00:01.000Z' })] }), new Set(['q-s']), readOf(APP));
    expect(rows.map((row) => [row.kind, grantOf(row)])).toEqual([['after', null], ['sending', null]]);
    for (const row of rows) expect(rowText(row)).not.toMatch(/^You approved /);
    const { consents, approvals } = transcriptOf(SPANNING);
    expect(consents).toEqual([{ class: 'consent', kind: 'command', subject: MARKER }]);
    expect(approvals).toHaveLength(1);
  });

  it('two grant lines in one message, handed: the transcript draws an approval row for each, and the handed row is no single grant', () => {
    const second = consentMessage('command', 'make test');
    const { approvals } = transcriptOf(`${GRANT}\n${second}`, WAITING);
    expect(approvals.map((row) => row.consent!.subject)).toEqual([MARKER, 'make test']);
    const rows = stackRows(queue(), new Set(), readOf(APP));
    expect(rows.map((row) => [row.kind, grantOf(row)])).toEqual([['handed', null]]);
    expect(rowText(rows[0]!)).not.toMatch(/^You approved /);
  });

  it('a submission on its way whose text only reads as the grant once drawn (a leading space): no grant, as the transcript records none', () => {
    const spaced = ` ${GRANT}`;
    const rows = stackRows(queue({ entries: [entry(spaced, { queueId: 'q-s', state: 'submitting', submittedAt: '2026-11-15T10:00:01.000Z' })] }), new Set(['q-s']), readOf(APP));
    expect(rows.map((row) => [row.kind, grantOf(row), rowText(row)])).toEqual([['sending', null, GRANT]]);
    const { consents, approvals } = transcriptOf(spaced);
    expect([consents, approvals]).toEqual([[], []]);
  });

  // The cascade merge of U4b into U1c: the person typed the exact grant sentence as a text answer, and this build writes
  // the envelope's new form (board ticket 711). The sentence stands on a line of MAWS's envelope, as a JSON string, and
  // in its block: an answer, never the person's own line (Decision Log 52), so no row of the stack reads it as a grant
  it('an envelope whose typed text answer is the exact sentence, handed and queued at the next step: an answer, no grant, as the transcript records none', () => {
    const NOTE = { id: 'q1', question: 'What should the agent be told?', modality: 'text' as const };
    const TYPED = askSteerText('toolu_a', [NOTE], [{ id: 'q1', question: NOTE.question, status: 'answered', value: GRANT }]);
    const { consents, approvals } = transcriptOf(TYPED, WAITING);
    expect([consents, approvals]).toEqual([[], []]);
    const handed = stackRows(queue(), new Set(), readOf(APP));
    expect(handed.map((row) => [row.kind, grantOf(row)])).toEqual([['handed', null]]);
    const next = stackRows(queue({ steers: [{ messageUuid: uuid, content: TYPED, createdAt: '2026-11-15T10:00:00.000Z' }] }), new Set(), readOf(APP));
    expect(next.map((row) => [row.kind, grantOf(row), rowText(row)])).toEqual([['next', null, answerWords(TYPED, readOf(APP).questions)]]);
    for (const row of [...handed, ...next]) expect(rowText(row)).not.toMatch(/^You approved /);
  });
});
