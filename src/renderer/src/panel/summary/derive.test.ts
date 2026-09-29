import { describe, expect, it } from 'vitest';
import type { TaskId } from '@shared/graph/ids';
import type { GitDiffFile, GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { applyEvents, createState, turnActivity, type TurnActivity, type TurnId } from '../../transcript';
import { journalToEvents } from '../../transcript/dev/journal';
import { useTranscriptStore } from '../../stores/transcript';
import { absolutePath, agentGlyphs, backgroundCounts, changeLine, displayPath, githubUrl, pushState, sourcesOf } from './derive';

const file = (path: string, over: Partial<GitFileStatus> = {}): GitFileStatus => ({ path, oldPath: null, index: '.', worktree: 'M', untracked: false, ...over });
const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'abcdef1234567', upstream: null, remoteUrl: null,
  ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-09-29T10:00:00.000Z', ...over,
});
const diff = (path: string, insertions: number, deletions: number, binary = false): GitDiffFile => ({ path, oldPath: null, insertions, deletions, binary });

const activityOf = (name: string) => turnActivity(applyEvents(createState(null, null), journalToEvents(loadSyntheticJournal(name))));

// A synthetic turn: only the fields the derivations read matter.
function turn(over: Partial<TurnActivity>): TurnActivity {
  return { turnId: 'turn:x' as TurnId, origin: 'human', state: 'closed', startedAt: '', endedAt: null, files: [], tools: [], subagents: [], ...over };
}
const agent = (n: number, status: TurnActivity['subagents'][number]['status']): TurnActivity['subagents'][number] => ({
  taskId: `t${n}` as TaskId, agentId: null, toolUseId: null, name: `agent ${n}`, glyph: n % 8, kind: 'agent', subagentType: null, status,
});

describe('summary derivations', () => {
  describe('changeLine', () => {
    it('sums the non-binary files, counts binary rows apart, and takes K and the untracked count from the status', () => {
      const dirty = status({ dirty: true, files: [file('a.ts'), file('b.ts'), file('new.txt', { index: '?', worktree: '?', untracked: true })] });
      expect(changeLine(dirty, [diff('a.ts', 2, 1), diff('b.ts', 1, 0), diff('logo.png', 0, 0, true)])).toEqual({ kind: 'change', insertions: 3, deletions: 1, files: 3, untracked: 1, binary: 1 });
    });

    it('reads clean for a clean tree whatever the diff, and unknown while the diff has not answered', () => {
      expect(changeLine(status({ dirty: false }), null)).toEqual({ kind: 'clean' });
      expect(changeLine(status({ dirty: true, files: [file('a.ts')] }), null)).toEqual({ kind: 'unknown' });
      expect(changeLine(null, null)).toEqual({ kind: 'unknown' });
    });
  });

  describe('pushState', () => {
    it('reads not pushed without an upstream, and ahead and behind against it', () => {
      expect(pushState(status())).toEqual({ kind: 'not_pushed' });
      expect(pushState(status({ upstream: 'origin/main', ahead: 2 }))).toEqual({ kind: 'ahead', ahead: 2, behind: 0, upstream: 'origin/main' });
      expect(pushState(status({ upstream: 'origin/main', ahead: 0, behind: 3 }))).toEqual({ kind: 'ahead', ahead: 0, behind: 3, upstream: 'origin/main' });
    });
  });

  describe('githubUrl', () => {
    it('converts the SSH, ssh:// and HTTPS forms, with and without .git, and appends the upstream’s branch', () => {
      for (const remote of ['git@github.com:o/r.git', 'git@github.com:o/r', 'ssh://git@github.com/o/r.git', 'ssh://git@github.com/o/r', 'https://github.com/o/r.git', 'https://github.com/o/r']) {
        expect(githubUrl(remote, null), remote).toBe('https://github.com/o/r');
        expect(githubUrl(remote, 'origin/feat/x'), remote).toBe('https://github.com/o/r/tree/feat/x');
      }
    });

    it('links the branch the upstream names, not the local one; the repository root with no upstream; each segment encoded', () => {
      // A local `work` tracking `origin/feature`: the status's upstream is what exists on GitHub.
      expect(githubUrl('git@github.com:o/r.git', 'origin/feature')).toBe('https://github.com/o/r/tree/feature');
      expect(githubUrl('git@github.com:o/r.git', 'upstream/main')).toBe('https://github.com/o/r/tree/main');
      // Not pushed: a /tree/<branch> link would be a 404.
      expect(githubUrl('git@github.com:o/r.git', null)).toBe('https://github.com/o/r');
      expect(githubUrl('git@github.com:o/r.git', 'origin/fix#12/a b')).toBe('https://github.com/o/r/tree/fix%2312/a%20b');
    });

    it('answers null for another host, another shape, or no remote', () => {
      expect(githubUrl('git@gitlab.com:o/r.git', 'main')).toBeNull();
      expect(githubUrl('https://example.com/o/r', 'main')).toBeNull();
      expect(githubUrl('https://github.com/o', 'main')).toBeNull();
      expect(githubUrl('/tmp/origin.git', 'main')).toBeNull();
      expect(githubUrl(null, 'main')).toBeNull();
    });
  });

  describe('backgroundCounts', () => {
    it('groups by task type, leaving agents to Subagents', () => {
      const task = (taskType: string) => ({ taskId: taskType as TaskId, taskType, description: '', ambient: false });
      expect(backgroundCounts([task('local_bash'), task('local_workflow'), task('local_agent'), task('monitor_ws')])).toEqual({ shells: 1, workflows: 1, monitors: 1, other: 0 });
      expect(backgroundCounts([task('remote_thing')])).toEqual({ shells: 0, workflows: 0, monitors: 0, other: 1 });
    });
  });

  describe('sourcesOf', () => {
    it('lists exploration-and-web as one file row per distinct path, a web row per URL with its host, and the MCP tool, newest first', () => {
      const sources = sourcesOf(activityOf('exploration-and-web'));
      expect(sources.map((s) => (s.kind === 'file' ? s.path : s.kind === 'web' ? s.url : `${s.server}/${s.tool}`))).toEqual([
        'docs/search',
        'https://tanstack.com/virtual/latest/docs/api/virtualizer',
        '/tmp/maws-synth-exploration-and-web/src/model/time.ts',
        '/tmp/maws-synth-exploration-and-web/src/model/copy.ts',
        '/tmp/maws-synth-exploration-and-web/src/model/keys.ts',
        '/tmp/maws-synth-exploration-and-web/src/model/rows.ts',
        '/tmp/maws-synth-exploration-and-web/src/model/reduce.ts',
        '/tmp/maws-synth-exploration-and-web/src/model/derive.ts',
      ]); // the Grep scope `src` is a directory, not a file source (C6 excludes search scopes from TurnWork.files)
      expect(sources[0]).toMatchObject({ kind: 'mcp', server: 'docs', tool: 'search' });
      expect(sources[1]).toMatchObject({ kind: 'web', host: 'tanstack.com' });
      const times = sources.map((s) => s.at);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('lists edit-and-receipt’s Edit, MultiEdit and Write paths as file rows, a path read and edited once', () => {
      expect(sourcesOf(activityOf('edit-and-receipt')).map((s) => s.kind === 'file' && s.path)).toEqual([
        '/tmp/maws-synth-edit-and-receipt/src/util/rows.ts',
        '/tmp/maws-synth-edit-and-receipt/src/store.ts',
        '/tmp/maws-synth-edit-and-receipt/src/app.ts',
      ]);
    });

    it('keeps the newest use of a path, a URL or an MCP tool, and stops at the limit', () => {
      const t1 = turn({
        files: [{ path: '/p/a.ts', use: 'read', at: '2026-09-29T10:00:01.000Z', edit: null }],
        tools: [
          { name: 'WebFetch', category: 'web', at: '2026-09-29T10:00:02.000Z', url: 'https://example.com/x', mcp: null },
          { name: 'mcp__docs__search', category: 'mcp', at: '2026-09-29T10:00:03.000Z', url: null, mcp: { server: 'docs', tool: 'search' } },
        ],
      });
      const t2 = turn({
        files: [{ path: '/p/a.ts', use: 'edited', at: '2026-09-29T10:00:09.000Z', edit: null }, { path: '/p/b.ts', use: 'read', at: '2026-09-29T10:00:05.000Z', edit: null }],
        tools: [
          { name: 'WebFetch', category: 'web', at: '2026-09-29T10:00:06.000Z', url: 'https://example.com/x', mcp: null },
          { name: 'mcp__docs__search', category: 'mcp', at: '2026-09-29T10:00:04.000Z', url: null, mcp: { server: 'docs', tool: 'search' } },
        ],
      });
      expect(sourcesOf([t1, t2])).toEqual([
        { kind: 'file', path: '/p/a.ts', at: '2026-09-29T10:00:09.000Z' },
        { kind: 'web', url: 'https://example.com/x', host: 'example.com', at: '2026-09-29T10:00:06.000Z' },
        { kind: 'file', path: '/p/b.ts', at: '2026-09-29T10:00:05.000Z' },
        { kind: 'mcp', server: 'docs', tool: 'search', at: '2026-09-29T10:00:04.000Z' },
      ]);
      const many = turn({ files: Array.from({ length: 14 }, (_, i) => ({ path: `/p/${i}.ts`, use: 'read' as const, at: `2026-09-29T10:00:${String(i).padStart(2, '0')}.000Z`, edit: null })) });
      expect(sourcesOf([many])).toHaveLength(10);
      expect(sourcesOf([many])[0]).toMatchObject({ path: '/p/13.ts' });
      expect(sourcesOf([many], 3)).toHaveLength(3);
    });
  });

  describe('agentGlyphs', () => {
    it('lists the agents not yet terminal before the finished ones, and stops at four', () => {
      const turns = [turn({ subagents: [agent(1, 'finished'), agent(2, 'working'), agent(3, 'stopped')] }), turn({ subagents: [agent(4, 'started'), agent(5, 'finished_with_errors'), agent(6, 'working')] })];
      expect(agentGlyphs(turns).map((a) => a.name)).toEqual(['agent 2', 'agent 4', 'agent 6', 'agent 1']);
      expect(agentGlyphs(turns, 10).map((a) => a.name)).toEqual(['agent 2', 'agent 4', 'agent 6', 'agent 1', 'agent 3', 'agent 5']);
    });

    it('reads agents-and-messages’ children with the transcript’s glyph index', () => {
      expect(agentGlyphs(activityOf('agents-and-messages')).map(({ name, glyph }) => [name, glyph])).toEqual([
        ['Survey src for TODOs', 0],
        ['List the tests', 2],
      ]);
    });
  });

  describe('source paths', () => {
    it('shows a path relative to the session directory when it lies inside it, and opens a relative one resolved against it', () => {
      expect(displayPath('/w/repo/docs/charter.md', '/w/repo')).toBe('docs/charter.md');
      expect(displayPath('/w/repository/x.md', '/w/repo')).toBe('/w/repository/x.md');
      expect(displayPath('/w/repo', '/w/repo')).toBe('/w/repo');
      expect(displayPath('src', '/w/repo')).toBe('src');
      expect(absolutePath('/w/repo/a.ts', '/w/repo')).toBe('/w/repo/a.ts');
      expect(absolutePath('src', '/w/repo')).toBe('/w/repo/src');
      expect(absolutePath('src', '/w/repo/')).toBe('/w/repo/src');
    });
  });

  it('answers the same for a transcript with every turn collapsed and with every turn expanded', async () => {
    for (const name of ['exploration-and-web', 'agents-and-messages', 'edit-and-receipt']) {
      const key = `derive-${name}`;
      const events = journalToEvents(loadSyntheticJournal(name));
      await useTranscriptStore.getState().attach(key, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) });
      const store = useTranscriptStore.getState;
      for (const id of store().entries[key].state.order) if (store().entries[key].state.ui.expandedTurns.has(id)) store().toggleTurn(key, id);
      const collapsed = { sources: sourcesOf(store().activity(key)), glyphs: agentGlyphs(store().activity(key)) };
      store().expandAll(key, { cells: true });
      expect({ sources: sourcesOf(store().activity(key)), glyphs: agentGlyphs(store().activity(key)) }, name).toEqual(collapsed);
      store().drop(key);
    }
  });
});
