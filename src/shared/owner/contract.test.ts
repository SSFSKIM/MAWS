import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  carriesPluginMessageTool, CONTRACT_HEADER, LEGACY_CONTRACT_1, LEGACY_CONTRACT_5, LEGACY_CONTRACT_7, LEGACY_MESSAGE_TOOL_ALIAS, LEGACY_SUPPLEMENT_1, LEGACY_SUPPLEMENT_2, NATIVE_TO_HUMAN_ENV, PLUGIN_MESSAGE_TOOL_FROM,
  STYLE_CONTRACT_KEY, styleShape, SUPPLEMENT, SUPPLEMENT_HEADER, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT, TO_HUMAN_SUPPLEMENT_VERSION,
} from './contract';
import { MAWS_MESSAGE_TOOL, PLUGIN_MESSAGE_TOOL } from './message-call';
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
// The message rule as both of P4-R7's texts word it: the tool, when, and the reason the model can carry.
const MESSAGE_RULE = ['A message you send before another tool call goes through `mcp__maws__message` (its `text` the message, in Markdown), called in the same response as that tool call', 'written as text there, it comes back as a paraphrase that never reaches them'];

// P4-R7z (the P4 spec's Decision Log 92): MAWS has no full contract of its own; the plugin's style carries the rule.
describe('MAWS’s contract version: 8, no text of its own', () => {
  it('advertises 8, MAWS offering no message tool, above the plugin’s 6 and MAWS’s former 7', () => {
    expect(TO_HUMAN_CONTRACT_VERSION).toBe(8);
    expect(TO_HUMAN_CONTRACT_VERSION).toBeGreaterThan(LEGACY_CONTRACT_7.version);
  });

  it('a style carries the lane from the plugin’s 6 on, every later declaration of its shape too; no earlier one, and no marks style', () => {
    expect(PLUGIN_MESSAGE_TOOL_FROM).toBe(6);
    for (const declared of [6, 7, 8, 17]) expect(carriesPluginMessageTool(declared)).toBe(true);
    for (const declared of [1, 2, 3, 4, 5, 0, 6.5, null]) expect(carriesPluginMessageTool(declared)).toBe(false);
  });
});

// Contract 7 (P4-R7), MAWS's full contract until P4-R7z: what sessions recorded under it carry.
describe('contract 7, recorded by sessions launched before P4-R7z', () => {
  it('opens with its header, states the message rule through MAWS’s former tool, and reads as no mark itself', () => {
    expect(LEGACY_CONTRACT_7.version).toBe(7);
    expect(LEGACY_CONTRACT_7.text.startsWith(`${CONTRACT_HEADER(7)}\n\n`)).toBe(true);
    for (const needle of [...MESSAGE_RULE, 'Every other message goes inside `<message>…</message>`', 'Where `mcp__maws__message` is missing, a span is the only form', '`mcp__maws__ask`']) expect(LEGACY_CONTRACT_7.text).toContain(needle);
    expect(LEGACY_CONTRACT_7.text).toContain(`\`${MAWS_MESSAGE_TOOL}\``); // the readers still read its calls
    expect(marksOf(LEGACY_CONTRACT_7.text, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
  });

  it('keeps contract 5’s other paragraphs word for word', () => {
    const tail = (text: string) => text.split('\n\n').slice(2).join('\n\n');
    expect(tail(LEGACY_CONTRACT_7.text)).toBe(tail(LEGACY_CONTRACT_5.text));
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

// P2-C2 (the P2 spec's Decision Log 31). P4-R7z draws its boundary inside the shape (`carriesPluginMessageTool`).
describe('the shape rule: what a style declaring a contract version carries', () => {
  it.each([
    [1, 'marks'],
    [2, 'marks'],
    [3, 'message-tool'],
    [4, 'message-tool'],
    [5, 'message-tool'], // MAWS's full contract before 7
    [6, 'message-tool'], // the plugin's style with its message tool, the owner's style today
    [7, 'message-tool'], // MAWS's full contract until P4-R7z
    [17, 'message-tool'], // a later key that keeps the shape needs no MAWS change
    [0, 'none'],
    [2.5, 'none'],
    [null, 'none'],
  ] as const)('%s is %s', (declared, shape) => {
    expect(styleShape(declared)).toBe(shape);
  });
});

describe('the supplement: supplement 3 (P4-R7z)', () => {
  it('opens with its own header, beside the contract’s, and is version 3', () => {
    expect(TO_HUMAN_SUPPLEMENT_VERSION).toBe(3);
    expect(SUPPLEMENT.text).toBe(TO_HUMAN_SUPPLEMENT);
    expect(SUPPLEMENT_HEADER(3)).toBe('# Messages to the human (MAWS to-human supplement 3)');
    expect(TO_HUMAN_SUPPLEMENT.startsWith(`${SUPPLEMENT_HEADER(3)}\n\n`)).toBe(true);
    expect(TO_HUMAN_SUPPLEMENT.startsWith(CONTRACT_HEADER(1).split('contract')[0]!)).toBe(true); // one family of headers
  });

  // The plugin's style carries the message rule; MAWS says only what it owns, its ask tool in place of the style's.
  it('names MAWS’s ask tool in place of the style’s, and says nothing of messages, under 80 words', () => {
    expect(wordsOf(TO_HUMAN_SUPPLEMENT).length).toBeLessThan(80);
    for (const needle of ['This session runs in MAWS.', '`mcp__maws__ask`', '`blocking: false`', '`blocking: true`', 'a user message naming the askId', 'Neither `mcp__sminos__AskUserQuestion` nor `mcp__doperpowers__AskUserQuestion` is available here', 'native AskUserQuestion only where']) {
      expect(TO_HUMAN_SUPPLEMENT).toContain(needle);
    }
    for (const withdrawn of [MAWS_MESSAGE_TOOL, PLUGIN_MESSAGE_TOOL, '<message>', 'final', 'not available here.', 'report', 'mark']) expect(TO_HUMAN_SUPPLEMENT).not.toContain(withdrawn);
    expect(marksOf(TO_HUMAN_SUPPLEMENT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
  });
});

// Supplement 2 (P4-R7), what sessions launched beside a message-tool style before P4-R7z recorded.
describe('supplement 2, recorded by sessions launched before supplement 3', () => {
  it('opens with its header, states the message rule, names MAWS’s former tool and says the plugin’s was not there', () => {
    expect(LEGACY_SUPPLEMENT_2.version).toBe(2);
    expect(LEGACY_SUPPLEMENT_2.text.startsWith(`${SUPPLEMENT_HEADER(2)}\n\n`)).toBe(true);
    for (const needle of [...MESSAGE_RULE, `\`${PLUGIN_MESSAGE_TOOL}\` is not available here`, '`mcp__maws__ask`', 'never inside code']) expect(LEGACY_SUPPLEMENT_2.text).toContain(needle);
  });
});

// P4-R7y's alias, withdrawn: the text its hook gave, which the prompt-state reader still recognises.
describe('P4-R7y’s alias, recorded by sessions launched before P4-R7z', () => {
  it('said the plugin’s message tool was MAWS’s there', () => {
    expect(LEGACY_MESSAGE_TOOL_ALIAS).toContain(`\`${PLUGIN_MESSAGE_TOOL}\` is the \`${MAWS_MESSAGE_TOOL}\` tool`);
    expect(TO_HUMAN_SUPPLEMENT).not.toContain(LEGACY_MESSAGE_TOOL_ALIAS);
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
