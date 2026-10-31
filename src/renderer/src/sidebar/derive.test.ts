import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import type { RemoteRow } from '@shared/ipc/schema/org';
import { digest, item, project, record, remoteRow } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { at as addr, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { loadScenario } from '../../../../test/support/scenario';
import { holderLine, needsYou, waitingItem, type NeedsYouRow } from '../attention/derive';
import { listedGlyph } from '../attention/glyph';
import type { ListedSession } from '../stores/sessions';
import type { RowKey } from '../stores/org-projects';
import { orderProjects } from '../overview/derive';
import { pageScenario } from '../test-support/shell-stores';
import {
  filterProjectList,
  formatAge,
  itemAge,
  lineageCaption,
  listedTitle,
  nestItems,
  nestLineage,
  projectItems,
  needsYouAge,
  projectList,
  projectSessions,
  rowBranch,
  SESSIONS_CAP,
  sessionAge,
  sessionMatcher,
  shownCount,
  type ProjectListInput,
  type ProjectSessionsInput,
  type SessionTree,
} from './derive';
import { REL } from '../test-support/relative-time';

const scenario = pageScenario(loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json')));
const records = new Map(scenario.sessions.map((r) => [r.appId, r]));
const digests = new Map(scenario.digests.map((d) => [d.appSessionId, { ...d, revision: 1 } as SessionDigest]));
const bySession = new Map(scenario.attention.map((a) => [a.appSessionId, a.items]));
const rows = needsYou(bySession, records);
const projects = orderProjects(scenario.projects);
const byId = new Map(projects.map((p) => [p.id, p]));
const NAMES = new Map([[TEST_MACHINE, 'This Mac'], [OTHER_MACHINE, 'Studio']]);
const machineName = (m: MachineRef) => NAMES.get(m) ?? m;
const input = (over: Partial<ProjectListInput> = {}): ProjectListInput => ({ records, digests, projects: byId, rows, local: TEST_MACHINE, machineName, ...over });
const base = input();
const mapOf = (list: ProjectRecord[]) => new Map(list.map((p) => [p.id, p]));
const titleOf = (id: AppSessionId) => records.get(id)?.title.text ?? id;
const titles = (list: { appId: AppSessionId }[]) => list.map((r) => titleOf(r.appId));
const everyone = () => true;
const LOCAL_ROW = machineKey(TEST_MACHINE);

// A project and a session on either machine (their ids are addresses, as the page holds them).
const there = <T extends string>(id: T): T => addressOf(OTHER_MACHINE, id);
const repo = (key: string, name = key): ProjectRecord['org'] => ({ key: `repo:${key}` as OrgKey, name, source: 'remote', smnsId: null });
const projectOn = (machine: MachineRef, id: string, order: number, over: Partial<ProjectRecord> = {}) =>
  project(addressOf(machine, id), order, { name: id, ...over });
const sessionOn = (machine: MachineRef, id: string, over: Partial<SessionRecord> = {}) => record(addressOf(machine, id), over);

describe('the project list', () => {
  it('lists every project, most recently active first, then this machine’s own row', () => {
    const list = projectList(base);
    expect(list.map((e) => [e.key, e.name, e.sessions.length])).toEqual([
      [addr('proj-claude-usage-menubar'), 'claude-usage-menubar', 3],
      [addr('proj-codex-somersault'), 'codex_somersault', 3],
      [addr('proj-maws'), 'MAWS', 4],
      [LOCAL_ROW, 'This Mac', 1],
    ]);
    expect(list.at(-1)!.project).toBeNull();
    expect(list.at(-1)!.machine).toBe(TEST_MACHINE);
    expect(list.at(-1)!.org.kind).toBe('machine');
  });

  it('counts each project’s waiting (Needs-you rows) and working sessions', () => {
    const rollups = Object.fromEntries(projectList(base).map((e) => [e.name, e.rollup]));
    expect(rollups).toEqual({
      MAWS: { waiting: 2, working: 1 },
      codex_somersault: { waiting: 1, working: 0 },
      'claude-usage-menubar': { waiting: 0, working: 1 },
      'This Mac': { waiting: 0, working: 0 },
    });
  });

  it('hides archived sessions, keeps their activity for the order, and puts a session of an unknown project under its machine’s row', () => {
    const a = projectOn(TEST_MACHINE, 'a', 0, { createdAt: '2026-09-01T00:00:00Z' });
    const b = projectOn(TEST_MACHINE, 'b', 1, { createdAt: '2026-09-02T00:00:00Z' });
    const recs = new Map([
      sessionOn(TEST_MACHINE, 'old', { projectId: a.id, archived: true, updatedAt: '2026-09-28T12:00:00Z' }),
      sessionOn(TEST_MACHINE, 'new', { projectId: b.id, updatedAt: '2026-09-27T12:00:00Z' }),
      sessionOn(TEST_MACHINE, 'stray', { projectId: addr('gone') as ProjectId }),
    ].map((r) => [r.appId, r]));
    const list = projectList(input({ records: recs, digests: new Map(), projects: mapOf([a, b]), rows: [] }));
    expect(list.map((e) => [e.name, e.sessions.map((r) => r.appId)])).toEqual([
      ['a', []],
      ['b', [addr('new')]],
      ['This Mac', [addr('stray')]],
    ]);
  });

  // W11 (I6): the project card's last activity, its sessions' latest movement (archived ones included)
  it('carries each project’s last activity, null without a session', () => {
    const a = projectOn(TEST_MACHINE, 'a', 0, { createdAt: '2026-09-01T00:00:00Z' });
    const b = projectOn(TEST_MACHINE, 'b', 1);
    const recs = new Map([
      sessionOn(TEST_MACHINE, 'old', { projectId: a.id, archived: true, updatedAt: '2026-09-28T12:00:00Z' }),
      sessionOn(TEST_MACHINE, 'new', { projectId: a.id, updatedAt: '2026-09-27T12:00:00Z' }),
    ].map((r) => [r.appId, r]));
    const list = projectList(input({ records: recs, digests: new Map(), projects: mapOf([a, b]), rows: [] }));
    expect(list.map((e) => [e.name, e.lastActivity])).toEqual([
      ['a', Date.parse('2026-09-28T12:00:00Z')],
      ['b', null],
    ]);
  });

  // W11 (I5): a project removed from the sidebar takes its sessions with it, never to its machine's row
  it('lists a hidden project’s sessions nowhere', () => {
    const hidden = projects.map((p) => (p.id === addr('proj-maws') ? { ...p, hidden: true } : p));
    const list = projectList(input({ projects: mapOf(hidden) }));
    expect(list.map((e) => [e.name, e.sessions.length])).toEqual([
      ['claude-usage-menubar', 3],
      ['codex_somersault', 3],
      ['This Mac', 1],
    ]);
  });

  it('places a project without sessions by when it was added, omits a machine’s row without listed sessions', () => {
    const fresh = projectOn(TEST_MACHINE, 'fresh', 5, { createdAt: '2026-09-30T00:00:00Z' });
    const list = projectList(input({ records: new Map([...records].filter(([, r]) => r.projectId !== null)), projects: mapOf([...projects, fresh]) }));
    expect(list.map((e) => e.name)).toEqual(['fresh', 'claude-usage-menubar', 'codex_somersault', 'MAWS']);
  });

  it('omits a machine’s row when its only session is archived', () => {
    const archived = sessionOn(TEST_MACHINE, 'archived-other', { projectId: null, archived: true });
    expect(projectList(input({ records: new Map([[archived.appId, archived]]), projects: new Map(), digests: new Map(), rows: [] }))).toEqual([]);
  });

  it('filters by project name, or by a session the project holds (title, directory)', () => {
    const list = projectList(base);
    expect(filterProjectList(list, 'QUOTA', byId).map((e) => e.name)).toEqual(['codex_somersault']);
    expect(filterProjectList(list, 'usage-menu', byId).map((e) => e.name)).toEqual(['claude-usage-menubar']);
    expect(filterProjectList(list, 'qqboLh', byId).map((e) => e.name)).toEqual(['MAWS']);
    expect(filterProjectList(list, 'terminal workflow', byId).map((e) => e.name)).toEqual(['This Mac']);
    expect(filterProjectList(list, 'This Mac', byId)).toEqual([]); // a machine's row is found by its sessions only
    expect(filterProjectList(list, '  ', byId)).toBe(list);
  });
});

// P5 O6 M5 (OX3; DL 28 T3, T4): one row per org project across machines, each machine's own row for the rest.
describe('the project list across machines', () => {
  const here = projectOn(TEST_MACHINE, 'maws', 0, { name: 'MAWS', org: repo('maws', 'MAWS') });
  const away = projectOn(OTHER_MACHINE, 'maws-clone', 0, { name: 'maws-clone', org: repo('maws', 'MAWS') });
  const recs = (...list: SessionRecord[]) => new Map(list.map((r) => [r.appId, r]));
  const list = (ps: ProjectRecord[], rs: Map<AppSessionId, SessionRecord>, over: Partial<ProjectListInput> = {}) =>
    projectList(input({ records: rs, digests: new Map(), projects: mapOf(ps), rows: [], ...over }));

  it('groups both machines’ checkouts of one repository under one row, its sessions from both', () => {
    const entries = list([here, away], recs(sessionOn(TEST_MACHINE, 's1', { projectId: here.id }), sessionOn(OTHER_MACHINE, 's2', { projectId: away.id })));
    expect(entries.map((e) => [e.key, e.name, e.sessions.map((r) => r.appId).sort()])).toEqual([['repo:maws', 'MAWS', [addr('s1'), there('s2')].sort()]]);
    expect(entries[0].project?.id).toBe(here.id); // the local checkout acts for the row
    expect(entries[0].org.checkouts.map((c) => c.machine)).toEqual([TEST_MACHINE, OTHER_MACHINE]);
  });

  it('acts through the other machine’s checkout when this machine has none', () => {
    const entries = list([away], recs(sessionOn(OTHER_MACHINE, 's2', { projectId: away.id })));
    expect(entries.map((e) => [e.key, e.project?.id])).toEqual([['repo:maws', away.id]]);
  });

  it('lists an org project while one machine’s checkout is not hidden', () => {
    const entries = list([{ ...here, hidden: true }, away], recs(sessionOn(TEST_MACHINE, 's1', { projectId: here.id }), sessionOn(OTHER_MACHINE, 's2', { projectId: away.id })));
    expect(entries.map((e) => [e.key, e.sessions.map((r) => r.appId)])).toEqual([['repo:maws', [there('s2')]]]); // the hidden checkout's sessions still nowhere
    expect(list([{ ...here, hidden: true }, { ...away, hidden: true }], recs(sessionOn(OTHER_MACHINE, 's2', { projectId: away.id })))).toEqual([]);
  });

  it('puts a session in a folder nobody opened under its machine’s row, named after the machine, this machine’s first', () => {
    const tmp = projectOn(OTHER_MACHINE, 'tmp', 1, { discovered: true, org: { key: `folder:${OTHER_MACHINE}:tmp` as OrgKey, name: 'tmp', source: 'folder', smnsId: null } });
    const entries = list([here, tmp], recs(
      sessionOn(OTHER_MACHINE, 'in-tmp', { projectId: tmp.id }),
      sessionOn(OTHER_MACHINE, 'home', { projectId: null }),
      sessionOn(TEST_MACHINE, 'home-here', { projectId: null }),
    ));
    expect(entries.map((e) => [e.key, e.name, e.machine, e.sessions.map((r) => r.appId).sort()])).toEqual([
      ['repo:maws', 'MAWS', null, []],
      [LOCAL_ROW, 'This Mac', TEST_MACHINE, [addr('home-here')]],
      [machineKey(OTHER_MACHINE), 'Studio', OTHER_MACHINE, [there('home'), there('in-tmp')].sort()],
    ]);
  });

  it('lists a key the project filter names though no checkout lists it, with its sessions', () => {
    const tmp = projectOn(OTHER_MACHINE, 'tmp', 1, { discovered: true, org: { key: `folder:${OTHER_MACHINE}:tmp` as OrgKey, name: 'tmp', source: 'folder', smnsId: null } });
    const entries = list([tmp], recs(sessionOn(OTHER_MACHINE, 'in-tmp', { projectId: tmp.id })), { alsoListed: new Set([tmp.org!.key]) });
    expect(entries.map((e) => [e.key, e.sessions.length])).toEqual([[tmp.org!.key, 1]]);
  });

  it('keeps a project its machine has not derived yet a row of its own, keyed by its address', () => {
    const fresh = projectOn(OTHER_MACHINE, 'fresh', 1);
    expect(list([fresh], recs()).map((e) => [e.key, e.name])).toEqual([[fresh.id, 'fresh']]);
  });
});

// P5 O8 M2 ("Drawing"): another machine's listed sessions beside this Mac's records.
describe('listed rows in the project list', () => {
  const ORG = 'repo:maws' as OrgKey;
  const here = projectOn(TEST_MACHINE, 'maws', 0, { name: 'MAWS', org: repo('maws', 'MAWS') });
  const listedOn = (session: string, over: Partial<RemoteRow> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, session, over), appId: there(session) as AppSessionId });
  const listedMap = (...list: ListedSession[]) => new Map(list.map((l) => [l.appId, l]));
  const recs = (...list: SessionRecord[]) => new Map(list.map((r) => [r.appId, r]));
  const local = sessionOn(TEST_MACHINE, 's1', { projectId: here.id, updatedAt: '2026-10-28T09:00:00Z' });
  const list = (listed: Map<AppSessionId, ListedSession>, over: Partial<ProjectListInput> = {}) =>
    projectList(input({ records: recs(local), digests: new Map(), projects: mapOf([here]), rows: [], listed, ...over }));
  const shape = (entries: ReturnType<typeof list>) => entries.map((e) => [e.key, e.sessions.map((r) => r.appId), e.listed.map((l) => l.appId)]);

  it('joins its org project beside the local rows; one whose project is not listed sits under its machine’s row', () => {
    const joined = listedOn('b1', { orgKey: ORG, issued: '2026-10-28T10:00:00Z' });
    const elsewhere = listedOn('b2', { orgKey: 'repo:unknown' as OrgKey });
    const none = listedOn('b3');
    const entries = list(listedMap(joined, elsewhere, none));
    expect(shape(entries)).toEqual([
      [ORG, [addr('s1')], [there('b1')]],
      [machineKey(OTHER_MACHINE), [], [there('b2'), there('b3')]],
    ]);
    expect(entries[0].lastActivity).toBe(Date.parse('2026-10-28T10:00:00Z')); // its issue is the row's latest movement
    expect(entries[1].name).toBe('Studio');
  });

  it('files an all-hidden project’s row nowhere, and a row of a key with no checkout under its machine’s row', () => {
    const row = listedOn('b1', { orgKey: ORG });
    expect(shape(list(listedMap(row), { projects: mapOf([{ ...here, hidden: true }]), records: new Map() }))).toEqual([]);
    expect(shape(list(listedMap(row), { projects: mapOf([{ ...here, discovered: true }]), records: new Map() }))).toEqual([[machineKey(OTHER_MACHINE), [], [there('b1')]]]);
  });

  it('draws only the member’s own rows, and none whose address has a record (the record’s row is drawn)', () => {
    const recorded = sessionOn(OTHER_MACHINE, 'b1', { projectId: null });
    const entries = list(listedMap(listedOn('b1'), listedOn('b2', { mine: false }), listedOn('b3')), { records: recs(local, recorded) });
    expect(shape(entries)).toEqual([[ORG, [addr('s1')], []], [machineKey(OTHER_MACHINE), [there('b1')], [there('b3')]]]);
  });

  // P5 O7 M2: the record main read over the link for a lane B row it opened stands where the row stood (its project is
  // unknown here), so one row per address, and it doesn't move when the record arrives
  it('draws a record at a listed address where its listing was filed when its project is not known here', () => {
    const recorded = sessionOn(OTHER_MACHINE, 'b1', { projectId: there('maws-b') as ProjectId });
    const entries = list(listedMap(listedOn('b1', { orgKey: ORG })), { records: recs(local, recorded) });
    expect(shape(entries)).toEqual([[ORG, [addr('s1'), there('b1')], []]]);
  });

  it('adds listed rows waiting and busy to the waiting and working counts', () => {
    const states = ['waiting', 'busy', 'busy', 'idle', 'failed'];
    const entries = list(listedMap(...states.map((state, i) => listedOn(`b${i}`, { orgKey: ORG, state }))), {
      digests: new Map([[local.appId, digest(local.appId, { phase: 'working' })]]),
    });
    expect(entries[0].rollup).toEqual({ waiting: 1, working: 3 });
  });

  it('a search finds a listed row by its title', () => {
    const entries = list(listedMap(listedOn('b1', { orgKey: ORG, title: 'Remote refactor' }), listedOn('b2', { title: 'Studio chores' })));
    expect(filterProjectList(entries, 'chores', byId).map((e) => e.key)).toEqual([machineKey(OTHER_MACHINE)]);
    expect(filterProjectList(entries, 'refactor', byId).map((e) => e.key)).toEqual([ORG]);
  });

  it('reads each state through the existing glyphs', () => {
    const read = (state: string) => { const g = listedGlyph(state); return [g.char, g.tone, g.label, g.pulse]; };
    expect(read('busy')).toEqual(['●', 'accent', 'Working', true]);
    expect(read('waiting')).toEqual(['◐', 'warning', 'Needs you', false]);
    expect(read('failed')).toEqual(['✕', 'danger', 'Failed', false]);
    for (const state of ['done', 'stopped', 'retired']) expect(read(state)).toEqual(['✓', 'faint', 'Done', false]);
    for (const state of ['idle', 'unknown-word', '']) expect(read(state)).toEqual(['○', 'faint', 'Idle', false]);
    expect(listedTitle({ title: '  ' })).toBe('New chat');
  });
});

// P5 O8 M5 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The People toggle"): ownership first (an address
// is others' when a listing at it isn't the member's), then the presentation: drawn under its row while that row's
// People toggle is on, else counted in its `others`; never in the rollups, which say what needs you.
describe('other people’s sessions and the People toggle', () => {
  const ORG = 'repo:maws' as OrgKey;
  const OTHER_ROW = machineKey(OTHER_MACHINE);
  const here = projectOn(TEST_MACHINE, 'maws', 0, { name: 'MAWS', org: repo('maws', 'MAWS') });
  const listedOn = (session: string, over: Partial<RemoteRow> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, session, { orgKey: ORG, ...over }), appId: there(session) as AppSessionId });
  const theirs = (session: string, over: Partial<RemoteRow> = {}) => listedOn(session, { mine: false, owners: ['ana'], ...over });
  const listedMap = (...list: ListedSession[]) => new Map(list.map((l) => [l.appId, l]));
  const recs = (...list: SessionRecord[]) => new Map(list.map((r) => [r.appId, r]));
  const local = sessionOn(TEST_MACHINE, 's1', { projectId: here.id, updatedAt: '2026-10-28T09:00:00Z' });
  const list = (listed: Map<AppSessionId, ListedSession>, people: ReadonlySet<RowKey> = new Set(), over: Partial<ProjectListInput> = {}) =>
    projectList(input({ records: recs(local), digests: new Map(), projects: mapOf([here]), rows: [], listed, people, ...over }));
  const shape = (entries: ReturnType<typeof list>) => entries.map((e) => [e.key, e.sessions.map((r) => r.appId), e.listed.map((l) => l.appId), e.others]);
  const waitingRow = (appSessionId: AppSessionId) => ({ appSessionId, oldest: item(appSessionId, 'permission', '2026-10-28T09:00:00Z'), count: 1, tier: 1 }) as NeedsYouRow;

  it('counts others’ rows while the toggle is off and draws them under People while it is on, their activity only once drawn', () => {
    const listed = listedMap(listedOn('b1'), theirs('b2', { issued: '2026-10-28T11:00:00Z' }), theirs('b3'));
    const off = list(listed);
    expect(shape(off)).toEqual([[ORG, [addr('s1')], [there('b1')], 2]]);
    expect(off[0].lastActivity).toBe(Date.parse('2026-10-28T09:00:00Z'));
    // a project holding others' rows alone, toggled off, ranks by when it was added, as one with no session does
    const notes = projectOn(TEST_MACHINE, 'notes', 1, { name: 'notes', org: repo('notes'), createdAt: '2026-10-28T10:00:00Z' });
    const ranked = list(listedMap(theirs('n1', { orgKey: 'repo:notes' as OrgKey })), new Set(), { projects: mapOf([here, notes]) });
    expect(ranked.map((e) => [e.key, e.lastActivity, e.others])).toEqual([['repo:notes', null, 1], [ORG, Date.parse('2026-10-28T09:00:00Z'), 0]]);
    const on = list(listed, new Set([ORG]));
    expect(shape(on)).toEqual([[ORG, [addr('s1')], [there('b1'), there('b2'), there('b3')], 0]]);
    expect(on[0].lastActivity).toBe(Date.parse('2026-10-28T11:00:00Z'));
  });

  it('hides a record at an others’ listed address while off and counts it; draws it while on; never in the rollups', () => {
    const recorded = sessionOn(OTHER_MACHINE, 'c1', { projectId: null });
    const over = { records: recs(local, recorded), rows: [waitingRow(recorded.appId)], digests: new Map([[recorded.appId, digest(recorded.appId, { phase: 'working' })]]) };
    const listed = listedMap(theirs('c1', { orgKey: null }));
    const off = list(listed, new Set(), over);
    expect(shape(off)).toEqual([[ORG, [addr('s1')], [], 0], [OTHER_ROW, [], [], 1]]);
    const on = list(listed, new Set([OTHER_ROW]), over);
    expect(shape(on)).toEqual([[ORG, [addr('s1')], [], 0], [OTHER_ROW, [there('c1')], [], 0]]);
    expect(on[1].rollup).toEqual({ waiting: 0, working: 0 });
  });

  // P5 O7 M2: where its listing is filed (one row per address), its project being unknown here
  it('draws a record at your listed address as today, where its listing is filed', () => {
    const recorded = sessionOn(OTHER_MACHINE, 'b1', { projectId: null });
    const entries = list(listedMap(listedOn('b1', { owners: ['member-1', 'ana'] })), new Set(), { records: recs(local, recorded) });
    expect(shape(entries)).toEqual([[ORG, [addr('s1'), there('b1')], [], 0]]);
  });

  it('counts yours only in the rollups: others’ waiting and busy rows add nothing', () => {
    const listed = listedMap(listedOn('b1', { state: 'waiting' }), theirs('b2', { state: 'waiting' }), theirs('b3', { state: 'busy' }));
    expect(list(listed, new Set([ORG]))[0].rollup).toEqual({ waiting: 1, working: 0 });
    expect(list(listed)[0].rollup).toEqual({ waiting: 1, working: 0 });
  });

  it('a search matches drawn rows only, so others’ rows match while the toggle is on', () => {
    const listed = listedMap(theirs('b1', { title: 'Ana’s refactor' }));
    expect(filterProjectList(list(listed), 'refactor', byId).map((e) => e.key)).toEqual([]);
    expect(filterProjectList(list(listed, new Set([ORG])), 'refactor', byId).map((e) => e.key)).toEqual([ORG]);
  });

  it('keeps a machine’s row with only others’ sessions, with its others, so its toggle stays reachable', () => {
    const entries = list(listedMap(theirs('b1', { orgKey: null }), theirs('b2', { orgKey: null })));
    expect(shape(entries)).toEqual([[ORG, [addr('s1')], [], 0], [OTHER_ROW, [], [], 2]]);
    expect(entries[1].name).toBe('Studio');
  });

  it('keys the toggle per row, machine rows included', () => {
    const listed = listedMap(theirs('b1'), theirs('b2', { orgKey: null }));
    expect(shape(list(listed, new Set([OTHER_ROW])))).toEqual([[ORG, [addr('s1')], [], 1], [OTHER_ROW, [], [there('b2')], 0]]);
    expect(shape(list(listed, new Set([ORG])))).toEqual([[ORG, [addr('s1')], [there('b1')], 0], [OTHER_ROW, [], [], 1]]);
  });
});

describe('an expanded project’s records and listed rows in one ordering', () => {
  const minute = (m: number) => `2026-10-28T10:${String(m).padStart(2, '0')}:00.000Z`;
  const rec = (id: string, m: number, over: Partial<SessionRecord> = {}) => record(id, { updatedAt: minute(m), ...over });
  const lst = (id: string, m: number): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { issued: minute(m) }), appId: there(id) as AppSessionId });
  const ids = (items: ReturnType<typeof projectItems>) => items.map((i) => (i.kind === 'record' ? i.record.appId : `@${i.listed.session}`));
  const items = (sorted: SessionRecord[], listed: ListedSession[], sort: 'priority' | 'recency' = 'recency', over: { rows?: NeedsYouRow[] } = {}) =>
    projectItems({ sorted, listed, digests: new Map(), rows: over.rows ?? [], sort });

  it('merges by last activity, records by `lastActivity`, listed rows by `issued`; pinned records stay on top', () => {
    expect(ids(items([rec('r9', 9), rec('r5', 5), rec('r1', 1)], [lst('l7', 7), lst('l3', 3), lst('l0', 0)]))).toEqual(['r9', '@l7', 'r5', '@l3', 'r1', '@l0']);
    expect(ids(items([rec('p', 0, { pinned: true }), rec('r5', 5)], [lst('l7', 7)]))).toEqual(['p', '@l7', 'r5']);
  });

  it('under priority, the records ranked by attention, unread or work lead; the listed rows merge among the rest', () => {
    const waitingOld = rec('w', 1);
    const unread = rec('u', 2, { unread: true });
    const rows = needsYou(new Map([[waitingOld.appId, [item('w', 'permission', minute(1))]]]), new Map([[waitingOld.appId, waitingOld]]));
    expect(ids(items([waitingOld, unread, rec('r5', 5), rec('r3', 3)], [lst('l9', 9), lst('l4', 4)], 'priority', { rows }))).toEqual(['w', 'u', '@l9', 'r5', '@l4', 'r3']);
  });

  it('nests lineage among records only, and caps count a listed row as one tree: five, then eight after Show more', () => {
    const parent = rec('a', 9);
    const child = rec('a-t', 2, { lineage: { kind: 'fork', parentAppSessionId: 'a' as AppSessionId, parentEngineSessionId: null, openedBy: 'fork' } });
    const merged = items([parent, child, ...Array.from({ length: 4 }, (_, i) => rec(`r${i}`, 4 - i))], Array.from({ length: 5 }, (_, i) => lst(`l${i}`, 8 - i)));
    const trees = nestItems(merged);
    expect(trees.map((t) => t.rows.map((r) => ('listed' in r ? `@${r.listed.session}` : r.nestedUnder === null ? r.record.appId : `${r.record.appId}<${r.nestedUnder}`)))).toEqual([
      ['a', 'a-t<a'], ['@l0'], ['@l1'], ['@l2'], ['@l3'], ['@l4'], ['r0'], ['r1'], ['r2'], ['r3'],
    ]);
    expect(trees.slice(0, shownCount(trees.length, false)).flatMap((t) => t.rows)).toHaveLength(6);
    expect(trees.slice(0, shownCount(trees.length, true)).flatMap((t) => t.rows)).toHaveLength(9);
  });
});

// W11 (I4, as the owner corrected it): one flat list per expanded project, five rows then "Show more" to eight.
describe('an expanded project’s sessions', () => {
  const maws = () => projectList(base).find((e) => e.key === addr('proj-maws'))!;
  const list = (over: Partial<ProjectSessionsInput> = {}) => projectSessions({ sessions: maws().sessions, digests, rows, sort: 'priority', matches: everyone, ...over });

  it('puts pinned sessions on top, then the rest in the chosen sort, worktree sessions among them', () => {
    expect(titles(list())).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    const usage = projectList(base).find((e) => e.key === addr('proj-claude-usage-menubar'))!;
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

  it('ages read now, minutes, hours, days, weeks, compact and in English under the Korean system locale (2h)', () => {
    const ages = [0, 59_000, 60_000, 3_599_000, 3_600_000, 86_399_000, 86_400_000, 7 * 86_400_000, -5000];
    expect(ages.map((ms) => formatAge(ms))).toEqual(['now', 'now', '1m', '59m', '1h', '23h', '1d', '1w', 'now']);
  });

  // E11 F2b (plan 2.4): an outcome (an error, an interruption) says when it happened; a request says how long it has waited
  it('an outcome reads "2 weeks ago", a request "waiting 5m"', () => {
    // the age's words are English (2 weeks ago; `@shared/app/date-format`)
    const now = at('2026-10-08T10:00:00Z');
    expect(itemAge(item('r', 'error', '2026-09-24T10:00:00Z'), now)).toBe(REL.ago(2, 'week'));
    expect(itemAge(item('r', 'interrupted', '2026-10-03T10:00:00Z'), now)).toBe(REL.ago(5, 'day'));
    expect(itemAge(item('r', 'permission', '2026-10-08T09:55:00Z'), now)).toBe(`waiting ${REL.amount(5, 'minute')}`);
  });

  it('a working session is "now"; otherwise the age of its latest movement; a Needs-you row shows its wait', () => {
    const now = at('2026-09-28T10:30:00Z');
    const r = record('r', { updatedAt: '2026-09-28T09:00:00Z' });
    // the display locale's compact amounts (8m), pinned by `formatAge` above
    expect(sessionAge(r, digest('r', { phase: 'working', turnStartedAt: '2026-09-28T08:00:00Z' }), now)).toBe(REL.now);
    expect(sessionAge(r, digest('r', { phase: 'idle', lastTurnEndedAt: '2026-09-28T10:22:00Z' }), now)).toBe(REL.amount(8, 'minute'));
    expect(sessionAge(r, null, now)).toBe(REL.amount(1, 'hour'));
    // A discovered session: the index wrote the record just now, its transcript last moved two days ago (C4's seed).
    const discovered = record('d', { updatedAt: '2026-09-28T10:29:30Z' });
    expect(sessionAge(discovered, digest('d', { phase: 'exited', lastTurnEndedAt: '2026-09-26T10:00:00Z' }), now)).toBe(REL.amount(2, 'day'));
    expect(needsYouAge(item('r', 'permission', '2026-09-28T10:26:00Z'), now)).toBe(REL.amount(4, 'minute'));
  });
});
