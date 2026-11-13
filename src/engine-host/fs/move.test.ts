// U8c-1 (M1): a transcript the engine moves keeps its readers. On EnterWorktree, ExitWorktree and `/cd` the engine
// renames the session's transcript into the project folder of the folder it moved to, renames the session's folder (its
// agents' transcripts) beside it, then appends a `relocated` row at the new place (engine 2.1.322, cli.pretty.js:381469-
// 381548; spikes/protocol-probe/findings-uxwave-U8-working-folder.txt, "The transcript file moves"). A rename keeps the
// inode. These cases do that to a real store under the real service: into a project folder that did not exist (which
// raises a rescan) and back into the one that does (which does not). Cases (a) to (f) and (j) use the platform's own
// watcher and assert outcomes only (rows delivered, paths, events absent), never an order of file events, so they hold on
// Linux's watch tree and on macOS's FSEvents alike; (g) to (i) drive a watcher by hand and hold the interleaving open
// through the service's test hook.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { StoreFixture } from '../../../test/support/store-fixture';
import type { StoreHooks } from './discovery';
import { FsFileReader } from './follow';
import { slugOf } from './paths';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS, type WatchFn } from './watcher';

const S1 = '5a1e0001-0000-4000-8000-000000000001' as SessionId;
const S2 = '5a1e0001-0000-4000-8000-000000000002' as SessionId;
const APP = 'app-moved' as AppSessionId;
// Invented folders: a repository and a worktree the engine made in it.
const HOME = '/repo';
const WORKTREE = '/repo/.claude/worktrees/w1';

const PARENT = '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId; // the suite's sidecar fixture (pass 1)
const AGENT = 'ad286defbc77bc090' as AgentId;
const AGENT_LAST = 'edd568e6-e914-4f1f-a726-921fb51619e2'; // the agent transcript's last row
const SIDECARS = join(FIXTURE_DIR, 'subagent-sidecars');
const fixtureLines = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean);

type Row = Record<string, unknown>;
const user = (uuid: string, parentUuid: string | null, cwd: string, content: string): Row => ({ type: 'user', uuid, parentUuid, cwd, timestamp: '2026-11-13T10:00:00.000Z', message: { role: 'user', content } });
const rowsOf = (rows: Row[]) => rows.map((row) => JSON.stringify(row));

// The two moves every case makes, each with the message row the engine's next turn appends at the new place.
const MOVES = [
  { from: HOME, to: WORKTREE, uuid: 'm-entered', content: 'after entering the worktree' },
  { from: WORKTREE, to: HOME, uuid: 'm-left', content: 'after leaving the worktree' },
] as const;
const parentOf = (index: number, first: string) => (index === 0 ? first : MOVES[index - 1].uuid);

type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// FSEvents starts its stream after `fs.watch` returns and reports nothing written in its first milliseconds (watcher.ts):
// a case's clock starts once the settle rescan has run.
const settled = () => sleep(SETTLE_MS + DEBOUNCE_MS + 50);

// Each case waits on real file events for up to 5 s at a step; the suite's bound leaves a loaded machine room past that.
describe('a transcript the engine moves keeps its readers', { timeout: 30_000 }, () => {
  let fixture: StoreFixture;
  let service: FsService | null;
  let emitted: Emitted[];
  let locators: (() => string | null)[];
  let hold: StoreHooks['at'] | null;

  beforeEach(async () => {
    fixture = await StoreFixture.create();
    service = null;
    emitted = [];
    locators = [];
    hold = null;
  });
  afterEach(async () => {
    service?.stop();
    vi.restoreAllMocks();
    await fixture.dispose();
  });

  const create = (watch?: WatchFn) =>
    (service = new FsService({
      paths: fixture.paths,
      emit: (name, payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
        emitted.push({ name, payload } as Emitted);
        return true;
      },
      watch,
      openReader: (locate) => {
        locators.push(locate);
        return new FsFileReader(locate);
      },
      hooks: { at: (point, detail) => hold?.(point, detail) ?? Promise.resolve() },
    }));
  const start = async (watch?: WatchFn) => {
    const fs = create(watch);
    await fs.start();
    await settled(); // the watcher's settle rescan has run, also under a watch the test drives
    return fs;
  };
  const events = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const delivered = (app: AppSessionId) => events('session.eventBatch').filter((b) => b.appSessionId === app).flatMap((b) => b.events);
  const said = (list: SessionEvent[], content: string) => list.filter((e) => e.kind === 'user.message' && e.content === content).length;
  const lastState = (app: AppSessionId, agentId: AgentId | null = null) => events('fs.followState').filter((s) => s.appSessionId === app && s.agentId === agentId).at(-1);
  const removed = () => events('fs.sessionRemoved');
  const changedPaths = (sessionId: SessionId) => events('fs.sessionChanged').filter((e) => e.summary.sessionId === sessionId).map((e) => e.summary.transcriptPath);

  const transcriptAt = (directory: string, sessionId: SessionId) => join(fixture.paths.projects, slugOf(directory), `${sessionId}.jsonl`);
  // The engine's move: the transcript renamed into the project folder of `to` (made when it does not exist), the session's
  // folder renamed beside it, then a `relocated` row and the next turn's message row appended at the new place.
  const move = async (sessionId: SessionId, from: string, to: string, message: Row) => {
    const target = transcriptAt(to, sessionId);
    await mkdir(join(fixture.paths.projects, slugOf(to)), { recursive: true });
    await renameFiles(sessionId, from, to);
    await fixture.appendLines(target, rowsOf([{ type: 'relocated', relocatedCwd: to, sessionId }, message]));
    return target;
  };
  // The renames alone (fs.rename: the inode stays).
  const renameFiles = async (sessionId: SessionId, from: string, to: string) => {
    await rename(transcriptAt(from, sessionId), transcriptAt(to, sessionId));
    const folder = join(fixture.paths.projects, slugOf(from), sessionId);
    if (existsSync(folder)) await rename(folder, join(fixture.paths.projects, slugOf(to), sessionId));
  };
  const agentPathAt = (directory: string) => join(fixture.paths.projects, slugOf(directory), PARENT, 'subagents', `agent-${AGENT}.jsonl`);
  const addParent = async () => {
    await fixture.addTranscript(HOME, PARENT, fixtureLines(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl')));
    await fixture.addSidecar(PARENT, `subagents/agent-${AGENT}.jsonl`, fixtureLines(join(SIDECARS, `agent-${AGENT}.jsonl`)).map((line) => `${line}\n`).join(''));
    await fixture.addSidecar(PARENT, `subagents/agent-${AGENT}.meta.json`, readFileSync(join(SIDECARS, `agent-${AGENT}.meta.json`), 'utf8'));
  };

  // A watch the test fires by hand.
  const manualWatch = () => {
    const listeners = new Map<string, (event: string, filename: string | null) => void>();
    const watch: WatchFn = (path, _options, listener) => {
      listeners.set(path, listener);
      return Object.assign(new EventEmitter(), { close: vi.fn() });
    };
    return { watch, fire: (path: string) => listeners.get(fixture.paths.projects)!('rename', path.slice(fixture.paths.projects.length + 1)) };
  };

  it('(a) the session’s follow delivers the row appended after each move, once, stays following, and reads the new file', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one'), user('u2', 'u1', HOME, 'two')]));
    const fs = await start();
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    expect(lastState(APP)?.leafUuid).toBe('u2');

    for (const [index, { from, to, uuid, content }] of MOVES.entries()) {
      const moved = await move(S1, from, to, user(uuid, parentOf(index, 'u2'), to, content));
      await expect.poll(() => lastState(APP)?.leafUuid, { timeout: 5_000 }).toBe(uuid);
      await settled();
      expect(lastState(APP)?.state).toBe('following');
      expect(said(delivered(APP), content)).toBe(1);
      expect(locators[0]!()).toBe(moved);
    }
  });

  it('(b) the quiet follow of a live session’s older pages answers a page that holds the row appended after each move', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one'), user('u2', 'u1', HOME, 'two')]));
    const fs = await start();
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    expect((await fs.eventsSnapshot(APP, null, {}, true)).events.length).toBeGreaterThan(0);

    for (const [index, { from, to, uuid, content }] of MOVES.entries()) {
      await move(S1, from, to, user(uuid, parentOf(index, 'u2'), to, content));
      await expect.poll(async () => said((await fs.eventsSnapshot(APP, null, {}, true)).events, content), { timeout: 5_000 }).toBe(1);
    }
    expect(delivered(APP)).toEqual([]); // the quiet follow emits nothing
  });

  it('(c) a follow of one of the session’s agents delivers a row appended to the agent’s transcript at its new path', async () => {
    await addParent();
    const fs = await start();
    await fs.bind([{ sessionId: PARENT, appSessionId: APP }]);
    await fs.agentEvents(APP, AGENT);
    expect(lastState(APP, AGENT)?.leafUuid).toBe(AGENT_LAST);

    for (const [index, { from, to, uuid, content }] of MOVES.entries()) {
      await move(PARENT, from, to, user(`p-${uuid}`, '5fe8e26b-1f38-4083-8117-f064a4b1dd85', to, content));
      const row = { ...user(uuid, parentOf(index, AGENT_LAST), to, content), isSidechain: true, agentId: AGENT, sessionId: PARENT };
      await fixture.appendLines(agentPathAt(to), rowsOf([row]));
      await expect.poll(() => lastState(APP, AGENT)?.leafUuid, { timeout: 5_000 }).toBe(uuid);
    }
  });

  it('(d) after each move fs.subagentsChanged names each of the session’s agents at its new path', async () => {
    await addParent();
    const fs = await start();
    await fs.bind([{ sessionId: PARENT, appSessionId: APP }]);
    expect((await fs.subagents(APP)).agents.map((agent) => agent.transcriptPath)).toEqual([agentPathAt(HOME)]);

    for (const { from, to, uuid, content } of MOVES) {
      await move(PARENT, from, to, user(`p-${uuid}`, '5fe8e26b-1f38-4083-8117-f064a4b1dd85', to, content));
      await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents.map((agent) => agent.transcriptPath), { timeout: 5_000 }).toEqual([agentPathAt(to)]);
      expect((await fs.subagents(APP)).agents.map((agent) => agent.transcriptPath)).toEqual([agentPathAt(to)]);
    }
  });

  it('(e) across each move no fs.sessionRemoved is told, and an fs.sessionChanged names the new path', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one')]));
    const fs = await start();
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.scan([]);

    for (const [index, { from, to, uuid, content }] of MOVES.entries()) {
      const moved = await move(S1, from, to, user(uuid, parentOf(index, 'u1'), to, content));
      await expect.poll(() => changedPaths(S1).at(-1), { timeout: 5_000 }).toBe(moved);
      await settled();
      expect(removed()).toEqual([]);
      expect(fs.state().sessions).toBe(1);
    }
  });

  // macOS: FSEvents starts its stream after `fs.watch` returns and reports nothing written in its first milliseconds
  // (watcher.ts's header); a move made then is found by the settle rescan alone.
  it.skipIf(process.platform !== 'darwin')('(f) a move made inside the watcher’s settle time, right after the service starts, is still found', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one'), user('u2', 'u1', HOME, 'two')]));
    const fs = create();
    await fs.start();
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const { uuid, content, to } = MOVES[0];
    await move(S1, HOME, to, user(uuid, 'u2', to, content));
    await expect.poll(() => lastState(APP)?.leafUuid, { timeout: 5_000 }).toBe(uuid);
    expect(removed()).toEqual([]);
  });

  it('(g) a scan whose listing read the target folder and not yet the source when the rename happened tells no removal, and lists the session at its new path', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one')]));
    const manual = manualWatch();
    const fs = await start(manual.watch);
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.scan([]);
    await mkdir(join(fixture.paths.projects, slugOf(WORKTREE)), { recursive: true }); // read by the scan's listing

    for (const { from, to } of MOVES) {
      const targetListed = deferred();
      hold = async (point, detail) => {
        if (point !== 'listing') return;
        if (detail === slugOf(to)) return targetListed.resolve();
        if (detail !== slugOf(from)) return;
        await targetListed.promise;
        await sleep(50); // the target folder's readdir, begun as its hook returned, has answered
        await renameFiles(S1, from, to);
      };
      const answer = await fs.scan([]);
      hold = null;
      expect(answer.sessions).toBe(1);
      expect(removed()).toEqual([]);
      expect(changedPaths(S1).at(-1)).toBe(transcriptAt(to, S1));
    }
  });

  it('(h) the read of the new path held past the watcher’s settle time while the old path’s event is handled: no removal, before or after its release', async () => {
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one')]));
    const manual = manualWatch();
    const fs = await start(manual.watch);
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.scan([]);

    for (const { from, to } of MOVES) {
      const target = transcriptAt(to, S1);
      const held = deferred();
      let reached = false;
      hold = async (point, detail) => {
        if (point !== 'summary' || detail !== target || reached) return;
        reached = true;
        await held.promise;
      };
      await mkdir(join(fixture.paths.projects, slugOf(to)), { recursive: true });
      await renameFiles(S1, from, to);
      manual.fire(target);
      await expect.poll(() => reached, { timeout: 2_000 }).toBe(true);
      manual.fire(transcriptAt(from, S1));
      await sleep(SETTLE_MS * 2);
      expect(removed()).toEqual([]);

      held.resolve();
      await expect.poll(() => changedPaths(S1).at(-1), { timeout: 2_000 }).toBe(target);
      await sleep(SETTLE_MS);
      hold = null;
      expect(removed()).toEqual([]);
      expect(fs.state().sessions).toBe(1);
    }
  });

  it('(i) a look that finds the transcript nowhere is overtaken, before it decides, by a read that lists the session: no removal', async () => {
    const away = join(fixture.configHome, `${S1}.jsonl`); // outside every project folder
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one')]));
    const manual = manualWatch();
    const fs = await start(manual.watch);
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.scan([]);

    for (const { from, to } of MOVES) {
      const target = transcriptAt(to, S1);
      const looked = deferred();
      const held = deferred();
      hold = async (point, detail) => {
        if (point !== 'look' || detail !== S1) return;
        looked.resolve();
        await held.promise;
      };
      await rename(transcriptAt(from, S1), away);
      manual.fire(transcriptAt(from, S1));
      await Promise.race([looked.promise, sleep(2_000)]); // the look has read every project folder and found the file in none

      await mkdir(join(fixture.paths.projects, slugOf(to)), { recursive: true });
      await rename(away, target);
      manual.fire(target);
      await expect.poll(() => changedPaths(S1).at(-1), { timeout: 2_000 }).toBe(target);
      held.resolve();
      await sleep(SETTLE_MS);
      hold = null;
      expect(removed()).toEqual([]);
      expect(fs.state().sessions).toBe(1);
    }
  });

  it('(j) a transcript that is deleted is told removed once, alone and among fifty deleted together', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `5a1e0002-0000-4000-8000-${String(i).padStart(12, '0')}` as SessionId);
    await fixture.addTranscript(HOME, S1, rowsOf([user('u1', null, HOME, 'one')]));
    for (const [i, sessionId] of many.entries()) await fixture.addTranscript(i % 2 === 0 ? HOME : WORKTREE, sessionId, rowsOf([user('u1', null, HOME, 'one')]));
    await fixture.addTranscript(WORKTREE, S2, rowsOf([user('u1', null, WORKTREE, 'kept')]));
    const fs = await start();
    await fs.bind([{ sessionId: S1, appSessionId: APP }]);
    await fs.scan([]);

    await rm(fixture.transcriptPath(S1));
    await expect.poll(() => removed(), { timeout: 5_000 }).toEqual([{ sessionId: S1, appSessionId: APP }]);
    await settled();
    expect(removed()).toHaveLength(1);

    await Promise.all(many.map((sessionId) => rm(fixture.transcriptPath(sessionId))));
    await expect.poll(() => removed().length, { timeout: 10_000 }).toBe(51);
    await settled();
    await sleep(SETTLE_MS);
    const told = removed().map((e) => e.sessionId);
    expect(told).toHaveLength(51);
    expect(new Set(told)).toEqual(new Set([S1, ...many]));
    expect(fs.state().sessions).toBe(1); // the one kept
  });
});
