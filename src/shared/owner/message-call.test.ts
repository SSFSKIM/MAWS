// P4-R7: a message tool's call read as a to-human message. P4-R7z (the P4 spec's Decision Log 92): the to-human
// plugin's tool, the one a MAWS session messages through, and MAWS's former one, which recorded sessions call.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { MAWS_TOOL_NAMES } from '../maws/tools';
import { isHookMadeMessageId, isMadeUpFinalAnswer, isMessageTool, MAWS_MESSAGE_TOOL, MESSAGE_TOOLS, messageCallState, messageCallText, PLUGIN_MESSAGE_TOOL } from './message-call';

describe('the message tools', () => {
  it('reads the to-human plugin’s name and MAWS’s former one as message tools, and no other tool', () => {
    expect(MESSAGE_TOOLS).toEqual(['mcp__to-human__message', 'mcp__maws__message']);
    for (const name of [PLUGIN_MESSAGE_TOOL, MAWS_MESSAGE_TOOL]) expect(isMessageTool(name)).toBe(true);
    for (const other of ['message', 'mcp__maws__ask', 'mcp__doperpowers__message', 'SendMessage', 'mcp__to-human__AskUserQuestion', undefined, null, 42]) expect(isMessageTool(other)).toBe(false);
  });

  // MAWS's former tool is read in recorded sessions only: the `maws` server lists it no more.
  it('MAWS’s former tool is not on the `maws` server', () => {
    expect(MAWS_TOOL_NAMES).not.toContain('message');
  });
});

describe('messageCallText', () => {
  it('is the input’s whole text, Markdown and surrounding whitespace kept', () => {
    expect(messageCallText({ text: 'Stage 1 is done.' })).toBe('Stage 1 is done.');
    expect(messageCallText({ text: '\n**Two things** need you:\n- one\n- two\n' })).toBe('\n**Two things** need you:\n- one\n- two\n');
  });

  it('is null for an input with no words: blank, missing, not a string, or no object at all', () => {
    for (const input of [{ text: '' }, { text: ' \n\t ' }, {}, { body: 'words' }, { text: 7 }, { text: null }, null, undefined, 'words', ['words']]) expect(messageCallText(input)).toBeNull();
  });
});

describe('messageCallState', () => {
  it('pending without a result, sent with one that is no error, refused with an error', () => {
    expect(messageCallState(null)).toBe('pending');
    expect(messageCallState(undefined)).toBe('pending');
    expect(messageCallState({ isError: false })).toBe('sent');
    expect(messageCallState({ isError: true })).toBe('refused');
  });
});

// test/fixtures/transcript-to-human-final.jsonl: a turn ending on an accepted final call of the plugin's tool, then the
// plugin's made-up answer and the turn's end.
describe('isMadeUpFinalAnswer', () => {
  const rows = readFileSync(join(TEST_FIXTURE_DIR, 'transcript-to-human-final.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const madeUp = rows.find((row) => row.uuid === 'made-up')!;
  const withText = (text: string, more: unknown[] = []) => ({ ...madeUp, message: { ...(madeUp.message as object), content: [{ type: 'text', text }, ...more] } });

  it('is the plugin’s answer, and no other record of the turn', () => {
    expect(rows.filter(isMadeUpFinalAnswer).map((row) => row.uuid)).toEqual(['made-up']);
  });

  // The stream-json frame of the same answer carries no flag, only the hook-made id (doperpowers #415's live MAWS check).
  const { answeredWithoutRequest: _flag, ...unflagged } = madeUp;
  void _flag;

  it('is the same answer as the live wire frames it: a hook-made id, no flag, no request id', () => {
    expect(isMadeUpFinalAnswer(unflagged)).toBe(true);
    expect(isHookMadeMessageId((madeUp.message as { id: string }).id)).toBe(true);
    for (const id of ['msg_01KpStagesB', 'req_011CStagesB', undefined, null, 42]) expect(isHookMadeMessageId(id)).toBe(false);
  });

  it('is not a model that writes the same sentence, another hook’s answer, or the answer with more in it', () => {
    const written: Record<string, unknown> = { ...unflagged, requestId: 'req_011CStagesC', message: { ...(madeUp.message as object), id: 'msg_01KpStagesC' } };
    expect(isMadeUpFinalAnswer(written)).toBe(false);
    expect(isMadeUpFinalAnswer(withText('Sent to the reviewer.'))).toBe(false);
    expect(isMadeUpFinalAnswer(withText('Message sent to the human.', [{ type: 'text', text: 'And more.' }]))).toBe(false);
    expect(isMadeUpFinalAnswer({ ...madeUp, type: 'user' })).toBe(false);
    expect(isMadeUpFinalAnswer(withText('\nMessage sent to the human.\n'))).toBe(true);
  });
});
