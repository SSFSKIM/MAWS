import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AgentId, MessageUuid, SessionId } from '@shared/graph/ids';
import { currentChain } from '@shared/wire/transcript';
import { FIXTURE_DIR, loadSyntheticTranscript, loadTranscriptFixture, TEST_FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { MemoryFileReader } from '../../../test/support/memory-reader';
import { ChainFollower, type FollowerEvent } from './chain-follower';
import { ownsTranscriptRecord } from './holders';

const SESSION = 'bdb23713-2f6c-40f3-8b18-b41a667a64e3' as SessionId;
const ownPids = new Set([42]);
const writers = [{ pid: 42, sessionId: SESSION, entrypoint: 'sdk-ts' }];
const isOwnRecord = (record: Record<string, unknown>) => ownsTranscriptRecord(record, SESSION, writers, ownPids);

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

// A follow of a session some process is writing (one live holder): what these suites exercise. The holder-less end
// of a backfill has its own suite below.
async function started(bytes: Buffer, sessionId: SessionId = SESSION): Promise<{ reader: MemoryFileReader; follower: ChainFollower; out: Collector }> {
  const reader = new MemoryFileReader(bytes);
  const out = new Collector();
  const follower = new ChainFollower(reader, sessionId, null, out.sink, { holders: () => 1 });
  await follower.start();
  return { reader, follower, out };
}

// FX5: hand-written, public synthetic data; no owner's transcript content.
const SIBLING_LINES = linesOf(join(TEST_FIXTURE_DIR, 'transcript-sibling-attachments.jsonl'));

describe('leaf-sibling attachments', () => {
  it.each(['backfill', 'tail'] as const)('%s swaps hook siblings silently and delivers every visible record once in order', async (mode) => {
    const { reader, follower, out } = await started(mode === 'backfill' ? joined(SIBLING_LINES) : Buffer.alloc(0));
    if (mode === 'tail') {
      for (const record of SIBLING_LINES) {
        reader.append(joined([record]));
        await follower.poke();
        await follower.poke(); // an unchanged file delivers nothing again
      }
    }
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'r1', 'a2', 'r2', 'a3', 'r3', 'a4', 's1']);
    expect(out.events().map((e) => [e.kind, e.id])).toEqual([
      ['session.started', `session:${SESSION}:started`], ['turn.started', 'u1'], ['user.message', 'u1#1'],
      ['assistant.block.complete', 'a1'], ['tool.use', 'a1#1'], ['tool.result', 'r1'],
      ['assistant.block.complete', 'a2'], ['tool.use', 'a2#1'], ['tool.result', 'r2'],
      ['assistant.block.complete', 'a3'], ['tool.use', 'a3#1'], ['tool.result', 'r3'],
      ['assistant.block.complete', 'a4'], ['turn.ended', 's1'],
    ]);
    expectWellFormed(out.events());
  });

  it('still retracts a real second-writer branch that removes a user record', async () => {
    const { reader, follower, out } = await started(joined(SIBLING_LINES.slice(0, 4)));
    reader.append(joined([line({ type: 'user', uuid: 'foreign', parentUuid: 'a1', message: { role: 'user', content: 'Another writer' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'foreign']);
    expect(out.of('boundary.retraction').map((e) => [e.reason, e.retractedMessageUuids])).toEqual([['transcript_branch', ['r1']]]);
    expect(out.of('notice.posted').map((e) => e.key)).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
  });

  it('does not hold a foreign record displacing only a MAWS-written attachment (W7)', async () => {
    const ownLines = SIBLING_LINES.slice(0, 3).map((l) => line({ ...JSON.parse(l), entrypoint: 'sdk-ts' }));
    const reader = new MemoryFileReader(joined(ownLines));
    const out = new Collector();
    const follower = new ChainFollower(reader, SESSION, null, out.sink, { holders: () => 1, pinned: () => true, isOwnRecord });
    await follower.start();
    expect(follower.snapshot().skeletons.get('h1' as MessageUuid)?.own).toBe(true);
    reader.append(joined([line({ ...JSON.parse(SIBLING_LINES[3]), entrypoint: 'cli' })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'r1']);
    expect(out.of('tool.result').map((e) => e.toolUseId)).toEqual(['t1']);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    const before = out.events();
    await follower.refold();
    expect(out.events()).toEqual(before); // no invisible branch was held for later
  });

  it('an unanchored rewind cutting only attachments remains silent', async () => {
    const { reader, follower, out } = await started(joined([
      ...SIBLING_LINES.slice(0, 3),
      line({ type: 'last-prompt', leafUuid: 'absent', rewound: true, lastPrompt: 'synthetic prefill' }),
    ]));
    expect(follower.snapshot().rewind?.phase).toBe('unanchored');
    reader.append(joined(SIBLING_LINES.slice(3, 4)));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'r1']);
    expect(follower.snapshot().rewind).toBeNull();
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
  });
});

// FX6: split API responses and their independently parented tool results, in file order.
const PARALLEL_LINES = linesOf(join(TEST_FIXTURE_DIR, 'transcript-parallel-tool-group.jsonl'));
const PARALLEL_CHAIN = ['u1', 'a1', 'a2', 'h1', 'rA', 'rB', 'h2', 'h3', 'a3', 'a4', 'a5', 'a6', 'rC', 'rA2', 'rB2', 'a7', 's1'];

describe('parallel response-group interleaves', () => {
  it.each(['backfill', 'tail'] as const)('%s keeps successive groups and pairs each result once in file order', async (mode) => {
    const { reader, follower, out } = await started(mode === 'backfill' ? joined(PARALLEL_LINES) : Buffer.alloc(0));
    if (mode === 'tail') {
      for (const record of PARALLEL_LINES) {
        reader.append(joined([record]));
        await follower.poke();
        await follower.poke();
      }
    }
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(follower.snapshot().chain).toEqual(PARALLEL_CHAIN);
    expect(follower.snapshot().emitted).toEqual(new Set(PARALLEL_CHAIN));
    expect(out.events().map((e) => [e.kind, e.id])).toEqual([
      ['session.started', `session:${SESSION}:started`], ['turn.started', 'u1'], ['user.message', 'u1#1'],
      ['assistant.block.complete', 'a1'], ['tool.use', 'a1#1'],
      ['assistant.block.complete', 'a2'], ['tool.use', 'a2#1'], ['tool.result', 'rA'], ['tool.result', 'rB'],
      ['assistant.block.complete', 'a3'],
      ['assistant.block.complete', 'a4'], ['tool.use', 'a4#1'],
      ['assistant.block.complete', 'a5'], ['tool.use', 'a5#1'],
      ['assistant.block.complete', 'a6'], ['tool.use', 'a6#1'],
      ['tool.result', 'rC'], ['tool.result', 'rA2'], ['tool.result', 'rB2'],
      ['assistant.block.complete', 'a7'], ['turn.ended', 's1'],
    ]);
    expect(out.of('tool.use').map((e) => [e.id, e.toolUseId])).toEqual([
      ['a1#1', 't1'], ['a2#1', 't2'], ['a4#1', 't3'], ['a5#1', 't4'], ['a6#1', 't5'],
    ]);
    expect(out.of('tool.result').map((e) => [e.id, e.toolUseId])).toEqual([
      ['rA', 't1'], ['rB', 't2'], ['rC', 't5'], ['rA2', 't3'], ['rB2', 't4'],
    ]);
    expectWellFormed(out.events());
    const before = out.events();
    reader.replace(joined(PARALLEL_LINES));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(PARALLEL_CHAIN);
    expect(out.events()).toEqual(before);
  });

  it('adopts through an older result, including the parent fallback when source is absent', async () => {
    const prefix = PARALLEL_LINES.slice(0, 6).map((l) => {
      const record = JSON.parse(l);
      delete record.sourceToolAssistantUUID;
      return line(record);
    });
    const { reader, follower, out } = await started(joined(prefix));
    reader.append(joined([
      line({ type: 'attachment', uuid: 'older-hook', parentUuid: 'rA', attachment: { type: 'hook_success' } }),
      line({ type: 'assistant', uuid: 'same-response', parentUuid: 'older-hook', message: { id: 'm1', content: [{ type: 'text', text: 'More of this response.' }] } }),
    ]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual([...PARALLEL_CHAIN.slice(0, 6), 'older-hook', 'same-response']);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
  });

  it('adopts group members before W7 even when removed members were written by MAWS', async () => {
    const own = PARALLEL_LINES.slice(0, 4).map((l) => line({ ...JSON.parse(l), entrypoint: 'sdk-ts' }));
    const reader = new MemoryFileReader(joined(own));
    const out = new Collector();
    const follower = new ChainFollower(reader, SESSION, null, out.sink, { holders: () => 2, pinned: () => true, isOwnRecord });
    await follower.start();
    reader.append(joined(PARALLEL_LINES.slice(4, 6)));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(PARALLEL_CHAIN.slice(0, 6));
    expect(out.of('notice.posted')).toEqual([]);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
    const before = out.events();
    await follower.refold();
    expect(out.events()).toEqual(before);
  });

  it.each([
    { type: 'user', message: { role: 'user', content: 'A second writer prompt.' } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'A resumed context.' } },
    { type: 'assistant', message: { id: 'different-response', content: [{ type: 'text', text: 'Another response.' }] } },
  ])('keeps a $type outside the response group as a branch, or holds it under W7', async (record) => {
    for (const pinned of [false, true]) {
      const reader = new MemoryFileReader(joined(PARALLEL_LINES.slice(0, 6).map((l) => line({ ...JSON.parse(l), entrypoint: 'sdk-ts' }))));
      const out = new Collector();
      const follower = new ChainFollower(reader, SESSION, null, out.sink, { holders: () => 2, pinned: () => pinned, isOwnRecord });
      await follower.start();
      reader.append(joined([line({ ...record, uuid: 'foreign', parentUuid: 'a1', entrypoint: 'cli' })]));
      await follower.poke();
      expect(follower.snapshot().chain).toEqual(pinned ? PARALLEL_CHAIN.slice(0, 6) : ['u1', 'a1', 'foreign']);
      expect(out.of('boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual(pinned ? [] : [['a2', 'h1', 'rA', 'rB']]);
      expect(out.of('notice.posted').map((e) => e.key)).toEqual(pinned ? ['transcript_branch_held'] : []);
      expect(out.of('boundary.rewind')).toEqual([]);
    }
  });

  it('keeps an inherited ancestry gap when adopting the existing prefix', async () => {
    const first = { ...JSON.parse(PARALLEL_LINES[0]), parentUuid: 'missing-root' };
    const { reader, follower, out } = await started(joined([line(first), ...PARALLEL_LINES.slice(1)]));
    reader.append(joined([line({ type: 'user', uuid: 'fork', parentUuid: 'u1', message: { content: 'A genuine fork.' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'fork']);
    expect(follower.snapshot().gap).toEqual({ parentUuid: 'missing-root', childUuid: 'u1' });
    expect(out.of('boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual([PARALLEL_CHAIN.slice(1)]);
  });

  it.each(['missing-id', 'different-removed-response', 'different-source'] as const)('does not infer membership from %s', async (shape) => {
    const prefix = PARALLEL_LINES.slice(0, 3).map((l) => JSON.parse(l));
    if (shape === 'missing-id') {
      delete prefix[1].message.id;
      delete prefix[2].message.id;
    }
    if (shape === 'different-removed-response') prefix[2].message.id = 'another-response';
    const result = JSON.parse(PARALLEL_LINES[4]);
    if (shape === 'different-source') result.sourceToolAssistantUUID = 'u1'; // present, but not a group assistant: no parent fallback
    const { follower, out } = await started(joined([...prefix.map(line), line(result)]));
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'rA']);
    expect(out.of('boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual([['a2']]);
    expect(out.of('notice.posted').map((e) => e.key)).toEqual([]);
  });

  it('retracts adopted results too when a genuine fork parents above their group', async () => {
    const { reader, follower, out } = await started(joined(PARALLEL_LINES));
    reader.append(joined([line({ type: 'user', uuid: 'foreign', parentUuid: 'u1', message: { role: 'user', content: 'Resume earlier.' } })]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'foreign']);
    expect(out.of('boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual([PARALLEL_CHAIN.slice(1)]);
    expect(out.of('notice.posted').map((e) => e.key)).toEqual([]);
    expect(out.of('boundary.rewind')).toEqual([]);
  });
});

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

  it('without the anchor and with two live holders, the continuation is a second writer: retraction plus a warning', async () => {
    // With at most one holder this same shape is the terminal rewind (below); two processes make it contested.
    const lines = [...REWIND_LINES.slice(0, 26), ...REWIND_LINES.slice(27)];
    const out = new Collector();
    const follower = new ChainFollower(new MemoryFileReader(joined(lines)), SESSION, null, out.sink, { holders: () => 2 });
    await follower.start();
    expect(follower.snapshot().chain.map(short)).toEqual(FULL_CHAIN);
    expect(out.of('boundary.rewind')).toEqual([]);
    const retractions = out.of('boundary.retraction');
    expect(retractions).toHaveLength(1);
    expect(retractions[0].retractedMessageUuids.map(short)).toEqual(['36a2aa44', '57525d04']);
    expect(retractions[0]).toMatchObject({ reason: 'transcript_branch', fallbackModel: null });
    const notices = out.of('notice.posted');
    expect(notices).toEqual([]); // a parent mismatch alone does not establish a second writer
    // The retraction precedes the branching record's own events.
    const order = out.events().map((e) => e.kind);
    expect(order.indexOf('boundary.retraction')).toBeLessThan(order.lastIndexOf('turn.started'));
    expectWellFormed(out.events());
  });

  it('a continuation from the rewound-away branch still rejoins, but an empty cut has no boundary', async () => {
    const edited = [...REWIND_LINES];
    const record = JSON.parse(edited[29]) as { parentUuid: string };
    record.parentUuid = fullUuid('57525d04');
    edited[29] = JSON.stringify(record);
    const { follower, out } = await started(joined(edited));
    const state = follower.snapshot();
    expect(state.chain.map(short)).toEqual([...CUT_CHAIN, 'af765f44', '36a2aa44', '57525d04', 'a4d68c72', '7c05f769']);
    expect(state.rewind).toBeNull();
    expect(out.of('boundary.rewind')).toHaveLength(1); // the anchor's cut
    // FX8 rule E: no removal means no retraction or notice. The seven observed empty cuts have no
    // outstanding rewind; this rejected-rewind path keeps its rejoin/redelivery semantics too.
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
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
    expect(out.of('notice.posted')).toEqual([]);
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

  it('keeps worktree, PR and agent-setting bookkeeping silent without hiding unknown types', async () => {
    const { follower, out } = await started(joined([
      line({ type: 'worktree-state', sessionId: SESSION, worktree: null }),
      line({ type: 'pr-link', sessionId: SESSION, prNumber: 12 }),
      line({ type: 'agent-setting', sessionId: SESSION, agentSetting: 'reviewer' }),
      line({ type: 'future-bookkeeping', sessionId: SESSION }),
    ]));
    expect(out.events()).toHaveLength(1);
    expect(out.of('frame.unknown')).toMatchObject([{ frameType: 'transcript:future-bookkeeping', subtype: null }]);
    expect(follower.snapshot().chain).toEqual([]);
    expect(follower.snapshot().skippedLines).toBe(0);
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

// The M7 acceptance transcript (claude 2.1.284 in a terminal): APPLE, BANANA, `/rewind` to before BANANA, then a new
// prompt. The interactive engine writes no `rewound` anchor; the new prompt's record simply parents onto the APPLE
// turn's last record (`8eb6beb3`, its `turn_duration`). Lines 1–48 end at that turn; the file's later lines are the
// same session's renames and a resume (item 7), all appended on the rewound chain.
describe('a terminal rewind without an anchor', () => {
  const TERMINAL = 'a76ad588-e4b4-4a99-bf4e-69287514916f' as SessionId;
  const TERMINAL_LINES = linesOf(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-terminal.jsonl'));
  const BANANA_TURN = ['7b39835b', 'd567fa97', 'ad2a15d2', '873e11da', '832711e7', 'db3e5073'];
  const follow = async (lines: string[], holders: number) => {
    const out = new Collector();
    const follower = new ChainFollower(new MemoryFileReader(joined(lines)), TERMINAL, null, out.sink, { holders: () => holders });
    await follower.start();
    return { follower, out };
  };

  // W9 (H2): the terminal ran in a folder that is no repository and wrote `"gitBranch":"HEAD"` on every record
  it('takes no branch from HEAD: the facts carry a null gitBranch beside the version', async () => {
    const { out } = await follow(TERMINAL_LINES, 1);
    expect(TERMINAL_LINES.some((l) => l.includes('"gitBranch":"HEAD"'))).toBe(true);
    expect(out.facts()).toMatchObject({ gitBranch: null, engineVersion: expect.any(String) });
  });

  it('with one live holder, a new prompt parented at a turn boundary is one boundary.rewind: no retraction, no notice', async () => {
    const { follower, out } = await follow(TERMINAL_LINES.slice(0, 48), 1);
    expect(out.of('boundary.rewind').map((e) => ({ ...e, targetMessageUuid: short(e.targetMessageUuid), precedingAssistantUuid: short(e.precedingAssistantUuid) }))).toEqual([
      expect.objectContaining({ targetMessageUuid: '7b39835b', precedingAssistantUuid: '2de7ede4', prefillText: null }),
    ]);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    const state = follower.snapshot();
    expect(state.chain).toHaveLength(26);
    expect(short(state.leaf)).toBe('c25b804b');
    expect(state.chain.map(short)).not.toEqual(expect.arrayContaining(['7b39835b']));
    expectWellFormed(out.events());
    // The whole file (the later renames and the resume extend the rewound chain): still exactly one boundary of any kind.
    const whole = await follow(TERMINAL_LINES, 1);
    expect(whole.out.of('boundary.rewind')).toHaveLength(1);
    expect(whole.out.of('boundary.retraction')).toEqual([]);
    expect(whole.out.of('notice.posted').filter((e) => e.key === 'transcript_branch')).toEqual([]);
    expect(short(whole.follower.snapshot().leaf)).toBe('fa24f6e9');
  });

  it('with no live holder (nobody is writing it, a historical backfill) the same branch is still one boundary.rewind', async () => {
    const { follower, out } = await follow(TERMINAL_LINES.slice(0, 48), 0);
    expect(out.of('boundary.rewind').map((e) => short(e.targetMessageUuid))).toEqual(['7b39835b']);
    expect(out.of('boundary.retraction')).toEqual([]);
    expect(out.of('notice.posted')).toEqual([]);
    expect(short(follower.snapshot().leaf)).toBe('c25b804b');
  });

  it('with two live holders the same branch is a second writer: the retraction and the notice', async () => {
    const { follower, out } = await follow(TERMINAL_LINES.slice(0, 48), 2);
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(out.of('boundary.retraction').map((e) => [e.reason, e.retractedMessageUuids.map(short)])).toEqual([['transcript_branch', BANANA_TURN]]);
    expect(out.of('notice.posted').map((e) => e.key)).toEqual([]);
    expect(short(follower.snapshot().leaf)).toBe('c25b804b');
  });

  it('with one live holder, a prompt parented mid-turn is still a second writer', async () => {
    // Re-parented onto the APPLE turn's first assistant record (its thinking block), which another assistant record follows.
    const [boundary, inside] = [fullTerminal('8eb6beb3'), fullTerminal('77c649cb')];
    const midTurn = TERMINAL_LINES.slice(0, 48).map((l) => (l.includes('"uuid":"040727ec') ? l.replace(`"parentUuid":"${boundary}"`, `"parentUuid":"${inside}"`) : l));
    expect(midTurn[42]).toContain(`"parentUuid":"${inside}"`);
    const { out } = await follow(midTurn, 1);
    expect(out.of('boundary.rewind')).toEqual([]);
    expect(out.of('boundary.retraction')).toHaveLength(1);
    expect(out.of('notice.posted').map((e) => e.key)).toEqual([]);
  });

  function fullTerminal(prefix: string): string {
    const found = TERMINAL_LINES.map((l) => JSON.parse(l) as { uuid?: string }).find((r) => r.uuid?.startsWith(prefix));
    if (!found?.uuid) throw new Error(`no record ${prefix}`);
    return found.uuid;
  }
});

// C6's whole-branch-review ask: SDK-entrypoint sessions write no `turn_duration`, so a backfilled session nobody is
// running would otherwise end on a turn that never ends. The follower states the one true fact it has instead.
describe('a holder-less transcript whose last turn never ended', () => {
  const SDK = '6eff2bf4-616c-40b7-9928-f60df666cdfe' as SessionId;
  const SDK_LINES = linesOf(join(TRANSCRIPT_FIXTURE_DIR, 'sdk-unended.jsonl'));
  const follow = async (bytes: Buffer, sessionId: SessionId, holders: number | null, agent: ConstructorParameters<typeof ChainFollower>[2] = null) => {
    const reader = new MemoryFileReader(bytes);
    const out = new Collector();
    const follower = new ChainFollower(reader, sessionId, agent, out.sink, holders === null ? {} : { holders: () => holders });
    await follower.start();
    return { reader, follower, out };
  };

  it('ends its backfill with one process.exited { reason: unknown } at the last record, and never again in that follow', async () => {
    const { reader, follower, out } = await follow(joined(SDK_LINES), SDK, 0);
    const events = out.events();
    expectWellFormed(events);
    expect(out.of('turn.started')).toHaveLength(1);
    expect(out.of('turn.ended')).toEqual([]);
    const leafAt = follower.snapshot().skeletons.get(follower.snapshot().leaf!)!.timestamp;
    expect(leafAt).toBe('2026-09-27T07:00:30.639Z');
    expect(events.at(-1)).toEqual({
      id: `session:${SDK}:exited`, sessionId: SDK, at: leafAt, seq: null, agentId: null, parentToolUseId: null,
      kind: 'process.exited', code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null, // C12
    });
    // Delivered after the backfill's records and before `following`.
    const order = out.received.flatMap((e) => (e.t === 'state' ? [e.state] : e.t === 'events' && e.events.some((x) => x.kind === 'process.exited') ? ['exited'] : []));
    expect(order).toEqual(['backfilling', 'exited', 'following']);
    // A later append and a later poke deliver nothing to undo it, and no second exit.
    reader.append(joined([line({ type: 'user', uuid: 'later', parentUuid: follower.snapshot().leaf, timestamp: at(9), message: { role: 'user', content: 'again' } })]));
    await follower.poke();
    await follower.poke();
    expect(out.of('process.exited')).toHaveLength(1);
    expect(follower.materialized().filter((e) => e.kind === 'process.exited')).toHaveLength(1);
  });

  it('unsupplied holders count as none', async () => {
    const { out } = await follow(joined(SDK_LINES), SDK, null);
    expect(out.of('process.exited')).toHaveLength(1);
  });

  it('emits nothing while a live holder has it: the live producer (C3) or the terminal owns its ending', async () => {
    expect((await follow(joined(SDK_LINES), SDK, 1)).out.of('process.exited')).toEqual([]);
    // The anchored (headless, no turn_duration) and the terminal fixtures, each with a live holder.
    expect((await follow(joined(REWIND_LINES), SESSION, 1)).out.of('process.exited')).toEqual([]);
    const terminal = linesOf(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-terminal.jsonl'));
    expect((await follow(joined(terminal), 'a76ad588-e4b4-4a99-bf4e-69287514916f' as SessionId, 1)).out.of('process.exited')).toEqual([]);
  });

  it('emits nothing when the last turn ended, or when no turn ever started', async () => {
    const ended = joined([
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at(1), message: { id: 'm1', model: 'x', content: [{ type: 'text', text: 'ok' }] } }),
      line({ type: 'system', subtype: 'turn_duration', uuid: 's1', parentUuid: 'a1', durationMs: 5, timestamp: at(2) }),
      line({ type: 'attachment', uuid: 'x1', parentUuid: 's1', timestamp: at(3), attachment: { type: 'prompt_snapshot' } }),
    ]);
    expect((await follow(ended, 'S' as SessionId, 0)).out.of('process.exited')).toEqual([]);
    const noTurn = joined([line({ type: 'attachment', uuid: 'x1', parentUuid: null, cwd: '/d', timestamp: at(0), attachment: { type: 'environment' } })]);
    expect((await follow(noTurn, 'S' as SessionId, 0)).out.of('process.exited')).toEqual([]);
    expect((await follow(Buffer.alloc(0), 'S' as SessionId, 0)).out.of('process.exited')).toEqual([]);
  });

  it('an interrupt marker does not end the turn it belongs to: the interrupted session still exits', async () => {
    const MARKER = '68646e1f-b5ba-4d72-bdae-3fd5f7f3ec46' as SessionId;
    const { out } = await follow(joined(linesOf(join(TRANSCRIPT_FIXTURE_DIR, 'interrupt-marker.jsonl'))), MARKER, 0);
    expect(out.of('turn.started')).toHaveLength(1);
    expect(out.of('user.message').map((e) => e.origin)).toEqual([null, 'interrupt-marker']);
    expect(out.of('process.exited').map((e) => e.id)).toEqual([`session:${MARKER}:exited`]);
  });

  it("an agent's own transcript (a sidecar follow) carries no process exit", async () => {
    const { out } = await follow(joined(SDK_LINES), SDK, 0, { agentId: 'a1' as AgentId, parentToolUseId: null });
    expect(out.of('turn.started')).toHaveLength(1);
    expect(out.of('process.exited')).toEqual([]);
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

  it('backfills a complete nine-MiB document without dropping its record or its child parent link', async () => {
    const data = 'A'.repeat(9 * 1024 * 1024);
    const prompt = line({ type: 'user', uuid: 'large', parentUuid: null, timestamp: at(0), message: { role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }] } });
    const answer = line({ type: 'assistant', uuid: 'answer', parentUuid: 'large', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: 'Read it' }] } });
    const { follower, out } = await started(joined([prompt, answer]));
    expect(out.of('user.message')).toHaveLength(1);
    expect(follower.snapshot()).toMatchObject({ chain: ['large', 'answer'], gap: null, skippedLines: 0 });
  });

  it('keeps an oversized partial tail on disk and recovers it once sealed', async () => {
    const first = line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'one' } });
    const { reader, follower, out } = await started(joined([first]), 'S' as SessionId);
    reader.append(Buffer.from('{"type":"user","uuid":"huge","parentUuid":"u1","message":{"role":"user","content":"' + 'x'.repeat(8 * 1024 * 1024) + '"'));
    await follower.poke();
    expect(follower.snapshot().skippedLines).toBe(0);
    expect(follower.snapshot().partial.length).toBe(0);
    expect(follower.snapshot().offset).toBe(reader.size);
    reader.append(Buffer.from('}}\n' + line({ type: 'user', uuid: 'u2', parentUuid: 'huge', timestamp: at(1), message: { role: 'user', content: 'two' } }) + '\n'));
    await follower.poke();
    expect(follower.snapshot().skippedLines).toBe(0);
    expect(follower.snapshot().chain).toEqual(['u1', 'huge', 'u2']);
    expect(out.of('user.message').map((e) => e.messageUuid)).toEqual(['u1', 'huge', 'u2']);
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

// A reader whose read at one armed offset first rewrites the file, then reads the new bytes there: a rename-over (the
// engine's GC; a new inode, as the fs reader would see after reopening by path) or an in-place rewrite (same inode).
class RenameOverReader extends MemoryFileReader {
  renamed = false;
  private armed: { offset: number; bytes: Buffer; inPlace: boolean } | null = null;
  renameOverAt(offset: number, bytes: Buffer): void {
    this.armed = { offset, bytes, inPlace: false };
  }
  rewriteInPlaceAt(offset: number, bytes: Buffer): void {
    this.armed = { offset, bytes, inPlace: true };
  }
  override async read(offset: number, length: number): Promise<Buffer> {
    if (this.armed !== null && this.armed.offset === offset) {
      if (this.armed.inPlace) {
        this.truncate(0);
        this.append(this.armed.bytes);
      } else this.replace(this.armed.bytes);
      this.armed = null;
      this.renamed = true;
    }
    return super.read(offset, length);
  }
}

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
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink, { holders: () => 1 });
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

  // Whole-branch review: a GC rename-over racing a branch flip. The rejoining record's by-offset re-read meets the new
  // file; the record must not count as delivered, so the reload that follows delivers it.
  it('a rename-over during the re-read of a rejoining record loses nothing: the reload delivers it', async () => {
    const record = (uuid: string, parent: string | null, n: number) => line({ type: 'user', uuid, parentUuid: parent, cwd: '/d', timestamp: at(n), message: { role: 'user', content: uuid } });
    const mode = line({ type: 'permission-mode', permissionMode: 'default', sessionId: 'S' });
    const reader = new RenameOverReader(joined([record('u1', null, 0), mode, record('u2', 'u1', 1), record('u3', 'u1', 2)]));
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink, { holders: () => 1 });
    await follower.start();
    expect(follower.snapshot().chain).toEqual(['u1', 'u3']);
    const u2 = follower.snapshot().skeletons.get('u2' as MessageUuid)!;
    // u4 flips the branch back onto u2, whose line is re-read by offset; the engine's GC renames a rewrite over the
    // file (the bookkeeping line and the abandoned u3 dropped, so u2 sits elsewhere) just before that read.
    reader.append(joined([record('u4', 'u2', 3)]));
    reader.renameOverAt(u2.offset, joined([record('u1', null, 0), record('u2', 'u1', 1), record('u4', 'u2', 3)]));
    await follower.poke();
    expect(reader.renamed).toBe(true);
    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u4']);
    expect(follower.snapshot().emitted).toEqual(new Set(['u1', 'u2', 'u4'] as MessageUuid[]));
    // Nothing of the interrupted pass is delivered after the failed re-read; the reload delivers u2 then u4, in chain order.
    expect(out.of('user.message').map((e) => e.id)).toEqual(['u1#1', 'u2#1', 'u3#1', 'u2@2#1', 'u4#1']);
    expect(out.states().slice(-2)).toEqual(['reloading', 'following']);
    expect(converge(follower, out)).toEqual(['u1', 'u2', 'u4']);
  });

  // Whole-branch review of the final wave: the retry's stat cannot be relied on to see the rewrite. A same-inode rewrite
  // of equal length during the re-read leaves inode and size as they were; the interrupted pass still reloads.
  it('a same-inode rewrite of equal length during the re-read of a rejoining record loses nothing either', async () => {
    const record = (uuid: string, parent: string | null, n: number) => line({ type: 'user', uuid, parentUuid: parent, cwd: '/d', timestamp: at(n), message: { role: 'user', content: uuid } });
    const mode = (pad: string) => line({ type: 'permission-mode', permissionMode: 'default', sessionId: 'S', pad });
    const reader = new RenameOverReader(joined([record('u1', null, 0), mode(''), record('u2', 'u1', 1), record('u3', 'u1', 2)]));
    const out = new Collector();
    const follower = new ChainFollower(reader, 'S' as SessionId, null, out.sink, { holders: () => 1 });
    await follower.start();
    const u2 = follower.snapshot().skeletons.get('u2' as MessageUuid)!;
    reader.append(joined([record('u4', 'u2', 3)]));
    // The same records with u3 dropped and the bookkeeping line moved to the end, padded to the file's exact length, so
    // u2 no longer sits at its offset while the inode and the size stay what the follower last saw.
    const size = reader.size;
    const body = joined([record('u1', null, 0), record('u2', 'u1', 1), record('u4', 'u2', 3)]);
    const rewrite = Buffer.concat([body, joined([mode(' '.repeat(size - body.length - joined([mode('')]).length))])]);
    expect(rewrite.length).toBe(size);
    reader.rewriteInPlaceAt(u2.offset, rewrite);
    await follower.poke();
    expect(reader.renamed).toBe(true);
    expect(await reader.stat()).toEqual({ ino: 1, size });
    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u4']);
    expect(out.of('user.message').map((e) => e.id)).toEqual(['u1#1', 'u2#1', 'u3#1', 'u2@2#1', 'u4#1']);
    expect(out.states().slice(-2)).toEqual(['reloading', 'following']);
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

// W7 (charter §4.3 as amended 2026-10-01): the owner's collision, recorded live (spikes/protocol-probe/fixtures/pass3/
// w7-collision-disk/transcript.jsonl): MAWS writes MAWS_ONE, a terminal resumes the id and writes TERMINAL_ONE on top
// of it, MAWS (its in-memory chain unchanged) writes MAWS_TWO as a sibling of TERMINAL_ONE, the terminal writes
// TERMINAL_TWO on its own branch, then exits. The file is fed in those steps, as the writers appended it.
describe('a transcript a terminal and MAWS both write (W7)', () => {
  const W7 = linesOf(join(FIXTURE_DIR, 'pass3', 'w7-collision-disk', 'transcript.jsonl'));
  const records = W7.map((l) => JSON.parse(l) as { type: string; uuid?: string; entrypoint?: string; message?: { content?: unknown } });
  const prompt = (text: string) => records.findIndex((r) => r.type === 'user' && typeof r.message?.content === 'string' && r.message.content.startsWith(text));
  const cuts = [prompt('Reply with exactly the word TERMINAL_ONE'), prompt('Reply with exactly the word MAWS_TWO'), prompt('Reply with exactly the word TERMINAL_TWO'), prompt('<local-command-caveat>')];
  const steps = [W7.slice(0, cuts[0]), W7.slice(cuts[0], cuts[1]), W7.slice(cuts[1], cuts[2]), W7.slice(cuts[2], cuts[3]), W7.slice(cuts[3], prompt('List, comma separated'))];
  const turnOf = (step: number) => steps[step].map((l) => JSON.parse(l) as { uuid?: string; type: string }).filter((r) => typeof r.uuid === 'string').map((r) => r.uuid!);
  // the words the prompts on the chain asked for, in chain order
  const wordsOnChain = (follower: ChainFollower) =>
    follower.snapshot().chain.flatMap((uuid) => {
      const content = records.find((r) => r.uuid === uuid)?.message?.content;
      const word = typeof content === 'string' ? /^Reply with exactly the word (\w+)$/.exec(content)?.[1] : undefined;
      return word === undefined ? [] : [word];
    });

  async function feed(pinned: { on: boolean }) {
    const reader = new MemoryFileReader(joined(steps[0]));
    const out = new Collector();
    const follower = new ChainFollower(reader, SESSION, null, out.sink, { holders: () => 2, pinned: () => pinned.on, isOwnRecord });
    await follower.start();
    const marks: number[] = [];
    for (const step of steps.slice(1)) {
      marks.push(out.events().length);
      reader.append(joined(step));
      await follower.poke();
    }
    return { reader, out, follower, marks };
  }

  // review finding: after MAWS's process exits one live holder is left, the terminal; its sibling prompt then has the
  // shape of a terminal /rewind, which must not outrank the pin (a cold hydration after a yield reads exactly this)
  it('pinned with one live holder, a foreign sibling prompt is held back, not read as a terminal rewind', async () => {
    const own = (type: 'user' | 'assistant', uuid: string, parentUuid: string | null, n: number, entrypoint = 'sdk-ts') =>
      line({ type, uuid, parentUuid, entrypoint, cwd: '/d', timestamp: at(n), message: type === 'user' ? { role: 'user', content: `${uuid} asks` } : { role: 'assistant', content: [{ type: 'text', text: `${uuid} says` }] } });
    const lines = [own('user', 'u1', null, 0), own('assistant', 'a1', 'u1', 1), own('user', 'u2', 'a1', 2), own('assistant', 'a2', 'u2', 3), own('user', 'c1', 'a1', 4, 'cli')];
    for (const pinned of [false, true]) {
      const out = new Collector();
      const follower = new ChainFollower(new MemoryFileReader(joined(lines)), SESSION, null, out.sink, { holders: () => 1, pinned: () => pinned, isOwnRecord });
      await follower.start();
      if (pinned) {
        expect(out.of('boundary.rewind')).toEqual([]);
        expect(out.of('notice.posted').map((e) => e.key)).toEqual(['transcript_branch_held']);
        expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u2', 'a2']);
      } else {
        expect(out.of('boundary.rewind').map((e) => e.targetMessageUuid)).toEqual(['u2']); // the heuristic, unpinned
      }
    }
  });

  it('attributes PID-less probe records only through unambiguous holder evidence', () => {
    const sdk = records.find((record) => record.entrypoint === 'sdk-ts')!;
    expect(sdk).not.toHaveProperty('pid'); // the real engine does not persist writer PIDs
    expect(isOwnRecord(sdk)).toBe(true);
    const contested = [...writers, { pid: 43, sessionId: SESSION, entrypoint: 'sdk-ts' }];
    expect(ownsTranscriptRecord(sdk, SESSION, contested, ownPids)).toBe(false);
    expect(ownsTranscriptRecord(sdk, SESSION, [], ownPids)).toBe(false);
    expect(ownsTranscriptRecord(sdk, 'other' as SessionId, writers, ownPids)).toBe(false);
    expect(ownsTranscriptRecord({ ...sdk, pid: 42 }, SESSION, contested, ownPids)).toBe(true);
    expect(ownsTranscriptRecord({ ...sdk, pid: 43 }, SESSION, writers, ownPids)).toBe(false);
    expect(ownsTranscriptRecord({ entrypoint: 'cli', pid: 42 }, SESSION, writers, ownPids)).toBe(false);
  });

  it('records the writers it claims: one fork, a terminal branch and a MAWS branch', () => {
    expect(cuts.every((i) => i > 0)).toBe(true);
    expect(records[cuts[0]].entrypoint).toBe('cli');
    expect(records[cuts[1]].entrypoint).toBe('sdk-ts');
    expect(records[cuts[2]].entrypoint).toBe('cli');
  });

  it('without the pin (before W7) each writer flips the view: MAWS_TWO vanishes when the terminal writes again', async () => {
    const { out, follower, marks } = await feed({ on: false });
    const between = (from: number, to?: number) => out.events().slice(marks[from], to === undefined ? undefined : marks[to]);
    expect(between(0, 1).filter((e) => e.kind === 'boundary.retraction')).toEqual([]); // TERMINAL_ONE extends MAWS_ONE
    const flipToMaws = between(1, 2).filter((e) => e.kind === 'boundary.retraction' || e.kind === 'notice.posted');
    expect(flipToMaws.map((e) => e.kind)).toEqual(['boundary.retraction']);
    expect((flipToMaws[0] as Extract<SessionEvent, { kind: 'boundary.retraction' }>).retractedMessageUuids).toEqual(turnOf(1));
    const flipBack = between(2, 3).filter((e) => e.kind === 'boundary.retraction');
    expect(flipBack.map((e) => e.retractedMessageUuids)).toEqual([turnOf(2)]); // MAWS_TWO's turn leaves the view
    expect(out.of('notice.posted').map((e) => e.text)).toEqual([]);
    expect(wordsOnChain(follower)).toEqual(['MAWS_ONE', 'TERMINAL_ONE', 'TERMINAL_TWO']);
  });

  it('pinned while a foreign process holds the session, MAWS_TWO stays in view and the other branch waits; the re-fold shows what a resume continues from', async () => {
    const pinned = { on: true };
    const { out, follower, marks } = await feed(pinned);
    // MAWS's own record still moves the view to its branch (its branch is the one kept)
    expect(out.events().slice(marks[1], marks[2]).filter((e) => e.kind === 'boundary.retraction').map((e) => e.retractedMessageUuids)).toEqual([turnOf(1)]);
    // the terminal's second turn and its exit are held back: no retraction, one notice
    const held = out.events().slice(marks[2]);
    expect(held.filter((e) => e.kind === 'boundary.retraction')).toEqual([]);
    expect(held.filter((e) => e.kind === 'notice.posted').map((e) => e.key)).toEqual(['transcript_branch_held']);
    expect(follower.snapshot().leaf).toBe(turnOf(2).at(-1));
    expect(wordsOnChain(follower)).toEqual(['MAWS_ONE', 'MAWS_TWO']);

    // the terminal exits: the follower reads the file again and reconciles once
    pinned.on = false;
    const before = out.events().length;
    await follower.refold();
    const refold = out.events().slice(before);
    expect(refold.filter((e) => e.kind === 'boundary.retraction').map((e) => [e.reason, e.retractedMessageUuids])).toEqual([['transcript_branch', turnOf(2)]]);
    expect(refold.filter((e) => e.kind === 'notice.posted').map((e) => e.key)).toEqual(['transcript_refold']);
    expect(follower.snapshot().leaf).toBe(turnOf(4).at(-1));
    expect(wordsOnChain(follower)).toEqual(['MAWS_ONE', 'TERMINAL_ONE', 'TERMINAL_TWO']);
    expectWellFormed(out.events());
    // a second re-fold has nothing held back
    const settled = out.events().length;
    await follower.refold();
    expect(out.events().length).toBe(settled);
  });
});
