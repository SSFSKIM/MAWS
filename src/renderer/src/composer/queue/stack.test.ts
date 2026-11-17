// UX wave U4a M3 (Interfaces G): the stack's rows, read from the host's queue and the transcript's `unread` mark, so a
// waiting message is a row here exactly while the transcript does not draw it.
import { describe, expect, it } from 'vitest';
import type { PendingSteer, QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { askSteerText } from '@shared/maws/ask';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import type { SessionQueue } from '../../stores/queue';
import { consentMessage } from '@shared/engine/arrival'; // UX wave U1c
import { entryDisplay } from './entry-text';
import { earlierAskSteerText, innerOpeningEnvelope } from '../../../../../test/support/ask-steer';
import { answerWords, firstToSend, newestToTake, rowText, stackRows, type Read, type StackRow } from './stack';

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
const read = (unread: Read['unread'] = [], started: readonly MessageUuid[] = [], asks: Record<string, readonly AskQuestion[]> = {}): Read => ({
  unread, started: (uuid) => started.includes(uuid), questions: (call) => asks[call] ?? null,
});
const NONE = new Set<string>();
const kinds = (rows: StackRow[]) => rows.map((row) => row.kind);
// an async ask's answer envelope, as `askSteerText` writes it (invented questions): the new form since board ticket 711
const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the gallery use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }], multi: true };
const THEME: AskQuestion = { id: 'q2', question: 'Which theme?', header: 'Theme', modality: 'choice', options: [{ label: 'Dark' }, { label: 'Light' }] };
const SIZE: AskQuestion = { id: 'q3', question: 'How large should the tiles be?', modality: 'text' };
const GRID: AskAnswer = { id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] };
const ANSWER = askSteerText('ask-1', [LAYOUT], [GRID]);
const noAsks: Read['questions'] = () => null;

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

  it('reads an answer’s envelope as the answer, on a next-step row and on a held one; any other message is no answer', () => {
    const asks = { 'ask-1': [LAYOUT] };
    const rows = stackRows(queue({ steers: [steer(U1, 1, ANSWER)], entries: [entry('q-1', 2)] }), NONE, read([], [], asks));
    expect(rows.map((row) => 'answer' in row && row.answer)).toEqual(['Answer to Layout: Grid', null]);
    expect(rows.map(rowText)).toEqual(['Answer to Layout: Grid', 'entry q-1']);
    // after a Stop holds it, the same words
    const held = stackRows(queue({ paused: true, pauseReason: 'interrupt', entries: [entry('q-a', 1, { content: ANSWER })] }), NONE, read([], [], asks));
    expect(held.map((row) => [row.kind, rowText(row)])).toEqual([['held', 'Answer to Layout: Grid']]);
  });

  it('gives a sending and a handed row an answer’s words too, and what they read today otherwise', () => {
    const q = queue({ entries: [entry('q-s', 1, { state: 'submitting', submittedAt: at(1), content: ANSWER }), entry('q-t', 2, { state: 'submitting', submittedAt: at(2) })] });
    const rows = stackRows(q, new Set(['q-s', 'q-t']), read([{ messageUuid: U3, text: ANSWER, at: at(0) }, { messageUuid: U2, text: 'typed', at: at(0) }], [], { 'ask-1': [LAYOUT] }));
    expect(rows.map((row) => [row.kind, rowText(row)])).toEqual([
      ['handed', 'Answer to Layout: Grid'],
      ['handed', 'typed'],
      ['sending', 'Answer to Layout: Grid'],
      ['sending', 'entry q-t'],
    ]);
  });
});

describe('a waiting message that holds an attachment beside an answer’s envelope (the architect’s rule, ticket 704)', () => {
  // made by hand: what the composer sends when the person pastes an envelope beside an image or a PDF
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const pdf = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } };
  const asks = { 'ask-1': [LAYOUT] };

  it('is no answer row on a next-step, after-the-turn, held or sending row: its text is the message as an ordinary one', () => {
    const withImage = [{ type: 'text', text: ANSWER }, image];
    const withPdf = [pdf, { type: 'text', text: ANSWER }];
    const rows = stackRows(
      queue({ steers: [steer(U1, 1, withImage as never)], entries: [entry('q-1', 2, { content: withPdf as never }), entry('q-s', 3, { state: 'submitting', submittedAt: at(3), content: withImage as never })] }),
      new Set(['q-s']),
      read([], [], asks),
    );
    expect(rows.map((row) => [row.kind, 'answer' in row ? row.answer : undefined])).toEqual([['next', null], ['after', null], ['sending', undefined]]);
    // what the stack draws of any message with an attachment: the attachment named, then the text
    expect(rows.map(rowText)).toEqual([entryDisplay(withImage as never), entryDisplay(withPdf as never), entryDisplay(withImage as never)]);
    expect(rowText(rows[0]!).startsWith('[Image #1] [MAWS ask ask-1]')).toBe(true);
    const held = stackRows(queue({ paused: true, pauseReason: 'interrupt', entries: [entry('q-a', 1, { content: withImage as never })] }), NONE, read([], [], asks));
    expect(held.map((row) => [row.kind, 'answer' in row && row.answer])).toEqual([['held', null]]);
  });

  it('the up-arrow can take it, as any ordinary waiting message', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 5), steer(U2, 9, [{ type: 'text', text: ANSWER }, image] as never)] }), NONE, read());
    expect(newestToTake(rows)?.key).toBe(U2);
  });

  it('the envelope alone in one text block is still the answer row', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 1, [{ type: 'text', text: ANSWER }] as never)] }), NONE, read([], [], asks));
    expect(rows.map((row) => 'answer' in row && row.answer)).toEqual(['Answer to Layout: Grid']);
  });
});

describe('a waiting answer’s words', () => {
  it('one question: the header where the window holds the ask, else the question’s own text, which only the earlier form carries', () => {
    expect(answerWords(ANSWER, (call) => (call === 'ask-1' ? [LAYOUT] : null))).toBe('Answer to Layout: Grid');
    // the new form holds neither the question's words nor the label: without the ask, the bare words, the pick by its place
    expect(answerWords(ANSWER, noAsks)).toBe('Answer: option 1');
    const earlier = earlierAskSteerText('ask-1', [LAYOUT], [GRID]);
    expect(answerWords(earlier, noAsks)).toBe('Answer to Which layout should the gallery use?: Grid');
    // the window holds the ask, and no question of it has the earlier form's id
    expect(answerWords(earlier, () => [THEME])).toBe('Answer to Which layout should the gallery use?: Grid');
  });

  it('a question with no header reads its question; an empty header reads the bare words, as the capsule’s label is empty', () => {
    const tiles: AskAnswer = { id: 'q3', question: SIZE.question, status: 'answered', value: 'Small' };
    expect(answerWords(askSteerText('ask-2', [SIZE], [tiles]), () => [SIZE])).toBe('Answer to How large should the tiles be?: Small');
    const blank: AskQuestion = { ...SIZE, header: '' };
    expect(answerWords(askSteerText('ask-2', [blank], [tiles]), () => [blank])).toBe('Answer: Small');
  });

  it('several questions: counted, in the asked order, skipped and left to the agent in the capsule’s words, a note as the capsule reads it', () => {
    const answers: AskAnswer[] = [
      { ...GRID, value: ['Grid', 'List'] },
      { id: 'q2', question: THEME.question, status: 'skipped' },
      { id: 'q3', question: SIZE.question, status: 'decide_for_me', note: 'whatever fits' },
    ];
    const text = askSteerText('ask-3', [LAYOUT, THEME, SIZE], answers);
    expect(answerWords(text, () => [LAYOUT, THEME, SIZE])).toBe('Answers to 3 questions: Layout: Grid, List; Theme: Skipped; How large should the tiles be?: Decide for me · Note: whatever fits');
    const blank: AskQuestion = { ...THEME, header: '' };
    expect(answerWords(text, () => [LAYOUT, blank, SIZE])).toBe('Answers to 3 questions: Layout: Grid, List; Skipped; How large should the tiles be?: Decide for me · Note: whatever fits');
  });

  it('follows the asked order where the window holds the ask, whatever the answers’ order; an answer no question holds comes after', () => {
    const theme: AskAnswer = { id: 'q2', question: THEME.question, status: 'answered', value: 'Dark' };
    const reversed = askSteerText('ask-4', [LAYOUT, THEME], [theme, GRID]);
    expect(answerWords(reversed, () => [LAYOUT, THEME])).toBe('Answers to 2 questions: Layout: Grid; Theme: Dark');
    // where the window holds no such row, the array's own order is the only one it has
    expect(answerWords(reversed, noAsks)).toBe('Answers to 2 questions: option 1; option 1');
    expect(answerWords(earlierAskSteerText('ask-4', [LAYOUT, THEME], [theme, GRID]), noAsks)).toBe('Answers to 2 questions: Which theme?: Dark; Which layout should the gallery use?: Grid');
    // an answer no question holds: the new form's writer leaves it out (it names no place); an earlier build's block may hold one
    const stray: AskAnswer = { id: 'q9', question: 'Anything else?', status: 'answered', value: 'No' };
    expect(answerWords(askSteerText('ask-4', [LAYOUT, THEME], [stray, theme, GRID]), () => [LAYOUT, THEME])).toBe('Answers to 2 questions: Layout: Grid; Theme: Dark');
    expect(answerWords(earlierAskSteerText('ask-4', [LAYOUT, THEME], [stray, theme, GRID]), () => [LAYOUT, THEME])).toBe('Answers to 3 questions: Layout: Grid; Theme: Dark; Anything else?: No');
  });

  it('a text that is no envelope is no answer, one changed character in the tag included', () => {
    expect(answerWords('Use the grid', noAsks)).toBeNull();
    expect(answerWords(ANSWER.replace('[MAWS ask', '[MAWS asc'), noAsks)).toBeNull();
  });

  // board ticket 711: the envelope's new form (each question by its number, no text the model wrote) and the form the
  // earlier builds wrote (the question's words on its line and in its block) are both an answer's
  it('knows an answer’s envelope in the new form and in the form the earlier builds wrote, held after the turn too', () => {
    const answered = askSteerText('ask-2', [{ id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Blue' }] }], [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] }]);
    expect(answered.split('\n')[1]).toBe('1. option 1');
    const old = ['[MAWS ask ask-3] The user answered the questions you asked:', '1. Which colour? — Blue', '```json', JSON.stringify({ status: 'answered', askId: 'ask-3', answers: [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] }] }, null, 2), '```'].join('\n');
    const rows = stackRows(queue({ steers: [steer(U1, 1, answered)], entries: [entry('q-1', 2, { content: old }), entry('q-2', 3)] }), NONE, read());
    expect(rows.map((row) => [row.kind, 'answer' in row && row.answer !== null])).toEqual([['next', true], ['after', true], ['after', false]]);
  });
});

// board ticket 711: the new form names each question by its place and a pick by `option <k>`; with the ask's questions in
// hand the row reads it back (askAnswersFromSteer) and says what the same answers said in the earlier form. The questions
// carry ids the model chose, so the place and the id differ.
describe('a waiting answer in the new form', () => {
  const PLAN: AskQuestion = { id: 'gallery-layout', question: 'Which layout should the gallery use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }, { label: 'Masonry' }], multi: true };
  const NOTES: AskQuestion = { id: 'footer-notes', question: 'What should the footer say?', modality: 'text' };
  const TONE: AskQuestion = { id: 'tone', question: 'Which tone fits?', header: 'Tone', modality: 'choice', options: [{ label: 'Warm' }, { label: 'Plain' }] };
  const picked: AskAnswer = { id: 'gallery-layout', question: PLAN.question, status: 'answered', value: ['Masonry', 'Grid'] };
  const typed: AskAnswer = { id: 'footer-notes', question: NOTES.question, status: 'answered', value: 'Made with care' };
  const skipped: AskAnswer = { id: 'tone', question: TONE.question, status: 'skipped' };
  const noted: AskAnswer = { id: 'tone', question: TONE.question, status: 'answered', value: ['Plain'], note: 'the shorter one' };
  const cases: { name: string; questions: AskQuestion[]; answers: AskAnswer[]; row: string }[] = [
    { name: 'a choice, by its labels', questions: [PLAN], answers: [picked], row: 'Answer to Layout: Masonry, Grid' },
    { name: 'a text', questions: [NOTES], answers: [typed], row: 'Answer to What should the footer say?: Made with care' },
    { name: 'a skipped one', questions: [TONE], answers: [skipped], row: 'Answer to Tone: Skipped' },
    { name: 'one with a note', questions: [TONE], answers: [noted], row: 'Answer to Tone: Plain · Note: the shorter one' },
    { name: 'all of them, in the asked order', questions: [PLAN, NOTES, TONE], answers: [noted, picked, typed], row: 'Answers to 3 questions: Layout: Masonry, Grid; What should the footer say?: Made with care; Tone: Plain · Note: the shorter one' },
  ];

  it.each(cases)('$name: the row the earlier form of the same answers gives', ({ questions, answers, row }) => {
    const envelope = askSteerText('ask-n', questions, answers);
    for (const question of questions) expect(envelope).not.toContain(question.question); // the new form, as the host writes it
    const asked = (call: string) => (call === 'ask-n' ? questions : null);
    expect(answerWords(envelope, asked)).toBe(row);
    expect(answerWords(envelope, asked)).toBe(answerWords(earlierAskSteerText('ask-n', questions, answers), asked));
  });

  it('on a next-step row and on a held one, as the queue lists them', () => {
    const envelope = askSteerText('ask-n', [PLAN], [picked]);
    const asks = { 'ask-n': [PLAN] };
    expect(stackRows(queue({ steers: [steer(U1, 1, envelope)] }), NONE, read([], [], asks)).map(rowText)).toEqual(['Answer to Layout: Masonry, Grid']);
    expect(stackRows(queue({ paused: true, pauseReason: 'interrupt', entries: [entry('q-a', 1, { content: envelope })] }), NONE, read([], [], asks)).map(rowText)).toEqual(['Answer to Layout: Masonry, Grid']);
  });

  it('the earlier form reads as before, with the ask’s questions in hand or without', () => {
    const earlier = earlierAskSteerText('ask-n', [PLAN, NOTES], [picked, typed]);
    expect(answerWords(earlier, () => [PLAN, NOTES])).toBe('Answers to 2 questions: Layout: Masonry, Grid; What should the footer say?: Made with care');
    expect(answerWords(earlier, noAsks)).toBe('Answers to 2 questions: Which layout should the gallery use?: Masonry, Grid; What should the footer say?: Made with care');
  });

  it('without the ask’s questions in hand: the bare words, a pick by its place, never the envelope', () => {
    const envelope = askSteerText('ask-n', [PLAN, NOTES, TONE], [picked, typed, skipped]);
    expect(answerWords(askSteerText('ask-n', [PLAN], [picked]), noAsks)).toBe('Answer: option 3, option 1');
    expect(answerWords(envelope, noAsks)).toBe('Answers to 3 questions: option 3, option 1; Made with care; Skipped');
    expect(answerWords(envelope, noAsks)).not.toMatch(/MAWS ask|q1|```/);
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

  it('a row with only text (handed, sending) whose message is one grant reads so too: a handed one as its transcript row records it', () => {
    const rows = stackRows(queue({ entries: [entry('q-s', 1, { content: GRANT, state: 'submitting', submittedAt: at(1) })] }), new Set(['q-s']), read([{ messageUuid: U3, text: GRANT, at: at(3), grant: { kind: 'command', subject: 'make build' } }]));
    expect(rows.map((row) => [row.kind, rowText(row)])).toEqual([['handed', 'You approved make build'], ['sending', 'You approved make build']]);
  });

  // Decision Log 53: no row reads a grant from the text it draws, which is the message with MAWS's envelopes taken out
  it('a handed row whose drawn text is the sentence and whose transcript row records no grant reads as its text', () => {
    const [row] = stackRows(queue(), NONE, read([{ messageUuid: U3, text: GRANT, at: at(3) }]));
    expect(row).toMatchObject({ kind: 'handed', grant: null });
    expect(rowText(row!)).toBe(GRANT);
  });

  it('a message that holds a grant line among other words is the person’s own message: no grant, its own words', () => {
    const words = `Go ahead with this one.\n${GRANT}`;
    const [row] = stackRows(queue({ entries: [entry('q-1', 1, { content: words })] }), NONE, read());
    expect(row).toMatchObject({ kind: 'after', grant: null });
    expect(rowText(row!)).toBe(words);
  });

  it('an answer’s row is unchanged: no grant, its envelope’s words', () => {
    const [row] = stackRows(queue({ steers: [steer(U1, 1, ANSWER)] }), NONE, read());
    expect(row).toMatchObject({ kind: 'next', answer: answerWords(ANSWER, read().questions), grant: null });
    expect(rowText(row!)).toBe(answerWords(ANSWER, read().questions));
  });

  // ticket 704 at the chain's merge of rule R (the architect's ruling 1 of 2026-11-16): a waiting message's grant is read on
  // its whole joined text, never on the part the split draws as the person's; the row is a grant's only where the sentence
  // is everything the message holds (Decision Log 44, rule R's first step), so A + G + A is no grant's row, nor an answer's
  it('an answer, the grant and the answer again, as one text or as text blocks: no grant’s row and no answer, whichever wait it is in', () => {
    const joined = `${ANSWER}\n${GRANT}\n${ANSWER}`;
    const blocks = [{ type: 'text' as const, text: ANSWER }, { type: 'text' as const, text: GRANT }, { type: 'text' as const, text: ANSWER }];
    const rows = stackRows(queue({ steers: [steer(U1, 1, joined)], entries: [entry('q-1', 2, { content: blocks }), entry('q-u', 3, { content: joined, uncertain: true })] }), NONE, read());
    expect(rows.map((row) => [row.kind, 'answer' in row ? row.answer : undefined, 'grant' in row ? row.grant : undefined])).toEqual([
      ['next', null, null],
      ['after', null, null],
      ['uncertain', undefined, null],
    ]);
    for (const row of rows) expect(rowText(row)).not.toMatch(/^You approved /);
    // an attachment beside them keeps the message the person's own (Decision Log 44), as beside the grant alone
    const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'iVBORw0KGgo=' } };
    const [row] = stackRows(queue({ entries: [entry('q-i', 4, { content: [...blocks, image] })] }), NONE, read());
    expect(row).toMatchObject({ kind: 'after', answer: null, grant: null });
  });

  // made by hand: an envelope cut before its block beside the sentence is no grant's row, the sentence not being the
  // whole message (Decision Log 44; the cascade reviews' A2, dropped by the architect's ruling 1 of 2026-11-16, pinned it)
  it('an envelope cut before its block beside the sentence, in either order: no grant’s row', () => {
    const cut = ANSWER.slice(0, ANSWER.indexOf('\n```json'));
    const rows = stackRows(queue({ steers: [steer(U1, 1, `${GRANT}\n${cut}`)], entries: [entry('q-1', 2, { content: `${cut}\n${GRANT}` })] }), NONE, read());
    expect(rows.map((row) => [row.kind, 'grant' in row ? row.grant : undefined])).toEqual([['next', null], ['after', null]]);
  });

  // ticket 704, the earlier review's finding, made by hand: an earlier build's envelope whose question holds the sentence
  // and another ask's whole opening line is bounded out and stays text (the reading past the bound, A, dropped by the
  // architect's ruling 2 of 2026-11-16): an ordinary message's row, no answer and no grant
  it('an earlier build’s envelope whose question holds the sentence and another ask’s opening line: no answer’s row, no grant', () => {
    const inner = innerOpeningEnvelope('ask-1', GRANT);
    const [row] = stackRows(queue({ steers: [steer(U1, 1, inner)] }), NONE, read());
    expect(answerWords(inner, read().questions)).toBeNull();
    expect(row).toMatchObject({ kind: 'next', answer: null, grant: null });
  });

  it('↑ never takes a grant (an edited grant is no grant); Esc still sends it', () => {
    const rows = stackRows(queue({ steers: [steer(U1, 5)], entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read());
    expect(newestToTake(rows)?.key).toBe(U1);
    expect(newestToTake(stackRows(queue({ entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read()))).toBeNull();
    expect(firstToSend(stackRows(queue({ entries: [entry('q-g', 9, { content: GRANT })] }), NONE, read()))?.key).toBe('q-g');
  });
});
