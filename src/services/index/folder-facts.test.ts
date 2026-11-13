// The record's two facts in the index (UX wave U8c-2, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md,
// §B to §D): where the session was launched and where its agent is, written beside every column build F's record
// carries, which keep build F's rule. Every case runs over real repositories made in a temporary folder.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRecord } from '@shared/graph/session';
import { workingBranch, workingFolder, workingWorktree } from '@shared/sessions/working-folder';
import type { TranscriptSummary } from '@shared/wire/store';
import { runGit } from '../../../test/support/git-fixture';
import { gitCheckout, gitWorktree, sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { FolderReads, folderColumns } from './folder-facts';
import { Index } from './index';
import { MIGRATIONS } from './migrations';
import { headBranch, locate, repositoryAt } from './projects';

describe("the record's two facts", () => {
  let tree: ReturnType<typeof tempDir>;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  const at = (rel: string) => join(tree.path, rel);
  const w1 = () => at('repo/.claude/worktrees/w1');

  beforeAll(async () => {
    tree = tempDir('maws-facts-');
    await gitCheckout(at('repo'), 'main', { 'README.md': 'hello\n', 'src/index.ts': 'export {};\n' });
    await gitWorktree(at('repo'), w1(), 'worktree-w1');
    await gitWorktree(at('repo'), at('side'), 'side');
    await gitWorktree(at('repo'), at('side2'), 'side2'); // deregistered by the batch case
    await runGit(at('repo'), ['worktree', 'add', '-q', '--detach', at('detached')]);
    await gitCheckout(at('other'), 'main');
    mkdirSync(at('plain/sub'), { recursive: true });
  });
  afterAll(() => tree.dispose());
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  let n = 0;
  const upsert = (over: Partial<TranscriptSummary>) => index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(++n), gitBranch: 'main', ...over })).record;
  // The two columns as stored, read as a peer would: whole rows, raw.
  const columns = (record: SessionRecord) => {
    const raw = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    try {
      const row = raw.prepare('SELECT launch_folder, agent_folder FROM sessions WHERE app_id = ?').get(record.appId) as { launch_folder: string | null; agent_folder: string | null };
      return { launch: row.launch_folder === null ? null : (JSON.parse(row.launch_folder) as object), agent: row.agent_folder === null ? null : (JSON.parse(row.agent_folder) as object) };
    } finally {
      raw.close();
    }
  };

  describe('§B, case by case', () => {
    it('writes neither column for a summary that does not say where the newest row is, or whose home is gone', () => {
      const moved = upsert({ directory: at('repo'), relocatedCwd: w1() }); // no newestCwd: an older engine host's summary
      expect(columns(moved)).toEqual({ launch: null, agent: null });
      expect(moved).not.toHaveProperty('launchFolder');
      expect(moved).not.toHaveProperty('agentFolder');
      expect(columns(upsert({ directory: at('repo'), relocatedCwd: at('gone'), newestCwd: at('gone') }))).toEqual({ launch: null, agent: null });
    });

    it('writes neither column when the first row, the home and the newest row name one folder', () => {
      for (const folder of [at('repo'), w1(), at('plain'), at('gone')]) {
        expect(columns(upsert({ directory: folder, newestCwd: folder })), folder).toEqual({ launch: null, agent: null });
        expect(columns(upsert({ directory: folder, relocatedCwd: folder, newestCwd: folder })), folder).toEqual({ launch: null, agent: null });
      }
    });

    it('keeps the launch folder while the tool files the session in a worktree, with its size and mtime as the stamp', () => {
      const record = upsert({ directory: at('repo'), relocatedCwd: w1(), newestCwd: w1(), size: 321, mtimeMs: 4_567 });
      expect(record).toMatchObject({ directory: w1(), worktree: { path: w1(), branch: 'main' }, launchFolder: at('repo') });
      expect(record).not.toHaveProperty('agentFolder');
      expect(columns(record)).toEqual({ launch: { folder: at('repo'), size: 321, mtimeMs: 4_567 }, agent: null });
    });

    it('keeps a launch folder that is a sub-folder of its repository, not the repository\'s root', () => {
      const record = upsert({ directory: at('repo/src'), relocatedCwd: `${w1()}/src`, newestCwd: `${w1()}/src` });
      expect(record).toMatchObject({ directory: `${w1()}/src`, launchFolder: at('repo/src') });
      expect(workingFolder(record)).toEqual({ path: w1(), cwd: `${w1()}/src`, launch: at('repo/src'), moved: true });
    });

    it('follows the home to another repository or to none: the launch folder is where the session is filed', () => {
      for (const home of [at('other'), at('plain')]) {
        const record = upsert({ directory: at('repo'), relocatedCwd: home, newestCwd: home });
        expect(record, home).not.toHaveProperty('launchFolder');
        expect(workingFolder(record), home).toEqual({ path: home, cwd: home, launch: home, moved: false });
      }
    });

    it("writes the agent's folder after a `cd` into another worktree, with the branch git names there", () => {
      const record = upsert({ directory: at('repo'), newestCwd: at('side'), gitBranch: 'main', size: 9, mtimeMs: 8 });
      expect(record).toMatchObject({ directory: at('repo'), worktree: null, branch: 'main', agentFolder: { checkout: at('side'), cwd: at('side'), branch: 'side', linked: true } });
      expect(columns(record)).toEqual({ launch: null, agent: { checkout: at('side'), cwd: at('side'), branch: 'side', linked: true, size: 9, mtimeMs: 8 } });
      expect(workingBranch(record)).toBe('side');
      expect(workingWorktree(record)).toEqual({ path: at('side'), branch: 'side' });
    });

    it("writes the agent's folder inside the filed checkout when it is not the directory, with the rows' branch", () => {
      const inside = upsert({ directory: at('repo'), newestCwd: at('repo/src') });
      expect(inside.agentFolder).toEqual({ checkout: at('repo'), cwd: at('repo/src'), branch: 'main', linked: false });
      expect(workingFolder(inside)).toEqual({ path: at('repo'), cwd: at('repo/src'), launch: at('repo'), moved: false });
      // filed in the worktree by the tool, then a `cd` inside it: the engine's rows describe that work tree
      const tool = upsert({ directory: at('repo'), relocatedCwd: w1(), newestCwd: `${w1()}/src`, gitBranch: 'worktree-w1' });
      expect(tool).toMatchObject({ launchFolder: at('repo'), agentFolder: { checkout: w1(), cwd: `${w1()}/src`, branch: 'worktree-w1', linked: true } });
    });

    it("takes git's branch for another checkout, none for a detached one, and the rows' for a folder in no repository", () => {
      // filed in the worktree by the tool, the agent back in the main checkout by `cd`: the rows still say the worktree's
      const back = upsert({ directory: at('repo'), relocatedCwd: w1(), newestCwd: at('repo'), gitBranch: 'worktree-w1' });
      expect(back).toMatchObject({ branch: 'worktree-w1', launchFolder: at('repo'), agentFolder: { checkout: at('repo'), cwd: at('repo'), branch: 'main', linked: false } });
      expect(workingFolder(back)).toEqual({ path: at('repo'), cwd: at('repo'), launch: at('repo'), moved: false });
      expect(workingWorktree(back)).toBeNull();
      const detached = upsert({ directory: at('repo'), newestCwd: at('detached') });
      expect(detached.agentFolder).toEqual({ checkout: at('detached'), cwd: at('detached'), branch: null, linked: true });
      expect(detached.branch).toBe('main'); // the record's own branch is build F's
      const plain = upsert({ directory: at('plain'), newestCwd: at('plain/sub'), gitBranch: 'HEAD' });
      expect(plain.agentFolder).toEqual({ checkout: at('plain'), cwd: at('plain/sub'), branch: null, linked: false });
    });

    it('writes no agent folder for a newest row that is gone, in another repository or in none, and answers the filed folder', () => {
      for (const newest of [at('gone'), at('other'), at('plain')]) {
        const record = upsert({ directory: at('repo'), newestCwd: newest });
        expect(columns(record), newest).toEqual({ launch: null, agent: null });
        expect(workingFolder(record), newest).toEqual({ path: at('repo'), cwd: at('repo'), launch: at('repo'), moved: false });
      }
    });

    it('writes the launch folder and no agent folder when the tail holds no row with a folder', () => {
      const record = upsert({ directory: at('repo'), relocatedCwd: w1(), newestCwd: null });
      expect(record.launchFolder).toBe(at('repo'));
      expect(record).not.toHaveProperty('agentFolder');
      expect(workingFolder(record)).toEqual({ path: w1(), cwd: w1(), launch: at('repo'), moved: true });
    });

    // Decision Log 12: the engine's `/cd` re-homes the session into a plain sub-folder of its launch checkout, and the
    // newest row names no checkout of the repository. The agent never left the launch checkout: not moved.
    it.each([
      ['null', null],
      ['gone', 'gone'],
      ['in another repository', 'other'],
      ['in no repository', 'plain'],
    ])('keeps a session re-homed into a sub-folder of its launch checkout in that checkout, its newest folder %s', (_, newest) => {
      const record = upsert({ directory: at('repo'), relocatedCwd: at('repo/src'), newestCwd: newest === null ? null : at(newest), gitBranch: 'main' });
      expect({ directory: record.directory, worktree: record.worktree, branch: record.branch }).toEqual({ directory: at('repo/src'), worktree: null, branch: 'main' }); // build F's
      expect(record.launchFolder).toBe(at('repo'));
      expect(record.agentFolder).toEqual({ checkout: at('repo'), cwd: at('repo/src'), branch: 'main', linked: false });
      expect(workingFolder(record)).toEqual({ path: at('repo'), cwd: at('repo/src'), launch: at('repo'), moved: false });
      expect(workingWorktree(record)).toBeNull();
      expect(workingBranch(record)).toBe('main');
    });

    it('clears both columns when a later summary drops the facts', () => {
      const sessionId = sessionIdFor(++n);
      const moved = index.sessions.upsertFromSummary(summary({ sessionId, directory: at('repo'), relocatedCwd: w1(), newestCwd: at('side') })).record;
      expect(moved).toHaveProperty('launchFolder');
      expect(moved).toHaveProperty('agentFolder');
      const back = index.sessions.upsertFromSummary(summary({ sessionId, directory: at('repo'), relocatedCwd: at('repo'), newestCwd: at('repo') })).record;
      expect(columns(back)).toEqual({ launch: null, agent: null });
      expect(workingFolder(back)).toEqual({ path: at('repo'), cwd: at('repo'), launch: at('repo'), moved: false });
    });
  });

  // §C: build F never writes either column and moves the size and mtime whenever it files a newer transcript, so a
  // value it has overtaken is not believed; this build's next summary writes it again.
  it('believes a fact only while its stamp is the row\'s size and mtime, as a statement naming only build F\'s columns leaves them', () => {
    const sessionId = sessionIdFor(++n);
    const facts = { sessionId, directory: at('repo'), relocatedCwd: w1(), newestCwd: at('side'), size: 100, mtimeMs: 1_000 };
    const first = index.sessions.upsertFromSummary(summary(facts)).record;
    expect(first).toMatchObject({ launchFolder: at('repo'), agentFolder: { checkout: at('side') } });

    const raw = new DatabaseSync(join(dir.path, 'index.sqlite'));
    try {
      raw.prepare('UPDATE sessions SET transcript_size = ?, transcript_mtime_ms = ? WHERE app_id = ?').run(140, 1_000, first.appId); // build F files a newer transcript
    } finally {
      raw.close();
    }
    const overtaken = index.sessions.get(first.appId)!;
    expect(overtaken).not.toHaveProperty('launchFolder');
    expect(overtaken).not.toHaveProperty('agentFolder');
    expect(workingFolder(overtaken)).toEqual({ path: w1(), cwd: w1(), launch: w1(), moved: false }); // where build F files it
    expect(columns(overtaken).launch).toEqual({ folder: at('repo'), size: 100, mtimeMs: 1_000 }); // still stored, not believed

    const mtimeOnly = new DatabaseSync(join(dir.path, 'index.sqlite'));
    try {
      mtimeOnly.prepare('UPDATE sessions SET transcript_size = ?, transcript_mtime_ms = ? WHERE app_id = ?').run(100, 2_000, first.appId);
    } finally {
      mtimeOnly.close();
    }
    expect(index.sessions.get(first.appId)).not.toHaveProperty('agentFolder');

    const again = index.sessions.upsertFromSummary(summary({ ...facts, size: 150, mtimeMs: 3_000 })).record;
    expect(again).toMatchObject({ launchFolder: at('repo'), agentFolder: { checkout: at('side') } });
  });

  // M2's "What it proves": §B over generated summaries. The first row's folder, the home and the newest row's folder are
  // each drawn from every kind below, and these hold throughout (the probe's outcome 4: the launch folder and the working
  // folder never disagree).
  it('holds its invariants over every combination of first-row folder, home and newest folder', () => {
    const kinds: Record<string, string> = {
      root: at('repo'),
      sub: at('repo/src'),
      worktree: w1(),
      worktreeSub: `${w1()}/src`,
      byHand: at('side'),
      other: at('other'),
      none: at('plain'),
      gone: at('gone'),
    };
    const sameRepository = (a: string, b: string) => {
      const [ra, rb] = [repositoryAt(a), repositoryAt(b)];
      return ra !== null && rb !== null && ra.commonDir === rb.commonDir;
    };
    const fDir = tempDir();
    const asF = new Index(join(fDir.path, 'index.sqlite')); // the same summaries without newestCwd: master's rule alone
    const launches = new Map<string, Set<string>>();
    try {
      // one transaction to each index, as discovery applies a scan's burst (source.ts, DISCOVERY_BATCH)
      index.transaction(() =>
        asF.transaction(() => {
          for (const [hName, H] of Object.entries(kinds))
            for (const [homeName, home] of Object.entries(kinds))
              for (const R of home === H ? [null, H] : [home])
                for (const [cName, C] of Object.entries(kinds)) {
                  const label = `first ${hName}, home ${homeName}${R === H ? ' (named)' : ''}, newest ${cName}`;
                  const sessionId = sessionIdFor(++n);
                  const record = index.sessions.upsertFromSummary(summary({ sessionId, directory: H, relocatedCwd: R, newestCwd: C, gitBranch: 'main' })).record;
                  const folder = workingFolder(record);
                  expect(folder.moved, label).toBe(folder.path !== folder.launch);
                  // the working folder is the launch folder, or a work tree of the launch folder's repository
                  if (folder.path !== folder.launch) {
                    expect(sameRepository(folder.path, folder.launch), label).toBe(true);
                    expect(repositoryAt(folder.path)?.workTree, label).toBe(folder.path);
                  }
                  // the launch folder does not change while the home stays in the first row's repository
                  if (sameRepository(H, home)) {
                    const seen = launches.get(H) ?? new Set();
                    launches.set(H, seen.add(folder.launch));
                  }
                  // every column build F knows is what master's rule writes for the same summary
                  const f = asF.sessions.upsertFromSummary(summary({ sessionId, directory: H, relocatedCwd: R, gitBranch: 'main' })).record;
                  expect({ directory: record.directory, worktree: record.worktree, branch: record.branch, title: record.title }, label).toEqual({ directory: f.directory, worktree: f.worktree, branch: f.branch, title: f.title });
                  expect(f, label).not.toHaveProperty('launchFolder');
                  expect(f, label).not.toHaveProperty('agentFolder');
                }
        }),
      );
      for (const [H, seen] of launches) {
        const first = locate(H);
        expect([...seen], H).toEqual([first.worktreePath ?? first.realpath]);
      }
      expect(launches.size).toBe(6); // the five kinds in the repository, and the other repository's own
      const raw = new DatabaseSync(join(fDir.path, 'index.sqlite'), { readOnly: true });
      try {
        expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE launch_folder IS NOT NULL OR agent_folder IS NOT NULL').get()).toEqual({ n: 0 });
      } finally {
        raw.close();
      }
    } finally {
      asF.close();
      fDir.dispose();
    }
  });

  // M2 fix wave 2 (decision 11, amended): one batch (one transaction: discovery applies a scan's burst 200 to one) reads
  // git's files for a folder once, and the next batch reads them again, so a worktree made a moment ago is seen at the
  // next pass.
  describe('the reads one batch shares', () => {
    it("reads each folder's repository, branch and location once for any number of summaries", () => {
      const calls: string[] = [];
      const reads = new FolderReads({
        repositoryAt: (folder) => (calls.push(`repository ${folder}`), repositoryAt(folder)),
        headBranch: (workTree) => (calls.push(`head ${workTree}`), headBranch(workTree)),
        locate: (folder) => (calls.push(`locate ${folder}`), locate(folder)),
      });
      const stamp = { size: 1, mtimeMs: 1 };
      const byCd = summary({ directory: at('repo'), newestCwd: at('side'), gitBranch: 'main' });
      const byTool = summary({ directory: at('repo'), relocatedCwd: w1(), newestCwd: `${w1()}/src`, gitBranch: 'worktree-w1' });
      const first = [folderColumns(byCd, locate(at('repo')), stamp, reads), folderColumns(byTool, locate(w1()), stamp, reads)];
      const once = calls.length;
      expect(once).toBeGreaterThan(0);
      for (let i = 0; i < 50; i++) {
        expect(folderColumns(byCd, locate(at('repo')), stamp, reads)).toEqual(first[0]);
        expect(folderColumns(byTool, locate(w1()), stamp, reads)).toEqual(first[1]);
      }
      expect(calls).toHaveLength(once);
      expect(new Set(calls).size).toBe(calls.length); // no folder read twice
      expect(JSON.parse(first[0].agent_folder!)).toMatchObject({ checkout: at('side'), branch: 'side' });
      expect(JSON.parse(first[1].launch_folder!)).toMatchObject({ folder: at('repo') });
    });

    it('answers a whole transaction from its first reads, and reads again in the next', () => {
      const cd = () => index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(++n), directory: at('repo'), newestCwd: at('side2') })).record;
      index.transaction(() => {
        expect(cd().agentFolder?.checkout).toBe(at('side2'));
        rmSync(at('repo/.git/worktrees/side2/gitdir')); // deregistered: its pointer is no longer named back
        expect(cd().agentFolder?.checkout).toBe(at('side2')); // the batch's own read
      });
      expect(cd()).not.toHaveProperty('agentFolder'); // the next batch sees the change
      expect(workingFolder(cd())).toEqual({ path: at('repo'), cwd: at('repo'), launch: at('repo'), moved: false });
    });
  });

  // §C: a database build F made has neither column; the opener adds both, null, and leaves its version where it was
  it('adds the two columns to an index, nullable, without moving its user_version', () => {
    const path = join(dir.path, 'build-f.sqlite');
    new Index(path).close();
    const raw = () => new DatabaseSync(path);
    const before = raw();
    let version: unknown;
    try {
      before.exec('ALTER TABLE sessions DROP COLUMN launch_folder; ALTER TABLE sessions DROP COLUMN agent_folder');
      version = before.prepare('PRAGMA user_version').get();
    } finally {
      before.close();
    }
    expect(version).toEqual({ user_version: MIGRATIONS.at(-1)!.version });
    new Index(path).close();
    const after = raw();
    try {
      expect(after.prepare('PRAGMA user_version').get()).toEqual(version);
      const added = (after.prepare('PRAGMA table_info(sessions)').all() as { name: string; notnull: number; type: string }[]).filter((c) => c.name === 'launch_folder' || c.name === 'agent_folder');
      expect(added.map((c) => [c.name, c.type, c.notnull]).sort()).toEqual([
        ['agent_folder', 'TEXT', 0],
        ['launch_folder', 'TEXT', 0],
      ]);
    } finally {
      after.close();
    }
  });
});
