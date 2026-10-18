// DC9 (the desk, 2026-10-17): doperpowers' ask tool's result read back into a question row's answers. The texts are the
// engine's own AskUserQuestion result (2.1.300 `mapToolResultToToolResultBlockParam`), as a blocking ask returns it,
// and the ask mod's own (`hooks/mods/ask.tsx`: its async return, its decline).
import { describe, expect, it } from 'vitest';
import { askModAnswers } from './ask-mod';

const COLOUR = { question: 'Which colour?' };
const FRUITS = { question: 'Which fruits?' };
const ok = (content: Parameters<typeof askModAnswers>[1]['content']) => ({ content, isError: false });

describe('askModAnswers', () => {
  it('reads each answer of the engine summary every option matched', () => {
    const text = 'Your questions have been answered: "Which colour?"="Red", "Which fruits?"="Apple,Pear". You can now continue with these answers in mind.';
    expect(askModAnswers([COLOUR, FRUITS], ok(text))).toEqual({ 'Which colour?': 'Red', 'Which fruits?': 'Apple,Pear' });
  });

  it('reads the summary of an answer written by the human, keyed by the call’s own questions, quotes inside kept', () => {
    const text = 'The user answered: "Which colour?"="a "warm" red, or "Which fruits?"", "Which fruits?"="Pear". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.';
    expect(askModAnswers([COLOUR, FRUITS], ok(text))).toEqual({ 'Which colour?': 'a "warm" red, or "Which fruits?"', 'Which fruits?': 'Pear' });
  });

  it('leaves a question out of the map when the summary does not answer it', () => {
    const text = 'Your questions have been answered: "Which fruits?"="Pear". You can now continue with these answers in mind.';
    expect(askModAnswers([COLOUR, FRUITS], ok(text))).toEqual({ 'Which fruits?': 'Pear' });
  });

  it('drops the selected preview and the notes after an answer', () => {
    const text = 'The user answered: "Which colour?"="Red" selected preview:\n<div>red</div> notes: brighter, "please", "Which fruits?"="Pear" notes: ripe. Read the answers carefully — and follow what they actually say.';
    expect(askModAnswers([COLOUR, FRUITS], ok(text))).toEqual({ 'Which colour?': 'Red', 'Which fruits?': 'Pear' });
  });

  it('reads a question answered with notes alone as its notes', () => {
    const text = 'The user answered: "Which colour?"=(no option selected) notes: none of these, something green. Read the answers carefully — and follow what they actually say.';
    expect(askModAnswers([COLOUR], ok(text))).toEqual({ 'Which colour?': 'none of these, something green' });
  });

  it('reads the text block beside pasted pictures', () => {
    const content = [{ type: 'text', text: 'Your questions have been answered: "Which colour?"="Red". You can now continue with these answers in mind.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }];
    expect(askModAnswers([COLOUR], ok(content))).toEqual({ 'Which colour?': 'Red' });
  });

  it('an ask the human submitted without answering is an empty map, as a skipped question', () => {
    expect(askModAnswers([COLOUR], ok('The user did not answer the questions.'))).toEqual({});
  });

  it('an async ask’s return answers nothing yet: null, the answer comes later', () => {
    const text = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
    expect(askModAnswers([COLOUR], ok(text))).toBeNull();
  });

  it('a declined ask, its refusal wrapped as the engine stores a plugin tool’s deny, is an empty map, as a question declined whole', () => {
    const decline = "<tool_use_error>The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.</tool_use_error>";
    expect(askModAnswers([COLOUR], { content: decline, isError: true })).toEqual({});
    const chat = "<tool_use_error>The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nask me later</tool_use_error>";
    expect(askModAnswers([COLOUR], { content: chat, isError: true })).toEqual({});
  });

  it('any other refusal answers nothing: null, the row shows the refusal instead', () => {
    const invalid = '<tool_use_error>InputValidationError: AskUserQuestion failed due to the following issue:\nThe parameter `questions` is missing</tool_use_error>';
    expect(askModAnswers([COLOUR], { content: invalid, isError: true })).toBeNull();
    expect(askModAnswers([COLOUR], { content: '<tool_use_error>AskUserQuestion is for the main conversation: report what you need to the agent that dispatched you.</tool_use_error>', isError: true })).toBeNull();
  });
});
