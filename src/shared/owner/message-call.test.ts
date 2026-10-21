// P4-R7: a message tool's call read as a to-human message: MAWS's own tool, and only it (the owner's ruling of
// 2026-10-21: the to-human plugin's is someone else's tool in MAWS).
import { describe, expect, it } from 'vitest';
import { MAWS_SERVER_NAME } from '../maws/tools';
import { MESSAGE_TOOL_NAMES } from '../maws/message-tool';
import { isMessageTool, MAWS_MESSAGE_TOOL, MESSAGE_TOOLS, messageCallState, messageCallText } from './message-call';

describe('the message tools', () => {
  it('reads MAWS’s name, and no other tool, as a message tool: the to-human plugin’s of the same shape neither', () => {
    expect(MESSAGE_TOOLS).toEqual(['mcp__maws__message']);
    expect(isMessageTool(MAWS_MESSAGE_TOOL)).toBe(true);
    for (const other of ['mcp__to-human__message', 'message', 'mcp__maws__ask', 'mcp__doperpowers__message', 'SendMessage', 'mcp__to-human__AskUserQuestion', undefined, null, 42]) expect(isMessageTool(other)).toBe(false);
  });

  // The renderer and main read the name the engine gives the server's tool; a rename on the server's side would leave
  // every reader looking for a tool the model no longer calls.
  it('MAWS’s name is the one the engine gives the `maws` server’s message tool', () => {
    expect(MESSAGE_TOOL_NAMES.map((name) => `mcp__${MAWS_SERVER_NAME}__${name}`)).toEqual([MAWS_MESSAGE_TOOL]);
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
