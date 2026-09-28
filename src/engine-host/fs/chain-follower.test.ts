import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { currentChain } from '@shared/wire/transcript';
import { loadSyntheticTranscript, loadTranscriptFixture, TEST_FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { MemoryFileReader } from '../../../test/support/memory-reader';
import { ChainFollower, type FollowerEvent } from './chain-follower';

const SESSION = 'bdb23713-2f6c-40f3-8b18-b41a667a64e3' as SessionId;

const linesOf = (file: string) => readFileSync(file, 'latin1').split('\n').filter((line) => line.length > 0);
const REWIND_LINES = linesOf(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-real.jsonl'));
const joined = (lines: string[]) => Buffer.from(lines.map((l) => l + '\n').join(''), 'latin1');
const short = (uuid: string | null) => uuid?.slice(0, 8) ?? null;
const at = (n: number) => `2026-09-28T10:00:${String(n).padStart(2, '0')}.000Z`;
const line = (record: object) => JSON.stringify(record);

function fullUuid(prefix: string): string {
  const record = loadTranscriptFixture('rewind-real').find((r) => typeof r.uuid === 'string' && r.uuid.startsWith(prefix));
  if (!record?.uuid) throw new Error(`no record with uuid prefix ${prefix}`);
  return record.uuid;
}

class Collector {
  readonly received: FollowerEvent[] = [];
  readonly sink = (e: FollowerEvent) => {
    this.received.push(e);
  };
  events(): SessionEvent[] {
    return this.received.flatMap((e) => (e.t === 'events' ? e.events : []));
  }
  states(): string[] {
    return this.received.flatMap((e) => (e.t === 'state' ? [e.state] : []));
  }
  facts(): Record<string, unknown> {
    return Object.assign({}, ...this.received.flatMap((e) => (e.t === 'facts' ? [e.facts] : [])));
  }
  of<K extends SessionEvent['kind']>(kind: K): Extract<SessionEvent, { kind: K }>[] {
    return this.events().filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
  }
  batchSizes(): number[] {
    return this.received.flatMap((e) => (e.t === 'events' ? [e.events.length] : []));
  }
}

function expectWellFormed(events: SessionEvent[]): void {
  const ids = new Set<string>();
  for (const event of events) {
    expect(SessionEventSchema.parse(event)).toEqual(event);
    expect(event.seq).toBeNull();
    expect(ids.has(event.id), `duplicate event id ${event.id}`).toBe(false);
    ids.add(event.id);
  }
}

async function started(bytes: Buffer, sessionId: SessionId = SESSION): Promise<{ reader: MemoryFileReader; follower: ChainFollower; out: Collector }> {
  const reader = new MemoryFileReader(bytes);
  const out = new Collector();
  const follower = new ChainFollower(reader, sessionId, null, out.sink);
  await follower.start();
  return { reader, follower, out };
}

const FULL_CHAIN = ['e3b48834', '030c4331', '6a832db5', 'a7225f9b', '73dad25d', '521cf9e3', '24b7be38', 'ae68c39d', '075fef0b', '1c54a876', '7b176449', 'edf0f954', 'af765f44', 'a4d68c72', '7c05f769'];
const CUT_CHAIN = FULL_CHAIN.slice(0, 12); // … edf0f954

describe('follows the leaf across a rewind', () => {
  it('fed whole, rewind-real yields the rewound chain and exactly one boundary.rewind', async () => {
    const { follower, out } = await started(joined(REWIND_LINES));
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(FULL_CHAIN);
    expect(short(state.leaf)).toBe('7c05f769');
    expect(state.gap).toBeNull();
    expect(state.rewind).toBeNull();
    expect(state.skippedLines).toBe(0);
    expect(state.skeletons.size).toBe(17); // every uuid-bearing record, the abandoned branch included
    expect(out.states()).toEqual(['backfilling', 'following']);
    const rewinds = out.of('boundary.rewind');
    expect(rewinds).toHaveLength(1);
    expect(short(rewinds[0].precedingAssistantUuid)).toBe('edf0f954');
    expect(short(rewinds[0].targetMessageUuid)).toBe('36a2aa44');
    expect(rewinds[0].prefillText).toBe('Also remember the word BANANA. Reply OK.');
    expect(rewinds[0].id).toMatch(/^anchor:\d+$/);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expect(out.of('frame.unknown')).toEqual([]);
    expect(out.of('session.started')[0]).toMatchObject({ cwd: '/private/tmp/maws-probe2-FIiJVW', engineVersion: '2.1.283' });
    // The abandoned branch's events were delivered before the anchor, then cut: three user messages in file order.
    expect(out.of('user.message').map((e) => short(e.messageUuid))).toEqual(['e3b48834', '36a2aa44', 'a4d68c72']);
    expect(out.of('assistant.block.complete').map((e) => short(e.messageUuid))).toEqual(['edf0f954', '57525d04', '7c05f769']);
    expectWellFormed(out.events());
    expect(follower.materialized()).toEqual(out.events());
    expect(out.facts()).toMatchObject({ aiTitle: 'Remembering the word APPLE', gitBranch: 'master', engineVersion: '2.1.283', leafUuid: fullUuid('7c05f769') });
  });

  it('fed in two steps split after the rewound anchor, cuts at step one and rejoins silently at step two', async () => {
    const { reader, follower, out } = await started(joined(REWIND_LINES.slice(0, 27)));
    let state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(CUT_CHAIN);
    expect(short(state.leaf)).toBe('edf0f954');
    expect(state.rewind?.phase).toBe('announced');
    expect(state.rewind && short(state.rewind.leafUuid)).toBe('edf0f954');
    expect(state.rewind?.phase === 'announced' && short(state.rewind.targetMessageUuid)).toBe('36a2aa44');
    for (const removed of ['af765f44', '36a2aa44', '57525d04']) {
      expect(state.chain.map(short)).not.toContain(removed);
      expect([...state.skeletons.keys()].map(short)).toContain(removed);
      expect([...state.emitted].map(short)).not.toContain(removed);
    }
    expect(out.of('boundary.rewind')).toHaveLength(1);
    const stepOneCount = out.events().length;

    reader.append(joined(REWIND_LINES.slice(27)));
    await follower.poke();
    state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(FULL_CHAIN);
    expect(state.rewind).toBeNull();
    expect(state.gap).toBeNull();
    expect(out.of('boundary.rewind')).toHaveLength(1);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    const stepTwo = out.events().slice(stepOneCount);
    expect(stepTwo.map((e) => e.kind)).toEqual(['turn.started', 'user.message', 'assistant.block.complete']);
    expect([...state.emitted].map(short)).toContain('af765f44'); // rejoined, mapped (to nothing visible), on the chain again
    expectWellFormed(out.events());
  });

  it('a trailing anchor keeps its cut on start and again after a rewrite of the same bytes', async () => {
    const bytes = joined(REWIND_LINES.slice(0, 27));
    const { reader, follower, out } = await started(bytes);
    expect(follower.snapshot().chain.map(short)).toEqual(CUT_CHAIN);
    expect(follower.snapshot().rewind?.phase).toBe('announced');
    // currentChain, which does not handle anchors, still reports the old leaf here.
    expect(short(currentChain(loadTranscriptFixture('rewind-real').slice(0, 27)).leaf?.uuid ?? null)).toBe('57525d04');
    const before = out.events().length;

    reader.replace(bytes);
    await follower.poke();
    expect(out.states()).toEqual(['backfilling', 'following', 'reloading', 'following']);
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(CUT_CHAIN);
    expect(state.rewind?.phase).toBe('announced');
    expect(state.ino).toBe(2);
    expect(state.offset).toBe(bytes.length);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.events().length).toBe(before); // nothing delivered twice
    expectWellFormed(out.events());
  });

  it('a rewrite that shifts the anchor\'s byte offset reloads to the same chain and replays no boundary', async () => {
    const lines = linesOf(join(TEST_FIXTURE_DIR, 'transcript-rewind.jsonl'));
    const { reader, follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u3', 'a3']);
    expect(out.of('boundary.rewind')).toHaveLength(1);
    const before = out.events().length;

    // One bookkeeping record prepended: every offset moves, the anchor's `anchor:<offset>` id with it.
    reader.replace(joined([line({ type: 'queue-operation', operation: 'enqueue', sessionId: 'S' }), ...lines]));
    await follower.poke();
    expect(out.states().slice(-2)).toEqual(['reloading', 'following']);
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u3', 'a3']);
    expect(follower.snapshot().rewind).toBeNull();
    expect(out.of('boundary.rewind')).toHaveLength(1);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.events().length).toBe(before); // nothing but the state transitions
    expect(follower.materialized()).toEqual(out.events());
    expectWellFormed(out.events());
  });

  it('without the anchor, the continuation is a second writer: retraction plus a warning', async () => {
    const lines = [...REWIND_LINES.slice(0, 26), ...REWIND_LINES.slice(27)];
    const { follower, out } = await started(joined(lines));
    expect(follower.snapshot().chain.map(short)).toEqual(FULL_CHAIN);
    expect(out.of('boundary.rewind')).toEqual([]);
    const retractions = out.of('boundary.retraction');
    expect(retractions).toHaveLength(1);
    expect(retractions[0].retractedMessageUuids.map(short)).toEqual(['36a2aa44', '57525d04']);
    expect(retractions[0]).toMatchObject({ reason: 'transcript_branch', fallbackModel: null });
    const notices = out.of('notice.posted');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: 'warning', key: 'transcript_branch' });
    // The retraction and the notice precede the branching record's own events.
    const order = out.events().map((e) => e.kind);
    expect(order.indexOf('boundary.retraction')).toBeLessThan(order.lastIndexOf('turn.started'));
    expect(order.indexOf('notice.posted')).toBeLessThan(order.lastIndexOf('turn.started'));
    expectWellFormed(out.events());
  });

  it('a continuation from the rewound-away branch is not a continuation: retraction and notice', async () => {
    const edited = [...REWIND_LINES];
    const record = JSON.parse(edited[29]) as { parentUuid: string };
    record.parentUuid = fullUuid('57525d04');
    edited[29] = JSON.stringify(record);
    const { follower, out } = await started(joined(edited));
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual([...CUT_CHAIN, 'af765f44', '36a2aa44', '57525d04', 'a4d68c72', '7c05f769']);
    expect(state.rewind).toBeNull();
    expect(out.of('boundary.rewind')).toHaveLength(1); // the anchor's cut
    expect(out.of('boundary.retraction')).toHaveLength(1);
    expect(out.of('boundary.retraction')[0].reason).toBe('transcript_branch');
    expect(out.of('notice.posted')).toHaveLength(1);
    // The cut records rejoin the chain and are re-read and re-emitted as a second delivery occurrence.
    expect(out.of('user.message').map((e) => short(e.messageUuid))).toEqual(['e3b48834', '36a2aa44', '36a2aa44', 'a4d68c72']);
    expect(out.of('user.message').map((e) => e.id.slice(36))).toEqual(['#1', '#1', '@2#1', '#1']);
    expect(out.of('assistant.block.complete').map((e) => e.id.slice(36))).toEqual(['', '', '@2', '']);
    expectWellFormed(out.events());
  });

  it("agrees with currentChain on C1's synthetic fixture", async () => {
    const lines = linesOf(join(TEST_FIXTURE_DIR, 'transcript-rewind.jsonl'));
    const { follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u3', 'a3']);
    expect(currentChain(loadSyntheticTranscript('transcript-rewind')).chain.map((r) => r.uuid)).toEqual(['u1', 'a1', 'u3', 'a3']);
    expect(follower.snapshot().gap).toBeNull();
    const rewinds = out.of('boundary.rewind');
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0]).toMatchObject({ precedingAssistantUuid: 'a1', targetMessageUuid: 'u2', prefillText: 'Also remember BANANA.' });
    expect(out.of('boundary.retraction')).toEqual([]);
    // `s1` (system/informational, on the abandoned branch) was delivered before the cut as an unknown system subtype.
    expect(out.of('frame.unknown').map((e) => [e.id, e.frameType, e.subtype])).toEqual([['s1', 'transcript:system', 'informational']]);
    expectWellFormed(out.events());
  });

  it('an anchor whose leafUuid is not on the chain waits for the branch, which then explains it as a rewind', async () => {
    const lines = [
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at(1), message: { id: 'm', model: 'x', content: [{ type: 'text', text: 'ok' }] } }),
      line({ type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: at(2), message: { role: 'user', content: 'two' } }),
      line({ type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: at(3), message: { id: 'm', model: 'x', content: [{ type: 'text', text: 'ok' }] } }),
      line({ type: 'last-prompt', lastPrompt: 'two', leafUuid: 'not-here', explicit: true, rewound: true }),
    ];
    const { reader, follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(follower.snapshot().rewind).toMatchObject({ phase: 'unanchored', leafUuid: 'not-here', prefillText: 'two' });
    expect(out.of('boundary.rewind')).toEqual([]);

    reader.append(joined([line({ type: 'user', uuid: 'u3', parentUuid: 'a1', timestamp: at(4), message: { role: 'user', content: 'three' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u3']);
    expect(follower.snapshot().rewind).toBeNull();
    const rewinds = out.of('boundary.rewind');
    expect(rewinds).toHaveLength(1);
    expect(rewinds[0]).toMatchObject({ precedingAssistantUuid: 'not-here', targetMessageUuid: 'u2', prefillText: 'two' });
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expectWellFormed(out.events());
  });

  it('a compaction boundary restarts the chain silently; a stray null-parent record is a second writer', async () => {
    const lines = [
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at(1), message: { id: 'm', model: 'x', content: [{ type: 'text', text: 'ok' }] } }),
      line({ type: 'system', subtype: 'compact_boundary', uuid: 'c1', parentUuid: null, logicalParentUuid: 'a1', compactMetadata: { trigger: 'auto', preTokens: 10 }, timestamp: at(2) }),
      line({ type: 'user', uuid: 'u2', parentUuid: 'c1', timestamp: at(3), message: { role: 'user', content: 'two' } }),
    ];
    const { reader, follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(follower.snapshot().chain).toEqual(['c1', 'u2']);
    expect(out.of('boundary.compaction')).toHaveLength(1);
    expect(out.of('boundary.compaction')[0]).toMatchObject({ logicalParentUuid: 'a1', historical: true });
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);

    reader.append(joined([line({ type: 'user', uuid: 'u9', parentUuid: null, timestamp: at(4), message: { role: 'user', content: 'stray' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u9']);
    expect(out.of('boundary.retraction')).toHaveLength(1);
    expect(out.of('boundary.retraction')[0].retractedMessageUuids).toEqual(['c1', 'u2']);
    expect(out.of('notice.posted')).toHaveLength(1);
    expectWellFormed(out.events());
  });

  it('progress records are skeletons only: never the leaf, walked through when a child names one as its parent', async () => {
    const lines = [
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } }),
      line({ type: 'progress', uuid: 'p1', parentUuid: 'u1', timestamp: at(1) }),
      line({ type: 'progress', uuid: 'p2', parentUuid: 'p1', timestamp: at(2) }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'p2', timestamp: at(3), message: { id: 'm', model: 'x', content: [{ type: 'text', text: 'ok' }] } }),
    ];
    const { follower, out } = await started(joined(lines), 'S' as SessionId);
    const state = follower.snapshot();
    expect(state.chain).toEqual(['u1', 'a1']);
    expect(state.skeletons.get('p1' as never)?.isProgress).toBe(true);
    expect(out.events().map((e) => e.kind)).toEqual(['session.started', 'turn.started', 'user.message', 'assistant.block.complete']);
    expect(out.of('boundary.retraction')).toEqual([]);
  });

  it('non-uuid records: titles and relocation become facts, known bookkeeping is silent, anything else is an unknown frame', async () => {
    const lines = [
      line({ type: 'queue-operation', operation: 'enqueue' }),
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', version: '2.1.283', gitBranch: 'main', timestamp: at(0), message: { role: 'user', content: 'one' } }),
      line({ type: 'custom-title', customTitle: 'Named' }),
      line({ type: 'ai-title', aiTitle: 'Generated' }),
      line({ type: 'relocated', relocatedCwd: '/moved' }),
      line({ type: 'last-prompt', lastPrompt: 'one', leafUuid: 'u1' }),
      line({ type: 'file-history-snapshot', messageId: 'u1', snapshot: {} }),
      line({ type: 'cost-state', totalCostUSD: 0 }),
      line({ type: 'agent-name', agentName: 'reviewer', sessionId: 'S' }), // SPEC 35 AgentNameRecord
      line({ type: 'bridge-session', sessionId: 'S' }), // remote-control bridge bookkeeping
      line({ type: 'brand-new-record-type', payload: 1 }),
      line({ type: 'custom-title', customTitle: '' }),
    ];
    const { follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(follower.snapshot().chain).toEqual(['u1']);
    expect(out.facts()).toEqual({ customTitle: null, aiTitle: 'Generated', relocatedCwd: '/moved', gitBranch: 'main', engineVersion: '2.1.283', leafUuid: 'u1', lastRecordAt: at(0) });
    const unknown = out.of('frame.unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ frameType: 'transcript:brand-new-record-type', subtype: null });
    expect(unknown[0].id).toMatch(/^line:\d+$/);
    expect(out.events().map((e) => e.kind)).toEqual(['session.started', 'turn.started', 'user.message', 'frame.unknown']);
    expectWellFormed(out.events());
  });

  it('delivers events in batches of at most 500 and materialises everything delivered', async () => {
    const lines: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 600; i++) {
      lines.push(line({ type: 'user', uuid: `u${i}`, parentUuid: parent, cwd: '/d', timestamp: at(i % 60), message: { role: 'user', content: `m${i}` } }));
      parent = `u${i}`;
    }
    const { follower, out } = await started(joined(lines), 'S' as SessionId);
    expect(out.events()).toHaveLength(1201); // session.started + 2 per record
    expect(Math.max(...out.batchSizes())).toBeLessThanOrEqual(500);
    expect(out.batchSizes().length).toBeGreaterThanOrEqual(3);
    expect(follower.materialized()).toEqual(out.events());
    expect(follower.snapshot().chain).toHaveLength(600);
  });

  it('a missing file waits in following with an empty chain until a poke finds it; stop discards the skeleton', async () => {
    const reader = new MemoryFileReader(Buffer.alloc(0), { exists: false });
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink);
    await follower.start();
    expect(out.states()).toEqual(['backfilling', 'following']);
    expect(follower.snapshot()).toMatchObject({ ino: null, offset: 0, chain: [], leaf: null });
    await follower.poke();
    expect(reader.ranges).toEqual([]);

    reader.append(joined([line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1']);
    expect(follower.snapshot().ino).toBe(1);
    expect(out.events().map((e) => e.kind)).toEqual(['session.started', 'turn.started', 'user.message']);

    follower.stop();
    expect(out.states().at(-1)).toBe('stopped');
    expect(follower.snapshot().skeletons.size).toBe(0);
    expect(follower.snapshot().chain).toEqual([]);
    await follower.poke(); // a stopped follower ignores pokes
    expect(out.states().at(-1)).toBe('stopped');
  });
});

describe('survives torn tails and rewrites', () => {
  const TORN = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'torn-tail.jsonl'));
  const TORN_RECORDS = loadTranscriptFixture('torn-tail');
  const TORN_SESSION = 'torn-tail-session' as SessionId;

  async function expectTornResult(reader: MemoryFileReader, follower: ChainFollower, out: Collector): Promise<void> {
    const state = follower.snapshot();
    expect(TORN_RECORDS).toHaveLength(11);
    expect(state.chain).toEqual(TORN_RECORDS.map((r) => r.uuid));
    expect(state.chain.at(-1)).toBe('t12');
    expect(state.skeletons.size).toBe(11);
    expect(state.skippedLines).toBe(1);
    expect(state.gap).toBeNull();
    expect(state.offset).toBe(TORN.length);
    expect(state.partial.length).toBe(0);
    expect(out.states().at(-1)).toBe('following');
    expectWellFormed(out.events());
    expect(out.of('user.message')).toHaveLength(5); // t01, t03, …, t09; t11 is the torn line
    expect(out.of('assistant.block.complete')).toHaveLength(6); // t02, …, t10 and the sealed t12
    reader.assertContiguous(TORN.length);
    // Every skeleton's (offset, length) re-reads to the record it describes.
    const verify = new MemoryFileReader(TORN);
    for (const [uuid, skeleton] of state.skeletons) {
      const bytes = await verify.read(skeleton.offset, skeleton.length);
      const text = bytes.toString('utf8').replace(/^\0+/, '');
      expect(JSON.parse(text).uuid).toBe(uuid);
      expect(skeleton.type).toBe(TORN_RECORDS.find((r) => r.uuid === uuid)?.type);
    }
  }

  it('fed one shot', async () => {
    const { reader, follower, out } = await started(TORN, TORN_SESSION);
    await expectTornResult(reader, follower, out);
    expect(reader.ranges).toHaveLength(1);
  });

  it('fed one byte per poke, every poke followed by a poke on the unchanged file', async () => {
    const reader = new MemoryFileReader(Buffer.alloc(0));
    const out = new Collector();
    const follower = new ChainFollower(reader, TORN_SESSION, null, out.sink);
    await follower.start();
    for (let i = 0; i < TORN.length; i++) {
      reader.append(TORN.subarray(i, i + 1));
      await follower.poke();
      const reads = reader.ranges.length;
      await follower.poke(); // unchanged: issues no read
      expect(reader.ranges.length).toBe(reads);
    }
    await expectTornResult(reader, follower, out);
    expect(reader.ranges).toHaveLength(TORN.length);
  });

  it('fed in random cuts of 1 to 97 bytes', async () => {
    let seed = 0x2f6c40f3;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let round = 0; round < 5; round++) {
      const reader = new MemoryFileReader(Buffer.alloc(0));
      const out = new Collector();
      const follower = new ChainFollower(reader, TORN_SESSION, null, out.sink);
      await follower.start();
      let cursor = 0;
      while (cursor < TORN.length) {
        const cut = 1 + (next() % 97);
        reader.append(TORN.subarray(cursor, cursor + cut));
        cursor = Math.min(TORN.length, cursor + cut);
        await follower.poke();
      }
      await expectTornResult(reader, follower, out);
      expect(reader.ranges.length).toBeGreaterThan(1);
    }
  });

  it('drops a partial line longer than 8 MiB and counts it, then parses the sealed remainder as garbage once', async () => {
    const first = line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } });
    const { reader, follower, out } = await started(joined([first]), 'S' as SessionId);
    reader.append(Buffer.from('{"type":"user","uuid":"huge","parentUuid":"u1","message":{"role":"user","content":"' + 'x'.repeat(8 * 1024 * 1024) + '"'));
    await follower.poke();
    expect(follower.snapshot().skippedLines).toBe(1);
    expect(follower.snapshot().partial.length).toBe(0);
    expect(follower.snapshot().offset).toBe(reader.size);
    reader.append(Buffer.from('}}\n' + line({ type: 'user', uuid: 'u2', parentUuid: 'u1', timestamp: at(1), message: { role: 'user', content: 'two' } }) + '\n'));
    await follower.poke();
    expect(follower.snapshot().skippedLines).toBe(2);
    expect(follower.snapshot().chain).toEqual(['u1', 'u2']);
    expect(out.of('user.message').map((e) => e.messageUuid)).toEqual(['u1', 'u2']);
    reader.assertContiguous(reader.size);
  });

  it('a rewrite that drops the abandoned branch (the GC shape) reloads to the same chain with nothing delivered twice', async () => {
    const { reader, follower, out } = await started(joined(REWIND_LINES));
    const before = out.events().length;
    const compacted = REWIND_LINES.filter((_, i) => i !== 24 && i !== 25); // lines 25 and 26: the abandoned branch
    reader.replace(joined(compacted));
    await follower.poke();
    expect(out.states().slice(-2)).toEqual(['reloading', 'following']);
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(FULL_CHAIN);
    expect(state.skeletons.size).toBe(15);
    expect(state.rewind).toBeNull();
    expect(out.events().length).toBe(before);
    expect(out.of('boundary.retraction')).toEqual([]);
    expectWellFormed(out.events());
  });

  it('a rewrite that removes chain records retracts them as transcript_rewritten and re-emits nothing already delivered', async () => {
    const { reader, follower, out } = await started(joined(REWIND_LINES));
    const before = out.events().length;
    reader.replace(joined(REWIND_LINES.slice(0, 27))); // the last turn is gone; the trailing anchor keeps its cut
    await follower.poke();
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual(CUT_CHAIN);
    expect(state.rewind?.phase).toBe('announced');
    const retractions = out.of('boundary.retraction');
    expect(retractions).toHaveLength(1);
    expect(retractions[0].retractedMessageUuids.map(short)).toEqual(['af765f44', 'a4d68c72', '7c05f769']);
    expect(retractions[0].reason).toBe('transcript_rewritten');
    expect(out.events().length).toBe(before + 1);
    expect(out.of('boundary.rewind')).toHaveLength(1); // the anchor's boundary was delivered on the cold start; its id is known
    expectWellFormed(out.events());

    // The turn appended again after the rewrite is a second delivery occurrence of the retracted records.
    reader.append(joined(REWIND_LINES.slice(27)));
    await follower.poke();
    expect(follower.snapshot().chain.map(short)).toEqual(FULL_CHAIN);
    expect(out.events().slice(before + 1).map((e) => e.id.slice(36))).toEqual(['@2', '@2#1', '@2']);
    expectWellFormed(out.events());

    // A file that shrinks under the same inode is also a rewrite.
    reader.truncate(joined(REWIND_LINES.slice(0, 20)).length);
    await follower.poke();
    expect(out.states().slice(-2)).toEqual(['reloading', 'following']);
    expect(follower.snapshot().chain.map(short)).toEqual(FULL_CHAIN.slice(0, 13));
  });
});

// A reader whose reads can be held open, so `stop` can land while a read is in flight.
class GatedReader extends MemoryFileReader {
  private release: (() => void) | null = null;
  hold(): void {
    if (this.release === null) this.gate = new Promise<void>((resolve) => (this.release = resolve));
  }
  open(): void {
    this.release?.();
    this.release = null;
    this.gate = null;
  }
  private gate: Promise<void> | null = null;
  override async read(offset: number, length: number): Promise<Buffer> {
    if (this.gate !== null) await this.gate;
    return super.read(offset, length);
  }
}

describe('stop cancels work in flight', () => {
  const ONE = joined([line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } })]);
  const TWO = joined([line({ type: 'user', uuid: 'u2', parentUuid: 'u1', timestamp: at(1), message: { role: 'user', content: 'two' } })]);

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('during start: the held read delivers nothing when released and materialized() is empty', async () => {
    const reader = new GatedReader(ONE);
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink);
    reader.hold();
    const starting = follower.start();
    await settle();
    follower.stop();
    reader.open();
    await starting;
    await settle();
    expect(out.states()).toEqual(['backfilling', 'stopped']);
    expect(out.events()).toEqual([]);
    expect(follower.materialized()).toEqual([]);
    expect(follower.snapshot().chain).toEqual([]);
  });

  it('during poke: a read held across stop delivers nothing and clears what was materialised', async () => {
    const reader = new GatedReader(ONE);
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink);
    await follower.start();
    expect(follower.materialized()).toHaveLength(3);
    reader.append(TWO);
    reader.hold();
    const poking = follower.poke();
    await settle();
    follower.stop();
    reader.open();
    await poking;
    await settle();
    expect(out.states()).toEqual(['backfilling', 'following', 'stopped']);
    expect(out.events()).toHaveLength(3);
    expect(follower.materialized()).toEqual([]);
    expect(follower.snapshot().chain).toEqual([]);
  });

  it('during reload: the fresh run is discarded, no retraction and no state follow', async () => {
    const reader = new GatedReader(Buffer.concat([ONE, TWO]));
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink);
    await follower.start();
    expect(follower.snapshot().chain).toEqual(['u1', 'u2']);
    reader.replace(ONE);
    reader.hold();
    const poking = follower.poke();
    await settle();
    expect(out.states().at(-1)).toBe('reloading');
    follower.stop();
    reader.open();
    await poking;
    await settle();
    expect(out.states()).toEqual(['backfilling', 'following', 'reloading', 'stopped']);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(follower.materialized()).toEqual([]);
  });
});

// The consumer contract (Cross-child reconciliation, C6 row): deduplicate by event id alone and remove the message
// uuids a boundary names, exactly as for C3's live rewinds. No release rule: a record that rejoins the chain after a
// boundary removed it arrives under a fresh occurrence id (`<uuid>@<g>`), so one follower's delivery log never carries
// an id twice and a snapshot overlapping a batch is all duplicates.
class ReferenceConsumer {
  readonly messages: string[] = [];
  private readonly seen = new Set<string>();

  accept(events: SessionEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      switch (event.kind) {
        case 'user.message':
          if (event.messageUuid !== null) this.show(event.messageUuid);
          break;
        case 'assistant.block.complete':
          this.show(event.messageUuid);
          break;
        case 'boundary.rewind': {
          const index = this.messages.indexOf(event.targetMessageUuid);
          if (index !== -1) this.messages.splice(index);
          break;
        }
        case 'boundary.retraction':
          for (const uuid of event.retractedMessageUuids) {
            const index = this.messages.indexOf(uuid);
            if (index !== -1) this.messages.splice(index, 1);
          }
          break;
        default:
          break;
      }
    }
  }

  private show(uuid: string): void {
    if (!this.messages.includes(uuid)) this.messages.push(uuid);
  }
}

function expectNoIdTwice(out: Collector): void {
  const ids = new Set<string>();
  for (const received of out.received) {
    if (received.t !== 'events') continue;
    for (const event of received.events) {
      expect(ids.has(event.id), `id ${event.id} delivered twice`).toBe(false);
      ids.add(event.id);
    }
  }
}

describe('retract-then-rejoin converges for a consumer that deduplicates by id and honours boundaries', () => {
  function visibleChain(follower: ChainFollower): string[] {
    const state = follower.snapshot();
    return state.chain.filter((uuid) => ['user', 'assistant'].includes(state.skeletons.get(uuid)?.type ?? ''));
  }

  function converge(follower: ChainFollower, out: Collector): string[] {
    const consumer = new ReferenceConsumer();
    for (const received of out.received) if (received.t === 'events') consumer.accept(received.events);
    const incremental = [...consumer.messages];
    // A snapshot overlapping everything already delivered, into the same consumer: all duplicates, nothing changes.
    consumer.accept(follower.materialized());
    expect(consumer.messages).toEqual(incremental);
    // A fresh consumer over the snapshot alone reaches the same list.
    const fresh = new ReferenceConsumer();
    fresh.accept(follower.materialized());
    expect(fresh.messages).toEqual(incremental);
    expect(visibleChain(follower)).toEqual(incremental);
    expectNoIdTwice(out);
    return incremental;
  }

  it('over the rewind-real two-step run', async () => {
    const { reader, follower, out } = await started(joined(REWIND_LINES.slice(0, 27)));
    reader.append(joined(REWIND_LINES.slice(27)));
    await follower.poke();
    expect(converge(follower, out).map(short)).toEqual(['e3b48834', 'edf0f954', 'a4d68c72', '7c05f769']);
  });

  it('over a sibling branch and a rejoin: u1 → u2, sibling u3, then u4 under u2', async () => {
    const record = (uuid: string, parent: string | null, n: number) => line({ type: 'user', uuid, parentUuid: parent, cwd: '/d', timestamp: at(n), message: { role: 'user', content: uuid } });
    const { reader, follower, out } = await started(joined([record('u1', null, 0), record('u2', 'u1', 1)]), 'S' as SessionId);
    reader.append(joined([record('u3', 'u1', 2)]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'u3']);
    reader.append(joined([record('u4', 'u2', 3)]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u4']);
    expect(out.of('boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual([['u2'], ['u3']]);
    // u2's second delivery carries the occurrence id.
    expect(out.of('user.message').map((e) => [e.id, e.messageUuid])).toEqual([['u1#1', 'u1'], ['u2#1', 'u2'], ['u3#1', 'u3'], ['u2@2#1', 'u2'], ['u4#1', 'u4']]);
    expect(out.of('turn.started').map((e) => e.id)).toEqual(['u1', 'u2', 'u3', 'u2@2', 'u4']);
    expect(converge(follower, out)).toEqual(['u1', 'u2', 'u4']);
  });

  it('over the rewind-real reload cases: a rewrite that drops the last turn, then the turn appended again', async () => {
    const { reader, follower, out } = await started(joined(REWIND_LINES));
    reader.replace(joined(REWIND_LINES.slice(0, 27)));
    await follower.poke();
    expect(converge(follower, out).map(short)).toEqual(['e3b48834', 'edf0f954']);
    reader.append(joined(REWIND_LINES.slice(27)));
    await follower.poke();
    expect(out.of('user.message').filter((e) => short(e.messageUuid) === 'a4d68c72').map((e) => e.id.slice(36))).toEqual(['#1', '@2#1']);
    expect(converge(follower, out).map(short)).toEqual(['e3b48834', 'edf0f954', 'a4d68c72', '7c05f769']);
  });

  it('a same-inode shrink, regrow and shrink again yields two distinct retractions and the consumer ends at the chain', async () => {
    const record = (uuid: string, parent: string | null, n: number) => line({ type: 'user', uuid, parentUuid: parent, cwd: '/d', timestamp: at(n), message: { role: 'user', content: uuid } });
    const one = joined([record('u1', null, 0)]);
    const two = joined([record('u2', 'u1', 1)]);
    const { reader, follower, out } = await started(Buffer.concat([one, two]), 'S' as SessionId);
    reader.truncate(one.length);
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1']);
    reader.append(two);
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'u2']);
    reader.truncate(one.length);
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1']);
    const retractions = out.of('boundary.retraction');
    expect(retractions.map((e) => e.retractedMessageUuids)).toEqual([['u2'], ['u2']]);
    expect(retractions[0].id).toMatch(/^rewrite:1:\d+$/);
    expect(retractions[1].id).toBe(`${retractions[0].id}@2`);
    expect(converge(follower, out)).toEqual(['u1']);
  });

  it('a reload delivers one event group per final-chain record: its final mapping, with no removal between', async () => {
    const record = (uuid: string, parent: string | null, n: number) => line({ type: 'user', uuid, parentUuid: parent, cwd: '/d', timestamp: at(n), message: { role: 'user', content: uuid } });
    const { reader, follower, out } = await started(joined([record('u1', null, 0)]), 'S' as SessionId);
    const before = out.events().length;
    // The rewritten file branches away from u2 and rejoins it: the suppressed fresh run maps u2 twice.
    reader.replace(joined([record('u1', null, 0), record('u2', 'u1', 1), record('u3', 'u1', 2), record('u4', 'u2', 3)]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u4']);
    const delivered = out.events().slice(before);
    expect(delivered.map((e) => [e.kind, e.id])).toEqual([
      ['turn.started', 'u2'], ['user.message', 'u2#1'],
      ['turn.started', 'u4'], ['user.message', 'u4#1'],
    ]);
    expect(out.of('session.started')).toHaveLength(1);
    expect(converge(follower, out)).toEqual(['u1', 'u2', 'u4']);
  });

  it('the same file followed twice from scratch yields the same delivery log', async () => {
    const edited = [...REWIND_LINES];
    const record = JSON.parse(edited[29]) as { parentUuid: string };
    record.parentUuid = fullUuid('57525d04');
    edited[29] = JSON.stringify(record);
    const first = await started(joined(edited));
    const second = await started(joined(edited));
    expect(second.out.events()).toEqual(first.out.events());
    expect(first.out.events().map((e) => e.id).filter((id) => id.includes('@'))).toEqual([
      `${fullUuid('36a2aa44')}@2`, `${fullUuid('36a2aa44')}@2#1`, `${fullUuid('57525d04')}@2`,
    ]);
  });
});
