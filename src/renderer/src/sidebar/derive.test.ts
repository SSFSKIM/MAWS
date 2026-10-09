import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Lineage } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { holderLine, needsYou, waitingItem } from '../attention/derive';
import { orderProjects } from '../overview/derive';
import {
  filterProjectList,
  formatAge,
  itemAge,
  lineageCaption,
  nestLineage,
  needsYouAge,
  OTHER_SESSIONS,
  projectList,
  projectSessions,
  relativeAge,
  rowBranch,
  SESSIONS_CAP,
  sessionAge,
  sessionMatcher,
  shownCount,
  type ProjectListInput,
  type ProjectSessionsInput,
  type SessionTree,
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

// E3 (M4): side threads and forks nest under their parent (E3 execution document, Design §6, M4's decisions)
describe('an expanded project’s lineage forest', () => {
  const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const thread = (id: string, parent: string, minute: number, over: Partial<Lineage> = {}) =>
    record(id, { createdAt: at(minute), lineage: { kind: 'side-thread', parentAppSessionId: parent as AppSessionId, parentEngineSessionId: null, anchor: { kind: 'file-line', locator: '/r/x.ts#L4', label: 'x.ts:4', path: '/r/x.ts', line: 4 }, openedBy: 'comment', ...over } });
  const fork = (id: string, parent: string, minute: number) => record(id, { createdAt: at(minute), lineage: { kind: 'fork', parentAppSessionId: parent as AppSessionId, parentEngineSessionId: null, openedBy: 'fork' } });
  const shape = (trees: SessionTree[]) => trees.map((t) => t.rows.map((r) => (r.nestedUnder === null ? r.record.appId : `${r.record.appId}<${r.nestedUnder}`)));

  it('nests a parent’s children under it in createdAt order, keeping the roots’ order', () => {
    const sorted = [record('b'), thread('t2', 'a', 9), record('a'), fork('f1', 'a', 3), thread('t1', 'a', 5), record('c')];
    expect(shape(nestLineage(sorted))).toEqual([['b'], ['a', 'f1<a', 't1<a', 't2<a'], ['c']]);
  });

  it('a child whose parent is not in the list (archived, searched away, another project) stays a root where it sorted', () => {
    expect(shape(nestLineage([record('b'), thread('orphan', 'gone', 1), record('c')]))).toEqual([['b'], ['orphan'], ['c']]);
  });

  it('a side thread of a side thread follows its own parent, depth first', () => {
    const sorted = [record('a'), thread('t1', 'a', 1), thread('t2', 'a', 2), thread('t11', 't1', 3)];
    expect(shape(nestLineage(sorted))).toEqual([['a', 't1<a', 't11<t1', 't2<a']]);
  });

  it('a lineage cycle (never written by MAWS) loses no record: the first of it sorted is taken as a root', () => {
    expect(shape(nestLineage([thread('x', 'y', 1), thread('y', 'x', 2)])).flat().sort()).toEqual(['x', 'y<x'].sort());
  });

  it('caps count roots: five trees, then eight, each with all its children', () => {
    const sorted = Array.from({ length: 9 }, (_, i) => [record(`r${i}`), thread(`r${i}-t`, `r${i}`, i)]).flat();
    const trees = nestLineage(sorted);
    expect(trees).toHaveLength(9);
    expect(trees.slice(0, shownCount(trees.length, false)).flatMap((t) => t.rows)).toHaveLength(10);
    expect(trees.slice(0, shownCount(trees.length, true)).flatMap((t) => t.rows)).toHaveLength(16);
  });

  it('the caption: nested, the anchor’s label unless it is the title; not nested, whose thread or fork it is', () => {
    expect(lineageCaption(thread('t', 'a', 1), true, 'Parent')).toBe('x.ts:4');
    expect(lineageCaption({ ...thread('t', 'a', 1), title: { text: 'x.ts:4', source: 'user' } }, true, 'Parent')).toBeNull();
    expect(lineageCaption(fork('f', 'a', 1), true, 'Parent')).toBeNull();
    expect(lineageCaption(thread('t', 'a', 1), false, 'Parent')).toBe('↳ side thread of Parent');
    expect(lineageCaption(thread('t', 'a', 1), false, null)).toBe('↳ side thread');
    expect(lineageCaption(fork('f', 'a', 1), false, 'Parent')).toBe('↳ fork of Parent');
    expect(lineageCaption(record('plain'), false, null)).toBeNull();
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

  // E11 F2b (plan 2.4): an outcome (an error, an interruption) says when it happened; a request says how long it has waited
  it('an outcome reads "2 weeks ago", a request "waiting 5m"', () => {
    const DAY = 86_400_000;
    expect([0, 59_000, 60_000, 120_000, 3_600_000, 7_200_000, DAY, 2 * DAY, 7 * DAY, 14 * DAY].map(relativeAge)).toEqual([
      'just now', 'just now', '1 minute ago', '2 minutes ago', '1 hour ago', '2 hours ago', '1 day ago', '2 days ago', '1 week ago', '2 weeks ago',
    ]);
    const now = at('2026-10-08T10:00:00Z');
    expect(itemAge(item('r', 'error', '2026-09-24T10:00:00Z'), now)).toBe('2 weeks ago');
    expect(itemAge(item('r', 'interrupted', '2026-10-03T10:00:00Z'), now)).toBe('5 days ago');
    expect(itemAge(item('r', 'permission', '2026-10-08T09:55:00Z'), now)).toBe('waiting 5m');
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
