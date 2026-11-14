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
import { EMPTY_REGISTRY, registryRecords, type OrgProjectLocation, type OrgProjects } from '../stores/registry';
import { lastActivity, orderProjects, seenActivity, type SeenActivity } from '../overview/derive';
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
  SESSIONS_FIRST,
  sessionAge,
  sessionMatcher,
  shownCount,
  shownTrees,
  sidebarSessionId,
  splitHidden,
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

  // P5 O7 M2: the record main read over the link for a lane B row it opened stands where the row stood, so one row per
  // address, and it doesn't move when the record arrives
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

  // P5 O7 M10 (a busy remote session's state): a record at a listed address with no digest counts by its listing, as
  // its listed row did; a digest, where there is one, says instead
  it('counts a record at a listed address by its listing’s state while it has no digest', () => {
    const states = ['waiting', 'busy', 'busy', 'idle'];
    const recorded = states.map((_, i) => sessionOn(OTHER_MACHINE, `b${i}`, { projectId: null }));
    const entries = list(listedMap(...states.map((state, i) => listedOn(`b${i}`, { orgKey: ORG, state }))), {
      records: recs(local, ...recorded),
      digests: new Map([[there('b2') as AppSessionId, digest(there('b2'), { phase: 'idle' })]]),
    });
    expect(shape(entries)).toEqual([[ORG, [addr('s1'), ...states.map((_, i) => there(`b${i}`))], []]]);
    expect(entries[0].rollup).toEqual({ waiting: 1, working: 1 });
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
  const NOW = Date.parse('2026-10-28T11:00:00.000Z'); // within a day of every fixture: each unread one is fresh
  const rec = (id: string, m: number, over: Partial<SessionRecord> = {}) => record(id, { updatedAt: minute(m), ...over });
  const lst = (id: string, m: number): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { issued: minute(m) }), appId: there(id) as AppSessionId });
  const ids = (items: ReturnType<typeof projectItems>) => items.map((i) => (i.kind === 'record' ? i.record.appId : `@${i.listed.session}`));
  const items = (sorted: SessionRecord[], listed: ListedSession[], sort: 'priority' | 'recency' = 'recency', over: { rows?: NeedsYouRow[] } = {}) =>
    projectItems({ now: NOW, sorted, listed, digests: new Map(), rows: over.rows ?? [], sort });

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

  // P5 O7 M8 (m8-1, red first; M8's *The sidebar row*): why the sitting's remote-spawned session had no row at all. Its
  // listing joins its project by its app id, but a group draws five rows (eight after Show more), and under the default
  // `priority` sort pinned, waiting, unread and working local records led while a listed row ranked by its `issued` time
  // alone, so behind more busy local records than the cap it was never drawn. m8-4's fix: the priority sort ranks a
  // listed row by its own state, as it ranks a local record (parity), and a session spawned from this window leads its
  // group until its first turn ends, on either lane (the architect's ruling; `leadsAsSpawned`, `sessions/spawned-here.ts`).
  const visible = (merged: ReturnType<typeof projectItems>) => nestItems(merged).slice(0, shownCount(nestItems(merged).length, false)).flatMap((t) => t.rows.map((r) => ('listed' in r ? `@${r.listed.session}` : r.record.appId)));
  const busy = (over: Partial<SessionRecord>) => Array.from({ length: SESSIONS_CAP + 1 }, (_, i) => rec(`b${i}`, SESSIONS_CAP - i, over)); // newest first, as `projectSessions` sorts them
  const spawned = (state: string) => ({ ...lst('spawned', SESSIONS_CAP + 2), state });
  const SPAWNED = new Set([there('spawned') as AppSessionId]);

  it('a just-spawned working remote session leads into the visible rows under priority, past more unread local sessions than the cap', () => {
    expect(visible(projectItems({ now: NOW, sorted: busy({ unread: true }), listed: [spawned('busy')], digests: new Map(), rows: [], sort: 'priority', spawned: SPAWNED }))).toContain('@spawned');
  });

  it('a just-spawned working remote session leads into the visible rows under priority, past more working local sessions than the cap', () => {
    const working = busy({});
    const digests = new Map(working.map((r) => [r.appId, digest(r.appId, { phase: 'working' })]));
    expect(visible(projectItems({ now: NOW, sorted: working, listed: [spawned('busy')], digests, rows: [], sort: 'priority' })), 'by its state alone').toContain('@spawned');
  });

  it('after its first turn a spawned remote session ranks by its state again: an idle one sinks behind the unread', () => {
    expect(visible(projectItems({ now: NOW, sorted: busy({ unread: true }), listed: [spawned('idle')], digests: new Map(), rows: [], sort: 'priority' }))).not.toContain('@spawned');
  });

  it('a just-spawned local session leads its group past more unread sessions than the cap until its first turn ends, then ranks by its state', () => {
    const fresh = rec('fresh', 0);
    const sessions = [...busy({ unread: true }), fresh];
    const shown = (spawnedHere: ReadonlySet<AppSessionId>) => {
      const sorted = projectSessions({ now: NOW, sessions, digests: new Map(), rows: [], sort: 'priority', matches: everyone, spawned: spawnedHere });
      return visible(projectItems({ now: NOW, sorted, listed: [], digests: new Map(), rows: [], sort: 'priority', spawned: spawnedHere }));
    };
    expect(shown(new Set([fresh.appId]))[0]).toBe('fresh');
    expect(shown(new Set())).not.toContain('fresh');
  });

  // The architect's ruling (2026-11-04, on m8-4a's review): a pin is the person's own order, the lead the app's inference,
  // so the lead sits under the pinned records; and while it holds it is always drawn, the cap growing by one past them.
  it('the spawned lead sits under pinned records, drawn past the cap they fill (the cap grows by one), under either sort', () => {
    const pinned = Array.from({ length: SESSIONS_CAP + 1 }, (_, i) => rec(`p${i}`, 20 - i, { pinned: true }));
    const fresh = rec('fresh', 0);
    const lead = new Set([...SPAWNED, fresh.appId]);
    for (const sort of ['priority', 'recency'] as const) {
      const sorted = projectSessions({ now: NOW, sessions: [...pinned, fresh], digests: new Map(), rows: [], sort, matches: everyone, spawned: lead });
      const trees = nestItems(projectItems({ now: NOW, sorted, listed: [spawned('idle')], digests: new Map(), rows: [], sort, spawned: lead }));
      const drawn = (more: boolean) => shownTrees(trees, more, lead);
      const names = (more: boolean) => drawn(more).shown.map((t) => sidebarSessionId(t.root)).map((id): string => (id === (there('spawned') as string) ? '@spawned' : id));
      expect(trees.slice(SESSIONS_CAP + 1).map((t) => sidebarSessionId(t.root)).sort(), sort).toEqual([fresh.appId, there('spawned')].sort()); // under all nine pins
      expect(names(false), sort).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', ...names(false).slice(5)]);
      expect(names(false).slice(5).sort(), sort).toEqual(['@spawned', 'fresh']);
      expect(drawn(false).more, `${sort}: Show more adds the three pins left within the cap`).toBe(3);
      expect(names(true).slice(0, SESSIONS_CAP), sort).toEqual(pinned.slice(0, SESSIONS_CAP).map((r) => r.appId));
      expect(names(true).slice(SESSIONS_CAP).sort(), sort).toEqual(['@spawned', 'fresh']);
      expect(drawn(true).more, sort).toBe(0);
    }
    const unled = shownTrees(nestItems(projectItems({ now: NOW, sorted: pinned, listed: [spawned('idle')], digests: new Map(), rows: [], sort: 'priority' })), false, new Set());
    expect(unled.shown.map((t) => sidebarSessionId(t.root)), 'with no lead the cap is the cap').toHaveLength(5);
  });

  // m8-4a's review 2 (cap-review.test.ts): a side thread's setup can mark a child nested under an older, unmarked parent;
  // the tree that holds a leading row is drawn past the cap, and Show more's count reads the same predicate
  it('a spawned lead nested under an unmarked parent past the cap is drawn with its tree, under either sort, before and after Show more', () => {
    const pinned = Array.from({ length: SESSIONS_CAP + 1 }, (_, i) => rec(`p${i}`, 20 - i, { pinned: true }));
    const parent = rec('parent', 0);
    const child = rec('child', 1, { lineage: { kind: 'side-thread', parentAppSessionId: parent.appId, parentEngineSessionId: null, anchor: { kind: 'file-line', locator: '/r/x.ts#L4', label: 'x.ts:4', path: '/r/x.ts', line: 4 }, openedBy: 'comment' } });
    const lead = new Set([child.appId]);
    for (const sort of ['priority', 'recency'] as const) {
      const sorted = projectSessions({ now: NOW, sessions: [...pinned, parent, child], digests: new Map(), rows: [], sort, matches: everyone, spawned: lead });
      const trees = nestItems(projectItems({ now: NOW, sorted, listed: [], digests: new Map(), rows: [], sort, spawned: lead }));
      expect(sidebarSessionId(trees[trees.length - 1].root), `${sort}: the parent's tree sits past the pins`).toBe(parent.appId);
      for (const more of [false, true]) {
        const drawn = shownTrees(trees, more, lead);
        const rows = drawn.shown.flatMap((tree) => tree.rows.map((row) => ('record' in row ? row.record.appId : row.listed.appId)));
        expect(rows.slice(-2), `${sort}, Show more ${more}`).toEqual([parent.appId, child.appId]);
        expect(drawn.shown, `${sort}, Show more ${more}`).toHaveLength(shownCount(SESSIONS_CAP + 2, more) + 1);
        expect(drawn.more, `${sort}, Show more ${more}: the pins left within the cap`).toBe(more ? 0 : SESSIONS_CAP - SESSIONS_FIRST);
      }
    }
  });

  it('under priority a listed row ranks by its own state: waiting from its attention feed, working from its listing, the rest by its issue', () => {
    const fed = lst('fed', 1);
    const rowsFor = needsYou(new Map([[fed.appId, [item(fed.appId, 'permission', minute(1))]]]), new Map(), { listed: new Map([[fed.appId, fed]]) });
    const unread = rec('u', 3, { unread: true });
    const working = rec('w', 4);
    const asking = rec('wr', 3); // its digest says waiting, and the feed has no row for it
    const digests = new Map([[working.appId, digest(working.appId, { phase: 'working', turnStartedAt: minute(4) })], [asking.appId, digest(asking.appId, { phase: 'waiting' })]]);
    const listed = [{ ...lst('asks', 2), state: 'waiting' }, { ...lst('runs', 6), state: 'busy' }, lst('rests', 9), fed];
    expect(ids(projectItems({ now: NOW, sorted: [unread, working, rec('r5', 5), asking], listed, digests, rows: rowsFor, sort: 'priority' })), 'a waiting word with no feed row is the rest’s, either way').toEqual(['@fed', 'u', '@runs', 'w', '@rests', 'r5', 'wr', '@asks']);
    expect(ids(projectItems({ now: NOW, sorted: [rec('r5', 5)], listed, digests: new Map(), rows: rowsFor, sort: 'recency' })), 'recency: the issue alone').toEqual(['@rests', '@runs', 'r5', '@asks', '@fed']);
  });
});

// P5 O7 M10 (A, red first; M10's *A remote session ranks by a stale activity time*): live, a session spawned from this
// Mac on another machine fell past the cap once its first turn ended. Its record (lane B, which no lane B module digests)
// ranked by `updatedAt` as this Mac last received it, frozen once its tab let it go; the record hid its listing, whose
// `issued` is fresher; and nothing read the turn events its stream delivered here. Its activity is now the newest of the
// three, and it ranks among local sessions by the same rule.
describe('a remote session’s activity', () => {
  const hour = (h: number) => `2026-11-05T${String(h).padStart(2, '0')}:00:00.000Z`;
  const NOW = Date.parse(hour(12)); // within a day of every fixture: each unread one is fresh
  const REMOTE = there('spawned') as AppSessionId;
  // the record as this Mac last received it: at the spawn, 00:00, before its tab let it go
  const remote = (over: Partial<SessionRecord> = {}) => record(REMOTE, { updatedAt: hour(0), ...over });
  // its first turn ended at 10:00, which its listing was issued again for
  const listing: ListedSession = { ...remoteRow(OTHER_MACHINE, 'spawned', { issued: hour(10) }), appId: REMOTE };
  // more idle local sessions than the cap, none pinned, each last active between the spawn and the turn's end
  const older = (over: Partial<SessionRecord> = {}) => Array.from({ length: SESSIONS_CAP + 1 }, (_, i) => record(`idle${i}`, { updatedAt: hour(0), ...over }));
  const digestsOf = (locals: SessionRecord[]) => new Map(locals.map((r, i) => [r.appId, digest(r.appId, { phase: 'idle', lastTurnEndedAt: hour(9 - i) })]));
  const drawn = (sessions: SessionRecord[], digests: ReadonlyMap<AppSessionId, SessionDigest>, seen: SeenActivity, sort: 'priority' | 'recency') => {
    const sorted = projectSessions({ now: NOW, sessions, digests, rows: [], sort, matches: everyone, seen });
    const trees = nestItems(projectItems({ now: NOW, sorted, listed: [], digests, rows: [], sort, seen }));
    return shownTrees(trees, false, new Set()).shown.map((tree) => sidebarSessionId(tree.root));
  };

  it('a remote session whose turn just ended shows first among older idle local sessions, by its listing’s issue, under either sort', () => {
    const locals = older();
    const seen = seenActivity(new Map([[REMOTE, listing]]), new Map());
    for (const sort of ['priority', 'recency'] as const) expect(drawn([...locals, remote()], digestsOf(locals), seen, sort)[0], sort).toBe(REMOTE);
  });

  it('the turn events its stream delivered here count the same, its listing aside', () => {
    const locals = older();
    const seen = seenActivity(new Map(), new Map([[REMOTE, Date.parse(hour(10))]]));
    for (const sort of ['priority', 'recency'] as const) expect(drawn([...locals, remote()], digestsOf(locals), seen, sort)[0], sort).toBe(REMOTE);
  });

  it('an unread remote session ranks among the unread by its latest activity, where it ranked last', () => {
    const locals = older({ unread: true });
    const seen = seenActivity(new Map([[REMOTE, listing]]), new Map());
    expect(drawn([...locals, remote({ unread: true })], digestsOf(locals), seen, 'priority')[0]).toBe(REMOTE);
  });

  it('its activity is the newest of the record as received, its listing’s issue and its turns seen; a session with turn times of its own keeps them', () => {
    expect(lastActivity(remote({ updatedAt: hour(11) }), undefined, seenActivity(new Map([[REMOTE, listing]]), new Map()).get(REMOTE))).toBe(Date.parse(hour(11)));
    expect(seenActivity(new Map([[REMOTE, listing]]), new Map([[REMOTE, Date.parse(hour(12))]])).get(REMOTE)).toBe(Date.parse(hour(12)));
    expect(seenActivity(new Map([[REMOTE, listing]]), new Map([[REMOTE, Date.parse(hour(1))]])).get(REMOTE)).toBe(Date.parse(hour(10)));
    const local = record('local', { updatedAt: hour(0) });
    expect(lastActivity(local, digest('local', { lastTurnEndedAt: hour(3) }), Date.parse(hour(12)))).toBe(Date.parse(hour(3)));
  });

  // M10's follow-up, the owner's ruling "Fresh unread first (Recommended)" (tracker row "a read session behind stale
  // unread ones"): live, the session the owner watched end its turn, and so read, sat behind more stale unread idle
  // sessions than the cap; an unread session now ranks ahead only within 24 h of the turn that made it unread
  it('a read session whose turn just ended shows among the visible rows above more stale unread idle sessions than the cap, remote or local', () => {
    const stale = Array.from({ length: SESSIONS_CAP + 1 }, (_, i) => record(`stale${i}`, { updatedAt: '2026-11-01T00:00:00.000Z', unread: true }));
    const staleDigests = stale.map((r, i) => [r.appId, digest(r.appId, { phase: 'idle', lastTurnEndedAt: `2026-11-01T0${i}:00:00.000Z` })] as const);
    const seen = seenActivity(new Map([[REMOTE, listing]]), new Map());
    for (const sort of ['priority', 'recency'] as const) expect(drawn([...stale, remote()], new Map(staleDigests), seen, sort)[0], `remote, ${sort}`).toBe(REMOTE);
    const read = record('read', { updatedAt: hour(0) });
    const digests = new Map([...staleDigests, [read.appId, digest(read.appId, { phase: 'idle', lastTurnEndedAt: hour(10) })] as const]);
    expect(drawn([...stale, read], digests, new Map(), 'priority')[0], 'local').toBe(read.appId);
    // the stale rows follow it by their activity
    expect(drawn([...stale, read], digests, new Map(), 'priority').slice(1)).toEqual(['stale8', 'stale7', 'stale6', 'stale5']);
  });

  it('its row’s age reads the same activity', () => {
    expect(sessionAge(remote(), undefined, Date.parse(hour(10)) + 8 * 60_000, Date.parse(hour(10)))).toBe(REL.amount(8, 'minute'));
  });

  // P5 O7 M10 (a busy remote session's state): with no digest, its listing's `busy` ranks it among the working (by its
  // activity, as a listed row by its issue), above idle sessions active since, and its age reads "now"
  it('a remote session its listing says is busy ranks among the working under priority and its age reads "now"', () => {
    const busy: ListedSession = { ...listing, state: 'busy', issued: '2026-11-05T00:30:00.000Z' }; // its turn started long since
    const listings = new Map([[REMOTE, busy]]);
    const seen = seenActivity(listings, new Map());
    const locals = older();
    const working = record('working-local', { updatedAt: hour(0) });
    const digests = new Map([...digestsOf(locals), [working.appId, digest(working.appId, { phase: 'working', turnStartedAt: hour(2) })]]);
    const sessions = [...locals, remote(), working];
    const sorted = projectSessions({ now: NOW, sessions, digests, rows: [], sort: 'priority', matches: everyone, seen, listings });
    expect(sorted.slice(0, 3).map((r) => r.appId)).toEqual([working.appId, REMOTE, 'idle0']);
    expect(projectItems({ now: NOW, sorted, listed: [], digests, rows: [], sort: 'priority', seen, listings }).slice(0, 2).map(sidebarSessionId)).toEqual([working.appId, REMOTE]);
    expect(projectSessions({ now: NOW, sessions, digests, rows: [], sort: 'recency', matches: everyone, seen, listings }).at(-1)?.appId).toBe(REMOTE); // recency: its activity alone
    expect(sessionAge(remote(), undefined, NOW, seen.get(REMOTE), busy)).toBe(formatAge(0));
    expect(sessionAge(remote(), undefined, NOW, seen.get(REMOTE), { ...busy, state: 'idle' })).not.toBe(formatAge(0));
  });
});

// W11 (I4, as the owner corrected it): one flat list per expanded project, five rows then "Show more" to eight.
describe('an expanded project’s sessions', () => {
  const NOW = Date.parse('2026-09-28T12:00:00.000Z'); // the scenario's day
  const maws = () => projectList(base).find((e) => e.key === addr('proj-maws'))!;
  const list = (over: Partial<ProjectSessionsInput> = {}) => projectSessions({ now: NOW, sessions: maws().sessions, digests, rows, sort: 'priority', matches: everyone, ...over });

  it('puts pinned sessions on top, then the rest in the chosen sort, worktree sessions among them', () => {
    expect(titles(list())).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    const usage = projectList(base).find((e) => e.key === addr('proj-claude-usage-menubar'))!;
    expect(titles(projectSessions({ now: NOW, sessions: usage.sessions, digests, rows, sort: 'recency', matches: everyone }))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    const recs = [record('m', { projectId: 'p' as never }), record('w', { projectId: 'p' as never, worktree: { path: '/r/.claude/worktrees/w', branch: 'worktree-w' } })];
    expect(projectSessions({ now: NOW, sessions: recs, digests: new Map(), rows: [], sort: 'priority', matches: everyone }).map((r) => r.appId).sort()).toEqual(['m', 'w']);
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

// UX wave U7, O-16 (Interfaces §D): a project's hidden sessions leave its ranked list after ranking and before the caps
describe('a project’s hidden sessions', () => {
  const at = (minutes: number) => `2026-11-12T${String(10 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00.000Z`;
  const item = (id: string, minutes: number): { kind: 'record'; record: SessionRecord } => ({ kind: 'record', record: record(addr(id), { updatedAt: at(minutes) }) });
  const listedItem = (id: string, minutes: number): { kind: 'listed'; listed: ListedSession } => ({ kind: 'listed', listed: { ...remoteRow(OTHER_MACHINE, id, { issued: at(minutes) }), appId: there(id) as AppSessionId } });
  const activity = (entry: Parameters<typeof sidebarSessionId>[0]) => (entry.kind === 'record' ? Date.parse(entry.record.updatedAt) : Date.parse(entry.listed.issued));
  const ids = (list: Parameters<typeof sidebarSessionId>[0][]) => list.map(sidebarSessionId);

  it('keeps the rank order among the shown, and orders the hidden by newest activity, records and listed rows alike', () => {
    const ranked = [item('a', 1), listedItem('b', 5), item('c', 9), item('d', 3), listedItem('e', 7)];
    const hidden = new Set<AppSessionId>([addr('a') as AppSessionId, there('b') as AppSessionId, addr('d') as AppSessionId, there('e') as AppSessionId]);
    const split = splitHidden(ranked, (id) => hidden.has(id), activity);
    expect(ids(split.shown)).toEqual([addr('c')]);
    expect(ids(split.hidden)).toEqual([there('e'), there('b'), addr('d'), addr('a')]);
    expect(splitHidden(ranked, () => false, activity)).toEqual({ shown: ranked, hidden: [] });
  });

  it('takes a hidden session out of the five: six sessions with one hidden show five and no "Show more"', () => {
    const ranked = Array.from({ length: 6 }, (_, i) => item(`s${i}`, 60 - i));
    const split = splitHidden(ranked, (id) => id === addr('s2'), activity);
    const drawn = shownTrees(nestItems(split.shown), false, new Set());
    expect(drawn.shown.map((tree) => sidebarSessionId(tree.root))).toEqual(['s0', 's1', 's3', 's4', 's5'].map(addr));
    expect(drawn.more).toBe(0);
    expect(ids(split.hidden)).toEqual([addr('s2')]);
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

  // UX wave U8c-2 (M4 decision 11): the row's branch follows the agent into a linked worktree,
  // whichever way it got there, and go when it is back in its launch checkout.
  it('names the branch of the linked worktree the agent works in, by a cd or by the tool', () => {
    const W1 = '/w/.claude/worktrees/w1';
    const byCd = record('c', { directory: '/w', branch: 'main', agentFolder: { checkout: W1, cwd: `${W1}/src`, branch: 'w1', linked: true } });
    expect(rowBranch(byCd)).toBe('w1');
    const byTool = record('t', { directory: W1, worktree: { path: W1, branch: 'w1' }, launchFolder: '/w', branch: 'w1' });
    expect(rowBranch(byTool)).toBe('w1');
    const backByCd = record('b', { directory: W1, worktree: { path: W1, branch: 'w1' }, launchFolder: '/w', branch: 'w1', agentFolder: { checkout: '/w', cwd: '/w', branch: 'main', linked: false } });
    expect(rowBranch(backByCd)).toBeNull(); // filed in the worktree, its agent back in the launch checkout
  });

  // UX wave U8c-2 (fix wave 1, the architect's ruling): a search finds a session by every word its rows show and by the
  // agent's working branch as well, so the Resume picker's row (which shows the record's branch) is found by it too.
  it('the search finds a moved session by the branch the record shows and by the working branch', () => {
    const W1 = '/w/.claude/worktrees/w1';
    const byCd = record('c', { directory: '/w', branch: 'main', agentFolder: { checkout: W1, cwd: `${W1}/src`, branch: 'w1', linked: true } });
    expect(sessionMatcher('main', new Map())(byCd)).toBe(true); // the record's branch, which the Resume picker shows
    expect(sessionMatcher('w1', new Map())(byCd)).toBe(true); // the working branch, which the sidebar's row shows
    expect(sessionMatcher('feature', new Map())(byCd)).toBe(false);
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

// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.1; M11's decisions): one row
// per project id, named as main assembled it and naming its machines; a row whose folders only the registry names follows
// this app's machines' rows, by name (provisional: Plan of Work, M11).
describe('the project registry’s rows', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  const AWAY_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  const SEEN_ID = '99999999-8888-4777-8666-555555555555';
  const location = (machine: MachineRef, pid: string, key: string): OrgProjectLocation => ({ machine, pid, path: `/srv/${pid}`, key: key as OrgKey, name: pid, source: 'remote', acts: true });
  const registry: OrgProjects = {
    ...EMPTY_REGISTRY,
    projects: [
      { id: ID, name: 'Northwind app', hub: true, renamable: true, locations: [location(TEST_MACHINE, 'app', 'remote:example.org/app'), location(OTHER_MACHINE, 'app-clone', 'remote:example.org/app')] },
      { id: AWAY_ID, name: 'scrape', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'scrape', `folder:${OTHER_MACHINE}:scrape`)] },
      { id: SEEN_ID, name: 'Alpha reports', hub: true, renamable: false, locations: [] },
    ],
    keys: { [ID]: 'remote:example.org/app' as OrgKey, [AWAY_ID]: `id:${AWAY_ID}` as OrgKey, [SEEN_ID]: `id:${SEEN_ID}` as OrgKey },
  };
  const app = projectOn(TEST_MACHINE, 'app', 0, { name: 'app', org: { key: 'remote:example.org/app' as OrgKey, name: 'app', source: 'remote', smnsId: ID } });
  const all = new Map([[app.id, app], ...registryRecords(registry, TEST_MACHINE)]);

  it('names each row as the registry does and its machines this Mac’s first, the rows only the registry names after, by name', () => {
    const entries = projectList(input({ records: new Map(), digests: new Map(), projects: all, rows: [], registry }));
    expect(entries.map((e) => [e.key, e.name, e.machines, e.registry?.id ?? null])).toEqual([
      ['remote:example.org/app', 'Northwind app', [TEST_MACHINE, OTHER_MACHINE], ID],
      [`id:${SEEN_ID}`, 'Alpha reports', [], SEEN_ID],
      [`id:${AWAY_ID}`, 'scrape', [OTHER_MACHINE], AWAY_ID],
    ]);
    expect(entries[0].project?.id).toBe(app.id); // this Mac's folder acts for the row
    expect(entries[2].project?.id).toBe(there('scrape')); // the other machine's location, from the registry
    expect(entries[1].project).toBeNull(); // seen only through a session: no folder to act through
  });

  // review 1, finding 4: a project seen only through others' sessions keeps the People capability with no checkout
  it('counts others’ sessions of a project with no location under its row, and draws them once its People toggle is on', () => {
    const theirs: ListedSession = { ...remoteRow(OTHER_MACHINE, 'b9', { orgKey: `id:${SEEN_ID}` as OrgKey, project: SEEN_ID, mine: false, owners: ['ana'] }), appId: there('b9') as AppSessionId };
    const listed = new Map([[theirs.appId, theirs]]);
    const row = (people: ReadonlySet<RowKey>) => projectList(input({ records: new Map(), digests: new Map(), projects: all, rows: [], registry, listed, people })).find((e) => e.key === `id:${SEEN_ID}`)!;
    expect([row(new Set()).others, row(new Set()).listed.map((l) => l.appId)]).toEqual([1, []]);
    expect([row(new Set([`id:${SEEN_ID}` as RowKey])).others, row(new Set([`id:${SEEN_ID}` as RowKey])).listed.map((l) => l.appId)]).toEqual([0, [there('b9')]]);
    expect(row(new Set()).project).toBeNull(); // still no folder to act through
  });

  // ticket 644: the registry places another machine's locations among the projects, so a record main read over that
  // machine's link has a known project; its listing still decides its row, so the row stands where the listed row stood
  // (the one the person clicked) when the record arrives. This Mac's record with a known project is filed by it, as before.
  describe('a record at a listed address whose project the registry places', () => {
    const listingAt = (machine: MachineRef, session: string, orgKey: OrgKey | null, project: string | null): ListedSession =>
      ({ ...remoteRow(machine, session, { orgKey, project }), appId: addressOf(machine, session) as AppSessionId });
    const held = sessionOn(OTHER_MACHINE, 'b1', { projectId: there('scrape') as ProjectId }); // its folder is the registry's location on B
    const filed = (records: SessionRecord[], listing: ListedSession) =>
      projectList(input({ records: new Map(records.map((r) => [r.appId, r])), digests: new Map(), projects: all, rows: [], registry, listed: new Map([[listing.appId, listing]]) }))
        .filter((e) => e.sessions.length + e.listed.length > 0)
        .map((e) => [e.key, e.sessions.map((r) => r.appId), e.listed.map((l) => l.appId)]);

    it('keeps another machine’s session under its machine’s row when its listing’s key is none of the key table’s', () => {
      const listing = listingAt(OTHER_MACHINE, 'b1', null, null);
      expect(filed([], listing), 'listed only').toEqual([[machineKey(OTHER_MACHINE), [], [there('b1')]]]);
      expect(filed([held], listing), 'its record held').toEqual([[machineKey(OTHER_MACHINE), [there('b1')], []]]);
    });

    it('files it under the registry project’s row when its listing and the registry agree on the key', () => {
      const listing = listingAt(OTHER_MACHINE, 'b1', `id:${AWAY_ID}` as OrgKey, AWAY_ID);
      expect(filed([], listing), 'listed only').toEqual([[`id:${AWAY_ID}`, [], [there('b1')]]]);
      expect(filed([held], listing), 'its record held').toEqual([[`id:${AWAY_ID}`, [there('b1')], []]]);
    });

    it('files this Mac’s record by its known project, a listing at its address notwithstanding', () => {
      const mine = sessionOn(TEST_MACHINE, 'a1', { projectId: app.id });
      expect(filed([mine], listingAt(TEST_MACHINE, 'a1', null, null))).toEqual([['remote:example.org/app', [addr('a1')], []]]);
    });
  });

  it('signed out, rows are as before: by label, naming no registry and no machine beyond their checkouts', () => {
    const entries = projectList(input({ records: new Map(), digests: new Map(), projects: mapOf([app]), rows: [] }));
    expect(entries.map((e) => [e.key, e.name, e.machines, e.registry])).toEqual([['remote:example.org/app', 'app', [TEST_MACHINE], null]]);
  });
});
