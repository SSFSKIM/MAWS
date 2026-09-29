import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { needsYou } from '../attention/derive';
import { orderProjects } from '../overview/derive';
import { formatAge, needsYouAge, PROJECT_PAGE, secondaryLine, sessionAge, sidebarModel, type SidebarInput } from './derive';

const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json'));
const records = new Map(scenario.sessions.map((r) => [r.appId, r]));
const digests = new Map(scenario.digests.map((d) => [d.appSessionId, { ...d, revision: 1 } as SessionDigest]));
const bySession = new Map(scenario.attention.map((a) => [a.appSessionId, a.items]));
const rows = needsYou(bySession, records);
const base: SidebarInput = { records, digests, projects: orderProjects(scenario.projects), rows, sort: 'priority', query: '' };
const titleOf = (id: AppSessionId) => records.get(id)?.title.text;
const titles = (list: { appId: AppSessionId }[]) => list.map((r) => titleOf(r.appId));

describe('sidebar model', () => {
  it('lays out Needs you, Pinned, the projects in order and Other sessions', () => {
    const model = sidebarModel(base);
    expect(model.needsYou.map((row) => titleOf(row.appSessionId))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Quota reset recovery']);
    expect(titles(model.pinned)).toEqual(['Workstation north star']);
    expect(model.projects.map((p) => [p.project.name, p.sessions.length])).toEqual([
      ['MAWS', 3],
      ['codex_somersault', 3],
      ['claude-usage-menubar', 3],
    ]);
    expect(titles(model.other)).toEqual(['Terminal workflow notes']);
  });

  it('does not repeat a pinned session under its project', () => {
    const maws = sidebarModel(base).projects[0];
    expect(titles(maws.sessions)).not.toContain('Workstation north star');
    expect(titles(maws.sessions)).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
  });

  it('rolls a project up into its Needs-you and working counts', () => {
    const [maws, codex, usage] = sidebarModel(base).projects;
    expect(maws.rollup).toEqual({ needsYou: 2, working: 1 });
    expect(codex.rollup).toEqual({ needsYou: 1, working: 0 });
    expect(usage.rollup).toEqual({ needsYou: 0, working: 1 });
  });

  it('sorts by recency when asked', () => {
    const usage = sidebarModel({ ...base, sort: 'recency' }).projects[2];
    expect(titles(usage.sessions)).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
  });

  it('hides archived sessions and puts a session of an unknown project under Other sessions', () => {
    const recs = new Map([
      ['a' as AppSessionId, record('a', { archived: true })],
      ['stray' as AppSessionId, record('stray', { projectId: 'gone' as never })],
    ]);
    const model = sidebarModel({ records: recs, digests: new Map(), projects: [], rows: [], sort: 'priority', query: '' });
    expect(model.other.map((r) => r.appId)).toEqual(['stray']);
  });

  it('filters rows by title, project name and directory, keeping only the projects with a match', () => {
    const byTitle = sidebarModel({ ...base, query: 'QUOTA' });
    expect(byTitle.needsYou.map((row) => titleOf(row.appSessionId))).toEqual(['Quota reset recovery']);
    expect(byTitle.projects.map((p) => [p.project.name, titles(p.sessions)])).toEqual([['codex_somersault', ['Quota reset recovery']]]);
    expect(byTitle.pinned).toEqual([]);
    expect(byTitle.other).toEqual([]);
    expect(byTitle.searching).toBe(true);

    const byProject = sidebarModel({ ...base, query: 'usage-menu' });
    expect(byProject.projects.map((p) => [p.project.name, p.sessions.length])).toEqual([['claude-usage-menubar', 3]]);

    const byDirectory = sidebarModel({ ...base, query: 'qqboLh' });
    expect(byDirectory.projects.flatMap((p) => titles(p.sessions))).toEqual(['Fix sidebar drag']);
  });
});

describe('sidebar row text', () => {
  const at = (iso: string) => Date.parse(iso);

  it('the secondary line: holder for foreign-live, the waiting item, the activity while working, else the last answer', () => {
    const r = record('r');
    expect(secondaryLine(record('t', { holder: { kind: 'terminal', pid: 7135 } }), digest('t', { phase: 'foreign', lastAssistantLine: 'x' }), [])).toBe('Terminal · pid 7135');
    expect(secondaryLine(record('b', { holder: { kind: 'background_job', pid: null, jobId: 'j1' } }), null, [])).toBe('Background job');
    expect(secondaryLine(r, digest('r', { phase: 'waiting', lastAssistantLine: 'old' }), [item('r', 'question', '2026-09-28T10:00:00Z', { summary: 'Which color?' })])).toBe('Which color?');
    expect(secondaryLine(r, digest('r', { phase: 'working', activity: 'Running bun test', lastAssistantLine: 'old' }), [])).toBe('Running bun test');
    expect(secondaryLine(r, digest('r', { phase: 'idle', lastAssistantLine: 'Done.' }), [])).toBe('Done.');
    expect(secondaryLine(r, null, [])).toBeNull();
  });

  it('the waiting item is the one its Needs-you row shows: an actionable item outranks an older held message', () => {
    const r = record('r');
    const held = item('r', 'held_peer_message', '2026-09-28T09:00:00Z', { summary: 'Message from reviewer' });
    const permission = item('r', 'permission', '2026-09-28T10:00:00Z', { summary: 'Bash: git push' });
    const pending = [held, permission];
    expect(needsYou(new Map([[r.appId, pending]]), new Map([[r.appId, r]]))[0].oldest).toBe(permission);
    expect(secondaryLine(r, digest('r', { phase: 'waiting' }), pending)).toBe('Bash: git push');
    expect(secondaryLine(r, digest('r', { phase: 'idle' }), [held])).toBe('Message from reviewer');
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

describe('show more', () => {
  it('pages a project at twenty sessions', () => {
    expect(PROJECT_PAGE).toBe(20);
    const p = project('p', 0);
    const recs = new Map(Array.from({ length: 25 }, (_, i) => [`s${i}` as AppSessionId, record(`s${i}`, { projectId: p.id })]));
    expect(sidebarModel({ records: recs, digests: new Map(), projects: [p], rows: [], sort: 'priority', query: '' }).projects[0].sessions).toHaveLength(25);
  });
});
