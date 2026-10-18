// The ask mod's async questions the log knows for a session (the composite's §9.1): each `question` event joined, by its
// `src` (the call's tool-use id), to the call the transcript holds and to the log's `answered` for it, whose text is the
// engine's summary the answers are read back from.
import { expect, it } from 'vitest';
import type { JsonObject, LogEvent } from 'desk-hub/protocol';
import { askedQuestions } from './asked';

const S = 'ac0d9312-d6f9-46c7-93d6-a137164c2e41';
const CALL = 'toolu_01ptPa1uE4qkTexQaiwjlnsO';
const QUESTIONS = [{ question: 'Keep the mockup server running once the suites finish?', header: 'Mockups', options: [{ label: 'Keep it running' }, { label: 'Stop it' }], multiSelect: false }];
const call: JsonObject = { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'tool_use', id: CALL, name: 'mcp__doperpowers__AskUserQuestion', input: { questions: QUESTIONS, async: true } }] } };
let seq = 0;
const ev = (kind: string, fields: Record<string, unknown>, writer = `SK.local/${S}`) => ({ offset: ++seq, event: { ts: '2026-10-15T18:52:41.362Z', writer, seq, kind, mac: { nonce: `n${seq}`, value: 'v' }, ...fields } as LogEvent });
const question = ev('question', { from: 'fakerec', to: 'host', text: [QUESTIONS[0].question], choices: ['Keep it running', 'Stop it'], src: CALL });
const SUMMARY = `Your questions have been answered: "${QUESTIONS[0].question}"="Stop it". You can now continue with these answers in mind.`;

it('joins a pending question to its call: its questions and headers, no answer yet', () => {
  expect(askedQuestions(S, [question], [call]).get(CALL)).toEqual({ questions: [{ question: QUESTIONS[0].question, header: 'Mockups' }], answers: null, answeredText: null });
});

it("reads the answers from the log's answer, the engine's summary", () => {
  const answered = ev('answered', { from: 'fakerec', src: CALL, text: SUMMARY });
  expect(askedQuestions(S, [question, answered], [call]).get(CALL)).toMatchObject({ answers: { [QUESTIONS[0].question]: 'Stop it' }, answeredText: SUMMARY });
});

it('keeps an answer it cannot read as answers as its text', () => {
  const answered = ev('answered', { from: 'fakerec', src: CALL, text: 'no' });
  expect(askedQuestions(S, [question, answered], [call]).get(CALL)).toMatchObject({ answers: null, answeredText: 'no' });
});

it("leaves out another session's questions, and a question whose call the view does not hold", () => {
  const other = ev('question', { from: 'x', to: 'host', text: ['?'], src: CALL }, 'SK.local/9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a');
  expect(askedQuestions(S, [other], [call]).size).toBe(0);
  expect(askedQuestions(S, [question], []).size).toBe(0);
});
