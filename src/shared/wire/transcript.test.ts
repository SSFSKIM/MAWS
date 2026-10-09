import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionId } from '@shared/graph/ids';
import { listTranscripts, loadJournal, loadSyntheticTranscript, loadTranscript, snapshotRecords, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { MemoryFileReader } from '../../../test/support/memory-reader';
import { ChainFollower } from '../../engine-host/fs/chain-follower';
import { deliveryOf } from '../../main/sessions/recent-turns';
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
  const recovered = (window: TranscriptRecord[]) => uuids(withResponseGroups(currentChain(window).chain, window, deliveryOf));
  // the chain the engine host's real follower keeps after reading the same records from a file
  async function followerChain(window: TranscriptRecord[]): Promise<string[]> {
    const follower = new ChainFollower(new MemoryFileReader(window.map((record) => `${JSON.stringify(record)}\n`).join('')), 'S' as SessionId, null, () => {}, { holders: () => 1 });
    await follower.start();
    return follower.snapshot().chain;
  }

  it('the raw walk drops the blocks and results its last result bypasses; the recovery keeps the follower’s chain', async () => {
    const { chain } = currentChain(records);
    expect(uuids(chain)).toEqual(['u1', 'a1', 'a2', 'rB', 'h2', 'h3', 'a3', 'a4', 'a5', 'rB2', 'a7', 's1']);
    expect(recovered(records)).toEqual(FOLLOWER_CHAIN);
    expect(await followerChain(records)).toEqual(FOLLOWER_CHAIN);
  });

  it('a chain that leaves a response before its last record (a fork) recovers nothing of it', async () => {
    const fork = parseTranscriptRecord({ type: 'user', uuid: 'foreign', parentUuid: 'a1', message: { role: 'user', content: 'A second writer prompt.' } });
    const window = [...records.slice(0, 6), fork];
    expect(recovered(window)).toEqual(['u1', 'a1', 'foreign']);
    expect(await followerChain(window)).toEqual(['u1', 'a1', 'foreign']);
  });

  it.each([
    ['a human prompt', { type: 'user', message: { role: 'user', content: 'A second writer prompt.' } }],
    ['another response', { type: 'assistant', message: { role: 'assistant', id: 'different-response', content: [{ type: 'text', text: 'Another response.' }] } }],
  ])('%s written inside the response, on one of its blocks, is a fork: never recovered, and the members before it stay off', async (_, shape) => {
    // between rA and rB: the follower forks to it, then rB's walk takes the chain back through a2 only (h1 and rA stay off)
    const foreign = parseTranscriptRecord({ ...shape, uuid: 'foreign', parentUuid: 'a1' });
    const window = [...records.slice(0, 5), foreign, ...records.slice(5)];
    const expected = FOLLOWER_CHAIN.filter((uuid) => uuid !== 'h1' && uuid !== 'rA');
    expect(await followerChain(window)).toEqual(expected);
    expect(recovered(window)).toEqual(expected);
  });
});

describe('a malformed transcript with a parent cycle never hangs the recovery', () => {
  // a cycle record is not recovered: the replay ends on the chain's leaf and returns the walk as it is
  const recover = (rows: Record<string, unknown>[]) => {
    const window = rows.map((row) => parseTranscriptRecord(row));
    const { chain } = currentChain(window);
    return { walk: uuids(chain), recovered: uuids(withResponseGroups(chain, window, deliveryOf)) };
  };
  const user = (uuid: string, parentUuid: string | null) => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content: 'go' } });
  const progress = (uuid: string, parentUuid: string) => ({ type: 'progress', uuid, parentUuid });

  it('a progress row that is its own parent, under a user record', () => {
    expect(recover([progress('g', 'g'), user('u', 'g')])).toEqual({ walk: ['g', 'u'], recovered: ['g', 'u'] });
  });

  it('two progress rows parented on each other, under a user record', () => {
    expect(recover([progress('g1', 'g2'), progress('g2', 'g1'), user('u', 'g1')])).toEqual({ walk: ['g2', 'g1', 'u'], recovered: ['g2', 'g1', 'u'] });
  });

  it('a two-record cycle through a progress row, between two conversation records, and a record its own parent', () => {
    expect(recover([user('x', 'g'), progress('g', 'x'), user('y', 'g')])).toEqual({ walk: ['x', 'g', 'y'], recovered: ['x', 'g', 'y'] });
    expect(recover([user('a', 'b'), user('b', 'a'), user('c', 'b')])).toEqual({ walk: ['a', 'b', 'c'], recovered: ['a', 'b', 'c'] });
    expect(recover([user('s', 's'), user('t', 's')])).toEqual({ walk: ['s', 't'], recovered: ['s', 't'] });
  });
});
