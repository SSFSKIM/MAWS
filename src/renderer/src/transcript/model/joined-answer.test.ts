// UX wave U4b, the joined answer's step 2 (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, the
// Decision Log's lines on the architect's medium review and on the probe; spikes/protocol-probe/findings-uxwave-u4b-
// envelope-join.txt). The engine joins an ask's answer envelope with a prompt waiting beside it, as it joins two prompts:
// the members in writing order, one newline between, under the last-written member's uuid. These replay the probe's
// recordings through the engine host's normaliser, the reducer and derive: the joined row is the person's words alone,
// and with the ask's call in the state its capsule takes the answers from the joined line alone (the route of a session
// read from its file, which keeps no line of the envelope's own). A pair the engine delivered apart (a tool boundary)
// reads as before.
import { describe, expect, it } from 'vitest';
import { framePasted } from '@shared/composer/pasted-content';
import type { ContentBlock } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { askSteerText, parseAskSteer } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { builder, uuid } from './test-events';
import { copiedUserText, userTextOf } from './user-text';

type UserRow = Extract<Row, { kind: 'user' }>;
type AskRow = Extract<Row, { kind: 'ask' }>;

const KIWI = 'Reply with the single word KIWI, then carry on with what you were doing.';
const frameAt = (rows: JournalRow[], seq: number) => rows.find((row) => row.seq === seq)!.frame as { uuid: MessageUuid; message: { content: string } };
const drawn = (events: Parameters<typeof applyEvents>[1]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const users = (rows: Row[]) => rows.filter((row): row is UserRow => row.kind === 'user');

// each shape's MAWS writes (the envelope, the prompt) and the joined replay, as the findings name their seqs
const JOINED = [
  { name: 'u4b-env-end-env-first-1', envelope: 150, prompt: 153, joined: 524 },
  { name: 'u4b-env-end-prompt-first-1', envelope: 166, prompt: 163, joined: 632 },
  { name: 'u4b-env-end-env-first-multi-1', envelope: 827, prompt: 830, joined: 916 },
];

function recorded({ name, envelope, prompt, joined }: (typeof JOINED)[number]) {
  const rows = loadUxwaveJournal(name);
  const [e, p, j] = [frameAt(rows, envelope), frameAt(rows, prompt), frameAt(rows, joined)];
  const last = envelope > prompt ? e : p;
  // the recording reads as the findings say: the members in writing order, one newline, under the last one's uuid
  expect(j.uuid).toBe(last.uuid);
  expect(j.message.content).toBe(envelope < prompt ? `${e.message.content}\n${p.message.content}` : `${p.message.content}\n${e.message.content}`);
  expect(parseAskSteer(j.message.content)).toBeNull();
  expect(p.message.content).toBe(KIWI);
  return { rows, envelope: e, under: last.uuid, steer: parseAskSteer(e.message.content)! };
}

describe('an answer envelope the engine joined with a waiting prompt', () => {
  describe.each(JOINED)('$name', (shape) => {
    it('draws the joined row as the prompt alone, nothing of the envelope anywhere', () => {
      const { rows, under } = recorded(shape);
      const drawnRows = drawn(journalToEvents(rows));
      const row = users(drawnRows).find((r) => r.messageUuid === under)!;
      expect(row.text).toBe(KIWI);
      expect(copiedUserText(row)).toBe(KIWI);
      expect(users(drawnRows).some((r) => r.text.includes('[MAWS ask') || r.text.includes('```json'))).toBe(false);
    });

    it('with the ask’s call in the state, its capsule is Answered from the joined line alone', () => {
      const { rows, envelope, under, steer } = recorded(shape);
      const call = builder();
      call.turn('u0');
      call.toolUse(steer.askId, 'mcp__maws__ask', { blocking: false, questions: steer.result.answers.map((answer) => ({ id: answer.id, question: answer.question, modality: 'text' })) });
      call.result(steer.askId, [{ type: 'text', text: JSON.stringify({ status: 'asked', askId: steer.askId }) }]);
      call.end(['u0']);
      // a session read from its file: the engine's file keeps the joined line, and no line of the envelope's own (MAWS's
      // write of it, and the engine's replay of it alone, both its whole text)
      const fromFile = journalToEvents(rows).filter((event) => !(event.kind === 'user.message' && event.content === envelope.message.content));
      expect(fromFile.some((event) => event.kind === 'user.message' && event.messageUuid === under && event.content !== KIWI)).toBe(true); // the joined line stays
      const drawnRows = drawn([...call.events, ...fromFile]);
      expect(drawnRows.find((r): r is AskRow => r.kind === 'ask')).toMatchObject({ askId: steer.askId, state: 'answered', answers: steer.result.answers });
      expect(users(drawnRows).find((r) => r.messageUuid === under)?.text).toBe(KIWI);
      expect(users(drawnRows).some((r) => r.text.includes('[MAWS ask'))).toBe(false);
    });
  });

  it('a pair the engine delivered apart at a tool boundary (u4b-env-two-late-env-first-1) reads as before: two rows, each its own text', () => {
    const rows = loadUxwaveJournal('u4b-env-two-late-env-first-1');
    const [e, p] = [frameAt(rows, 39), frameAt(rows, 42)];
    expect(parseAskSteer(e.message.content)).not.toBeNull();
    const byUuid = new Map(users(drawn(journalToEvents(rows))).map((row) => [row.messageUuid, row.text]));
    expect(byUuid.get(e.uuid)).toBe(e.message.content); // no call for the invented ask: its envelope keeps its bubble, as today
    expect(byUuid.get(p.uuid)).toBe(KIWI);
  });
});

// the task review (Decision Log): a join of envelopes alone, each for an ask answered here, is no bubble, as one envelope
// is; one whose ask is not answered here keeps the bubble, as an orphan envelope does
describe('a join of answer envelopes with no prompt', () => {
  const question = (id: string) => ({ id: 'q1', question: `Which option for ${id}?`, header: id, modality: 'choice' as const, options: [{ label: 'One' }, { label: 'Two' }] });
  const envelopeOf = (askId: string) => askSteerText(askId, [question(askId)], [{ id: 'q1', question: question(askId).question, status: 'answered', value: ['Two'] }]);
  function stateWith(asks: string[], text: string) {
    const b = builder();
    b.turn('u0');
    for (const askId of asks) b.toolUse(askId, 'mcp__maws__ask', { blocking: false, questions: [question(askId)] });
    for (const askId of asks) b.result(askId, [{ type: 'text', text: JSON.stringify({ status: 'asked', askId }) }]);
    b.end(['u0']);
    b.turn('u1', text);
    b.end(['u1']);
    return drawn(b.events);
  }

  it('two asks answered here: both capsules Answered, and no bubble for the join', () => {
    const rows = stateWith(['toolu_ask_a', 'toolu_ask_b'], `${envelopeOf('toolu_ask_a')}\n${envelopeOf('toolu_ask_b')}`);
    expect(rows.filter((r): r is AskRow => r.kind === 'ask').map((r) => [r.askId, r.state])).toEqual([['toolu_ask_a', 'answered'], ['toolu_ask_b', 'answered']]);
    expect(users(rows).map((r) => r.text)).toEqual(['prompt u0']);
  });

  it('one of them for an ask not answered here: the join keeps its bubble, as an orphan envelope does', () => {
    const text = `${envelopeOf('toolu_ask_a')}\n${envelopeOf('toolu_ask_c')}`;
    const rows = stateWith(['toolu_ask_a'], text);
    expect(rows.find((r): r is AskRow => r.kind === 'ask')).toMatchObject({ askId: 'toolu_ask_a', state: 'answered' });
    expect(users(rows).map((r) => r.text)).toEqual(['prompt u0', text]);
  });
});

// The architect's review of the joined answer (the Decision Log): four findings. Each case stages the ask's call by hand,
// then the person's message, and reads what the reducer recorded and what derive draws.
describe('the joined answer, the architect\'s review', () => {
  const LAYOUT = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice' as const, options: [{ label: 'Grid' }, { label: 'List' }] };
  const envelopeOf = (askId: string, question: AskQuestion = LAYOUT) => askSteerText(askId, [question], [{ id: 'q1', question: question.question, status: 'answered', value: ['Grid'] }]);
  const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  function rowsAfter(asks: { askId: string; question?: AskQuestion }[], content: string | ContentBlock[]) {
    const b = builder();
    b.turn('u0');
    for (const { askId, question } of asks) b.toolUse(askId, 'mcp__maws__ask', { blocking: false, questions: [question ?? LAYOUT] });
    for (const { askId } of asks) b.result(askId, [{ type: 'text', text: JSON.stringify({ status: 'asked', askId }) }]);
    b.end(['u0']);
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u1']);
    return drawn(b.events);
  }
  const asksOf = (rows: Row[]) => rows.filter((r): r is AskRow => r.kind === 'ask').map((r) => [r.askId, r.state]);
  const promptOf = (rows: Row[]) => users(rows).find((r) => r.messageUuid === 'u1');

  // (1) a pasted segment's body is data
  describe('a prompt with a pasted segment whose body is a valid envelope', () => {
    const prompt = `Why did the agent stop after this?\n${framePasted('a1b2', envelopeOf('toolu_ask_p'))}`;

    it('keeps the segment whole, as its attachment', () => {
      const read = userTextOf(prompt);
      expect(read.text).toBe('Why did the agent stop after this?\n[Pasted text #1 +' + envelopeOf('toolu_ask_p').split('\n').length + ' lines]');
      expect(read.attachments.map((a) => a.text)).toEqual([envelopeOf('toolu_ask_p')]);
    });

    it('records no answer for the ask it names, and draws the prompt with its attachment', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_p' }], prompt);
      expect(asksOf(rows)).toEqual([['toolu_ask_p', 'asked']]);
      expect(promptOf(rows)?.attachments.map((a) => a.text)).toEqual([envelopeOf('toolu_ask_p')]);
    });
  });

  // (2) the engine's joining of a message with image or document blocks is not recorded: such a message is never hidden
  describe('a message with an image beside envelopes alone', () => {
    it('every ask answered here: the row draws the image, with the envelopes\' text gone', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_i' }], [IMAGE, { type: 'text', text: envelopeOf('toolu_ask_i') }]);
      expect(asksOf(rows)).toEqual([['toolu_ask_i', 'answered']]);
      expect(promptOf(rows)).toMatchObject({ text: '', lines: 0, attachments: [{ kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] });
    });

    it('two envelopes joined, both answered here: the same', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_i' }, { askId: 'toolu_ask_j' }], [IMAGE, { type: 'text', text: `${envelopeOf('toolu_ask_i')}\n${envelopeOf('toolu_ask_j')}` }]);
      expect(asksOf(rows)).toEqual([['toolu_ask_i', 'answered'], ['toolu_ask_j', 'answered']]);
      expect(promptOf(rows)).toMatchObject({ text: '', attachments: [{ kind: 'image' }] });
    });

    it('a document beside them: the row draws its chip', () => {
      const document: ContentBlock = { type: 'document', title: 'brief.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } };
      const rows = rowsAfter([{ askId: 'toolu_ask_i' }], [{ type: 'text', text: envelopeOf('toolu_ask_i') }, document]);
      expect(promptOf(rows)).toMatchObject({ text: '', attachments: [{ kind: 'file', name: 'brief.pdf' }] });
    });

    it('a block that draws nothing (a type no attachment reads) keeps no row: there is nothing to lose', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_i' }], [{ type: 'text', text: envelopeOf('toolu_ask_i') }, { type: 'container_upload' }]);
      expect(asksOf(rows)).toEqual([['toolu_ask_i', 'answered']]);
      expect(promptOf(rows)).toBeUndefined();
    });

    it('an ask not answered here: the row draws the image and the raw text', () => {
      const text = `${envelopeOf('toolu_ask_i')}\n${envelopeOf('toolu_ask_k')}`;
      const rows = rowsAfter([{ askId: 'toolu_ask_i' }], [IMAGE, { type: 'text', text }]);
      expect(promptOf(rows)).toMatchObject({ text, attachments: [{ kind: 'image' }] });
    });
  });

  // (3) the member boundary is the writer's whole first line
  describe('a question whose second line begins with the tag', () => {
    const TAGGED: AskQuestion = { id: 'q1', question: 'Which marker should the log use?\n[MAWS ask lines] keep their own prefix', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
    const envelope = envelopeOf('toolu_ask_t', TAGGED);

    it('its envelope alone answers the ask, and draws no bubble', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_t', question: TAGGED }], envelope);
      expect(rows.find((r): r is AskRow => r.kind === 'ask')).toMatchObject({ askId: 'toolu_ask_t', state: 'answered', answers: [{ id: 'q1', value: ['Grid'] }] });
      expect(promptOf(rows)).toBeUndefined();
    });

    it('joined with a prompt, it answers the ask and the bubble is the prompt', () => {
      const rows = rowsAfter([{ askId: 'toolu_ask_t', question: TAGGED }], `Also fix the footer.\n${envelope}`);
      expect(asksOf(rows)).toEqual([['toolu_ask_t', 'answered']]);
      expect(promptOf(rows)?.text).toBe('Also fix the footer.');
    });
  });
});
