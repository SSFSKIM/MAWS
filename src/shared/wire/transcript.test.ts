import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listTranscripts, loadJournal, loadSyntheticTranscript, loadTranscript, snapshotRecords, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { AgentMetaSchema, currentChain, LastPromptAnchorSchema, parseTranscriptRecord, withResponseGroups, type TranscriptRecord } from './transcript';

const uuids = (records: TranscriptRecord[]) => records.map((r) => r.uuid);

describe('transcript records chain from the leaf', () => {
  it('parses every sidecar and workflow-disk JSONL record', () => {
    const files = listTranscripts();
    expect(files).toEqual([
      'subagent-sidecars/agent-ad286defbc77bc090.jsonl',
      'subagent-sidecars/agent-ae75ba6ce5d866acc.jsonl',
      'pass2/workflow-disk/journal.jsonl',
    ]);
    for (const file of files) {
      const records = loadTranscript(file);
      expect(records.length, file).toBeGreaterThan(0);
      for (const record of records) expect(typeof record.type).toBe('string');
    }
    const sidecar = loadTranscript('subagent-sidecars/agent-ad286defbc77bc090.jsonl');
    expect(sidecar[0]?.isSidechain).toBe(true);
    expect(sidecar[0]?.agentId).toBe('ad286defbc77bc090');
    const chain = currentChain(sidecar);
    expect(chain.gap).toBeNull();
    expect(chain.chain[0]?.parentUuid).toBeNull();
    expect(chain.leaf?.uuid).toBe(sidecar.filter((r) => typeof r.uuid === 'string').at(-1)?.uuid);
  });

  it('parses the records of the three pass-2 rewind snapshots', () => {
    const rows = loadJournal('pass2', 'rewind');
    for (const label of ['before', 'after-rewind', 'after-next-turn']) {
      const records = snapshotRecords(rows, label);
      expect(records.length, label).toBeGreaterThan(0);
      for (const record of records) expect(parseTranscriptRecord(record)).toEqual(record);
    }
    expect(() => snapshotRecords(rows, 'nope')).toThrow(/jsonl_snapshot/);
  });

  it('follows uuid/parentUuid from the leaf and excludes the abandoned branch and the anchors', () => {
    const records = loadSyntheticTranscript('transcript-rewind');
    expect(records).toHaveLength(10);
    const result = currentChain(records);
    expect(uuids(result.chain)).toEqual(['u1', 'a1', 'u3', 'a3']);
    expect(result.leaf?.uuid).toBe('a3');
    expect(result.gap).toBeNull();
    const anchors = records.filter((r) => r.type === 'last-prompt').map((r) => LastPromptAnchorSchema.parse(r));
    expect(anchors).toHaveLength(2);
    expect(anchors[0].rewound).toBeUndefined();
    expect(anchors[0].lastPrompt).toBe('Also remember BANANA.');
    // The rewound anchor carries the prompt that was rewound away (the rewind response's prefillText) and names the
    // assistant record preceding the rewind point; `explicit` and `sessionId` ride the index signature.
    expect(anchors[1].rewound).toBe(true);
    expect(anchors[1].lastPrompt).toBe('Also remember BANANA.');
    expect(anchors[1].leafUuid).toBe('a1');
    expect(anchors[1].explicit).toBe(true);
    expect(anchors[1].sessionId).toBe('S');
  });

  it('stops at a missing parent and reports the gap instead of bridging it', () => {
    const records = loadSyntheticTranscript('transcript-rewind').filter((r) => r.uuid !== 'a1');
    const result = currentChain(records);
    expect(uuids(result.chain)).toEqual(['u3', 'a3']);
    expect(result.leaf?.uuid).toBe('a3');
    expect(result.gap).toEqual({ parentUuid: 'a1', childUuid: 'u3' });
  });

  it('reports the parent the filtered after-next-turn snapshot dropped', () => {
    const records = snapshotRecords(loadJournal('pass2', 'rewind'), 'after-next-turn');
    const result = currentChain(records);
    expect(result.gap).toEqual({
      parentUuid: 'af765f44-46a0-45e9-acdc-c6fa44c05d80',
      childUuid: 'a4d68c72-bdde-4afa-bc32-408c9dac42e6',
    });
    expect(uuids(result.chain)).toEqual(['a4d68c72-bdde-4afa-bc32-408c9dac42e6', '7c05f769-39b6-4a06-a028-9c9c38d7f898']);
    expect(result.leaf?.uuid).toBe('7c05f769-39b6-4a06-a028-9c9c38d7f898');
  });

  it('handles empty input, a leaf-only file and a parent cycle', () => {
    expect(currentChain([])).toEqual({ chain: [], leaf: null, gap: null });
    expect(currentChain([{ type: 'last-prompt', lastPrompt: 'x' }])).toEqual({ chain: [], leaf: null, gap: null });
    const cycle: TranscriptRecord[] = [
      { type: 'user', uuid: 'a', parentUuid: 'b' },
      { type: 'assistant', uuid: 'b', parentUuid: 'a' },
    ];
    const result = currentChain(cycle);
    expect(result.leaf?.uuid).toBe('b');
    expect(uuids(result.chain)).toEqual(['a', 'b']);
    expect(result.gap).toEqual({ parentUuid: 'b', childUuid: 'a' });
  });

  it('accepts loose records with only a type and rejects the rest', () => {
    expect(parseTranscriptRecord({ type: 'file-history-snapshot', messageId: 'a1', snapshot: {} })).toEqual({ type: 'file-history-snapshot', messageId: 'a1', snapshot: {} });
    expect(() => parseTranscriptRecord({ uuid: 'u1' })).toThrow(z.ZodError);
    expect(() => parseTranscriptRecord({ type: 'user', uuid: 5 })).toThrow(z.ZodError);
    expect(() => parseTranscriptRecord('user')).toThrow(z.ZodError);
    expect(LastPromptAnchorSchema.safeParse({ type: 'last-prompt' }).success).toBe(false);
    expect(LastPromptAnchorSchema.safeParse({ type: 'user', lastPrompt: 'x' }).success).toBe(false);
  });

  it('parses the sidecar agent meta', () => {
    const meta = AgentMetaSchema.parse({ agentType: 'general-purpose', description: 'Read and report one.txt content', toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB', spawnDepth: 1, requestShape: 'background', requestNonInteractive: true, model: 'haiku' });
    expect(meta.spawnDepth).toBe(1);
    expect(AgentMetaSchema.safeParse({ agentType: 'x', description: 'y' }).success).toBe(false);
  });
});

describe('a parallel response regains its siblings', () => {
  // the chain follower's FX6 fixture and the chain it keeps (chain-follower.test.ts, PARALLEL_CHAIN)
  const records = readFileSync(join(TEST_FIXTURE_DIR, 'transcript-parallel-tool-group.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => parseTranscriptRecord(JSON.parse(line)));
  const FOLLOWER_CHAIN = ['u1', 'a1', 'a2', 'h1', 'rA', 'rB', 'h2', 'h3', 'a3', 'a4', 'a5', 'a6', 'rC', 'rA2', 'rB2', 'a7', 's1'];

  it('the raw walk drops the blocks and results its last result bypasses; the recovery keeps the follower’s chain', () => {
    const { chain } = currentChain(records);
    expect(uuids(chain)).toEqual(['u1', 'a1', 'a2', 'rB', 'h2', 'h3', 'a3', 'a4', 'a5', 'rB2', 'a7', 's1']);
    expect(uuids(withResponseGroups(chain, records))).toEqual(FOLLOWER_CHAIN);
  });

  it('a chain that leaves a response before its last record (a fork) recovers nothing of it', () => {
    const fork = parseTranscriptRecord({ type: 'user', uuid: 'foreign', parentUuid: 'a1', message: { role: 'user', content: 'A second writer prompt.' } });
    const window = [...records.slice(0, 6), fork];
    expect(uuids(withResponseGroups(currentChain(window).chain, window))).toEqual(['u1', 'a1', 'foreign']);
  });
});
