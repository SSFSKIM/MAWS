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

// The transcript's own answer (`ask-answer.ts`): the plugin's prompt while the session was idle, or a context attachment
// on a tool's result or the human's prompt, each naming the call it answers.
const idlePrompt = (text: string): JsonObject => ({
  type: 'user', uuid: 'u2', origin: { kind: 'plugin', name: 'doperpowers' }, promptId: 'p2',
  message: { role: 'user', content: `The doperpowers plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.` },
});
const context = (text: string, hookName: 'tool.call' | 'prompt.submit'): JsonObject => ({
  type: 'attachment', uuid: 'c1', attachment: { type: 'hook_additional_context', content: [text], hookName, toolUseID: 'x-context', hookEvent: hookName === 'tool.call' ? 'PostToolUse' : 'UserPromptSubmit' },
});
const delivered = (summary: string) => `The human responded to your async AskUserQuestion (call ${CALL}): ${summary}`;

it("reads the answers from the transcript's own delivery, by any of its routes, when the log has none: a question the log never named included", () => {
  for (const row of [idlePrompt(delivered(SUMMARY)), context(delivered(SUMMARY), 'tool.call'), context(delivered(SUMMARY), 'prompt.submit')]) {
    expect(askedQuestions(S, [question], [call, row]).get(CALL), JSON.stringify(row)).toMatchObject({ answers: { [QUESTIONS[0].question]: 'Stop it' }, answeredText: SUMMARY });
    expect(askedQuestions(S, [], [call, row]).get(CALL)).toMatchObject({ answers: { [QUESTIONS[0].question]: 'Stop it' } });
  }
});

it("prefers the log's answer to the transcript's, and reads no answer from a prompt the human typed that quotes one", () => {
  const logged = `Your questions have been answered: "${QUESTIONS[0].question}"="Keep it running". You can now continue with these answers in mind.`;
  const answered = ev('answered', { from: 'fakerec', src: CALL, text: logged });
  expect(askedQuestions(S, [question, answered], [call, idlePrompt(delivered(SUMMARY))]).get(CALL)).toMatchObject({ answeredText: logged });
  const typed: JsonObject = { type: 'user', uuid: 'u3', origin: { kind: 'human' }, message: { role: 'user', content: delivered(SUMMARY) } };
  expect(askedQuestions(S, [question], [call, typed]).get(CALL)).toMatchObject({ answers: null, answeredText: null });
});
