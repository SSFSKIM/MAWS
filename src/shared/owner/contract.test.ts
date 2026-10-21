import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  carriesFullContract, CONTRACT_HEADER, FULL_CONTRACT, LEGACY_CONTRACT_1, LEGACY_CONTRACT_5, LEGACY_SUPPLEMENT_1, MESSAGE_TOOL_ALIAS, messageToolHookGroup, NATIVE_TO_HUMAN_ENV, PLUGIN_MESSAGE_TOOL, STYLE_CONTRACT_KEY, styleShape, SUPPLEMENT, SUPPLEMENT_HEADER, TO_HUMAN_CONTRACT,
  TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT, TO_HUMAN_SUPPLEMENT_VERSION,
} from './contract';
import { MAWS_MESSAGE_TOOL } from './message-call';
import type { MessageUuid } from '../graph/ids';
import { marksOf } from './marks';


// The engine's record of the system prompt U2 run 6 rendered with the contract appended (S14, a new session): the
// segment is the text the live runs tested (spikes/protocol-probe/findings-pass3-p2-to-human.txt).
const FIXTURE = join(__dirname, '../../../spikes/protocol-probe/fixtures/pass3/p2-to-human-shapes-s14-new.jsonl');
type SnapshotNote = { frame: { event?: string; records?: Record<string, { systemPrompt: string[] }[]> } };
const recordedSegments = (): string[] =>
  readFileSync(FIXTURE, 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line) as SnapshotNote)
    .flatMap((row) => (row.frame.event === 'prompt_snapshot_records' ? Object.values(row.frame.records ?? {}).flat() : []))
    .flatMap((record) => record.systemPrompt);

describe('contract 1 (Design §1), MAWS’s full contract until contract 5', () => {
  it('opens with its header, and is the text the engine recorded in U2', () => {
    expect(LEGACY_CONTRACT_1.version).toBe(1);
    expect(CONTRACT_HEADER(1)).toBe('# Messages to the human (MAWS to-human contract 1)');
    expect(LEGACY_CONTRACT_1.text.startsWith(`${CONTRACT_HEADER(1)}\n\n`)).toBe(true);
    const recorded = recordedSegments().filter((segment) => segment.startsWith(CONTRACT_HEADER(1)));
    expect(recorded.length).toBeGreaterThan(0);
    for (const segment of recorded) expect(segment).toBe(LEGACY_CONTRACT_1.text);
  });

  it('reads under grammar 2 as one question, its example; the vocabulary it quotes in code is no mark', () => {
    expect(marksOf(LEGACY_CONTRACT_1.text, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([{
      kind: 'need-input', anchor: { messageUuid: 'u', blockIndex: 0, span: 0 }, head: 'Which backend should the board use?',
      choices: [{ text: 'Postgres: already running for the board', recommended: true }, { text: 'SQLite: one file, no daemon', recommended: false }],
    }]);
  });

  it('declares the style key and the advertisement variable', () => {
    expect(STYLE_CONTRACT_KEY).toBe('maws-to-human-contract');
    expect(NATIVE_TO_HUMAN_ENV).toBe('MAWS_NATIVE_TO_HUMAN');
  });
});

const wordsOf = (text: string) => text.split('\n').slice(1).join(' ').split(/\s+/).filter(Boolean);
// The message rule as both texts that state it word it (P4-R7): the tool, when, and the reason the model can carry.
const MESSAGE_RULE = ['A message you send before another tool call goes through `mcp__maws__message` (its `text` the message, in Markdown), called in the same response as that tool call', 'written as text there, it comes back as a paraphrase that never reaches them'];

// P4-R7 (the P4 spec's Decision Log 46): contract 5 with the message tool, MAWS's full contract from now on.
describe('the full contract: contract 7', () => {
  it('is contract 7, of the message-tool shape, opening with its header', () => {
    expect(FULL_CONTRACT.version).toBe(7);
    expect(TO_HUMAN_CONTRACT_VERSION).toBe(7);
    expect(FULL_CONTRACT.text).toBe(TO_HUMAN_CONTRACT);
    expect(TO_HUMAN_CONTRACT.startsWith(`${CONTRACT_HEADER(7)}\n\n`)).toBe(true);
    expect(styleShape(FULL_CONTRACT.version)).toBe('message-tool');
  });

  it('states the message rule beside the one mark and MAWS’s ask tool, under 320 words, and reads as no mark itself', () => {
    expect(wordsOf(TO_HUMAN_CONTRACT).length).toBeLessThan(320); // contract 5 was 249; the rule adds its paragraph
    for (const needle of [...MESSAGE_RULE, 'Every other message goes inside `<message>…</message>`', 'Where `mcp__maws__message` is missing, a span is the only form', '`mcp__maws__ask`', '`blocking: false`', '`blocking: true`', 'a user message naming the askId', 'native AskUserQuestion only where', 'never in code', 'your answers included']) {
      expect(TO_HUMAN_CONTRACT).toContain(needle);
    }
    for (const retired of ['need-input', 'insight', 'essential', 'to-human>', 'mcp__doperpowers__', 'mcp__sminos__', PLUGIN_MESSAGE_TOOL]) expect(TO_HUMAN_CONTRACT).not.toContain(retired);
    expect(marksOf(TO_HUMAN_CONTRACT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
    expect(TO_HUMAN_CONTRACT.length).toBeLessThanOrEqual(16_384); // the launch spec's bound
    expect(TO_HUMAN_CONTRACT).toContain(`\`${MAWS_MESSAGE_TOOL}\``); // the readers' name for it
  });

  it('keeps contract 5’s other paragraphs word for word', () => {
    const tail = (text: string) => text.split('\n\n').slice(2).join('\n\n');
    expect(tail(TO_HUMAN_CONTRACT)).toBe(tail(LEGACY_CONTRACT_5.text));
  });

  it('a style declaring exactly contract 7 carries it; no other version does, 5 included', () => {
    expect(carriesFullContract(7)).toBe(true);
    for (const declared of [1, 2, 3, 4, 5, 6, 8, null]) expect(carriesFullContract(declared)).toBe(false);
  });
});

// Contract 5 (P2-C2), MAWS's full contract until P4-R7: what sessions recorded under it carry.
describe('contract 5, recorded by sessions launched before contract 7', () => {
  it('opens with its header and names no message tool', () => {
    expect(LEGACY_CONTRACT_5.version).toBe(5);
    expect(LEGACY_CONTRACT_5.text.startsWith(`${CONTRACT_HEADER(5)}\n\n`)).toBe(true);
    expect(LEGACY_CONTRACT_5.text).toContain('goes inside `<message>…</message>`, one message per span, wherever written');
    expect(LEGACY_CONTRACT_5.text).not.toContain('mcp__maws__message');
    expect(wordsOf(LEGACY_CONTRACT_5.text).length).toBe(249);
  });
});

// P2-C2 (the P2 spec's Decision Log 31). P4-R7 adds no boundary: the plugin's 6, which states the message rule, keeps
// the shape of its 3 and 4, which do not, and supplement 2 states the rule beside either (the architect, 2026-10-21).
describe('the shape rule: what a style declaring a contract version carries', () => {
  it.each([
    [1, 'marks'],
    [2, 'marks'],
    [3, 'message-tool'],
    [4, 'message-tool'], // the owner's style today
    [5, 'message-tool'], // MAWS's full contract before 7
    [6, 'message-tool'], // the plugin's style with its message tool
    [7, 'message-tool'], // MAWS's full contract
    [17, 'message-tool'], // a later key that keeps the shape needs no MAWS change
    [0, 'none'],
    [2.5, 'none'],
    [null, 'none'],
  ] as const)('%s is %s', (declared, shape) => {
    expect(styleShape(declared)).toBe(shape);
  });
});

describe('the supplement: supplement 2 (P4-R7)', () => {
  it('opens with its own header, beside the contract’s, and is version 2', () => {
    expect(TO_HUMAN_SUPPLEMENT_VERSION).toBe(2);
    expect(SUPPLEMENT.text).toBe(TO_HUMAN_SUPPLEMENT);
    expect(SUPPLEMENT_HEADER(2)).toBe('# Messages to the human (MAWS to-human supplement 2)');
    expect(TO_HUMAN_SUPPLEMENT.startsWith(`${SUPPLEMENT_HEADER(2)}\n\n`)).toBe(true);
    expect(TO_HUMAN_SUPPLEMENT.startsWith(CONTRACT_HEADER(1).split('contract')[0]!)).toBe(true); // one family of headers
  });

  // It goes beside a style of 3 or 4, which says nothing of a message tool, and one of 6, which names the plugin's.
  it('states the message rule, names MAWS’s tools and says the plugin’s message tool is not here, under 170 words', () => {
    expect(wordsOf(TO_HUMAN_SUPPLEMENT).length).toBeLessThan(170);
    for (const needle of [...MESSAGE_RULE, 'Every other message goes inside `<message>…</message>`, the one mark here too', `\`${PLUGIN_MESSAGE_TOOL}\` is not available here`, '`mcp__maws__ask`', '`blocking: false`', '`blocking: true`', 'Neither `mcp__sminos__AskUserQuestion` nor `mcp__doperpowers__AskUserQuestion` is available here', 'native AskUserQuestion only where', 'never inside code', 'your answers included']) {
      expect(TO_HUMAN_SUPPLEMENT).toContain(needle);
    }
    for (const retired of ['need-input', 'insight', 'essential', 'to-human>']) expect(TO_HUMAN_SUPPLEMENT).not.toContain(retired);
  });

  it('quotes its mark in code, so it reads as no mark itself', () => {
    expect(marksOf(TO_HUMAN_SUPPLEMENT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
  });
});

// P4-R7y (the owner's ask of 2026-10-21): the context a lane-on session's SessionStart hook gives at every start.
describe('the SessionStart context and its hook (P4-R7y)', () => {
  it('says the plugin’s message tool is MAWS’s here, to call MAWS’s wherever instructions name the plugin’s, and that the input is the same', () => {
    expect(MESSAGE_TOOL_ALIAS).toContain(`\`${PLUGIN_MESSAGE_TOOL}\` is the \`${MAWS_MESSAGE_TOOL}\` tool`);
    expect(MESSAGE_TOOL_ALIAS).toContain(`wherever your instructions name \`${PLUGIN_MESSAGE_TOOL}\`, call \`${MAWS_MESSAGE_TOOL}\``);
    expect(MESSAGE_TOOL_ALIAS).toContain('same input');
    // supplement 2 names the same two tools: the plugin's not available here, MAWS's the one to message through
    for (const tool of [PLUGIN_MESSAGE_TOOL, MAWS_MESSAGE_TOOL]) expect(TO_HUMAN_SUPPLEMENT).toContain(`\`${tool}\``);
  });

  it('is what the hook prints, run as the engine runs an exec-form hook (no shell): the SessionStart answer, for every source', () => {
    const group = messageToolHookGroup();
    expect(group).not.toHaveProperty('matcher');
    expect(group.hooks).toHaveLength(1);
    const [hook] = group.hooks;
    expect(hook!.type).toBe('command');
    expect(JSON.parse(execFileSync(hook!.command, hook!.args, { encoding: 'utf8', env: {} }))).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: MESSAGE_TOOL_ALIAS } });
  });
});

// Supplement 1 (P2-C2), what sessions launched beside a message-tool style before P4-R7 recorded.
describe('supplement 1, recorded by sessions launched before supplement 2', () => {
  it('opens with its header and names the ask tool and no message tool', () => {
    expect(LEGACY_SUPPLEMENT_1.version).toBe(1);
    expect(LEGACY_SUPPLEMENT_1.text.startsWith(`${SUPPLEMENT_HEADER(1)}\n\n`)).toBe(true);
    expect(LEGACY_SUPPLEMENT_1.text).toContain('`mcp__maws__ask`');
    expect(LEGACY_SUPPLEMENT_1.text).not.toContain('mcp__maws__message');
  });
});
