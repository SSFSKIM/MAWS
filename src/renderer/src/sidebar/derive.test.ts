import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { holderLine, needsYou, waitingItem } from '../attention/derive';
import { orderProjects } from '../overview/derive';
import {
  filterProjectList,
  formatAge,
  needsYouAge,
  OTHER_SESSIONS,
  projectList,
  projectSessions,
  rowBranch,
  SESSIONS_CAP,
  sessionAge,
  sessionMatcher,
  shownCount,
  type ProjectListInput,
  type ProjectSessionsInput,
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

  // W11 (I6): the project card's last activity, its sessions' latest movement (archived ones included)
  it('carries each project’s last activity, null without a session', () => {
    const a = project('a', 0, { createdAt: '2026-09-01T00:00:00Z' });
    const b = project('b', 1);
    const recs = new Map([
      ['old' as AppSessionId, record('old', { projectId: a.id, archived: true, updatedAt: '2026-09-28T12:00:00Z' })],
      ['new' as AppSessionId, record('new', { projectId: a.id, updatedAt: '2026-09-27T12:00:00Z' })],
    ]);
    const list = projectList({ records: recs, digests: new Map(), projects: [a, b], rows: [] });
    expect(list.map((e) => [e.name, e.lastActivity])).toEqual([
      ['a', Date.parse('2026-09-28T12:00:00Z')],
      ['b', null],
    ]);
  });

  // W11 (I5): a project removed from the sidebar takes its sessions with it, never to Other sessions
  it('lists a hidden project’s sessions nowhere', () => {
    const hidden = new Set(['proj-maws' as never]);
    const list = projectList({ ...base, projects: projects.filter((p) => p.id !== 'proj-maws'), hidden });
    expect(list.map((e) => [e.name, e.sessions.length])).toEqual([
      ['claude-usage-menubar', 3],
      ['codex_somersault', 3],
      ['Other sessions', 1],
    ]);
  });

  it('places a project without sessions by when it was added, omits Other sessions without listed sessions', () => {
    const fresh = project('fresh', 5, { createdAt: '2026-09-30T00:00:00Z' });
    const list = projectList({ ...base, records: new Map([...records].filter(([, r]) => r.projectId !== null)), projects: [...projects, fresh] });
    expect(list.map((e) => e.name)).toEqual(['fresh', 'claude-usage-menubar', 'codex_somersault', 'MAWS']);
  });

  it('omits Other sessions when its only session is archived', () => {
    const archived = record('archived-other', { projectId: null, archived: true });
    expect(projectList({ records: new Map([[archived.appId, archived]]), projects: [], digests: new Map(), rows: [] })).toEqual([]);
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

// W11 (I4, as the owner corrected it): one flat list per expanded project, five rows then "Show more" to eight.
describe('an expanded project’s sessions', () => {
  const maws = () => projectList(base).find((e) => e.key === 'proj-maws')!;
  const list = (over: Partial<ProjectSessionsInput> = {}) => projectSessions({ sessions: maws().sessions, digests, rows, sort: 'priority', matches: everyone, ...over });

  it('puts pinned sessions on top, then the rest in the chosen sort, worktree sessions among them', () => {
    expect(titles(list())).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    const usage = projectList(base).find((e) => e.key === 'proj-claude-usage-menubar')!;
    expect(titles(projectSessions({ sessions: usage.sessions, digests, rows, sort: 'recency', matches: everyone }))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    const recs = [record('m', { projectId: 'p' as never }), record('w', { projectId: 'p' as never, worktree: { path: '/r/.claude/worktrees/w', branch: 'worktree-w' } })];
    expect(projectSessions({ sessions: recs, digests: new Map(), rows: [], sort: 'priority', matches: everyone }).map((r) => r.appId).sort()).toEqual(['m', 'w']);
  });

  it('filters by the search, pinned sessions included', () => {
    expect(titles(list({ matches: sessionMatcher('sidebar', byId) }))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass']);
  });

  it('shows five, then eight at most after "Show more", never more', () => {
    expect([shownCount(3, false), shownCount(5, false), shownCount(250, false)]).toEqual([3, 5, 5]);
    expect([shownCount(3, true), shownCount(6, true), shownCount(250, true)]).toEqual([3, 6, 8]);
    expect(SESSIONS_CAP).toBe(8);
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
    expect(rowBranch(record('w', { worktree: { path: '/w/.claude/worktrees/a', branch: 'HEAD' }, branch: '' }))).toBeNull(); // W9 (H2): no branch names
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
