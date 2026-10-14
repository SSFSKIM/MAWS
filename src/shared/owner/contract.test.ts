import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  carriesFullContract, CONTRACT_HEADER, FULL_CONTRACT, LEGACY_CONTRACT_1, NATIVE_TO_HUMAN_ENV, STYLE_CONTRACT_KEY, styleShape, SUPPLEMENT_HEADER, TO_HUMAN_CONTRACT, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT,
  TO_HUMAN_SUPPLEMENT_VERSION,
} from './contract';
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

// P2-C2: the owner's answer on Decision Log 31 (2026-10-13, parity with the plugin's style) swapped the one constant.
describe('the full contract: contract 5', () => {
  const words = TO_HUMAN_CONTRACT.split('\n').slice(1).join(' ').split(/\s+/).filter(Boolean);

  it('is contract 5, of the message-tool shape, opening with its header', () => {
    expect(FULL_CONTRACT.version).toBe(5);
    expect(TO_HUMAN_CONTRACT_VERSION).toBe(5);
    expect(FULL_CONTRACT.text).toBe(TO_HUMAN_CONTRACT);
    expect(TO_HUMAN_CONTRACT.startsWith(`${CONTRACT_HEADER(5)}\n\n`)).toBe(true);
    expect(styleShape(FULL_CONTRACT.version)).toBe('message-tool');
  });

  it('names the one mark and MAWS’s ask tool, under 250 words, asks for none of the retired marks, and reads as no mark itself', () => {
    expect(words.length).toBeLessThan(250);
    for (const needle of ['`<message>…</message>`', '`mcp__maws__ask`', '`blocking: false`', '`blocking: true`', 'a user message naming the askId', 'native AskUserQuestion only where', 'never in code', 'your answers included']) {
      expect(TO_HUMAN_CONTRACT).toContain(needle);
    }
    for (const retired of ['need-input', 'insight', 'essential', 'to-human>', 'mcp__doperpowers__']) expect(TO_HUMAN_CONTRACT).not.toContain(retired);
    expect(marksOf(TO_HUMAN_CONTRACT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
    expect(TO_HUMAN_CONTRACT.length).toBeLessThanOrEqual(16_384); // the launch spec's bound
  });

  it('a style declaring exactly contract 5 carries it; no other version does', () => {
    expect(carriesFullContract(5)).toBe(true);
    for (const declared of [1, 2, 3, 4, 6, null]) expect(carriesFullContract(declared)).toBe(false);
  });
});

// P2-C2 (the P2 spec's Decision Log 31)
describe('the shape rule: what a style declaring a contract version carries', () => {
  it.each([
    [1, 'marks'],
    [2, 'marks'],
    [3, 'message-tool'],
    [4, 'message-tool'],
    [17, 'message-tool'], // a later key that keeps the shape needs no MAWS change
    [0, 'none'],
    [null, 'none'],
  ] as const)('%s is %s', (declared, shape) => {
    expect(styleShape(declared)).toBe(shape);
  });
});

describe('the supplement (P2-C2)', () => {
  const words = TO_HUMAN_SUPPLEMENT.split('\n').slice(1).join(' ').split(/\s+/).filter(Boolean);

  it('opens with its own header, beside the contract’s, and is version 1', () => {
    expect(TO_HUMAN_SUPPLEMENT_VERSION).toBe(1);
    expect(SUPPLEMENT_HEADER(1)).toBe('# Messages to the human (MAWS to-human supplement 1)');
    expect(TO_HUMAN_SUPPLEMENT.startsWith(`${SUPPLEMENT_HEADER(1)}\n\n`)).toBe(true);
    expect(TO_HUMAN_SUPPLEMENT.startsWith(CONTRACT_HEADER(1).split('contract')[0]!)).toBe(true); // one family of headers
  });

  it('names the one mark and the ask tool of a MAWS session, under 120 words, and nothing of the retired marks', () => {
    expect(words.length).toBeLessThan(120);
    for (const needle of ['`<message>…</message>`', '`mcp__maws__ask`', '`blocking: false`', '`blocking: true`', '`mcp__doperpowers__AskUserQuestion` is not available here', 'native AskUserQuestion only where', 'never inside code']) {
      expect(TO_HUMAN_SUPPLEMENT).toContain(needle);
    }
    for (const retired of ['need-input', 'insight', 'essential', 'to-human>']) expect(TO_HUMAN_SUPPLEMENT).not.toContain(retired);
  });

  it('quotes its mark in code, so it reads as no mark itself', () => {
    expect(marksOf(TO_HUMAN_SUPPLEMENT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([]);
  });
});
