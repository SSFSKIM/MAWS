import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { holderLine, needsYou, waitingItem } from '../attention/derive';
import { orderProjects } from '../overview/derive';
import type { WorktreeInfo } from '@shared/sessions/worktree';
import {
  filterProjectList,
  formatAge,
  hasWorktreeSessions,
  needsYouAge,
  OTHER_SESSIONS,
  projectList,
  projectPage,
  rowBranch,
  sessionAge,
  sessionMatcher,
  type ProjectListInput,
  type ProjectPageInput,
} from './derive';

const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json'));
const records = new Map(scenario.sessions.map((r) => [r.appId, r]));
const digests = new Map(scenario.digests.map((d) => [d.appSessionId, { ...d, revision: 1 } as SessionDigest]));
const bySession = new Map(scenario.attention.map((a) => [a.appSessionId, a.items]));
const rows = needsYou(bySession, records);
const projects = orderProjects(scenario.projects);
const byId = new Map(projects.map((p) => [p.id, p]));
const base: ProjectListInput = { records, digests, projects, rows };
const titleOf = (id: AppSessionId) => records.get(id)?.title.text ?? id;
const titles = (list: { appId: AppSessionId }[]) => list.map((r) => titleOf(r.appId));
const everyone = () => true;

describe('the project list', () => {
  it('lists every project, most recently active first, then Other sessions', () => {
    const list = projectList(base);
    expect(list.map((e) => [e.key, e.name, e.sessions.length])).toEqual([
      ['proj-claude-usage-menubar', 'claude-usage-menubar', 3],
      ['proj-codex-somersault', 'codex_somersault', 3],
      ['proj-maws', 'MAWS', 4],
      [OTHER_SESSIONS, 'Other sessions', 1],
    ]);
    expect(list.at(-1)!.project).toBeNull();
  });

  it('counts each project’s waiting (Needs-you rows) and working sessions', () => {
    const rollups = Object.fromEntries(projectList(base).map((e) => [e.name, e.rollup]));
    expect(rollups).toEqual({
      MAWS: { waiting: 2, working: 1 },
      codex_somersault: { waiting: 1, working: 0 },
      'claude-usage-menubar': { waiting: 0, working: 1 },
      'Other sessions': { waiting: 0, working: 0 },
    });
  });

  it('hides archived sessions, keeps their activity for the order, and puts a session of an unknown project under Other sessions', () => {
    const a = project('a', 0, { createdAt: '2026-09-01T00:00:00Z' });
    const b = project('b', 1, { createdAt: '2026-09-02T00:00:00Z' });
    const recs = new Map([
      ['old' as AppSessionId, record('old', { projectId: a.id, archived: true, updatedAt: '2026-09-28T12:00:00Z' })],
      ['new' as AppSessionId, record('new', { projectId: b.id, updatedAt: '2026-09-27T12:00:00Z' })],
      ['stray' as AppSessionId, record('stray', { projectId: 'gone' as never })],
    ]);
    const list = projectList({ records: recs, digests: new Map(), projects: [a, b], rows: [] });
    expect(list.map((e) => [e.name, e.sessions.map((r) => r.appId)])).toEqual([
      ['a', []],
      ['b', ['new']],
      ['Other sessions', ['stray']],
    ]);
  });

  it('places a project without sessions by when it was added, and leaves Other sessions out when it is empty', () => {
    const fresh = project('fresh', 5, { createdAt: '2026-09-30T00:00:00Z' });
    const list = projectList({ ...base, records: new Map([...records].filter(([, r]) => r.projectId !== null)), projects: [...projects, fresh] });
    expect(list.map((e) => e.name)).toEqual(['fresh', 'claude-usage-menubar', 'codex_somersault', 'MAWS']);
  });

  it('filters by project name, or by a session the project holds (title, directory)', () => {
    const list = projectList(base);
    expect(filterProjectList(list, 'QUOTA', byId).map((e) => e.name)).toEqual(['codex_somersault']);
    expect(filterProjectList(list, 'usage-menu', byId).map((e) => e.name)).toEqual(['claude-usage-menubar']);
    expect(filterProjectList(list, 'qqboLh', byId).map((e) => e.name)).toEqual(['MAWS']);
    expect(filterProjectList(list, 'terminal workflow', byId).map((e) => e.name)).toEqual(['Other sessions']);
    expect(filterProjectList(list, '  ', byId)).toBe(list);
  });
});

describe('a project’s page', () => {
  const maws = () => projectList(base).find((e) => e.key === 'proj-maws')!;
  const page = (over: Partial<ProjectPageInput> = {}) =>
    projectPage({ sessions: maws().sessions, digests, rows, sort: 'priority', matches: everyone, worktrees: null, ...over });

  it('puts pinned sessions on top and, without a worktree session, one flat Main list', () => {
    const p = page();
    expect(titles(p.pinned)).toEqual(['Workstation north star']);
    expect(p.grouped).toBe(false);
    expect(p.groups.map((g) => [g.label, titles(g.sessions)])).toEqual([['Main', ['Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']]]);
  });

  it('sorts by recency when asked, and filters by the search', () => {
    const usage = projectList(base).find((e) => e.key === 'proj-claude-usage-menubar')!;
    const recency = projectPage({ sessions: usage.sessions, digests, rows, sort: 'recency', matches: everyone, worktrees: null });
    expect(titles(recency.groups[0].sessions)).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    const searched = page({ matches: sessionMatcher('sidebar', byId) });
    expect(titles(searched.groups[0].sessions)).toEqual(['Fix sidebar drag', 'Sidebar interaction pass']);
    expect(searched.pinned).toEqual([]);
  });

  it('groups Main first, then each worktree in the listed order with the listed branch, then worktrees not listed', () => {
    const at = (path: string, branch: string | null) => ({ worktree: { path, branch }, branch: 'stale' });
    const recs = [
      record('m', { projectId: 'p' as never }),
      record('b1', { projectId: 'p' as never, ...at('/r/.claude/worktrees/beta', 'worktree-beta') }),
      record('a1', { projectId: 'p' as never, ...at('/sib/alpha', null) }),
      record('a2', { projectId: 'p' as never, ...at('/sib/alpha/', null), pinned: true }),
      record('z1', { projectId: 'p' as never, ...at('/gone/zeta', 'zeta') }),
    ];
    const info = (path: string, branch: string | null, isMain = false): WorktreeInfo => ({ repoRoot: '/r', path, branch, head: 'h', isMain, locked: false, prunable: false, managed: path.includes('/.claude/') });
    const worktrees = [info('/r', 'main', true), info('/sib/alpha', 'alpha'), info('/r/.claude/worktrees/beta', 'worktree-beta')];
    const p = projectPage({ sessions: recs, digests: new Map(), rows: [], sort: 'priority', matches: everyone, worktrees });
    const ids = (list: { appId: AppSessionId }[]) => list.map((r) => r.appId);
    expect(p.grouped).toBe(true);
    expect(ids(p.pinned)).toEqual(['a2']);
    expect(p.groups.map((g) => [g.kind, g.label, g.branch, g.path, ids(g.sessions)])).toEqual([
      ['main', 'Main', 'main', null, ['m']],
      ['worktree', 'alpha', 'alpha', '/sib/alpha', ['a1']],
      ['worktree', 'beta', 'worktree-beta', '/r/.claude/worktrees/beta', ['b1']],
      ['worktree', 'zeta', 'zeta', '/gone/zeta', ['z1']],
    ]);
    // Before the list answers: the worktrees by folder name, each with the branch its sessions recorded.
    const unlisted = projectPage({ sessions: recs, digests: new Map(), rows: [], sort: 'priority', matches: everyone, worktrees: null });
    expect(unlisted.groups.map((g) => [g.label, g.branch])).toEqual([
      ['Main', null],
      ['alpha', 'stale'],
      ['beta', 'worktree-beta'],
      ['zeta', 'zeta'],
    ]);
    expect(hasWorktreeSessions(recs)).toBe(true);
    expect(hasWorktreeSessions([recs[0]])).toBe(false);
  });

  it('renders every session of a large project: no page cap', () => {
    const p = project('p', 0);
    const recs = Array.from({ length: 250 }, (_, i) => record(`s${i}`, { projectId: p.id }));
    expect(projectPage({ sessions: recs, digests: new Map(), rows: [], sort: 'priority', matches: everyone, worktrees: null }).groups[0].sessions).toHaveLength(250);
  });
});

describe('sidebar row text', () => {
  const at = (iso: string) => Date.parse(iso);

  // W5: the row is one line; what its second line said (the holder, the activity) is in the hover card, which reads these.
  it('the holder of a foreign-live session, a background job by its short id', () => {
    expect(holderLine(record('t', { holder: { kind: 'terminal', pid: 7135 } }))).toBe('Terminal · pid 7135');
    // debt wave 4: a background job reads by the short id `claude --bg` printed, its pid only without one
    expect(holderLine(record('b', { holder: { kind: 'background_job', pid: 4242, jobId: 'e6dcd828' } }))).toBe('bg · e6dcd828');
    expect(holderLine(record('b', { holder: { kind: 'background_job', pid: 4242, jobId: null } }))).toBe('bg · pid 4242');
    expect(holderLine(record('b', { holder: { kind: 'background_job', pid: null, jobId: null } }))).toBe('Background job');
    expect(holderLine(record('s'))).toBeNull();
  });

  it('a worktree session’s branch, none for a session in the project directory', () => {
    expect(rowBranch(record('w', { worktree: { path: '/w/.claude/worktrees/a', branch: 'worktree-a' }, branch: 'stale' }))).toBe('worktree-a');
    expect(rowBranch(record('w', { worktree: { path: '/w/.claude/worktrees/a', branch: null }, branch: 'from-index' }))).toBe('from-index');
    expect(rowBranch(record('w', { worktree: { path: '/w/.claude/worktrees/a', branch: null } }))).toBeNull();
    expect(rowBranch(record('p', { branch: 'main' }))).toBeNull();
  });

  it('the waiting item a hover card shows is the one main notifies: an actionable item outranks an older held message', () => {
    const r = record('r');
    const held = item('r', 'held_peer_message', '2026-09-28T09:00:00Z', { summary: 'Message from reviewer' });
    const permission = item('r', 'permission', '2026-09-28T10:00:00Z', { summary: 'Bash: git push' });
    const pending = [held, permission];
    expect(needsYou(new Map([[r.appId, pending]]), new Map([[r.appId, r]]))[0].oldest).toBe(permission);
    expect(waitingItem(pending)?.oldest).toBe(permission);
    expect(waitingItem([held])?.oldest).toBe(held);
  });

  it('ages read now, minutes, hours, days, weeks', () => {
    expect([0, 59_000, 60_000, 3_599_000, 3_600_000, 86_399_000, 86_400_000, 7 * 86_400_000, -5000].map(formatAge)).toEqual([
      'now', 'now', '1m', '59m', '1h', '23h', '1d', '1w', 'now',
    ]);
  });

  it('a working session is "now"; otherwise the age of its latest movement; a Needs-you row shows its wait', () => {
    const now = at('2026-09-28T10:30:00Z');
    const r = record('r', { updatedAt: '2026-09-28T09:00:00Z' });
    expect(sessionAge(r, digest('r', { phase: 'working', turnStartedAt: '2026-09-28T08:00:00Z' }), now)).toBe('now');
    expect(sessionAge(r, digest('r', { phase: 'idle', lastTurnEndedAt: '2026-09-28T10:22:00Z' }), now)).toBe('8m');
    expect(sessionAge(r, null, now)).toBe('1h');
    // A discovered session: the index wrote the record just now, its transcript last moved two days ago (C4's seed).
    const discovered = record('d', { updatedAt: '2026-09-28T10:29:30Z' });
    expect(sessionAge(discovered, digest('d', { phase: 'exited', lastTurnEndedAt: '2026-09-26T10:00:00Z' }), now)).toBe('2d');
    expect(needsYouAge(item('r', 'permission', '2026-09-28T10:26:00Z'), now)).toBe('4m');
  });
});
