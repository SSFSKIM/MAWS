import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPATIBLE_CONTRACTS, CONTRACT_HEADER, NATIVE_TO_HUMAN_ENV, STYLE_CONTRACT_KEY, TO_HUMAN_CONTRACT, TO_HUMAN_CONTRACT_VERSION } from './contract';
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

describe('the contract (Design §1)', () => {
  it('is version 1, opens with its header, and is the text the engine recorded in U2', () => {
    expect(TO_HUMAN_CONTRACT_VERSION).toBe(1);
    expect(CONTRACT_HEADER(1)).toBe('# Messages to the human (MAWS to-human contract 1)');
    expect(TO_HUMAN_CONTRACT.startsWith(`${CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION)}\n\n`)).toBe(true);
    const recorded = recordedSegments().filter((segment) => segment.startsWith(CONTRACT_HEADER(1)));
    expect(recorded.length).toBeGreaterThan(0);
    for (const segment of recorded) expect(segment).toBe(TO_HUMAN_CONTRACT);
  });

  it('fits the launch spec’s bound (16 384 characters)', () => {
    expect(TO_HUMAN_CONTRACT.length).toBeLessThanOrEqual(16_384);
  });

  it('reads under grammar 2 as one question, its example; the vocabulary it quotes in code is no mark', () => {
    expect(marksOf(TO_HUMAN_CONTRACT, { messageUuid: 'u' as MessageUuid, blockIndex: 0 })).toEqual([{
      kind: 'need-input', anchor: { messageUuid: 'u', blockIndex: 0, span: 0 }, head: 'Which backend should the board use?',
      choices: [{ text: 'Postgres: already running for the board', recommended: true }, { text: 'SQLite: one file, no daemon', recommended: false }],
    }]);
  });

  it('declares the versions MAWS can present, the style key and the advertisement variable', () => {
    expect(COMPATIBLE_CONTRACTS).toContain(TO_HUMAN_CONTRACT_VERSION);
    expect(STYLE_CONTRACT_KEY).toBe('maws-to-human-contract');
    expect(NATIVE_TO_HUMAN_ENV).toBe('MAWS_NATIVE_TO_HUMAN');
  });
});
