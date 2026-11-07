// P5 O8 M7b (the architect's condition, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Decision Log "M7b's
// refresh at its cut", item 4): the one extraction of what a session said to its human, which the transcript's
// `to_human` row and the spine's project-channel journal both read.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { markIdOf, marksOf } from './marks';
import { MAWS_MESSAGE_TOOL, PLUGIN_MESSAGE_TOOL } from './message-call';
import { finishedTextOf, messageOfCall, toHumanOfText } from './to-human-items';

describe('toHumanOfText', () => {
  it('reads each message span and each question, in the text’s order; essentials, insights and plain words are neither', () => {
    const text = [
      'Working notes.',
      '<message>The build is green.</message>',
      '<essential>Read this.</essential>',
      '<need-input>Which backend?\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>',
      '<insight>A choice.</insight>',
      '<to-human>Legacy spelling.</to-human>',
    ].join('\n');
    expect(toHumanOfText(text)).toEqual([
      { kind: 'message', text: 'The build is green.', span: 0 },
      { kind: 'question', text: 'Which backend?', head: 'Which backend?', choices: [{ text: 'Postgres', recommended: true }, { text: 'SQLite', recommended: false }], span: 0 },
      { kind: 'message', text: 'Legacy spelling.', span: 1 },
    ]);
  });

  it('numbers its questions as the owner channel’s marks do, so a question’s mark id names it', () => {
    const text = '<essential>e</essential><need-input>First?</need-input><message>m</message><need-input>Second?</need-input>';
    const questions = toHumanOfText(text).filter((item) => item.kind === 'question');
    const marks = marksOf(text, { messageUuid: 'u' as never, blockIndex: 2 }).filter((mark) => mark.kind === 'need-input');
    expect(questions.map((q) => markIdOf('s' as never, 'need-input', { messageUuid: 'u' as never, blockIndex: 2, span: q.span }))).toEqual(
      marks.map((mark) => markIdOf('s' as never, 'need-input', mark.anchor)),
    );
    expect(questions.map((q) => q.head)).toEqual(marks.map((mark) => mark.head));
  });

  it('a message holding a question reads as the report draws it: the message, the question, the rest of the message', () => {
    expect(toHumanOfText('<message>Before. <need-input>Go?</need-input> After.</message>').map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'message', text: 'Before.' },
      { kind: 'question', text: 'Go?' },
      { kind: 'message', text: 'After.' },
    ]);
  });

  it('a question of choices alone is still a question; marks quoted in code and unbalanced marks are none', () => {
    expect(toHumanOfText('<need-input><choice>Yes</choice><choice>No</choice></need-input>')).toEqual([
      { kind: 'question', text: '', head: '', choices: [{ text: 'Yes', recommended: false }, { text: 'No', recommended: false }], span: 0 },
    ]);
    expect(toHumanOfText('Quote `<message>x</message>` and <message>open')).toEqual([]);
  });
});

describe('messageOfCall', () => {
  it('reads either message tool’s call as its whole text, pending until its result, sent once it is no error, refused once it is', () => {
    for (const toolName of [PLUGIN_MESSAGE_TOOL, MAWS_MESSAGE_TOOL]) {
      const use = { toolName, input: { text: 'Stage 1 is done.', final: false } };
      expect(messageOfCall(use, null)).toEqual({ text: 'Stage 1 is done.', state: 'pending' });
      expect(messageOfCall(use, { isError: false })).toEqual({ text: 'Stage 1 is done.', state: 'sent' });
      expect(messageOfCall(use, { isError: true })).toEqual({ text: 'Stage 1 is done.', state: 'refused' });
    }
  });

  it('is null for another tool’s call, and for a message tool’s call with no words', () => {
    expect(messageOfCall({ toolName: 'Bash', input: { text: 'ls' } }, { isError: false })).toBeNull();
    expect(messageOfCall({ toolName: PLUGIN_MESSAGE_TOOL, input: { text: '  ' } }, { isError: false })).toBeNull();
  });
});

describe('finishedTextOf', () => {
  const base = { id: 'e1', sessionId: 's', at: '2026-11-06T10:00:00.000Z', seq: 4, agentId: null, parentToolUseId: null };
  const complete = (over: Record<string, unknown> = {}) =>
    ({ ...base, kind: 'assistant.block.complete', messageUuid: 'u1', apiMessageId: 'a1', blockIndex: 1, block: { type: 'text', text: '<message>hi</message>' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [], ...over }) as unknown as SessionEvent;

  it('is a main-thread text block’s text and anchor, with whether an interrupt cut it', () => {
    expect(finishedTextOf(complete())).toEqual({ text: '<message>hi</message>', messageUuid: 'u1', blockIndex: 1, aborted: false });
    expect(finishedTextOf(complete({ aborted: true }))).toMatchObject({ aborted: true });
  });

  it('is null for a subagent’s block, a block that is no text, the engine’s API-error message, and every other event', () => {
    expect(finishedTextOf(complete({ parentToolUseId: 'toolu_1' }))).toBeNull();
    expect(finishedTextOf(complete({ block: { type: 'thinking', thinking: 'x' } }))).toBeNull();
    expect(finishedTextOf(complete({ isApiErrorMessage: true }))).toBeNull();
    expect(finishedTextOf({ ...base, kind: 'session.state', state: 'idle' } as unknown as SessionEvent)).toBeNull();
  });
});
