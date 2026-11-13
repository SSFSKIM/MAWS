import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, AttentionId, MessageUuid, RequestId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SessionRecordSchema } from '@shared/graph/session';
import type { TranscriptSummary } from '@shared/wire/store';
import { gitCheckout, gitWorktree, sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { budgetVerdict, machineLoad } from '../../../test/support/latency-budget';
import { Index } from './index';
import { cutPrompt, promptTitle } from './sessions';

const LAUNCH = {
  directory: '/nowhere/launch',
  additionalDirectories: ['/nowhere/extra'],
  worktree: null,
  model: { requested: 'opus', resolved: null },
  effort: 'high',
  permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
} as const satisfies Omit<Parameters<Index['sessions']['createForLaunch']>[0], 'appSessionId'>;

describe('session records in the index', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let changes: [SessionRecord, string][];
  let bindings: [AppSessionId, SessionId | null][];
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    changes = [];
    bindings = [];
    index.sessions.onChange((record, cause) => changes.push([record, cause]));
    index.sessions.onBinding((change) => bindings.push([change.appSessionId, change.sessionId]));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  const titleOf = (appId: AppSessionId) => index.sessions.get(appId)!.title;

  // New chat (2026-10-01): "Don't work in a project" runs in the home directory, which discovery makes no project of,
  // so its session lists under Other sessions; a folder inside it is a project as any other
  it('discovery makes no project of the home directory', () => {
    const { record } = index.sessions.upsertFromSummary(summary({ directory: realpathSync(homedir()) }));
    expect(record.projectId).toBeNull();
    expect(index.projects.list()).toEqual([]);
    expect(index.sessions.upsertFromSummary(summary({ directory: dir.path })).record.projectId).not.toBeNull();
  });

  // W11 (I1): a launched session has a title before its transcript is summarised, and after a `/clear` once the next
  // message's summary arrives; between the two it is empty (the renderer reads "New chat").
  describe('the first prompt seeded at launch', () => {
    it('titles the record until the first summary with a prompt overwrites it; a summary without one keeps it', () => {
      const { record } = index.sessions.createForLaunch({ ...LAUNCH, firstPrompt: 'Fix the  drag handle' });
      expect(record.title).toEqual({ text: 'Fix the drag handle', source: 'none' });
      const s = summary({ customTitle: null, aiTitle: null, firstPrompt: null });
      index.sessions.bindEngineId(record.appId, s.sessionId);
      index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: 'Fix the drag handle', source: 'none' });
      index.sessions.upsertFromSummary({ ...s, firstPrompt: 'Fix the drag handle, as written to disk', size: 300 });
      expect(titleOf(record.appId)).toEqual({ text: 'Fix the drag handle, as written', source: 'none' }); // S-11: six words
      index.sessions.upsertFromSummary({ ...s, firstPrompt: 'Fix the drag handle, as written to disk', aiTitle: 'Drag handle fix', size: 400 });
      expect(titleOf(record.appId)).toEqual({ text: 'Drag handle fix', source: 'generated' });
    });

    it('a launch without a message seeds nothing, and `/clear` then a message titles from the new transcript', () => {
      const { record } = index.sessions.createForLaunch({ ...LAUNCH, firstPrompt: null });
      expect(record.title).toEqual({ text: '', source: 'none' });
      const a = summary({ customTitle: null, aiTitle: null, firstPrompt: 'First topic' });
      index.sessions.bindEngineId(record.appId, a.sessionId);
      index.sessions.upsertFromSummary(a);
      expect(titleOf(record.appId)).toEqual({ text: 'First topic', source: 'none' });
      const b = sessionIdFor(81);
      expect(index.sessions.bindEngineId(record.appId, b).title).toEqual({ text: '', source: 'none' });
      index.sessions.upsertFromSummary(summary({ sessionId: b, customTitle: null, aiTitle: null, firstPrompt: 'Second topic' }));
      expect(titleOf(record.appId)).toEqual({ text: 'Second topic', source: 'none' });
    });

    it('a pasted block titles as its placeholder, cut or whole', () => {
      const block = (body: string) => `<pasted_content id="ab12">\n${body}\n</pasted_content id="ab12">`;
      expect(promptTitle(`Review this\n\n${block('one\ntwo\nthree')}\n`)).toBe('Review this [Pasted text #1 +3 lines]');
      expect(promptTitle(`${block('a')}\n\nand ${block('b\nc')}`)).toBe('[Pasted text #1 +1 lines] and [Pasted text #2 +2 lines]');
      expect(promptTitle(`Review this\n\n<pasted_content id="ab12">\nline one\nline two, cut at the c`)).toBe('Review this [Pasted text #1]');
      const { record } = index.sessions.createForLaunch({ ...LAUNCH, firstPrompt: 'Review this [Pasted text #1 +3 lines]' });
      expect(record.title.text).toBe('Review this [Pasted text #1 +3 lines]');
    });
  });

  // UX wave U7, S-11 (Interfaces §A): a session with no title is named by six words of its first prompt, cut as Claude
  // Desktop cuts it; the stored prompt stays whole, so the conversation search still reads all of it.
  describe('a prompt names its session by six words', () => {
    const thirty = Array.from({ length: 30 }, (_, n) => `word${n + 1}`).join(' ');

    it('keeps the first six words, at most 60 code points, never splitting a surrogate pair', () => {
      expect(cutPrompt(thirty)).toBe('word1 word2 word3 word4 word5 word6');
      const long = 'a'.repeat(80);
      expect(cutPrompt(long)).toBe(`${'a'.repeat(59)}…`);
      expect(Array.from(cutPrompt(long))).toHaveLength(60);
      const paired = `${'b'.repeat(58)}😀😀 next`; // the second emoji is the 60th code point, past the 59 kept
      expect(cutPrompt(paired)).toBe(`${'b'.repeat(58)}😀…`);
      expect(cutPrompt(`${'c'.repeat(59)}😀`)).toBe(`${'c'.repeat(59)}😀`); // 60 code points (61 UTF-16 units): whole
    });

    it('takes the file mentions at its start off, in both forms, and is named by their files when they are all it has', () => {
      expect(cutPrompt('@"my notes/plan.md" @src/app.ts, tidy the imports in both files please')).toBe('tidy the imports in both files');
      expect(cutPrompt('@"my notes/plan.md" @src/app.ts')).toBe('plan.md, app.ts');
      expect(cutPrompt('@src/ walk it')).toBe('walk it');
      expect(cutPrompt('@src/')).toBe('src');
      expect(cutPrompt('Look at @src/app.ts first')).toBe('Look at @src/app.ts first'); // a mention inside the prompt is a word
      expect(cutPrompt('@agent-reviewer look at this')).toBe('@agent-reviewer look at this');
      expect(cutPrompt('@src/app.ts @agent-reviewer look at this')).toBe('@agent-reviewer look at this');
    });

    it('counts a pasted block’s placeholder as one word', () => {
      expect(cutPrompt('Review this [Pasted text #1 +3 lines] and the two files beside it now')).toBe('Review this [Pasted text #1 +3 lines] and the two');
      expect(cutPrompt('[Image #1] [PDF #2] [Pasted text #3] one two three four')).toBe('[Image #1] [PDF #2] [Pasted text #3] one two three');
    });

    it('cuts only a prompt’s title: a rename, the engine’s title and a generated title are kept whole', () => {
      const s = summary({ customTitle: null, aiTitle: thirty, firstPrompt: thirty });
      const { record } = index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: thirty, source: 'generated' });
      index.sessions.upsertFromSummary({ ...s, customTitle: thirty, size: 300 });
      expect(titleOf(record.appId)).toEqual({ text: thirty, source: 'user' });
      index.sessions.update(record.appId, { title: { text: `${thirty} again`, source: 'user' } });
      expect(titleOf(record.appId)).toEqual({ text: `${thirty} again`, source: 'user' });
    });

    it('names a session by six words while the conversation search still finds it by its thirtieth', () => {
      const { record } = index.sessions.upsertFromSummary(summary({ customTitle: null, aiTitle: null, firstPrompt: thirty }));
      expect(titleOf(record.appId)).toEqual({ text: 'word1 word2 word3 word4 word5 word6', source: 'none' });
      expect(index.sessionSearch.search('word30').map((hit) => hit.appSessionId)).toEqual([record.appId]);
    });
  });

  it('upsertFromSummary twice with the same summary creates one row and answers created: false the second time', () => {
    const s = summary();
    const first = index.sessions.upsertFromSummary(s);
    expect(first.created).toBe(true);
    expect(SessionRecordSchema.parse(first.record)).toEqual(first.record);
    expect(first.record).toMatchObject({
      engineSessionId: s.sessionId,
      projectId: null,
      directory: '/nowhere/at/all',
      title: { text: 'hello', source: 'none' },
      holder: { kind: 'none' },
      gateway: { routed: null, baseUrl: null, autoModeServer: 'unknown' }, // unknown: no verification ran
      pinned: false,
      archived: false,
      unread: false,
    });
    const second = index.sessions.upsertFromSummary(s);
    expect(second.created).toBe(false);
    expect(second.record.appId).toBe(first.record.appId);
    expect(index.sessions.list()).toHaveLength(1);
    expect(changes.map(([, cause]) => cause)).toEqual(['discovered']); // an unchanged summary is silent
    expect(bindings).toEqual([[first.record.appId, s.sessionId]]);
    expect(index.sessions.summaries().get(first.record.appId)).toEqual(s);
  });

  it('reports an advance only when lastRecordAt moves past a stored value', () => {
    const s = summary();
    expect(index.sessions.upsertFromSummary(s).advanced).toBe(false); // first sight is not news
    expect(index.sessions.upsertFromSummary({ ...s, size: 200 }).advanced).toBe(false);
    expect(index.sessions.upsertFromSummary({ ...s, lastRecordAt: '2026-09-28T11:00:00.000Z' }).advanced).toBe(true);
  });

  describe('title gates (the Title rule)', () => {
    it('two consecutive terminal renames: the second reaches the record as user', () => {
      const s = summary({ customTitle: 'A' });
      const { record } = index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: 'A', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'B' });
      expect(titleOf(record.appId)).toEqual({ text: 'B', source: 'user' });
    });

    it('a regenerated AI title replaces the previous one, and never displaces a custom title', () => {
      const s = summary({ aiTitle: 'X' });
      const { record } = index.sessions.upsertFromSummary(s);
      expect(titleOf(record.appId)).toEqual({ text: 'X', source: 'generated' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y' });
      expect(titleOf(record.appId)).toEqual({ text: 'Y', source: 'generated' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y', customTitle: 'Mine' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Z', customTitle: 'Mine' });
      expect(titleOf(record.appId)).toEqual({ text: 'Mine', source: 'user' });
    });

    it('a MAWS rename holds through unchanged custom titles and any AI title, yields to a new terminal rename, and clears to the engine title', () => {
      const s = summary({ customTitle: null, aiTitle: 'X' });
      const { record } = index.sessions.upsertFromSummary(s);
      index.sessions.update(record.appId, { title: { text: 'M', source: 'user' } });
      expect(titleOf(record.appId)).toEqual({ text: 'M', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Y' });
      index.sessions.upsertFromSummary({ ...s, aiTitle: 'Z', size: 300 });
      expect(titleOf(record.appId)).toEqual({ text: 'M', source: 'user' });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'T' });
      expect(titleOf(record.appId)).toEqual({ text: 'T', source: 'user' });

      // An override set while a custom title stands holds while that custom title is unchanged.
      index.sessions.update(record.appId, { title: { text: 'M2', source: 'tool' } });
      index.sessions.upsertFromSummary({ ...s, customTitle: 'T', aiTitle: 'W' });
      expect(titleOf(record.appId)).toEqual({ text: 'M2', source: 'tool' });
      index.sessions.update(record.appId, { title: null });
      expect(titleOf(record.appId)).toEqual({ text: 'T', source: 'user' });
    });

    it('falls back from custom to AI title to first prompt to an empty title', () => {
      const { record } = index.sessions.upsertFromSummary(summary({ firstPrompt: null }));
      expect(titleOf(record.appId)).toEqual({ text: '', source: 'none' });
    });

    it('offers a slash command as the command typed, never its markup', () => {
      // As the engine writes a `/clear` prompt (spikes/protocol-probe fixtures).
      const clear = '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>';
      const { record } = index.sessions.upsertFromSummary(summary({ customTitle: null, aiTitle: null, firstPrompt: clear }));
      expect(titleOf(record.appId)).toEqual({ text: '/clear', source: 'none' });
      const command = (name: string, args: string) =>
        `<command-message>${name} is running…</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;
      expect(promptTitle(command('fix-issue', 'the parser drops  trailing commas'))).toBe('/fix-issue the parser drops trailing commas');
      expect(promptTitle(command('review', 'PR 12'))).toBe('/review PR 12');
      expect(promptTitle(`${command('review', 'PR 12')}\n  Look at the   sidebar drag first`)).toBe('/review PR 12 Look at the sidebar drag first');
      expect(promptTitle('<command-name>/init</command-name>\n<command-message>init is analyzing your codebase…')).toBe('/init'); // cut at the cap
      expect(promptTitle('<command-name>/fix-issue</command-name>\n<command-args>the parser dr')).toBe('/fix-issue the parser dr');
      // A local command's output alone has nothing readable once stripped: the prompt as written, never a blank title
      // (W11, I1).
      expect(promptTitle('<local-command-stdout>Set model to opus</local-command-stdout>')).toBe('<local-command-stdout>Set model to opus</local-command-stdout>');
      expect(promptTitle('  \n ')).toBeNull();
      // Prose that mentions the markup is prose.
      expect(promptTitle('Why does the sidebar show <command-name> in some titles?')).toBe('Why does the sidebar show <command-name> in some titles?');
      expect(promptTitle('Why does <div> wrap here?')).toBe('Why does <div> wrap here?');
      // An AI title still wins over a readable prompt, and a readable prompt is kept as it stands.
      const titled = index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(2), customTitle: null, aiTitle: null, firstPrompt: 'Fix the drag' }));
      expect(titleOf(titled.record.appId)).toEqual({ text: 'Fix the drag', source: 'none' });
    });
  });

  it('setHolder moves a foreign holder, answers null for an unknown engine id, and leaves a self-held record alone', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    expect(index.sessions.setHolder(s.sessionId, { kind: 'terminal', pid: 42 })?.holder).toEqual({ kind: 'terminal', pid: 42 });
    expect(index.sessions.setHolder(sessionIdFor(999), { kind: 'terminal', pid: 1 })).toBeNull();
    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' } });
    changes.length = 0;
    expect(index.sessions.setHolder(s.sessionId, { kind: 'none' })?.holder).toEqual({ kind: 'self' });
    expect(changes).toEqual([]);
  });

  // C10 start: D-16's start-time reset (C10 execution document, Session service "D-16 reset")
  it('resetSelfHolders clears every self holder to none, leaves foreign holders alone, and announces each record once', () => {
    const held = summary();
    const foreign = summary();
    const a = index.sessions.upsertFromSummary(held).record;
    const b = index.sessions.createForLaunch({ ...LAUNCH, appSessionId: randomUUID() as AppSessionId }).record;
    const c = index.sessions.upsertFromSummary(foreign).record;
    index.sessions.applyEngineStatus(a.appId, { holder: { kind: 'self' } });
    index.sessions.applyEngineStatus(b.appId, { holder: { kind: 'self' } });
    index.sessions.setHolder(foreign.sessionId, { kind: 'background_job', pid: 7, jobId: 'abcd1234' });
    index.sessions.update(b.appId, { archived: true });
    changes.length = 0;
    expect(index.sessions.resetSelfHolders()).toBe(2);
    expect(index.sessions.get(a.appId)!.holder).toEqual({ kind: 'none' });
    expect(index.sessions.get(b.appId)!.holder).toEqual({ kind: 'none' }); // archived records too: nothing is held at start
    expect(index.sessions.get(c.appId)!.holder).toEqual({ kind: 'background_job', pid: 7, jobId: 'abcd1234' });
    expect(changes.map(([record, cause]) => [record.appId, cause]).sort()).toEqual([[a.appId, 'holder'], [b.appId, 'holder']].sort());
    changes.length = 0;
    expect(index.sessions.resetSelfHolders()).toBe(0);
    expect(changes).toEqual([]);
  });
  // C10 end

  // UX wave U8c-2 (M2 decision 11; Decision Log 3, finding F): the summaries as this build produces them, every one with
  // its newest row's folder. 3,600 name one folder (nothing is read for them); 200 have their home in a real worktree of
  // a real repository (the launch folder is computed); 200 have their newest row in a second real worktree after a `cd`
  // (the agent's folder is computed and its branch read from git's files). A measurement of that workload, not a bound
  // for a store in which every summary needs fresh repository reads.
  const BOUND_COUNT = 4_000;
  const boundSummaries = async (root: string) => {
    const main = await gitCheckout(join(root, 'repo'), 'main');
    const w1 = await gitWorktree(main, join(main, '.claude/worktrees/w1'), 'worktree-w1');
    const w2 = await gitWorktree(main, join(root, 'repo-w2'), 'w2');
    const groups = { oneFolder: 0, homeInWorktree: 0, cdIntoWorktree: 0 };
    const summaries = Array.from({ length: BOUND_COUNT }, (_, i) => {
      const base = { sessionId: sessionIdFor(i + 1), customTitle: i % 3 === 0 ? `t${i}` : null };
      if (i % 20 === 1) return (groups.homeInWorktree++, summary({ ...base, directory: main, relocatedCwd: w1, newestCwd: w1 }));
      if (i % 20 === 2) return (groups.cdIntoWorktree++, summary({ ...base, directory: main, newestCwd: w2 }));
      const one = summary(base);
      return (groups.oneFolder++, { ...one, newestCwd: one.directory });
    });
    expect(groups).toEqual({ oneFolder: 3_600, homeInWorktree: 200, cdIntoWorktree: 200 });
    return { summaries, main, w1, w2 };
  };

  // The summaries an engine host of a build before this landing sends: no newest row's folder.
  const withoutNewest = (summaries: TranscriptSummary[]) =>
    summaries.map((s) => {
      const copy = { ...s };
      delete copy.newestCwd;
      return copy;
    });

  // macOS: a CPU-time bound measured on the Apple silicon Mac (a hardware-bound gate,
  // docs/doperpowers/plans/2026-10-14-gate-offload.md §3.1).
  it.skipIf(process.platform !== 'darwin')('upserts 4,000 synthetic summaries inside one transaction in under 500 ms of CPU time', async () => {
    const repos = tempDir('maws-bound-');
    try {
      const { summaries } = await boundSummaries(repos.path);
      // The bound is on the work the upserts cost (this process's CPU time; vitest runs each file in its own process), so
      // a loaded machine's scheduling does not decide it. Contention still adds to CPU time (shared caches, a slower clock
      // with every core busy): master's own code measured 512 ms on the mini while e2e jobs ran on both its desktops (run
      // 43429465758; 605.9, 519.5 and 518.4 ms in runs 43206290258, 43420507070 and 43427405095). So the cost is the least
      // of three runs, each on a fresh index, and it is held to 500 ms as named only on a quiet machine; loaded (busy cores,
      // a shared desktop, the guest, or a guest beside the host) it is recorded and held to the loose ceiling, as every
      // latency bound is (test/support/latency-budget.ts).
      const machine = machineLoad();
      const at = Date.now();
      const run = (target: Index, batch = summaries) => {
        const cpu = process.cpuUsage();
        const started = performance.now();
        target.transaction(() => {
          for (const s of batch) target.sessions.upsertFromSummary(s);
        });
        const spent = process.cpuUsage(cpu);
        return { ms: (spent.user + spent.system) / 1000, elapsed: performance.now() - started };
      };
      const first = run(index);
      expect(index.sessions.list()).toHaveLength(BOUND_COUNT);
      const runs = [first];
      for (let i = 1; i < 3; i++) {
        const fresh = tempDir();
        const other = new Index(join(fresh.path, 'index.sqlite'));
        try {
          runs.push(run(other));
          expect(other.sessions.list()).toHaveLength(BOUND_COUNT);
        } finally {
          other.close();
          fresh.dispose();
        }
      }
      // Printed and not asserted: the same 4,000 summaries without the newest row's folder (the older producer's, which
      // reads nothing new), the comparison every run carries at its own load, the least of three runs on fresh indexes;
      // and the three shares, what a run over the bound is reported with: diagnostics, one run each (M2 fix wave 2).
      const leastOf = (batch: TranscriptSummary[], runCount = 3) => {
        const times: number[] = [];
        for (let i = 0; i < runCount; i++) {
          const fresh = tempDir();
          const other = new Index(join(fresh.path, 'index.sqlite'));
          try {
            times.push(run(other, batch).ms);
          } finally {
            other.close();
            fresh.dispose();
          }
        }
        return Math.round(Math.min(...times) * 10) / 10;
      };
      const share = (pick: (i: number) => boolean) => leastOf(summaries.filter((_, i) => pick(i)), 1);
      const least = Math.round(Math.min(...runs.map((r) => r.ms)) * 10) / 10;
      const withoutNewestLeast = leastOf(withoutNewest(summaries));
      console.log(`[latency] 4,000 upserts, CPU ms: ${least}; the same without the newest row's folder: ${withoutNewestLeast}`);
      console.log(`[latency] 4,000 upserts by share, CPU ms: one folder ${share((i) => i % 20 > 2 || i % 20 === 0)}, home in a worktree ${share((i) => i % 20 === 1)}, cd into a worktree ${share((i) => i % 20 === 2)}`);
      const { ceiling, reason } = budgetVerdict('4,000 upserts, CPU time', least, 500, machine, at);
      if (reason !== null) console.log(`[latency] ${reason}`);
      expect(least).toBeLessThan(ceiling);
      expect(Math.min(...runs.map((r) => r.elapsed))).toBeLessThan(2000); // a sanity bound on the wall clock, as M5's instant pin keeps
    } finally {
      repos.dispose();
    }
  }, 60_000); // the case runs the upserts 9 times; this is the test's timeout, not a time bound

  // U8c-2 (M2 decision 11): the same count from an engine host that does not say where the newest row is gives exactly
  // today's records, and neither column is written.
  it('upserts the same 4,000 summaries without the newest row\'s folder into today\'s records and no fact', async () => {
    const repos = tempDir('maws-bound-');
    try {
      const { summaries, main, w1 } = await boundSummaries(repos.path);
      const older = withoutNewest(summaries);
      index.transaction(() => {
        for (const s of older) index.sessions.upsertFromSummary(s);
      });
      const records = index.sessions.list();
      expect(records).toHaveLength(BOUND_COUNT);
      const bySession = new Map(records.map((r) => [r.engineSessionId, r]));
      older.forEach((s, i) => {
        const record = bySession.get(s.sessionId)!;
        const want =
          i % 20 === 1 ? { directory: w1, worktree: { path: w1, branch: null } } : i % 20 === 2 ? { directory: main, worktree: null } : { directory: s.directory, worktree: null };
        expect({ directory: record.directory, worktree: record.worktree, branch: record.branch, title: record.title.text }).toEqual({ ...want, branch: null, title: s.customTitle ?? 'hello' });
        expect(record).not.toHaveProperty('launchFolder');
        expect(record).not.toHaveProperty('agentFolder');
      });
      const raw = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
      try {
        expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE launch_folder IS NOT NULL OR agent_folder IS NOT NULL').get()).toEqual({ n: 0 });
      } finally {
        raw.close();
      }
    } finally {
      repos.dispose();
    }
  });

  it('createForLaunch takes a caller-supplied UUID v4 and answers exists with the first record on a collision', () => {
    const appSessionId = randomUUID() as AppSessionId;
    const created = index.sessions.createForLaunch({ appSessionId, ...LAUNCH });
    expect(created).toMatchObject({ ok: true, record: { appId: appSessionId, engineSessionId: null, directory: '/nowhere/launch', additionalDirectories: ['/nowhere/extra'], effort: 'high' } });
    const again = index.sessions.createForLaunch({ appSessionId, ...LAUNCH, directory: '/elsewhere' });
    expect(again).toEqual({ ok: false, reason: 'exists', record: index.sessions.get(appSessionId) });
    expect(index.sessions.get(appSessionId)?.directory).toBe('/nowhere/launch');
    expect(() => index.sessions.createForLaunch({ appSessionId: 'not-a-uuid' as AppSessionId, ...LAUNCH })).toThrow('not a UUID v4: not-a-uuid');

    const allocated = index.sessions.createForLaunch(LAUNCH);
    expect(allocated.ok).toBe(true);
    expect(allocated.record.appId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // P5 O7 M4 (launchedBy write-once): O12 reads a record's launchedBy as a trust input, so only the launch's insert writes
  // it; no update, discovery merge, rebind or yield to another binding sets, changes or clears it
  it('keeps the launchedBy its launch inserted through updates, discovery, a rebind, and another launch wanting its engine id', () => {
    const launchedBy = { member: 'mem-a', device: 'dev-1', opId: 'op-1', action: { action: 'session.spawn', signature: 'sig' } };
    const { record } = index.sessions.createForLaunch({ ...LAUNCH, launchedBy });
    const appId = record.appId;
    expect(index.sessions.createForLaunch({ ...LAUNCH, appSessionId: appId }).record.launchedBy).toEqual(launchedBy); // a launch reusing the row writes nothing
    index.sessions.setPinned(appId, true);
    index.sessions.update(appId, { title: { text: 'Named', source: 'user' }, archived: true, branch: 'feature' });
    index.sessions.setPinned(appId, false);
    index.sessions.update(appId, { title: null, archived: false });
    const first = sessionIdFor(81);
    index.sessions.bindEngineId(appId, first);
    index.sessions.upsertFromSummary(summary({ sessionId: first, customTitle: 'From the transcript' })); // discovery's merge
    expect(index.sessions.get(appId)?.launchedBy).toEqual(launchedBy);
    index.sessions.bindEngineId(appId, sessionIdFor(82)); // a rebind (`/clear`)
    index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(82) }));
    expect(index.sessions.get(appId)?.launchedBy).toEqual(launchedBy);
    // another launch binding the spawned record's engine id is refused: the record is never yielded (deleted) as bare
    const other = index.sessions.createForLaunch(LAUNCH).record;
    expect(() => index.sessions.bindEngineId(other.appId, sessionIdFor(82))).toThrow(`already bound to app session ${appId}`);
    expect(index.sessions.get(appId)?.launchedBy).toEqual(launchedBy);
    expect(other.launchedBy).toBeUndefined();
  });

  it('bindEngineId then unbindEngineId leaves engineSessionId null and pin, title and directory as they were', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const appId = record.appId;
    index.sessions.setPinned(appId, true);
    index.sessions.update(appId, { title: { text: 'Named', source: 'user' } });
    const engineId = sessionIdFor(77);
    expect(index.sessions.bindEngineId(appId, engineId).engineSessionId).toBe(engineId);
    expect(index.sessions.getByEngineId(engineId)?.appId).toBe(appId);
    const unbound = index.sessions.unbindEngineId(appId);
    expect(unbound).toMatchObject({ engineSessionId: null, pinned: true, title: { text: 'Named', source: 'user' }, directory: '/nowhere/launch' });
    expect(index.sessions.getByEngineId(engineId)).toBeNull();
    expect(bindings).toEqual([
      [appId, engineId],
      [appId, null],
    ]);
    // A transcript later discovered under that engine id becomes a fresh record.
    const later = index.sessions.upsertFromSummary(summary({ sessionId: engineId }));
    expect(later.created).toBe(true);
    expect(later.record.appId).not.toBe(appId);
  });

  it('a live process takes over the record discovery made for its transcript first; an engine id another MAWS process holds is refused', () => {
    // Discovery can see the new transcript before the status naming its id arrives: that record yields, its facts move over.
    const s = summary({ customTitle: 'Seen first' });
    const discovered = index.sessions.upsertFromSummary(s).record;
    const { record } = index.sessions.createForLaunch(LAUNCH);
    bindings.length = 0;
    changes.length = 0;
    const bound = index.sessions.bindEngineId(record.appId, s.sessionId);
    expect(bound).toMatchObject({ appId: record.appId, engineSessionId: s.sessionId, title: { text: 'Seen first', source: 'user' } });
    expect(index.sessions.get(discovered.appId)).toBeNull();
    expect(index.sessions.summaryOf(record.appId)?.sessionId).toBe(s.sessionId);
    expect(bindings).toEqual([
      [discovered.appId, null],
      [record.appId, s.sessionId],
    ]);
    expect(changes.map(([r, cause]) => [r.appId, cause])).toEqual([
      [discovered.appId, 'removed'],
      [record.appId, 'live'],
    ]);

    // A record carrying the owner's own state (an exited MAWS session with a pin, say: holder `none`) never yields.
    const exited = summary();
    const kept = index.sessions.upsertFromSummary(exited).record;
    index.sessions.setPinned(kept.appId, true);
    const claimant = index.sessions.createForLaunch(LAUNCH).record;
    expect(() => index.sessions.bindEngineId(claimant.appId, exited.sessionId)).toThrow(/already bound/);
    expect(index.sessions.get(kept.appId)).toMatchObject({ engineSessionId: exited.sessionId, pinned: true });
    // Nor does one with a draft, a MAWS title, or a last-seen cursor.
    for (const mark of [
      (id: AppSessionId) => index.drafts.set(id, { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T10:00:00.000Z' }),
      (id: AppSessionId) => index.sessions.update(id, { title: { text: 'Mine', source: 'user' } }),
      (id: AppSessionId) => index.sessions.markSeen(id, { messageUuid: null, at: '2026-09-28T10:00:00.000Z' }),
      (id: AppSessionId) => index.sessions.update(id, { archived: true }),
      (id: AppSessionId) =>
        index.attention.replaceForSession(id, [
          {
            id: 'att-1' as AttentionId,
            appSessionId: id,
            sessionId: null,
            kind: 'permission',
            request: { requestId: 'req-1' as RequestId, toolUseId: null, taskId: null, agentId: null },
            summary: 'Allow?',
            createdAt: '2026-09-28T10:00:00.000Z',
            state: 'pending',
            stateChangedAt: '2026-09-28T10:00:00.000Z',
            expiresAt: null,
          },
        ]),
    ]) {
      const s2 = summary();
      const marked = index.sessions.upsertFromSummary(s2).record;
      mark(marked.appId);
      expect(() => index.sessions.bindEngineId(claimant.appId, s2.sessionId)).toThrow(/already bound/);
      expect(index.sessions.get(marked.appId)?.engineSessionId).toBe(s2.sessionId);
    }
    // A draft cleared (its tombstone, M6a's re-review K1), the owners' or a member's, is none: that record still yields.
    for (const reader of ['owner', 'b'.repeat(32)]) {
      const s3 = summary();
      const cleared = index.sessions.upsertFromSummary(s3).record;
      index.drafts.set(cleared.appId, { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T10:00:00.000Z' }, reader);
      index.drafts.set(cleared.appId, null, reader);
      const taker = index.sessions.createForLaunch(LAUNCH).record;
      expect(index.sessions.bindEngineId(taker.appId, s3.sessionId)).toMatchObject({ appId: taker.appId, engineSessionId: s3.sessionId });
      expect(index.sessions.get(cleared.appId)).toBeNull();
    }

    // Two MAWS processes claiming one engine session is a conflict to surface, not to merge.
    const other = index.sessions.createForLaunch(LAUNCH).record;
    index.sessions.applyEngineStatus(other.appId, { holder: { kind: 'self' } });
    const engineId = sessionIdFor(78);
    index.sessions.bindEngineId(other.appId, engineId);
    const third = index.sessions.createForLaunch(LAUNCH).record;
    expect(() => index.sessions.bindEngineId(third.appId, engineId)).toThrow(/already bound/);
    expect(index.sessions.get(third.appId)?.engineSessionId).toBeNull();
    expect(index.sessions.get(other.appId)?.engineSessionId).toBe(engineId);
  });

  it('a second engine id for a bound record (the engine\'s /clear) rebinds it, and the old transcript becomes a record of its own', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const appId = record.appId;
    const a = summary({ customTitle: 'Before clear', lastRecordAt: '2026-09-28T10:00:00.000Z' });
    index.sessions.bindEngineId(appId, a.sessionId);
    index.sessions.upsertFromSummary(a);
    index.sessions.setPinned(appId, true);
    index.sessions.update(appId, { title: { text: 'Named in MAWS', source: 'user' } });
    bindings.length = 0;

    const b = sessionIdFor(79);
    const rebound = index.sessions.bindEngineId(appId, b);
    expect(rebound).toMatchObject({ appId, engineSessionId: b, pinned: true, title: { text: 'Named in MAWS', source: 'user' } });
    // The app session no longer describes A's transcript: nothing tells the host A's size and mtime under this app id.
    expect(index.sessions.summaryOf(appId)).toBeNull();
    expect(index.sessions.bindings().find((binding) => binding.appSessionId === appId)).toEqual({ sessionId: b, appSessionId: appId, size: null, mtimeMs: null });
    const history = index.sessions.getByEngineId(a.sessionId)!;
    expect(history.appId).not.toBe(appId);
    expect(history).toMatchObject({ pinned: false, title: { text: 'Before clear', source: 'user' } });
    expect(index.sessions.summaryOf(history.appId)).toEqual(a);
    expect(bindings).toEqual([
      [appId, b],
      [history.appId, a.sessionId],
    ]);

    // B's first summary fills the record; A's custom title was the engine's, so the MAWS rename holds.
    const next = index.sessions.upsertFromSummary(summary({ sessionId: b, customTitle: null, lastRecordAt: '2026-09-28T11:00:00.000Z' }));
    // A first sighting of the new transcript, not an advance: last_record_at was cleared with the old transcript's facts.
    expect(next).toMatchObject({ created: false, advanced: false, record: { appId, title: { text: 'Named in MAWS', source: 'user' } } });
  });

  it('a rebind clears the old transcript\'s engine titles and text, so no two rows carry its title', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const a = summary({ customTitle: 'Old custom', aiTitle: 'Old AI', firstPrompt: 'old prompt', lastAssistantText: 'old reply' });
    index.sessions.bindEngineId(record.appId, a.sessionId);
    index.sessions.upsertFromSummary(a);
    const rebound = index.sessions.bindEngineId(record.appId, sessionIdFor(80));
    expect(rebound.title).toEqual({ text: '', source: 'none' });
    expect(index.sessions.list().filter((r) => r.title.text === 'Old custom').map((r) => r.engineSessionId)).toEqual([a.sessionId]);
    const reader = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    const row = { ...reader.prepare('SELECT custom_title, ai_title, first_prompt, last_assistant_text, last_record_at FROM sessions WHERE app_id = ?').get(record.appId) };
    reader.close();
    expect(row).toEqual({ custom_title: null, ai_title: null, first_prompt: null, last_assistant_text: null, last_record_at: null });
  });

  it('applyEngineStatus updates the engine id, holder, gateway, model and permission mode', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const engineId = sessionIdFor(78);
    const applied = index.sessions.applyEngineStatus(record.appId, {
      engineSessionId: engineId,
      holder: { kind: 'self' },
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: 'opus', resolved: 'claude-opus-5' },
      permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_unavailable' },
      engineVersion: '2.1.283',
    });
    expect(applied).toMatchObject({
      engineSessionId: engineId,
      holder: { kind: 'self' },
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: 'opus', resolved: 'claude-opus-5' },
      permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_unavailable' },
      engineVersion: '2.1.283',
    });
    expect(changes.at(-1)?.[1]).toBe('live');
    expect(bindings).toEqual([[record.appId, engineId]]);
  });

  // P5 O7 M9 (Interfaces §U): the record's gateway keeps the route it launched on and what get_status reported of it, in
  // two added columns an older build leaves alone. The route is the one the launch chose (setRoute, at the launch),
  // which an older host's status, carrying none, leaves standing (fix round, item 1); what was observed is the status's
  // alone, cleared by one without it
  it('keeps the gateway’s route and observed across a reopen; a status carrying neither clears only what was observed', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    const machine = { routed: false, baseUrl: 'https://inference.example.invalid', autoModeServer: 'unknown', route: 'machine', observed: { kind: 'host', baseUrl: 'https://inference.example.invalid' } } as const;
    expect(index.sessions.applyEngineStatus(record.appId, { gateway: machine }).gateway).toEqual(machine);
    index.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    expect(index.sessions.get(record.appId)!.gateway).toEqual(machine);
    expect(SessionRecordSchema.parse(index.sessions.get(record.appId)).gateway).toEqual(machine);
    expect(index.sessions.applyEngineStatus(record.appId, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } }).gateway).toEqual({ routed: false, baseUrl: null, autoModeServer: 'unknown', route: 'machine' });
  });

  it('setRoute records the route a launch chose, and a later one replaces it; an unknown id is no write', () => {
    const { record } = index.sessions.createForLaunch(LAUNCH);
    expect(index.sessions.setRoute(record.appId, 'machine')?.gateway.route).toBe('machine');
    expect(index.sessions.setRoute(record.appId, 'direct')?.gateway.route).toBe('direct');
    expect(index.sessions.get(record.appId)!.gateway.route).toBe('direct');
    expect(index.sessions.setRoute(randomUUID() as AppSessionId, 'gateway')).toBeNull();
  });

  // C3's ask (gateway filled for disk sessions): the transcript records no base URL or auto-mode server, so a session
  // discovered on disk carries null and 'unknown' until a verified status of a live process fills them, and what a
  // status filled stays through later summaries (and restarts: they are columns).
  it('a discovered session has no gateway facts until a status fills them; a later summary keeps them', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    expect(record.gateway).toMatchObject({ baseUrl: null, autoModeServer: 'unknown' });
    index.sessions.applyEngineStatus(record.appId, { gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' } });
    expect(index.sessions.upsertFromSummary({ ...s, size: s.size + 1 }).record.gateway).toEqual({ routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' });
  });

  it('markSeen moves lastSeen and clears unread; setUnread and setPinned set their flags', () => {
    const { record } = index.sessions.upsertFromSummary(summary());
    expect(index.sessions.setUnread(record.appId, true).unread).toBe(true);
    const seen = index.sessions.markSeen(record.appId, { messageUuid: 'm1' as MessageUuid, at: '2026-09-28T12:00:00.000Z' });
    expect(seen).toMatchObject({ unread: false, lastSeen: { messageUuid: 'm1', at: '2026-09-28T12:00:00.000Z' } });
    expect(index.sessions.setPinned(record.appId, true).pinned).toBe(true);
    expect(index.sessions.update(record.appId, { archived: true }).archived).toBe(true);
    expect(index.sessions.list()).toEqual([]);
    expect(index.sessions.list({ includeArchived: true })).toHaveLength(1);
  });

  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): the session row's reader columns
  // are the machine's owners'; every other member reads and writes rows of their own, and neither side's writes reach the
  // other's.
  describe('reader state per member', () => {
    const B = 'b'.repeat(32);
    const C = 'c'.repeat(32);
    const at = '2026-09-28T12:00:00.000Z';

    it('a member with no row reads unpinned, read and never seen, whatever the owners hold', () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      index.sessions.setPinned(record.appId, true);
      index.sessions.markSeen(record.appId, { messageUuid: 'm1' as MessageUuid, at });
      index.sessions.setUnread(record.appId, true);
      const owners = index.sessions.get(record.appId)!;
      expect(owners).toMatchObject({ pinned: true, unread: true, lastSeen: { messageUuid: 'm1', at } });
      const unseen = { ...owners, pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } };
      expect(index.sessions.get(record.appId, B)).toEqual(unseen);
      expect(index.sessions.get(record.appId, 'owner')).toEqual(owners);
      expect(index.sessions.list({}, B)).toEqual([unseen]);
      expect(index.sessions.list({}, 'owner')).toEqual([owners]);
    });

    it('a member’s pin, mark and unread are their own: the owners’ columns and another member’s rows are untouched, and the reverse', () => {
      const { record } = index.sessions.upsertFromSummary(summary());
      changes.length = 0;
      const revision = index.revision;
      expect(index.sessions.setPinned(record.appId, true, B)).toMatchObject({ appId: record.appId, pinned: true, unread: false });
      expect(index.sessions.setUnread(record.appId, true, B)).toMatchObject({ pinned: true, unread: true });
      expect(index.sessions.markSeen(record.appId, { messageUuid: 'm2' as MessageUuid, at }, B)).toMatchObject({ pinned: true, unread: false, lastSeen: { messageUuid: 'm2', at } });
      expect(index.sessions.get(record.appId)).toMatchObject({ pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } });
      expect(index.sessions.get(record.appId, C)).toMatchObject({ pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } });
      // a member's write changes no record anyone else reads: no change announced, no revision taken
      expect(changes).toEqual([]);
      expect(index.revision).toBe(revision);

      index.sessions.setPinned(record.appId, true);
      index.sessions.markSeen(record.appId, { messageUuid: 'm3' as MessageUuid, at: '2026-09-28T13:00:00.000Z' });
      index.sessions.setUnread(record.appId, true);
      expect(index.sessions.get(record.appId, B)).toMatchObject({ pinned: true, unread: false, lastSeen: { messageUuid: 'm2', at } });
      index.close();
      index = new Index(join(dir.path, 'index.sqlite'));
      expect(index.sessions.get(record.appId, B)).toMatchObject({ pinned: true, unread: false, lastSeen: { messageUuid: 'm2', at } });
      expect(index.sessions.get(record.appId)).toMatchObject({ pinned: true, unread: true, lastSeen: { messageUuid: 'm3' } });
    });

    it('a new turn’s end marks every member with a row unread; a member who never looked stays read', () => {
      const s = summary({ lastRecordAt: '2026-09-28T10:00:00.000Z' });
      const { record } = index.sessions.upsertFromSummary(s);
      index.sessions.markSeen(record.appId, { messageUuid: null, at }, B);
      index.sessions.setPinned(record.appId, true, C);
      expect(index.sessions.upsertFromSummary({ ...s, size: s.size + 1, lastRecordAt: '2026-09-28T11:00:00.000Z' }).advanced).toBe(true);
      expect(index.sessions.get(record.appId, B)).toMatchObject({ unread: true, lastSeen: { at } });
      expect(index.sessions.get(record.appId, C)).toMatchObject({ unread: true, pinned: true });
      expect(index.sessions.get(record.appId, 'd'.repeat(32))).toMatchObject({ unread: false });
      // the owners' unread stays the source's to set, by its visible set (source.ts)
      expect(index.sessions.get(record.appId)!.unread).toBe(false);
      // a summary that does not advance marks nobody
      index.sessions.markSeen(record.appId, { messageUuid: null, at }, B);
      expect(index.sessions.upsertFromSummary({ ...s, size: s.size + 2, lastRecordAt: '2026-09-28T11:00:00.000Z' }).advanced).toBe(false);
      expect(index.sessions.get(record.appId, B)!.unread).toBe(false);
    });

    it('a member’s write to an app session with no record fails as the owners’ does', () => {
      const unknown = randomUUID() as AppSessionId;
      for (const write of [() => index.sessions.setPinned(unknown, true, B), () => index.sessions.setUnread(unknown, true, B), () => index.sessions.markSeen(unknown, { messageUuid: null, at }, B)]) expect(write).toThrow(`unknown app session: ${unknown}`);
      expect(index.sessions.get(unknown, B)).toBeNull();
    });

    it('a record holding a member’s state never yields to a live process, and its removal takes that state with it', () => {
      const claimant = index.sessions.createForLaunch(LAUNCH).record;
      for (const mark of [(id: AppSessionId) => index.sessions.setPinned(id, false, B), (id: AppSessionId) => index.drafts.set(id, { doc: null, attachments: [], updatedAt: at }, B)]) {
        const s = summary();
        const marked = index.sessions.upsertFromSummary(s).record;
        mark(marked.appId);
        expect(() => index.sessions.bindEngineId(claimant.appId, s.sessionId)).toThrow(/already bound/);
        index.sessions.remove(marked.appId);
        const raw = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
        try {
          for (const table of ['reader_state', 'member_drafts']) expect(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE app_session_id = ?`).get(marked.appId)).toEqual({ n: 0 });
        } finally {
          raw.close();
        }
      }
    });
  });

  it('a transcript removed from disk archives the record and keeps it', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    expect(index.sessions.markTranscriptRemoved(s.sessionId)).toMatchObject({ appId: record.appId, archived: true });
    expect(index.sessions.bindings()).toEqual([{ sessionId: s.sessionId, appSessionId: record.appId, size: null, mtimeMs: null }]);
    expect(index.sessions.markTranscriptRemoved(sessionIdFor(12345))).toBeNull();
  });

  // Whole-branch review: a relocation arrives as `fs.sessionRemoved` then `fs.sessionChanged` for the same session.
  it('a transcript that reappears after its removal is un-archived; the owner\'s own archive is not', () => {
    const s = summary();
    const { record } = index.sessions.upsertFromSummary(s);
    index.sessions.markTranscriptRemoved(s.sessionId);
    const back = index.sessions.upsertFromSummary({ ...s, transcriptPath: '/moved/elsewhere.jsonl' });
    expect(back.record).toMatchObject({ appId: record.appId, archived: false });
    expect(index.sessions.list().map((r) => r.appId)).toEqual([record.appId]);
    // A second removal and return behave the same (the mark is cleared on return, set again on removal).
    index.sessions.markTranscriptRemoved(s.sessionId);
    expect(index.sessions.upsertFromSummary(s).record.archived).toBe(false);

    // The owner archived it: a removal and a return leave it archived.
    index.sessions.update(record.appId, { archived: true });
    index.sessions.markTranscriptRemoved(s.sessionId);
    expect(index.sessions.upsertFromSummary(s).record.archived).toBe(true);
    // The owner archived it while its transcript was gone: the owner's act, kept on return.
    index.sessions.update(record.appId, { archived: false });
    index.sessions.markTranscriptRemoved(s.sessionId);
    index.sessions.update(record.appId, { archived: true });
    expect(index.sessions.upsertFromSummary(s).record.archived).toBe(true);
    // An archived record the owner never touched stays archived through summaries that do not follow a removal.
    const other = summary({ sessionId: sessionIdFor(7) });
    const created = index.sessions.upsertFromSummary(other).record;
    index.sessions.update(created.appId, { archived: true });
    expect(index.sessions.upsertFromSummary({ ...other, size: other.size + 1 }).record.archived).toBe(true);
  });

  it('createReplay makes a kind replay record titled by the tool; remove deletes it and reports removed', () => {
    const appId = randomUUID() as AppSessionId;
    const record = index.sessions.createReplay({ appId, sessionId: 'rp_1' as SessionId, title: 'workflow' });
    expect(record).toMatchObject({ appId, engineSessionId: 'rp_1', title: { text: 'workflow', source: 'tool' }, holder: { kind: 'none' } });
    expect(changes.at(-1)?.[1]).toBe('replay');
    index.sessions.remove(appId);
    expect(index.sessions.get(appId)).toBeNull();
    expect(changes.at(-1)).toEqual([record, 'removed']);
  });

  it('an unknown app session id is an answer, not an invariant', () => {
    const unknown = randomUUID() as AppSessionId;
    const message = `unknown app session: ${unknown}`;
    expect(index.sessions.get(unknown)).toBeNull();
    expect(() => index.sessions.update(unknown, { archived: true })).toThrow(message);
    expect(() => index.sessions.setPinned(unknown, true)).toThrow(message);
    expect(() => index.sessions.markSeen(unknown, { messageUuid: null, at: 'now' })).toThrow(message);
    expect(() => index.sessions.bindEngineId(unknown, sessionIdFor(1))).toThrow(message);
    expect(() => index.sessions.unbindEngineId(unknown)).toThrow(message);
    expect(() => index.sessions.applyEngineStatus(unknown, {})).toThrow(message);
  });

  it('one notification per record per transaction, after commit, with the first cause; nothing on rollback', () => {
    const s = summary();
    index.transaction(() => {
      const { record } = index.sessions.upsertFromSummary(s);
      index.sessions.setUnread(record.appId, true);
      expect(changes).toEqual([]);
    });
    expect(changes).toHaveLength(1);
    expect(changes[0][1]).toBe('discovered');
    expect(changes[0][0].unread).toBe(true);

    changes.length = 0;
    expect(() =>
      index.transaction(() => {
        index.sessions.setPinned(changes.length === 0 ? index.sessions.getByEngineId(s.sessionId)!.appId : ('' as AppSessionId), true);
        throw new Error('abandoned');
      }),
    ).toThrow('abandoned');
    expect(changes).toEqual([]);
    expect(index.sessions.getByEngineId(s.sessionId)?.pinned).toBe(false);
  });
});
