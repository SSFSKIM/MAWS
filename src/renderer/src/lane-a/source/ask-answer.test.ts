// The ask mod's answer to an async question (`ask-answer.ts`), through MAWS's own store, reducer and report, on rows in
// the shapes 2.1.302 keeps them (local transcripts, read for their shapes): the prompt the plugin submits while the
// session is idle, and the context on a tool's result or on the human's next prompt. Each draws as the answer's notice
// `answered: …` where the answer reached the model (UX wave U3, UC-2, class `answer`: MAWS's backfill draws it from the
// arrivals reader), never as the harness's text, and the idle prompt's turn as one the session continued, with no
// bubble of the owner's.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { reportRows } from '../../owner/report/project';
import { createTranscriptStore } from '../../stores/transcript';
import { rowsOf, withAllExpanded } from '../../transcript/model/derive';
import type { Row } from '../../transcript/model/rows';
import { answeredWords, askAnswers, CLARIFYING, isAnswerPrompt } from '../conversation/ask-answer';
import { deliveredLines } from '../conversation/delivery-frame';
import { Chain, SESSION } from '../test-support/chain-rows';
import { NOTICE } from '../../transcript/model/copy';
import { freshSource, subagentLookupOf } from '../plane-transcript';

const QUESTIONS = [
  { question: 'Which color do you prefer?', header: 'Color', options: [{ label: 'Blue' }, { label: 'Red' }] },
  { question: 'Which season do you prefer?', header: 'Season', options: [{ label: 'Summer' }, { label: 'Winter' }] },
];
const CHOSEN = 'Your questions have been answered: "Which color do you prefer?"="Blue", "Which season do you prefer?"="Summer". You can now continue with these answers in mind.';
const TYPED = 'The user answered: "Which color do you prefer?"="teal, if we have it". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.';
const delivered = (call: string, summary: string) => `The human responded to your async AskUserQuestion (call ${call}): ${summary}`;

async function drawn(rows: JsonObject[]) {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  // the notice is work of its turn, folded with it once the turn has closed (UX wave U3, M2): read it unfolded
  return { rows: entry.rows, expanded: rowsOf(withAllExpanded(entry.state)), report: reportRows(entry.rows, entry.state, {}) };
}
const bubbles = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'user' ? [r.text] : []));
const lines = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'notice' && r.class === 'answer' ? [r.text] : []));
const dividers = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'divider' ? [r.origin] : []));
const HARNESS = /AskUserQuestion|plugin sent a message|surfaces a prompt/;

describe("the ask mod's answer", () => {
  it('is read off its three routes by the call it names; never off a prompt the human typed, nor another plugin’s', () => {
    const c = new Chain();
    const idle = c.answerPrompt(`${delivered('toolu_a', CHOSEN)}\n\n${delivered('toolu_b', TYPED)}`);
    expect(isAnswerPrompt(idle)).toBe(true);
    expect(askAnswers(idle)).toEqual([
      { call: 'toolu_a', text: CHOSEN },
      { call: 'toolu_b', text: TYPED },
    ]);
    for (const hook of ['tool.call', 'prompt.submit'] as const) {
      const context = c.answerContext(delivered('toolu_c', CHOSEN), hook);
      expect(isAnswerPrompt(context)).toBe(false);
      expect(askAnswers(context)).toEqual([{ call: 'toolu_c', text: CHOSEN }]);
    }
    expect(askAnswers(c.prompt(delivered('toolu_d', CHOSEN)))).toEqual([]);
    expect(askAnswers(c.row('user', { origin: { kind: 'plugin', name: 'another' }, message: { role: 'user', content: delivered('toolu_e', CHOSEN) } }))).toEqual([]);
    // No delivery: the tail matches no send by it.
    expect(deliveredLines(idle)).toEqual([]);
  });

  it('says its answers by the call’s headers, else by the summary’s pairs; an answer with none says so', () => {
    expect(answeredWords(CHOSEN, QUESTIONS)).toBe('Color → Blue · Season → Summer');
    expect(answeredWords(CHOSEN, null)).toBe('Which color do you prefer? → Blue · Which season do you prefer? → Summer');
    expect(answeredWords(TYPED, QUESTIONS)).toBe('Color → teal, if we have it');
    expect(answeredWords(TYPED, null)).toBe('Which color do you prefer? → teal, if we have it');
    expect(answeredWords('The user did not answer the questions.', QUESTIONS)).toBe('Not answered');
    expect(answeredWords('The user did not answer the questions.', null)).toBe('Not answered');
    // A declined dialog (2.1.300's refusal): Esc, "Chat about this", or words the human gave with it.
    const declined = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
    expect(answeredWords(declined, QUESTIONS)).toBe('Skipped');
    const chat = `${declined} To tell you how to proceed, the user said:\nThe user wants to clarify these questions.\n    This means they may have additional information, context or questions for you.\n\n    Questions asked:\n- "Which color do you prefer?"\n  (No answer provided)`;
    expect(answeredWords(chat, QUESTIONS)).toBe(CLARIFYING);
    expect(answeredWords(`${declined} To tell you how to proceed, the user said:\nask me tomorrow\nthanks`, null)).toBe('Skipped: ask me tomorrow');
  });

  it('idle: the line where the answer went in, in a turn the session continued, with no bubble and no harness text; the report keeps the line', async () => {
    const c = new Chain();
    c.prompt('Pick my colors, then write the palette.');
    c.asyncAsk('toolu_01RZQ8nn9jVyPaqznEmsoXMr', QUESTIONS);
    c.answer('Asked; waiting on you.');
    c.end();
    c.answerPrompt(delivered('toolu_01RZQ8nn9jVyPaqznEmsoXMr', CHOSEN));
    c.answer('<message>The palette is blue and summer-bright.</message>');
    c.end();
    const { rows, expanded, report } = await drawn(c.rows);
    expect(bubbles(rows)).toEqual(['Pick my colors, then write the palette.']);
    expect(lines(expanded)).toEqual([NOTICE.answered('Color → Blue · Season → Summer')]);
    // UX wave U2 (O-15; the U2a document's C5): the turn the answer opened only answers, so it has no line; the answer's
    // line heads it, in view (UX wave U3, the U3a document's head rule)
    expect(dividers(rows)).toEqual([]);
    const answered = expanded.find((r) => r.kind === 'notice')!;
    expect(rows.find((r) => r.kind !== 'time' && r.turnId === answered.turnId)).toMatchObject({ id: answered.id });
    expect([...bubbles(rows), ...lines(expanded)].some((text) => HARNESS.test(text))).toBe(false);
    // The report folds the answered turn's work and keeps the line, with the question's row: until U1b fills that row
    // with the answer, an answer's notice stays through a fold (the architect's ruling of 2026-11-13), so the report
    // never shows a question without its answer.
    expect(lines(report)).toEqual([NOTICE.answered('Color → Blue · Season → Summer')]);
    expect(report.filter((r) => r.kind === 'question')).toHaveLength(1);
    expect(bubbles(report)).toEqual(['Pick my colors, then write the palette.']);
  });

  it('idle with the question out of view: the line reads the summary’s pairs; two answers in one prompt draw two lines', async () => {
    const c = new Chain();
    c.answerPrompt(`${delivered('toolu_a', CHOSEN)}\n\n${delivered('toolu_b', TYPED)}`);
    c.answer('Noted both.');
    c.end();
    const { rows, expanded } = await drawn(c.rows);
    expect(bubbles(rows)).toEqual([]);
    expect(lines(expanded)).toEqual([
      NOTICE.answered('Which color do you prefer? → Blue · Which season do you prefer? → Summer'),
      NOTICE.answered('Which color do you prefer? → teal, if we have it'),
    ]);
  });

  it('as context on a running turn’s tool result, or on the human’s next prompt after a stop: the same line in that turn', async () => {
    const c = new Chain();
    c.prompt('Pick my colors, then write the palette.');
    c.asyncAsk('toolu_busy', QUESTIONS);
    const call = c.call('toolu_sleep');
    c.result('toolu_sleep', call);
    c.answerContext(delivered('toolu_busy', CHOSEN), 'tool.call');
    c.answer('Blue it is.');
    c.end();
    c.prompt('And the font?');
    c.answerContext(delivered('toolu_busy', TYPED), 'prompt.submit');
    c.answer('Serif.');
    c.end();
    const { rows, expanded } = await drawn(c.rows);
    expect(bubbles(rows)).toEqual(['Pick my colors, then write the palette.', 'And the font?']);
    const turns = rows.flatMap((r) => (r.kind === 'user' ? [r.turnId] : []));
    expect(expanded.flatMap((r) => (r.kind === 'notice' ? [[r.text, r.turnId]] : []))).toEqual([
      [NOTICE.answered('Color → Blue · Season → Summer'), turns[0]],
      [NOTICE.answered('Color → teal, if we have it'), turns[1]],
    ]);
  });
});

// The sminos plugin (doperpowers' sminos plugin design, §3 and §11): the ask moves out of doperpowers into a plugin of its
// own, so a rolled machine's ask is `mcp__sminos__AskUserQuestion` and its idle answer `The sminos plugin sent a
// message:` under origin `sminos`; a machine not yet rolled writes the old names, and a session resumed across the roll
// holds a call under one name and its answer under the other. Every one is read, for good.
describe("the ask mod's answer under either plugin's name", () => {
  it.each(['doperpowers', 'sminos'] as const)('%s: the idle answer draws its line by the call’s headers, in a turn the session continued, which only answers', async (plugin) => {
    const c = new Chain('c4a10000', plugin);
    c.prompt('Pick my colors, then write the palette.');
    c.asyncAsk('toolu_01RZQ8nn9jVyPaqznEmsoXMr', QUESTIONS);
    c.answer('Asked; waiting on you.');
    c.end();
    const idle = c.answerPrompt(delivered('toolu_01RZQ8nn9jVyPaqznEmsoXMr', CHOSEN));
    c.answer('<message>The palette is blue and summer-bright.</message>');
    c.end();
    expect(isAnswerPrompt(idle)).toBe(true);
    expect(askAnswers(idle)).toEqual([{ call: 'toolu_01RZQ8nn9jVyPaqznEmsoXMr', text: CHOSEN }]);
    const { rows, expanded } = await drawn(c.rows);
    expect(bubbles(rows)).toEqual(['Pick my colors, then write the palette.']);
    expect(lines(expanded)).toEqual([NOTICE.answered('Color → Blue · Season → Summer')]);
    expect(dividers(rows)).toEqual([]); // UX wave U2 (O-15): the turn the answer opened only answers: no line
    expect([...bubbles(rows), ...lines(expanded)].some((text) => HARNESS.test(text))).toBe(false);
  });

  it.each([
    ['doperpowers', 'sminos'],
    ['sminos', 'doperpowers'],
  ] as const)('a call under %s answered under %s (a session resumed across the roll): the line still reads the call’s headers', async (asked, answered) => {
    const c = new Chain('c4a10000', answered);
    c.prompt('Pick my colors.');
    c.asyncAsk('toolu_roll', QUESTIONS, asked);
    c.answer('Asked.');
    c.end();
    c.answerPrompt(delivered('toolu_roll', CHOSEN));
    c.answer('Blue.');
    c.end();
    const { rows, expanded } = await drawn(c.rows);
    expect(lines(expanded)).toEqual([NOTICE.answered('Color → Blue · Season → Summer')]);
    expect(bubbles(rows)).toEqual(['Pick my colors.']);
  });

  it('never another plugin’s prompt, even framed as the ask’s', () => {
    const c = new Chain();
    const framed = `The another plugin sent a message:\n${delivered('toolu_x', CHOSEN)}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.`;
    const row = c.row('user', { origin: { kind: 'plugin', name: 'another' }, message: { role: 'user', content: framed } });
    expect(isAnswerPrompt(row)).toBe(false);
    expect(askAnswers(row)).toEqual([]);
  });
});
