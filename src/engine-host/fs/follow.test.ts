import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import type { ReadRange } from '../../../test/support/memory-reader';
import { StoreFixture } from '../../../test/support/store-fixture';
import { ChainFollower, type FileReader } from './chain-follower';
import { Follow, FsFileReader } from './follow';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const S1 = '11111111-1111-4111-8111-111111111111';
const SIDECARS = join(FIXTURE_DIR, 'subagent-sidecars');
const WORKFLOW_DISK = join(FIXTURE_DIR, 'pass2/workflow-disk');

describe('the fs FileReader opens the file per read', () => {
  let fixture: StoreFixture;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('reports a missing or unlocated file as absent, reads exact ranges, and sees a rename-over as a new inode', async () => {
    let located: string | null = null;
    const reader = new FsFileReader(() => located);
    expect(await reader.stat()).toBeNull(); // not located yet: a MAWS-launched session before its first record
    located = `${fixture.paths.projects}/-work-a/${S1}.jsonl`;
    expect(await reader.stat()).toBeNull(); // located, not written yet

    const path = await fixture.addTranscript('/work/a', S1, ['{"a":1}', '{"b":2}']);
    expect(path).toBe(located);
    const first = await reader.stat();
    expect(first).toEqual({ ino: expect.any(Number), size: 16 });
    expect((await reader.read(8, 8)).toString()).toBe('{"b":2}\n');
    expect((await reader.read(13, 100)).toString()).toBe('2}\n'); // a read past the end returns what there is

    await fixture.rewriteFile(path, ['{"c":3}']);
    const second = await reader.stat();
    expect(second?.ino).not.toBe(first?.ino);
    expect(second?.size).toBe(8);
  });

  it('answers a read after a rename-over with no bytes (a reload), never the new file\'s bytes under the old inode', async () => {
    const path = await fixture.addTranscript('/work/a', S1, ['{"a":1}', '{"b":2}']);
    const reader = new FsFileReader(() => path);
    const before = await reader.stat();
    await fixture.rewriteFile(path, ['{"replaced":true}', '{"x":0}']);
    expect(await reader.read(0, 16)).toEqual(Buffer.alloc(0)); // the handle's inode is not the one the follower stat'ed
    const after = await reader.stat();
    expect(after?.ino).not.toBe(before?.ino);
    expect((await reader.read(0, 18)).toString()).toBe('{"replaced":true}\n');
  });

  it('abandons and retries a reload whose own read meets a second replacement, never retracting what still stands', async () => {
    const record = (uuid: string, parentUuid: string | null, content: string) => JSON.stringify({ type: 'user', uuid, parentUuid, cwd: '/w', message: { role: 'user', content } });
    const base = [record('u1', null, 'one'), record('u2', 'u1', 'two')];
    const path = await fixture.addTranscript('/work/a', S1, base);
    const inner = new FsFileReader(() => path);
    let replaceDuringRead: (() => Promise<void>) | null = null;
    const reader: FileReader = {
      path,
      stat: () => inner.stat(),
      read: async (offset, length) => {
        const replace = replaceDuringRead;
        replaceDuringRead = null;
        if (replace) await replace();
        return inner.read(offset, length);
      },
    };
    const events: SessionEvent[] = [];
    const states: string[] = [];
    const follower = new ChainFollower(reader, S1 as SessionId, null, (e) => {
      if (e.t === 'events') events.push(...e.events);
      if (e.t === 'state') states.push(e.state);
    });
    await follower.start();
    expect(follower.snapshot().chain).toEqual(['u1', 'u2']);
    const delivered = events.length;

    // First rewrite (the GC shape); the reload stats it, and a second rewrite lands between that stat and its read.
    await fixture.rewriteFile(path, [...base, record('u3', 'u2', 'three')]);
    replaceDuringRead = () => fixture.rewriteFile(path, [...base, record('u3', 'u2', 'three'), record('u4', 'u3', 'four')]);
    await follower.poke();

    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u3', 'u4']);
    const later = events.slice(delivered);
    expect(later.filter((e) => e.kind === 'boundary.retraction')).toEqual([]); // u1 and u2 still stand
    expect(later.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['three', 'four']);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(states.slice(-2)).toEqual(['reloading', 'following']);
  });

  it('a start whose read meets a replacement retries from a fresh stat and reports following only once complete', async () => {
    const record = (uuid: string, parentUuid: string | null, content: string) => JSON.stringify({ type: 'user', uuid, parentUuid, cwd: '/w', message: { role: 'user', content } });
    const path = await fixture.addTranscript('/work/a', S1, [record('u1', null, 'the old file, whose size covers the whole first record of the new one')]);
    const inner = new FsFileReader(() => path);
    let replaceOnce = true;
    // The replacement lands after the follower's stat and before its read: the rename-over race.
    const reader: FileReader = {
      path,
      stat: () => inner.stat(),
      read: async (offset, length) => {
        if (replaceOnce) {
          replaceOnce = false;
          await fixture.rewriteFile(path, [record('n0', null, 'new'), record('n1', 'n0', 'new file, second record, past the old size')]);
        }
        return inner.read(offset, length);
      },
    };
    const host = recordingHost();
    const follow = new Follow({ appSessionId: 'app-race' as AppSessionId, sessionId: S1 as SessionId, agent: null, reader, emit: host.emit });
    await follow.started; // no poke: the start itself re-stats and retries
    const snapshot = follow.snapshot();
    expect(snapshot.complete).toBe(true);
    expect(host.states.at(-1)).toMatchObject({ state: 'following', chainLength: 2, leafUuid: 'n1' });
    expect(snapshot.events.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['new', 'new file, second record, past the old size']);
    expect(snapshot.events.filter((e) => e.kind === 'boundary.retraction')).toEqual([]);
    expect(host.events.map((e) => e.id)).toEqual(snapshot.events.map((e) => e.id)); // nothing read under the old inode
    expect(host.states.map((s) => s.state)).toEqual(['backfilling', 'following']);
  });

  it('a start whose reads keep meeting replacements stays backfilling, incomplete, until a poke completes it', async () => {
    const record = (uuid: string, parentUuid: string | null) => JSON.stringify({ type: 'user', uuid, parentUuid, cwd: '/w', message: { role: 'user', content: uuid } });
    const lines = [record('u1', null), record('u2', 'u1')];
    const path = await fixture.addTranscript('/work/a', S1, lines);
    const inner = new FsFileReader(() => path);
    let churning = true;
    const reader: FileReader = {
      path,
      stat: () => inner.stat(),
      read: async (offset, length) => {
        if (churning) await fixture.rewriteFile(path, lines); // a new inode under every read
        return inner.read(offset, length);
      },
    };
    const host = recordingHost();
    const follow = new Follow({ appSessionId: 'app-churn' as AppSessionId, sessionId: S1 as SessionId, agent: null, reader, emit: host.emit });
    await follow.started;
    expect(follow.state).toBe('backfilling');
    expect(follow.snapshot()).toEqual({ events: [], complete: false });
    expect(host.states.map((s) => s.state)).not.toContain('following');

    churning = false;
    await follow.poke();
    expect(follow.state).toBe('following');
    const snapshot = follow.snapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.events.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['u1', 'u2']);
  });

  it('an ordinary poke whose read meets a replacement delivers nothing partial and completes from the next stat', async () => {
    const record = (uuid: string, parentUuid: string | null) => JSON.stringify({ type: 'user', uuid, parentUuid, cwd: '/w', message: { role: 'user', content: uuid } });
    const path = await fixture.addTranscript('/work/a', S1, [record('u1', null), record('u2', 'u1')]);
    const inner = new FsFileReader(() => path);
    let replaceDuringRead: (() => Promise<void>) | null = null;
    const reader: FileReader = {
      path,
      stat: () => inner.stat(),
      read: async (offset, length) => {
        const replace = replaceDuringRead;
        replaceDuringRead = null;
        if (replace) await replace();
        return inner.read(offset, length);
      },
    };
    const events: SessionEvent[] = [];
    const states: string[] = [];
    const follower = new ChainFollower(reader, S1 as SessionId, null, (e) => {
      if (e.t === 'events') events.push(...e.events);
      if (e.t === 'state') states.push(e.state);
    });
    await follower.start();
    const delivered = events.length;

    // An append, then the file is replaced (u3 kept, u4 added) between the poke's stat and its read.
    await fixture.appendLines(path, [record('u3', 'u2')]);
    replaceDuringRead = () => fixture.rewriteFile(path, [record('u1', null), record('u2', 'u1'), record('u3', 'u2'), record('u4', 'u3')]);
    await follower.poke();

    expect(follower.snapshot().chain).toEqual(['u1', 'u2', 'u3', 'u4']);
    const later = events.slice(delivered);
    expect(later.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['u3', 'u4']);
    expect(later.filter((e) => e.kind === 'boundary.retraction')).toEqual([]);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(states.at(-1)).toBe('following');
  });
});

// A host emit that keeps what a Follow sends: its event batches, flattened, and its follow states, in order.
function recordingHost() {
  const events: SessionEvent[] = [];
  const states: EventPayload<'fs.followState'>[] = [];
  const emit = ((name: EventName, payload: unknown) => {
    if (name === 'session.eventBatch') events.push(...(payload as EventPayload<'session.eventBatch'>).events);
    if (name === 'fs.followState') states.push(payload as EventPayload<'fs.followState'>);
    return true;
  }) as HostEmit;
  return { events, states, emit };
}

// ---- following through the service (M3 pins) ------------------------------------------------------------------------

const REWIND = 'bdb23713-2f6c-40f3-8b18-b41a667a64e3' as SessionId;
const REWIND_DIR = '/private/tmp/maws-probe2-FIiJVW';
const PARENT = '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId;
const APP = 'app-rewind' as AppSessionId;
const rewindLines = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-real.jsonl'), 'utf8').split('\n').filter((line) => line.length > 0);
const lineOf = (prefix: string) => rewindLines.findIndex((line) => line.includes(`"uuid":"${prefix}`));

type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];

// The real `fs` reader with every stat and read recorded, so the tailer's reads can be asserted on the real file.
class RecordingReader implements FileReader {
  readonly ranges: ReadRange[] = [];
  stats = 0;
  private readonly inner: FsFileReader;
  constructor(locate: () => string | null) {
    this.inner = new FsFileReader(locate);
  }
  get path() {
    return this.inner.path;
  }
  stat() {
    this.stats += 1;
    return this.inner.stat();
  }
  read(offset: number, length: number) {
    this.ranges.push({ offset, length });
    return this.inner.read(offset, length);
  }
  // The tailer's invariant over the whole backfill: contiguous, ascending, disjoint, union exactly [0, size).
  assertContiguousTo(size: number) {
    let next = 0;
    for (const range of this.ranges) {
      expect(range.offset).toBe(next);
      next += range.length;
    }
    expect(next).toBe(size);
  }
}

describe('a followed session backfills, then tails its transcript', () => {
  let fixture: StoreFixture;
  let service: FsService | null;
  let emitted: Emitted[];
  let readers: RecordingReader[];
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    service = null;
    emitted = [];
    readers = [];
  });
  afterEach(async () => {
    service?.stop();
    await fixture.dispose();
  });

  const start = async (options: { reconcileMs?: number } = {}) => {
    service = new FsService({
      paths: fixture.paths,
      emit: (name, payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
        emitted.push({ name, payload } as Emitted);
        return true;
      },
      openReader: (locate) => {
        const reader = new RecordingReader(locate);
        readers.push(reader);
        return reader;
      },
      reconcileMs: options.reconcileMs,
    });
    await service.start();
    await settled();
    return service;
  };
  const events = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const delivered = (app: AppSessionId = APP) => events('session.eventBatch').filter((b) => b.appSessionId === app).flatMap((b) => b.events);
  const lastState = (app: AppSessionId = APP, agentId: string | null = null) => events('fs.followState').filter((s) => s.appSessionId === app && s.agentId === agentId).at(-1);
  const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));
  const ids = (list: SessionEvent[]) => list.map((e) => e.id);

  it('backfills 26 lines, shrinks at the rewound anchor, and rejoins the continuation with no boundary', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines.slice(0, 26));
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);

    const snapshot = await fs.eventsSnapshot(APP, null);
    expect(snapshot.complete).toBe(true);
    const backfill = lastState();
    expect(backfill).toMatchObject({ state: 'following', leafUuid: expect.stringMatching(/^57525d04/), gap: null });
    expect(ids(delivered())).toEqual(ids(snapshot.events));
    expect(delivered().some((e) => e.kind === 'assistant.block.complete' && e.messageUuid.startsWith('57525d04'))).toBe(true);
    const states = events('fs.followState').map((s) => s.state);
    expect(states.indexOf('following')).toBeGreaterThan(states.indexOf('backfilling'));

    const anchorAt = Date.now();
    await fixture.appendLines(path, [rewindLines[26]]);
    await expect.poll(() => delivered().some((e) => e.kind === 'boundary.rewind'), { interval: 5, timeout: 1000 }).toBe(true);
    expect(Date.now() - anchorAt).toBeLessThan(300);
    const rewind = delivered().find((e) => e.kind === 'boundary.rewind');
    expect(rewind).toMatchObject({ precedingAssistantUuid: expect.stringMatching(/^edf0f954/), prefillText: 'Also remember the word BANANA. Reply OK.' });
    await expect.poll(() => lastState()?.chainLength).toBe(backfill!.chainLength - 3);

    await fixture.appendLines(path, rewindLines.slice(27));
    await expect.poll(() => lastState()?.leafUuid).toMatch(/^7c05f769/);
    const all = delivered();
    expect(all.filter((e) => e.kind === 'boundary.rewind')).toHaveLength(1);
    expect(all.filter((e) => e.kind === 'boundary.retraction' || e.kind === 'notice.posted')).toEqual([]);
    expect(new Set(ids(all)).size).toBe(all.length);
  });

  it('delivers a record split across two writes once, reading exactly the two appended ranges; a reconcile poke on an unchanged file reads nothing', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start({ reconcileMs: 40 });
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const reader = readers[0];
    const size = statSync(path).size;
    reader.assertContiguousTo(size);

    // Unchanged file: the reconcile timer stats it and reads nothing.
    reader.ranges.length = 0;
    const stats = reader.stats;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reader.stats).toBeGreaterThan(stats + 2);
    expect(reader.ranges).toEqual([]);

    const leaf = lastState()!.leafUuid!;
    const record = Buffer.from(
      JSON.stringify({ type: 'assistant', uuid: 'c4-m3-split', parentUuid: leaf, timestamp: '2026-09-28T10:00:00.000Z', message: { id: 'msg_split', model: 'm', content: [{ type: 'text', text: 'split in two' }] } }) + '\n',
    );
    const cut = 40;
    const before = delivered().length;
    await fixture.appendBytes(path, record.subarray(0, cut));
    await expect.poll(() => reader.ranges.length).toBe(1);
    expect(delivered().length).toBe(before);
    await fixture.appendBytes(path, record.subarray(cut));
    await expect.poll(() => delivered().length).toBe(before + 1);
    expect(delivered().at(-1)).toMatchObject({ kind: 'assistant.block.complete', messageUuid: 'c4-m3-split' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(delivered().length).toBe(before + 1);
    expect(reader.ranges).toEqual([
      { offset: size, length: cut },
      { offset: size + cut, length: record.length - cut },
    ]);
  });

  it('reloads a rewritten transcript (the GC shape) to the same chain with no duplicate event ids', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const before = lastState()!;
    expect(before.leafUuid).toMatch(/^7c05f769/);
    const count = events('fs.followState').length;

    const abandoned = new Set([lineOf('36a2aa44'), lineOf('57525d04')]);
    await fixture.rewriteFile(path, rewindLines.filter((_, i) => !abandoned.has(i)));
    await expect.poll(() => events('fs.followState').slice(count).map((s) => s.state)).toEqual(['reloading', 'following']);
    expect(lastState()).toMatchObject({ chainLength: before.chainLength, leafUuid: before.leafUuid });
    const all = delivered();
    expect(new Set(ids(all)).size).toBe(all.length);
    expect(all.filter((e) => e.kind === 'boundary.retraction')).toEqual([]);
  });

  it('answers a second snapshot while following with every event once and complete, and stops on fs.unfollow', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    const first = await fs.eventsSnapshot(APP, null);
    const second = await fs.eventsSnapshot(APP, null);
    expect(second.complete).toBe(true);
    expect(ids(second.events)).toEqual(ids(first.events));
    expect(new Set(ids(second.events)).size).toBe(second.events.length);
    expect(events('fs.followState').filter((s) => s.state === 'backfilling')).toHaveLength(1); // one follower
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]);

    await fs.unfollow(APP, null);
    expect(lastState()?.state).toBe('stopped');
    expect(fs.state().followed).toEqual([]);
    const count = emitted.length;
    await fixture.appendLines(path, [JSON.stringify({ type: 'user', uuid: 'after', parentUuid: lastState()!.leafUuid, message: { role: 'user', content: 'x' } })]);
    await settled();
    expect(emitted.slice(count).filter((e) => e.name === 'session.eventBatch' || e.name === 'fs.followState')).toEqual([]);
  });

  // The disk half of the disk-to-live handoff (main's fs.unfollow when C3 reports the app id live, source.ts
  // liveStatus): only a read (eventsSnapshot, agentEvents) starts a session's follow, so nothing a live MAWS process
  // does to the store afterwards starts it again and puts disk-form copies of its live events on session.eventBatch:
  // its own registry record (every `-p` launch writes one), its appends, main's re-sent binding and scan (sync).
  it('after fs.unfollow, a live process on the session (its registry record, its appends, main\'s re-sent binding and scan) starts no follow', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines.slice(0, 26));
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null); // the pane read before the launch
    await fs.unfollow(APP, null); // the handoff at the launch's first status
    const count = emitted.length;

    await fixture.addRegistryRecord(process.pid, { sessionId: REWIND, cwd: REWIND_DIR, startedAt: Date.now() });
    await expect.poll(() => events('fs.holderChanged').some((e) => e.sessionId === REWIND && e.holder.kind !== 'none')).toBe(true);
    await fixture.appendLines(path, rewindLines.slice(26));
    await expect.poll(() => events('fs.sessionChanged').filter((e) => e.summary.sessionId === REWIND && e.appSessionId === APP).length).toBeGreaterThan(0);
    await fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    const { size, mtimeMs } = statSync(path);
    await fs.scan([{ sessionId: REWIND, appSessionId: APP, size, mtimeMs }]);
    await settled();

    expect(fs.state().followed).toEqual([]);
    expect(emitted.slice(count).filter((e) => e.name === 'session.eventBatch' || e.name === 'fs.followState')).toEqual([]);
  });

  it.each(['new path first, then the old one deleted', 'old path deleted first, then the new one written'])(
    'follows a relocated transcript to the surviving file whatever order the notifications arrive in (%s)',
    async (order) => {
      const oldPath = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
      const fs = await start();
      fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
      await fs.eventsSnapshot(APP, null);
      expect(lastState()?.leafUuid).toMatch(/^7c05f769/);

      const moved = join(fixture.paths.projects, '-private-tmp-moved', `${REWIND}.jsonl`);
      const extra = JSON.stringify({ type: 'user', uuid: 'after-move', parentUuid: lastState()!.leafUuid, message: { role: 'user', content: 'after the move' } });
      const writeNew = async () => {
        await mkdir(dirname(moved), { recursive: true });
        await writeFile(moved, [...rewindLines, extra].map((line) => `${line}\n`).join(''));
      };
      if (order.startsWith('new')) {
        await writeNew();
        await settled();
        await rm(oldPath);
      } else {
        await rm(oldPath);
        await settled();
        await writeNew();
      }
      await expect.poll(() => lastState()?.leafUuid, { timeout: 3000 }).toBe('after-move');
      // Once both notifications have been handled, the follower's location is the surviving file (what the 30 s
      // reconcile stats), not whichever path was notified last.
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(readers[0].path).toBe(moved);

      // The follower stays on the surviving file: a later append there arrives.
      await settled();
      await fixture.appendLines(moved, [JSON.stringify({ type: 'user', uuid: 'later', parentUuid: 'after-move', message: { role: 'user', content: 'later' } })]);
      await expect.poll(() => lastState()?.leafUuid, { timeout: 3000 }).toBe('later');
    },
  );

  it('fs.unbind drops the pair and stops the session\'s followers; later events carry no app id, and an unknown id is a no-op', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    expect(fs.state()).toMatchObject({ bound: 1, followed: [{ appSessionId: APP, agentId: null }] });

    await fs.unbind(APP);
    expect(lastState()?.state).toBe('stopped');
    expect(fs.state()).toMatchObject({ bound: 0, followed: [] });
    await expect(fs.eventsSnapshot(APP, null)).rejects.toThrow(`unknown app session: ${APP}`);
    await expect(fs.unbind(APP)).resolves.toBeUndefined();
    await expect(fs.unbind('app-never-bound' as AppSessionId)).resolves.toBeUndefined();

    const count = emitted.length;
    await fixture.appendLines(path, [JSON.stringify({ type: 'custom-title', customTitle: 'After the unbind', sessionId: REWIND })]);
    await expect.poll(() => events('fs.sessionChanged').some((e) => e.summary.customTitle === 'After the unbind')).toBe(true);
    const later = emitted.slice(count);
    expect(later.filter((e) => e.name === 'session.eventBatch' || e.name === 'fs.followState')).toEqual([]);
    expect(later.filter((e) => e.name === 'fs.sessionChanged').map((e) => e.payload)).toEqual([expect.objectContaining({ appSessionId: null })]);
  });

  it('fs.bind of a new engine id for a bound app id (the engine\'s /clear) replaces the pair and moves its follower to the new transcript', async () => {
    const old = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const next = await fixture.addTranscript('/work/cleared', S1, [JSON.stringify({ type: 'user', uuid: 'n1', parentUuid: null, cwd: '/work/cleared', message: { role: 'user', content: 'after the clear' } })]);
    const fs = await start();
    await fs.scan([]);
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const before = delivered().length;

    // A snapshot asked the moment bind returns, before its promise settles, never answers the old transcript.
    const rebinding = fs.bind([{ sessionId: S1 as SessionId, appSessionId: APP }]);
    const early = await fs.eventsSnapshot(APP, null);
    expect(early.events.every((e) => e.sessionId === S1)).toBe(true);
    expect(early.events.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['after the clear']);
    await rebinding;
    expect(fs.state()).toMatchObject({ bound: 1, followed: [{ appSessionId: APP, agentId: null }] });
    const states = events('fs.followState').filter((s) => s.appSessionId === APP).map((s) => s.state);
    expect(states).toContain('stopped');
    const snapshot = await fs.eventsSnapshot(APP, null);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.events.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['after the clear']);
    expect(snapshot.events.every((e) => e.sessionId === S1)).toBe(true);
    await expect.poll(() => lastState()?.leafUuid).toBe('n1');
    expect(delivered().slice(before).every((e) => e.sessionId === S1)).toBe(true);

    // The old transcript is nobody's now: its changes reach main unbound (main made it a record of its own), and nothing
    // of it reaches the app session; the new one's appends do.
    await fixture.appendLines(old, [JSON.stringify({ type: 'custom-title', customTitle: 'Old after the clear', sessionId: REWIND })]);
    await expect.poll(() => events('fs.sessionChanged').find((e) => e.summary.customTitle === 'Old after the clear')?.appSessionId).toBeNull();
    await fixture.appendLines(next, [JSON.stringify({ type: 'user', uuid: 'n2', parentUuid: 'n1', cwd: '/work/cleared', message: { role: 'user', content: 'second' } })]);
    await expect.poll(() => lastState()?.leafUuid).toBe('n2');
    expect(delivered().slice(before).every((e) => e.sessionId === S1)).toBe(true);
  });

  it('a rebind while the old follower is still starting: a snapshot asked right after never joins the old start', async () => {
    await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    await fixture.addTranscript('/work/cleared', S1, [JSON.stringify({ type: 'user', uuid: 'n1', parentUuid: null, cwd: '/work/cleared', message: { role: 'user', content: 'after the clear' } })]);
    const fs = await start();
    await fs.scan([]);
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    const old = fs.eventsSnapshot(APP, null); // its start is in flight (the agent listing is awaited first)
    const rebinding = fs.bind([{ sessionId: S1 as SessionId, appSessionId: APP }]);
    const fresh = await fs.eventsSnapshot(APP, null);
    expect(fresh.events.flatMap((e) => (e.kind === 'user.message' ? [e.content] : []))).toEqual(['after the clear']);
    await old;
    await rebinding;
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]);
    expect((await fs.eventsSnapshot(APP, null)).events.every((e) => e.sessionId === S1)).toBe(true);
  });

  // Whole-branch review: the first start resolves while a later start (after A → B → A) holds its key and names the
  // same transcript. Only the start that owns the key may store its follower; the displaced one is stopped, not stored
  // (stored, it would be overwritten by the owner's and keep running unreachable).
  it('a rebind A → B → A while the first follower is still starting stores only the last start; the first is stopped', async () => {
    await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    await fixture.addTranscript('/work/cleared', S1, [JSON.stringify({ type: 'user', uuid: 'n1', parentUuid: null, cwd: '/work/cleared', message: { role: 'user', content: 'after the clear' } })]);
    const fs = await start();
    await fs.scan([]);
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    const first = fs.eventsSnapshot(APP, null); // start 1 on A, in flight
    const toB = fs.bind([{ sessionId: S1 as SessionId, appSessionId: APP }]); // start 2 on B
    const backToA = fs.bind([{ sessionId: REWIND, appSessionId: APP }]); // start 3 on A
    const stale = await first;
    await Promise.all([toB, backToA]);
    await settled();
    // Three followers started; two were stopped (B's by the move back, the first A's on resolving), one stands.
    const states = events('fs.followState').filter((s) => s.appSessionId === APP).map((s) => s.state);
    expect(states.filter((s) => s === 'backfilling')).toHaveLength(3);
    expect(states.filter((s) => s === 'stopped')).toHaveLength(2);
    expect(stale.events).toEqual([]); // the displaced start answered from a stopped follower
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]);
    const now = await fs.eventsSnapshot(APP, null);
    expect(now.complete).toBe(true);
    expect(now.events.every((e) => e.sessionId === REWIND)).toBe(true);
    // Unfollowing stops the one that stands, and nothing is left running: no follower of the app id reports again.
    await fs.unfollow(APP, null);
    expect(events('fs.followState').filter((s) => s.appSessionId === APP && s.state === 'stopped')).toHaveLength(3);
  });

  it('reads a terminal rewind (no anchor) as boundary.rewind with one registry holder or none, and as a fork with two', async () => {
    const TERMINAL = 'a76ad588-e4b4-4a99-bf4e-69287514916f' as SessionId;
    const lines = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-terminal.jsonl'), 'latin1').split('\n').filter((l) => l.length > 0).slice(0, 48);
    await fixture.addTranscript('/private/tmp/maws-accept', TERMINAL, lines.slice(0, 42));
    await fixture.addRegistryRecord(process.pid, { sessionId: TERMINAL, cwd: '/private/tmp/maws-accept', kind: 'interactive', startedAt: Date.now() });
    const fs = await start();
    await fs.scan([]);
    fs.bind([{ sessionId: TERMINAL, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    await fixture.appendBytes(fixture.transcriptPath(TERMINAL), Buffer.from(lines.slice(42).map((l) => `${l}\n`).join(''), 'latin1'));
    await expect.poll(() => lastState()?.leafUuid).toMatch(/^c25b804b/);
    expect(delivered().filter((e) => e.kind === 'boundary.rewind').map((e) => e.kind === 'boundary.rewind' && e.targetMessageUuid.slice(0, 8))).toEqual(['7b39835b']);
    expect(delivered().filter((e) => e.kind === 'boundary.retraction' || e.kind === 'notice.posted')).toEqual([]);

    // Each later follow re-reads the whole file under a fresh app id, with the registry as it is then.
    const refollow = async (app: string) => {
      await fs.unbind(APP);
      await fs.unbind('app-terminal-contested' as AppSessionId);
      fs.bind([{ sessionId: TERMINAL, appSessionId: app as AppSessionId }]);
      const events = (await fs.eventsSnapshot(app as AppSessionId, null)).events;
      return { rewinds: events.filter((e) => e.kind === 'boundary.rewind').length, retractions: events.filter((e) => e.kind === 'boundary.retraction').length, notices: events.flatMap((e) => (e.kind === 'notice.posted' ? [e.key] : [])) };
    };
    // Two live processes rule out a terminal rewind. FX8 keeps the fork boundary; only W7 holding a
    // foreign branch off MAWS-owned records posts a contention notice, not this historical parent mismatch.
    const second = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    try {
      await fixture.addRegistryRecord(second.pid!, { sessionId: TERMINAL, cwd: '/private/tmp/maws-accept', kind: 'interactive', startedAt: Date.now() });
      await expect.poll(async () => (await fs.holdersNow({ sessionIds: [TERMINAL], directories: null })).holders.length).toBe(2);
      expect(await refollow('app-terminal-contested')).toEqual({ rewinds: 0, retractions: 1, notices: [] });
    } finally {
      second.kill('SIGKILL');
    }
    // Nobody holding it (a historical backfill): the rewind again.
    await fixture.removeRegistryRecord(second.pid!);
    await fixture.removeRegistryRecord(process.pid);
    await expect.poll(() => fs.state().holders.length).toBe(0);
    expect(await refollow('app-terminal-unheld')).toEqual({ rewinds: 1, retractions: 0, notices: [] });
  });

  it('follows an app session whose transcript does not exist yet, and picks it up when it appears', async () => {
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    expect(await fs.eventsSnapshot(APP, null)).toEqual({ events: [], complete: true });
    await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    await expect.poll(() => lastState()?.leafUuid).toMatch(/^7c05f769/);
    expect(delivered().length).toBeGreaterThan(5);
  });

  it('refuses every fs.* command for an app session id main has not bound', async () => {
    const fs = await start();
    const unknown = 'app-unbound' as AppSessionId;
    const message = 'unknown app session: app-unbound';
    await expect(fs.eventsSnapshot(unknown, null)).rejects.toThrow(message);
    await expect(fs.unfollow(unknown, null)).rejects.toThrow(message);
    await expect(fs.subagents(unknown)).rejects.toThrow(message);
    await expect(fs.agentEvents(unknown, 'a1' as AgentId)).rejects.toThrow(message);
    await expect(fs.workflows(unknown)).rejects.toThrow(message);
  });

  it('lists subagents as their sidecars appear, parses a meta written late, and follows an agent with its attribution', async () => {
    const parentLines = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl'), 'utf8').split('\n').filter(Boolean);
    const parent = await fixture.addTranscript('/private/tmp/maws-probe-WmHZ2j', PARENT, parentLines);
    const fs = await start();
    const app = 'app-parent' as AppSessionId;
    fs.bind([{ sessionId: PARENT, appSessionId: app }]);
    const agentId = 'ad286defbc77bc090' as AgentId;

    const agentLines = readFileSync(join(SIDECARS, `agent-${agentId}.jsonl`), 'utf8').split('\n').filter(Boolean);
    const agentPath = await fixture.addSidecar(PARENT, `subagents/agent-${agentId}.jsonl`, agentLines.slice(0, 3).map((line) => `${line}\n`).join(''));
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents.map((a) => a.agentId)).toEqual([agentId]);
    const listed = events('fs.subagentsChanged').length;

    // Follow before the meta is read: refused, not attributed to no parent tool use for the rest of the follow.
    await expect(fs.agentEvents(app, agentId)).rejects.toThrow(`agent meta not yet available: ${agentId}`);
    expect(fs.state().followed).toEqual([]);

    // The child's transcript grows: its size and mtime change, the agent set and its meta do not, so nothing is emitted.
    await fixture.appendLines(agentPath, agentLines.slice(3));
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events('fs.subagentsChanged')).toHaveLength(listed);

    // A meta that names no tool use (the engine patches metas in place; SubagentMetaSchema requires only agentType) is
    // no attribution either: still refused.
    const metaPath = await fixture.addSidecar(PARENT, `subagents/agent-${agentId}.meta.json`, { agentType: 'general-purpose', description: 'Read and report one.txt content' });
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents[0].meta?.agentType).toBe('general-purpose');
    await expect(fs.agentEvents(app, agentId)).rejects.toThrow(`agent meta not yet available: ${agentId}`);
    expect(fs.state().followed).toEqual([]);
    await settled();
    const partial = events('fs.subagentsChanged').length;

    // The whole meta lands: exactly one fs.subagentsChanged, which is the consumer's cue to retry.
    await writeFile(metaPath, readFileSync(join(SIDECARS, `agent-${agentId}.meta.json`), 'utf8'));
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents[0].meta?.toolUseId).toBe('toolu_01CYiK6ncgQLFUQ2iqC1b4oB');
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(partial).toBe(listed + 1);
    expect(events('fs.subagentsChanged')).toHaveLength(listed + 2);
    expect(events('fs.subagentsChanged').at(-1)?.agents[0].size).toBe(statSync(agentPath).size); // the payload keeps size
    expect(events('fs.subagentsChanged').at(-1)).toMatchObject({
      appSessionId: app,
      agents: [{ agentId, runId: null, transcriptPath: join(dirname(parent), PARENT, 'subagents', `agent-${agentId}.jsonl`) }],
    });
    expect((await fs.subagents(app)).agents.map((a) => a.agentId)).toEqual([agentId]);

    const child = await fs.agentEvents(app, agentId);
    expect(child.complete).toBe(true);
    expect(child.events.length).toBeGreaterThan(5);
    for (const event of child.events) expect([event.agentId, event.parentToolUseId]).toEqual([agentId, 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB']);
    expect(delivered(app).every((e) => e.agentId === agentId)).toBe(true);
    expect(lastState(app, agentId)).toMatchObject({ state: 'following' });
    await expect(fs.agentEvents(app, 'no-such-agent' as AgentId)).rejects.toThrow('unknown agent: no-such-agent');

    // The parent's backfill starts the listed agent through the sidecar meta.
    const parentEvents = (await fs.eventsSnapshot(app, null)).events;
    expect(parentEvents.flatMap((e) => (e.kind === 'subagent.started' ? [e.taskId] : []))).toEqual([agentId]);
    expect(fs.state().followed).toEqual(expect.arrayContaining([{ appSessionId: app, agentId }, { appSessionId: app, agentId: null }]));
    await fs.unfollow(app, null); // the session and its agents
    expect(fs.state().followed).toEqual([]);
  });

  it('follows a workflow agent at once, with no parent tool use, though its meta names none', async () => {
    const session = 'bac6130b-8eb8-499e-aeb1-89e7624a52cd' as SessionId;
    const app = 'app-workflow' as AppSessionId;
    await fixture.addTranscript('/private/tmp/maws-probe2-1RzDNs', session, [
      JSON.stringify({ type: 'user', uuid: 'w1', parentUuid: null, cwd: '/private/tmp/maws-probe2-1RzDNs', message: { role: 'user', content: 'run it' } }),
    ]);
    const fs = await start();
    fs.bind([{ sessionId: session, appSessionId: app }]);
    const agentId = 'a014f6be436bed86b' as AgentId;
    const dir = 'subagents/workflows/wf_7cacbb2d-902';
    await fixture.addSidecar(session, `${dir}/agent-${agentId}.jsonl`, [
      JSON.stringify({ type: 'user', uuid: 'c1', parentUuid: null, isSidechain: true, agentId, cwd: '/private/tmp/maws-probe2-1RzDNs', message: { role: 'user', content: 'Reply with exactly ALPHA and nothing else.' } }),
      JSON.stringify({ type: 'assistant', uuid: 'c2', parentUuid: 'c1', isSidechain: true, agentId, message: { id: 'msg_a', model: 'm', content: [{ type: 'text', text: 'ALPHA' }] } }),
    ].map((line) => `${line}\n`).join(''));

    // No meta yet: a workflow agent still follows, since no meta would name a parent tool use anyway.
    const child = await fs.agentEvents(app, agentId);
    expect(child.complete).toBe(true);
    expect(child.events.map((e) => e.kind)).toEqual(['session.started', 'turn.started', 'user.message', 'assistant.block.complete']);
    for (const event of child.events) expect([event.agentId, event.parentToolUseId]).toEqual([agentId, null]);
    await fixture.addSidecar(session, `${dir}/agent-${agentId}.meta.json`, readFileSync(join(WORKFLOW_DISK, `agent-${agentId}.meta.json`), 'utf8'));
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents[0]).toMatchObject({ agentId, runId: 'wf_7cacbb2d-902', meta: { agentType: 'workflow-subagent' } });
  });

  it('reads workflow runs, and a followed session emits one workflow.progress per snapshot change', async () => {
    const session = 'bac6130b-8eb8-499e-aeb1-89e7624a52cd' as SessionId;
    const app = 'app-workflow' as AppSessionId;
    await fixture.addTranscript('/private/tmp/maws-probe2-1RzDNs', session, [
      JSON.stringify({ type: 'user', uuid: 'w1', parentUuid: null, cwd: '/private/tmp/maws-probe2-1RzDNs', message: { role: 'user', content: 'run it' } }),
    ]);
    const fs = await start();
    fs.bind([{ sessionId: session, appSessionId: app }]);
    await fs.eventsSnapshot(app, null);

    const run = 'wf_7cacbb2d-902';
    const snapshot = readFileSync(join(WORKFLOW_DISK, `${run}.json`), 'utf8');
    await fixture.addSidecar(session, `subagents/workflows/${run}/journal.jsonl`, readFileSync(join(WORKFLOW_DISK, 'journal.jsonl'), 'utf8'));
    await fixture.addSidecar(session, `subagents/workflows/${run}/agent-a014f6be436bed86b.meta.json`, readFileSync(join(WORKFLOW_DISK, 'agent-a014f6be436bed86b.meta.json'), 'utf8'));
    await fixture.addSidecar(session, `workflows/scripts/maws-probe-${run}.js`, readFileSync(join(WORKFLOW_DISK, `maws-probe-${run}.js`), 'utf8'));
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await expect.poll(() => delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(1);
    await expect.poll(() => events('fs.workflowChanged')).toContainEqual({ appSessionId: app, runId: run });
    const progress = delivered(app).find((e) => e.kind === 'workflow.progress');
    expect(progress).toMatchObject({ taskId: 'wayue3on6', workflowName: 'maws-probe', progress: JSON.parse(snapshot).workflowProgress });

    const { runs } = await fs.workflows(app);
    expect(runs).toHaveLength(1);
    expect(runs[0].snapshot?.agentCount).toBe(2);
    expect(runs[0].journal).toHaveLength(5);

    // A rewrite that changes nothing a consumer sees emits no second progress; one that advances it does.
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await settled();
    expect(delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(1);
    await fixture.addSidecar(session, `workflows/${run}.json`, { ...JSON.parse(snapshot), workflowProgress: [] });
    await expect.poll(() => delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(2);
    const [firstId, secondId] = delivered(app).flatMap((e) => (e.kind === 'workflow.progress' ? [e.id] : []));
    expect(secondId).not.toBe(firstId);
    // Back to the first progress: a new occurrence of its id, never the same id twice in one follow.
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await expect.poll(() => delivered(app).flatMap((e) => (e.kind === 'workflow.progress' ? [e.id] : []))).toEqual([firstId, secondId, `${firstId}@2`]);
    const second = await fs.eventsSnapshot(app, null);
    expect(second.events.filter((e) => e.kind === 'workflow.progress')).toHaveLength(3); // the snapshot carries them too
  });

  it('tells main a task list changed and reads it on request', async () => {
    const fs = await start();
    await fixture.addTask('team-a', { id: '1', subject: 'One', description: 'd', status: 'pending', blocks: [], blockedBy: [] });
    await expect.poll(() => events('fs.tasksChanged')).toContainEqual({ listId: 'team-a' });
    expect((await fs.tasks('team-a')).tasks.map((t) => t.subject)).toEqual(['One']);
  });
});
