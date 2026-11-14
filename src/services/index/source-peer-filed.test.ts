// The two paths of M2 decision 7 as amended (UX wave U8c-2, Decision Log 22;
// docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md): a record an older build filed last is left as
// that build filed it until this build next summarises its transcript, which is its next row, or a re-read the search
// index asks for. At a host start `sync()` sends `fs.scan` a size and mtime of -1 for a session whose search text is
// behind its stored stamp, and the engine host summarises that transcript again; an older build that quit within its
// 30 s re-index debounce after filing a row leaves its text so. The steps are §L's fourth scene's, over a real
// repository with a worktree, the index, its source with the production debounce, and an engine host whose scan
// summarises the transcript on disk unless the stamp it is sent matches it (discovery's own `matchesKnown`).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult, EventName, EventPayload, HostState } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { TranscriptSummary } from '@shared/wire/store';
import { gitCheckout, gitWorktree, sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { matchesKnown } from '../../engine-host/fs/discovery';
import { Index } from './index';
import { IndexSessionSource, SEARCH_REINDEX_DEBOUNCE_MS, type ReadModelWriter, type SourceHost } from './source';

type Listener = (payload: unknown) => void;
type Known = { sessionId: string; appSessionId: string; size: number; mtimeMs: number };
const FS_STATE_EMPTY = { configHome: '/cfg', watching: true, projects: 0, sessions: 0, bound: 0, followed: [], holders: [], lastScanAt: null, lastScan: null };
const SCAN_RESULT = { projects: 0, sessions: 0, changed: 0, durationMs: 1 };
const writer: ReadModelWriter = { observeRecord: () => {}, observeRemoved: () => {}, observeProject: () => {}, observeProjectRemoved: () => {}, setDigest: () => {} };

// A ready engine host whose one transcript on disk is `disk()`: its scan summarises it unless the stamp it is sent
// matches, and its text read answers at the file's stamp
function engineHost(disk: () => TranscriptSummary) {
  const listeners = new Map<string, Set<Listener>>();
  const scans: Known[][] = [];
  let summarised = 0;
  const fire = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    listeners.get(name)?.forEach((l) => l(checked.value));
  };
  const host: SourceHost = {
    dispatch: vi.fn(async (_owner, name: CommandName, input: unknown) => {
      const file = disk();
      if (name === 'fs.scan') {
        const known = (input as { known: Known[] }).known;
        scans.push(known);
        if (!matchesKnown({ size: file.size, mtimeMs: file.mtimeMs }, known.find((entry) => entry.sessionId === file.sessionId))) {
          summarised += 1;
          fire('fs.sessionChanged', { summary: file, appSessionId: null });
        }
        return { ok: true, value: SCAN_RESULT } as CommandResult<CommandName>;
      }
      if (name === 'fs.state') return { ok: true, value: FS_STATE_EMPTY } as CommandResult<CommandName>;
      if (name === 'fs.sessionText') return { ok: true, value: { text: 'invented words', cursor: null, size: file.size, mtimeMs: file.mtimeMs } } as CommandResult<CommandName>;
      return { ok: true, value: undefined } as CommandResult<CommandName>;
    }) as SourceHost['dispatch'],
    onEvent: ((name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }) as SourceHost['onEvent'],
    onState: () => () => {},
    onStreaming: () => () => {},
    snapshot: (): HostState => ({ state: 'ready', pid: 1, restarts: 0, revision: 1 }),
  };
  return { host, scans, fire, summarised: () => summarised };
}

describe('decision 7 (Decision Log 22): a record an older build filed last, at this build\'s next start', () => {
  let tree: ReturnType<typeof tempDir>;
  const at = (rel: string) => join(tree.path, rel);
  beforeAll(async () => {
    tree = tempDir('maws-peer-filed-');
    await gitCheckout(at('repo'), 'main');
    await gitWorktree(at('repo'), at('repo/.claude/worktrees/w1'), 'worktree-w1');
  });
  afterAll(() => tree.dispose());

  // The scene's steps; `peerTextAtItsStamp`: whether the older build's text pass reached the row it filed before it quit
  async function scene(peerTextAtItsStamp: boolean) {
    const dir = tempDir();
    const path = join(dir.path, 'index.sqlite');
    const [repo, w1] = [at('repo'), at('repo/.claude/worktrees/w1')];
    const sessionId = sessionIdFor(0x4242);
    const home = { sessionId, directory: repo } as const;
    const atRepo = summary({ ...home, relocatedCwd: null, newestCwd: repo, gitBranch: 'main', size: 200, mtimeMs: 1_000.25 });
    const moved = summary({ ...home, relocatedCwd: w1, newestCwd: w1, gitBranch: 'worktree-w1', size: 400, mtimeMs: 2_000.5 });
    const peerStamp = { size: 600, mtimeMs: 3_000.75 };
    const onDisk = summary({ ...home, relocatedCwd: w1, newestCwd: w1, gitBranch: 'worktree-w1', ...peerStamp });
    let disk = atRepo;
    try {
      // this build: the session discovered at the repository, then moved the tool's way; it quits before the move's
      // text pass, which the debounce holds back
      let index = new Index(path);
      const first = engineHost(() => disk);
      let source = new IndexSessionSource(index, first.host, { emit: () => true, tickMs: 5, searchDebounceMs: SEARCH_REINDEX_DEBOUNCE_MS });
      let stop = source.start(writer);
      first.fire('fs.sessionChanged', { summary: atRepo, appSessionId: null });
      const appId = await vi.waitFor(() => {
        const record = index.sessions.getByEngineId(sessionId);
        expect(record).not.toBeNull();
        return record!.appId;
      });
      await vi.waitFor(() => expect(index.sessionSearch.current(appId, sessionId, atRepo.size, atRepo.mtimeMs)).toBe(true));
      disk = moved;
      first.fire('fs.sessionChanged', { summary: moved, appSessionId: null });
      await vi.waitFor(() => expect(index.sessions.get(appId)).toMatchObject({ directory: w1, launchFolder: repo }));
      expect(index.sessionSearch.current(appId, sessionId, moved.size, moved.mtimeMs)).toBe(false);
      stop();
      index.close();

      // the older build: its text pass at the moved stamp, then one more row filed by its own rule (its columns only, a
      // summary with no newestCwd), and its text pass at that row's stamp or not
      const raw = new DatabaseSync(path);
      const { newestCwd: _dropped, ...olderSummary } = onDisk;
      raw.prepare('UPDATE sessions SET transcript_size = ?, transcript_mtime_ms = ?, summary = ? WHERE app_id = ?').run(peerStamp.size, peerStamp.mtimeMs, JSON.stringify(olderSummary), appId);
      raw.close();
      index = new Index(path);
      index.sessionSearch.replace(appId, sessionId, moved.size, moved.mtimeMs, 'invented words');
      if (peerTextAtItsStamp) index.sessionSearch.replace(appId, sessionId, peerStamp.size, peerStamp.mtimeMs, 'invented words');
      disk = onDisk;
      const filed = index.sessions.get(appId)!;
      expect(filed.directory).toBe(w1);
      expect(filed).not.toHaveProperty('launchFolder'); // the stamp: nothing believed of what the older build overtook

      // this build again
      const again = engineHost(() => disk);
      source = new IndexSessionSource(index, again.host, { emit: () => true, tickMs: 5, searchDebounceMs: SEARCH_REINDEX_DEBOUNCE_MS });
      stop = source.start(writer);
      await vi.waitFor(() => expect(source.discoveryApplied()).toBe(true));
      const result = { appId, repo, w1, peerStamp, scans: again.scans, summarised: again.summarised(), record: index.sessions.get(appId)! };
      stop();
      index.close();
      return result;
    } finally {
      dir.dispose();
    }
  }

  it('text behind its stamp: the scan is sent -1, the transcript is summarised once, and the facts are written', async () => {
    const { appId, repo, w1, scans, summarised, record } = await scene(false);
    expect(scans[0]).toEqual([{ sessionId: sessionIdFor(0x4242), appSessionId: appId, size: -1, mtimeMs: -1 }]);
    expect(summarised).toBe(1);
    expect(record).toMatchObject({ directory: w1, launchFolder: repo }); // the card's "moved from"
  });

  it('text at its stamp: the scan is sent the filed stamp, nothing is summarised, and no fact appears', async () => {
    const { appId, w1, peerStamp, scans, summarised, record } = await scene(true);
    expect(scans[0]).toEqual([{ sessionId: sessionIdFor(0x4242), appSessionId: appId, ...peerStamp }]);
    expect(summarised).toBe(0);
    expect(record.directory).toBe(w1);
    expect(record).not.toHaveProperty('launchFolder'); // as the older build filed it, until the session's next row
  });
});
