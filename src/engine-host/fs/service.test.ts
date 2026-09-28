import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { StoreFixture } from '../../../test/support/store-fixture';
import { Discovery, type ListedTranscript } from './discovery';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS, type WatchFn } from './watcher';

const S1 = '11111111-1111-4111-8111-111111111111' as SessionId;
const S2 = '22222222-2222-4222-8222-222222222222' as SessionId;
const S3 = '33333333-3333-4333-8333-333333333333' as SessionId;
const A1 = 'app-1' as AppSessionId;
const NO_SUCH_PID = 2 ** 22 - 1;

type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];

const user = (uuid: string, parentUuid: string | null, cwd: string, content: string) =>
  JSON.stringify({ type: 'user', uuid, parentUuid, cwd, timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content } });
const titleLine = (sessionId: string, customTitle: string) => JSON.stringify({ type: 'custom-title', customTitle, sessionId });

describe('filesystem state service: discovery, sidecars and holders', () => {
  let fixture: StoreFixture;
  let emitted: Emitted[];
  let service: FsService | null;

  beforeEach(async () => {
    fixture = await StoreFixture.create();
    emitted = [];
    service = null;
  });
  afterEach(async () => {
    service?.stop();
    await fixture.dispose();
  });

  // Every payload is checked against its X2 schema, as the host runtime would before posting it.
  const start = async (watch?: WatchFn) => {
    service = new FsService({
      paths: fixture.paths,
      emit: (name, payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
        emitted.push({ name, payload } as Emitted);
      },
      watch,
    });
    await service.start();
    return service;
  };
  const events = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const clear = () => emitted.splice(0);
  // The timed pins measure steady-state latency: FSEvents starts its stream asynchronously and a write in its first
  // milliseconds is only caught by the settle rescan (watcher.ts), so their clocks start once that has run.
  const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));

  async function threeSessions() {
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first')]);
    await fixture.addSidecar(S1, 'custom-title.json', { customTitle: 'From the sidecar' });
    await fixture.addTranscript('/work/a', S2, [user('u1', null, '/work/a', 'second'), titleLine(S2, 'From the tail')]);
    await fixture.addTranscript('/work/b', S3, [JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: S3 })]);
  }

  it('fs.scan lists every session with its head and tail facts, and skips what main already knows', async () => {
    await threeSessions();
    const fs = await start();
    clear();

    const result = await fs.scan([]);
    expect(result).toMatchObject({ projects: 2, sessions: 3, changed: 3 });
    const changed = events('fs.sessionChanged');
    expect(changed).toHaveLength(3);
    const by = (id: SessionId) => changed.find((e) => e.summary.sessionId === id)!;
    expect(by(S1).summary).toMatchObject({ directory: '/work/a', customTitle: 'From the sidecar', hasMessages: true });
    expect(by(S2).summary).toMatchObject({ directory: '/work/a', customTitle: 'From the tail', hasMessages: true });
    expect(by(S3).summary).toMatchObject({ directory: null, customTitle: null, hasMessages: false });
    expect(changed.every((e) => e.appSessionId === null)).toBe(true);
    expect(events('fs.scanProgress').at(-1)).toEqual({ scanned: 3, total: 3 });

    clear();
    const known = changed.map((e) => ({ sessionId: e.summary.sessionId, appSessionId: `app-${e.summary.sessionId.slice(0, 1)}` as AppSessionId, size: e.summary.size, mtimeMs: e.summary.mtimeMs }));
    expect(await fs.scan(known)).toMatchObject({ projects: 2, sessions: 3, changed: 0 });
    expect(events('fs.sessionChanged')).toEqual([]);

    await fixture.appendLines(fixture.transcriptPath(S1), [user('u2', 'u1', '/work/a', 'more')]);
    await expect.poll(() => events('fs.sessionChanged').map((e) => [e.summary.sessionId, e.appSessionId]), { timeout: 1_000 }).toContainEqual([S1, 'app-1']);
    expect(fs.state()).toMatchObject({ configHome: fixture.configHome, watching: true, projects: 2, sessions: 3, bound: 3, followed: [], holders: [] });
    expect(fs.state().lastScanAt).not.toBeNull();
  });

  it('a custom-title line appended in the terminal reaches fs.sessionChanged within 200 ms, once', async () => {
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first')]);
    const fs = await start();
    fs.bind([{ sessionId: S1, appSessionId: A1 }]);
    await settled();
    clear();
    const appended = Date.now();
    await fixture.appendLines(fixture.transcriptPath(S1), [titleLine(S1, 'Renamed')]);
    await expect.poll(() => events('fs.sessionChanged').filter((e) => e.summary.customTitle === 'Renamed').length, { timeout: 200, interval: 5 }).toBe(1);
    expect(Date.now() - appended).toBeLessThan(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events('fs.sessionChanged')).toHaveLength(1);
    expect(events('fs.sessionChanged')[0].appSessionId).toBe(A1);
  });

  it('a transcript that vanishes is reported removed', async () => {
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first')]);
    const fs = await start();
    fs.bind([{ sessionId: S1, appSessionId: A1 }]);
    await rm(fixture.transcriptPath(S1));
    await expect.poll(() => events('fs.sessionRemoved'), { timeout: 1_000 }).toEqual([{ sessionId: S1, appSessionId: A1 }]);
    expect(fs.state().sessions).toBe(0);
  });

  it('a registry record for a live pid flips the holder within 500 ms; its removal flips it back; a dead pid emits nothing', async () => {
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'first')]);
    const fs = await start();
    fs.bind([{ sessionId: S1, appSessionId: A1 }]);
    clear();

    await fixture.addRegistryRecord(NO_SUCH_PID, { sessionId: S2, kind: 'interactive' });
    await settled();
    const written = Date.now();
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
    await expect.poll(() => events('fs.holderChanged').length, { timeout: 500, interval: 5 }).toBe(1);
    expect(Date.now() - written).toBeLessThan(500);
    expect(events('fs.holderChanged')[0]).toMatchObject({ sessionId: S1, appSessionId: A1, holder: { kind: 'terminal', pid: process.pid }, job: null });
    expect(fs.state().holders).toEqual([{ sessionId: S1, appSessionId: A1, holder: { kind: 'terminal', pid: process.pid } }]);

    await fixture.removeRegistryRecord(process.pid);
    await expect.poll(() => events('fs.holderChanged').length, { timeout: 500 }).toBe(2);
    expect(events('fs.holderChanged')[1]).toMatchObject({ sessionId: S1, holder: { kind: 'none' }, registry: null });
    expect(events('fs.holderChanged').some((e) => e.sessionId === S2)).toBe(false);
  });

  it('a registry record written in two steps (sessionId arriving 60 ms later) emits exactly one fs.holderChanged', async () => {
    const fs = await start();
    await fixture.addRegistryRecord(process.pid, { kind: 'interactive', cwd: '/work/a' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await fixture.addRegistryRecord(process.pid, { kind: 'interactive', cwd: '/work/a', sessionId: S1 });
    await expect.poll(() => events('fs.holderChanged').length, { timeout: 1_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 600)); // past every retry and debounce
    expect(events('fs.holderChanged')).toHaveLength(1);
    expect(fs.state().holders).toHaveLength(1);
  });

  it('a live bg record with its job is a background job holder; a job state alone holds nothing', async () => {
    await fixture.addJob('22222222', { sessionId: S2, state: 'working' });
    await fixture.addJob('11111111', { sessionId: S1, state: 'working', name: 'nightly' });
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'bg', jobId: '11111111' });
    const fs = await start();
    expect(events('fs.holderChanged')).toEqual([
      expect.objectContaining({ sessionId: S1, holder: { kind: 'background_job', pid: process.pid, jobId: '11111111' }, job: expect.objectContaining({ name: 'nightly' }) }),
    ]);
    expect(fs.state().holders.map((h) => h.sessionId)).toEqual([S1]);
  });

  it('a watch event without a filename rescans projects/ and discovers a transcript created meanwhile', async () => {
    const listeners = new Map<string, (event: string, filename: string | null) => void>();
    const watch: WatchFn = (path, _options, listener) => {
      listeners.set(path, listener);
      return Object.assign(new EventEmitter(), { close: vi.fn() });
    };
    const fs = await start(watch);
    expect(fs.state().sessions).toBe(0);
    await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'made while the stream dropped its names')]);
    listeners.get(fixture.paths.projects)!('rename', null);
    await expect.poll(() => events('fs.sessionChanged').map((e) => e.summary.sessionId), { timeout: 1_000 }).toEqual([S1]);
    expect(fs.state().sessions).toBe(1);
  });

  describe('a scan whose listing is overtaken by the watcher', () => {
    // A fake watch the test fires by hand, and a listing the test releases by hand: the scan's `list()` is taken before
    // the watcher's news and resolves after it, which is the interleaving a slow readdir pass over the real store has.
    const manualWatch = () => {
      const listeners = new Map<string, (event: string, filename: string | null) => void>();
      const watch: WatchFn = (path, _options, listener) => {
        listeners.set(path, listener);
        return Object.assign(new EventEmitter(), { close: vi.fn() });
      };
      return { watch, fire: (path: string, filename: string) => listeners.get(path)!('rename', filename) };
    };
    const deferredListing = () => {
      let release!: (files: ListedTranscript[]) => void;
      const listing = new Promise<ListedTranscript[]>((resolve) => (release = resolve));
      vi.spyOn(Discovery.prototype, 'list').mockReturnValueOnce(listing);
      return release;
    };
    afterEach(() => vi.restoreAllMocks());

    it('never forgets a transcript the watcher discovered while the listing was in flight', async () => {
      const manual = manualWatch();
      const fs = await start(manual.watch);
      const release = deferredListing();
      const scanning = fs.scan([]);

      const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'new while listing')]);
      manual.fire(fixture.paths.projects, `-work-a/${S1}.jsonl`);
      await expect.poll(() => events('fs.sessionChanged').map((e) => e.summary.sessionId), { timeout: 1_000 }).toEqual([S1]);

      release([]); // the stale snapshot, taken before the file existed
      expect(await scanning).toMatchObject({ sessions: 1 });
      expect(events('fs.sessionRemoved')).toEqual([]);
      expect(fs.state().sessions).toBe(1);
      expect(path).toBe(fixture.transcriptPath(S1));
    });

    it('never resurrects a transcript the watcher saw vanish while the listing was in flight', async () => {
      const path = await fixture.addTranscript('/work/a', S1, [user('u1', null, '/work/a', 'soon gone')]);
      const manual = manualWatch();
      const fs = await start(manual.watch);
      const stale = await new Discovery(fixture.paths).list();
      const release = deferredListing();
      const scanning = fs.scan([]);

      await rm(path);
      manual.fire(fixture.paths.projects, `-work-a/${S1}.jsonl`);
      await expect.poll(() => events('fs.sessionRemoved').length, { timeout: 1_000 }).toBe(1);
      clear();

      release(stale); // still lists the file
      expect(await scanning).toMatchObject({ sessions: 0 });
      expect(emitted.filter((e) => e.name !== 'fs.scanProgress')).toEqual([]); // nothing re-listed, nothing removed twice
      expect(fs.state().sessions).toBe(0);
    });
  });

  describe('fs.holders answers the registry as it is now (C10 exclusive-writer guards)', () => {
    // A watch that never reports anything: whatever fs.holders answers, it read for itself.
    const deafWatch: WatchFn = () => Object.assign(new EventEmitter(), { close: vi.fn() });

    it('answers a live record by session id, refreshing the registry first, with the bound app id', async () => {
      const fs = await start(deafWatch);
      fs.bind([{ sessionId: S1, appSessionId: A1 }]);
      await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
      await fixture.addRegistryRecord(NO_SUCH_PID, { sessionId: S2, kind: 'interactive', cwd: '/work/a' });

      const before = Date.now();
      const answer = await fs.holdersNow({ sessionIds: [S1, S2], directories: null });
      expect(answer.holders).toEqual([{ sessionId: S1, appSessionId: A1, holder: { kind: 'terminal', pid: process.pid }, cwd: '/work/a' }]);
      expect(answer.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(answer.refreshedAt)).toBeGreaterThanOrEqual(before);
      expect((await fs.holdersNow({ sessionIds: [S3], directories: null })).holders).toEqual([]);
    });

    it('answers by directory, comparing NFC-normalised realpaths (a symlinked path finds the record)', async () => {
      const real = join(fixture.configHome, 'work-real');
      const link = join(fixture.configHome, 'work-link');
      await mkdir(real);
      await symlink(real, link);
      await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: link });
      const fs = await start(deafWatch);

      const byReal = await fs.holdersNow({ sessionIds: null, directories: [real] });
      expect(byReal.holders).toEqual([{ sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: process.pid }, cwd: await realpath(real) }]);
      expect((await fs.holdersNow({ sessionIds: null, directories: [link] })).holders.map((h) => h.sessionId)).toEqual([S1]);
      expect((await fs.holdersNow({ sessionIds: null, directories: [join(fixture.configHome, 'elsewhere')] })).holders).toEqual([]);
      expect((await fs.holdersNow({ sessionIds: null, directories: null })).holders.map((h) => h.sessionId)).toEqual([S1]);
    });

    it('answers one row per live pid: two processes on one session with different directories are two rows, each found by its own directory', async () => {
      const older = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
      const newer = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
      try {
        const dirA = join(fixture.configHome, 'dir-a');
        const dirB = join(fixture.configHome, 'dir-b');
        await mkdir(dirA);
        await mkdir(dirB);
        await fixture.addRegistryRecord(older.pid!, { sessionId: S1, kind: 'interactive', cwd: dirA, startedAt: 1_000 });
        await fixture.addRegistryRecord(newer.pid!, { sessionId: S1, kind: 'interactive', cwd: dirB, startedAt: 2_000 });
        const fs = await start(deafWatch);

        const row = (pid: number, dir: string) => ({ sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid }, cwd: dir });
        const bySession = await fs.holdersNow({ sessionIds: [S1], directories: null });
        expect(bySession.holders).toHaveLength(2);
        expect(bySession.holders).toEqual(expect.arrayContaining([row(older.pid!, await realpath(dirA)), row(newer.pid!, await realpath(dirB))]));
        expect((await fs.holdersNow({ sessionIds: null, directories: [dirA] })).holders).toEqual([row(older.pid!, await realpath(dirA))]);
        expect((await fs.holdersNow({ sessionIds: null, directories: [dirB] })).holders).toEqual([row(newer.pid!, await realpath(dirB))]);
        expect(fs.state().holders).toEqual([{ sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: newer.pid } }]); // the badge stays one per session
      } finally {
        older.kill('SIGKILL');
        newer.kill('SIGKILL');
      }
    });

    it('compares and answers directories NFC-normalised, composed and decomposed names alike', async () => {
      // fs.promises.realpath returns an existing directory's name as stored on disk (here decomposed), so the answered
      // cwd is NFC only by normalisation; a directory that no longer exists is compared as written, NFC-normalised.
      const decomposed = join(fixture.configHome, 'cafe\u0301');
      const composed = join(fixture.configHome, 'caf\u00e9');
      expect(composed).not.toBe(decomposed);
      await mkdir(decomposed);
      await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: decomposed });
      const fs = await start(deafWatch);

      const answer = await fs.holdersNow({ sessionIds: null, directories: [composed] });
      expect(answer.holders.map((h) => h.sessionId)).toEqual([S1]);
      expect(answer.holders[0].cwd?.endsWith('/caf\u00e9')).toBe(true);

      const gone = '/nonexistent-maws-c4/proje\u0301t'; // a project directory since removed
      await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: gone });
      const byGone = await fs.holdersNow({ sessionIds: null, directories: ['/nonexistent-maws-c4/proj\u00e9t'] });
      expect(byGone.holders.map((h) => [h.sessionId, h.cwd])).toEqual([[S1, '/nonexistent-maws-c4/proj\u00e9t']]);
    });

    it('fails with "holder registry unreadable: <errno>" when the registry cannot be read, rather than answering a stale table', async () => {
      await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
      const fs = await start(deafWatch);
      expect((await fs.holdersNow({ sessionIds: [S1], directories: null })).holders).toHaveLength(1);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      await chmod(fixture.paths.sessions, 0o000); // the fixture's own temp directory, never the owner's store
      try {
        await expect(fs.holdersNow({ sessionIds: [S1], directories: null })).rejects.toThrow('holder registry unreadable: EACCES');
      } finally {
        await chmod(fixture.paths.sessions, 0o755);
        errors.mockRestore();
      }
    });

    it('fails when one registry record is unreadable, while the poll keeps the holder it last read', async () => {
      const record = await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
      const fs = await start(deafWatch);
      expect((await fs.holdersNow({ sessionIds: [S1], directories: null })).holders).toHaveLength(1);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      await chmod(record, 0o000); // the fixture's own temp file, never the owner's store
      try {
        await expect(fs.holdersNow({ sessionIds: [S1], directories: null })).rejects.toThrow('holder registry unreadable: EACCES');
        expect(fs.state().holders).toEqual([{ sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: process.pid } }]);
      } finally {
        await chmod(record, 0o644);
        errors.mockRestore();
      }
      expect((await fs.holdersNow({ sessionIds: [S1], directories: null })).holders).toHaveLength(1);
    });

    it('answers from the record last read whole when one registry record is torn, without failing', async () => {
      const record = await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
      const fs = await start(deafWatch);
      await writeFile(record, '{"pid":'); // torn, never repaired within the retry schedule
      const answer = await fs.holdersNow({ sessionIds: [S1], directories: null });
      expect(answer.holders).toEqual([{ sessionId: S1, appSessionId: null, holder: { kind: 'terminal', pid: process.pid }, cwd: '/work/a' }]);
    });

    it('does not answer a record whose process has died, even with the file left behind', async () => {
      const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
      await fixture.addRegistryRecord(child.pid!, { sessionId: S1, kind: 'interactive', cwd: '/work/a' });
      const fs = await start(deafWatch);
      expect((await fs.holdersNow({ sessionIds: [S1], directories: null })).holders).toHaveLength(1);
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
      expect((await fs.holdersNow({ sessionIds: [S1], directories: ['/work/a'] })).holders).toEqual([]);
    });
  });

  it('works against a config home whose roots do not exist yet', async () => {
    await rm(fixture.paths.projects, { recursive: true });
    await rm(fixture.paths.jobs, { recursive: true });
    const fs = await start();
    expect(await fs.scan([])).toMatchObject({ projects: 0, sessions: 0, changed: 0 });
    expect(fs.state()).toMatchObject({ watching: false, sessions: 0 });
  });
});
