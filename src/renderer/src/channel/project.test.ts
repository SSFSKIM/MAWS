// The channel's projection (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's *Folding* and
// Proves: "exchanges and broadcasts fold; a third party ends an exchange; one message unfolded; titles and machines from
// lifecycle events; the waiting section filtered to the project").
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { ChannelEvent, ChannelSession, OrgMember } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { orgIndex, type RowKey } from '../stores/org-projects';
import { EMPTY_REGISTRY, registryRecords, type OrgProjects } from '../stores/registry';
import type { ListedSession } from '../stores/sessions';
import { TEST_MACHINE, OTHER_MACHINE } from '../../../../test/support/machine';
import { channelEntries, channelOfRow, channelProjectName, channelProjects, placeByTime, toHumanEntries, waitingFor, type ChannelEntry, type StreamEntry, type ToHumanEntry } from './project';
import type { ChannelHost, ChannelMachine } from '@shared/ipc/schema/org';
import { record as recordOf, remoteRow } from '../../../../test/support/builders';

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const C = 'cccccccc-3333-4333-8333-cccccccccccc';
const SMNS = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const T = (minutes: number) => new Date(Date.UTC(2026, 10, 6, 12, 0, 0) + minutes * 60_000).toISOString();
const OWNER: OrgMember = { id: 'owner0000000000000000000000000000', email: 'sam.owner@example.com', name: 'Sam' };
const ANA: OrgMember = { id: 'ana00000000000000000000000000000', email: 'ana@example.com', name: 'Ana' };

let offset = 0;
/** An event as main sends it: a machine writer's `session` named, as cache.ts names it (an audience stream's suffix off). */
const ev = (event: Record<string, unknown>, extra: Partial<ChannelEvent> = {}): ChannelEvent => {
  offset += 1;
  const writer = String(event.writer);
  const session = writer.startsWith('hub/') ? undefined : writer.slice(writer.indexOf('/') + 1).replace(/~[0-9a-f]{16}$/, '');
  return { offset, writer, seq: offset, ...(session === undefined ? {} : { session }), event: { seq: offset, ...event }, label: 'verified', ...extra };
};
const say = (from: string, to: '*' | string[], minute: number, text = `from ${from.slice(0, 1)} at ${minute}`, extra: Partial<ChannelEvent> = {}, writer = `mini/${from}`) =>
  ev({ kind: 'say', writer, from: from.slice(0, 1), to: to === '*' ? '*' : to.map((s) => ({ session: s, alias: `alias-${s.slice(0, 1)}` })), text, ts: T(minute) }, { owners: [OWNER], ...extra });
const human = (member: OrgMember, minute: number, text: string, extra: Record<string, unknown> = {}) =>
  ev({ kind: 'human', writer: `hub/${member.id}`, from: 'human', member: member.id, to: '*', text, ts: T(minute), ...extra }, { author: member });
const sessions: ChannelSession[] = [
  { session: A, alias: 'maws-45', machine: 'mini', title: 'Fix the relay', member: true, authenticated: true },
  { session: B, alias: 'ci-opt', machine: 'build-vm', title: null, member: true, authenticated: true },
  { session: C, alias: 'third', machine: 'mini', title: 'A third', member: false, authenticated: true },
];
const project = (events: ChannelEvent[], rest: Partial<Parameters<typeof channelEntries>[0]> = {}) => channelEntries({ events, sessions, tail: [], me: null, ...rest });
const kinds = (entries: ChannelEntry[]) => entries.map((e) => (e.kind === 'exchange' ? `exchange:${e.count}` : e.kind));

describe('channelEntries: folding', () => {
  it('folds a run of says between the same two sessions into one exchange, its parties named with their titles and machines', () => {
    const entries = project([say(A, [B], 0), say(B, [A], 2), say(A, [B], 5)]);
    expect(kinds(entries)).toEqual(['exchange:3']);
    const [x] = entries;
    if (x.kind !== 'exchange') throw new Error('not an exchange');
    expect(x.between).toEqual([
      { session: A, alias: 'maws-45', title: 'Fix the relay', machine: 'mini' },
      { session: B, alias: 'ci-opt', title: null, machine: 'build-vm' },
    ]);
    expect(x.first).toBe(T(0));
    expect(x.last).toBe(T(5));
    expect(x.says.map((s) => s.text)).toEqual(['from a at 0', 'from b at 2', 'from a at 5']);
    expect(x.offsets).toEqual(x.says.map((s) => s.offset));
  });

  it('draws an exchange of one message as the message itself, with its owners', () => {
    const [entry] = project([say(A, [B], 0, 'hello')]);
    expect(entry).toMatchObject({ kind: 'say', text: 'hello', from: { alias: 'maws-45' }, to: [{ alias: 'ci-opt' }], owners: [OWNER], label: 'verified' });
  });

  it('a third session’s say ends the exchange, as does a gap past ten minutes either way', () => {
    expect(kinds(project([say(A, [B], 0), say(A, [B], 1), say(C, [A], 2), say(A, [B], 3), say(B, [A], 4)]))).toEqual(['exchange:2', 'say', 'exchange:2']);
    expect(kinds(project([say(A, [B], 0), say(B, [A], 10), say(A, [B], 21)]))).toEqual(['exchange:2', 'say']);
    // the log's order is the hub's; a timestamp far behind the last (a machine's skewed clock) is no part of its run
    expect(kinds(project([say(A, [B], 30), say(B, [A], 25), say(A, [B], 5)]))).toEqual(['exchange:2', 'say']);
  });

  it('reads an audience stream’s writer as its session: their exchange folds, each party named with its title', () => {
    const DIGEST = '0123456789abcdef';
    const entries = project([say(A, [B], 0, 'scoped one', {}, `mini/${A}~${DIGEST}`), say(B, [A], 1, 'scoped two', {}, `build-vm/${B}~fedcba9876543210`), say(A, [B], 2, 'plain', {}, `mini/${A}`)]);
    expect(kinds(entries)).toEqual(['exchange:3']);
    expect(entries[0]).toMatchObject({ between: [{ session: A, alias: 'maws-45', title: 'Fix the relay' }, { session: B, alias: 'ci-opt', machine: 'build-vm' }] });
  });

  it('folds a session’s broadcasts in the window as messages to everyone, apart from its exchanges', () => {
    const entries = project([say(A, '*', 0), say(A, '*', 3), say(A, '*', 4), say(A, [B], 5)]);
    expect(kinds(entries)).toEqual(['exchange:3', 'say']);
    expect(entries[0]).toMatchObject({ kind: 'exchange', between: [{ alias: 'maws-45' }, 'everyone'] });
    expect(kinds(project([say(A, '*', 0), say(B, '*', 1)]))).toEqual(['say', 'say']);
  });

  it('people’s words and earlier to-human entries end a run; lifecycle, tombstone-free state and unlisted events draw nothing and end none', () => {
    const entries = project([
      say(A, [B], 0),
      ev({ kind: 'joined', writer: `mini/${C}`, session: C, alias: 'third', machine: 'mini', ts: T(1) }),
      ev({ kind: 'state', writer: `mini/${A}`, session: A, state: 'busy', ts: T(1) }),
      ev({ kind: 'unlisted', writer: `mini/${A}`, session: A, ts: T(1) }),
      say(B, [A], 2),
      human(OWNER, 3, 'what is going on?'),
      say(A, [B], 4),
      ev({ kind: 'message', writer: `mini/${A}`, from: 'maws-45', text: 'Done with the relay', ts: T(5) }),
    ]);
    expect(kinds(entries)).toEqual(['exchange:2', 'words', 'say', 'host']);
  });

  it('folds only events of one label: a migrated run and a verified one stay apart, each labelled', () => {
    const entries = project([say(A, [B], 0, 'old', { label: 'migrated', by: 'mini' }), say(B, [A], 1, 'old too', { label: 'migrated', by: 'mini' }), say(A, [B], 2, 'new')]);
    expect(entries.map((e) => [e.kind, e.label, e.by])).toEqual([
      ['exchange', 'migrated', 'mini'],
      ['say', 'verified', undefined],
    ]);
    expect(project([say(A, [B], 0, 'x', { label: 'legacy' })])[0]).toMatchObject({ kind: 'say', label: 'legacy' });
  });

  // the branch re-review's finding: a legacy lifecycle (a phase-1 code nothing checks) names only legacy entries
  it('never names a verified or migrated entry by a session whose only lifecycle is legacy: it draws as a session the lifecycle does not name', () => {
    const lone = 'dddddddd-4444-4444-8444-dddddddddddd';
    const forged: ChannelSession = { session: lone, alias: 'forged-alias', machine: 'forged-machine', title: 'A forged title', member: false, authenticated: false };
    const withForged = { sessions: [...sessions, forged] };
    const verified = ev({ kind: 'say', writer: `studio/${lone}`, from: 'studio-1', to: [{ session: lone, alias: 'signed-alias' }], text: 'signed', ts: T(0) });
    const [entry] = project([verified], withForged);
    expect(entry).toMatchObject({ kind: 'say', label: 'verified', from: { session: lone, alias: 'studio-1', title: null, machine: 'studio' }, to: [{ session: lone, alias: 'signed-alias', title: null, machine: null }] });
    const toForged = project([say(A, [lone], 1, 'to it', { label: 'migrated', by: 'mini' })], withForged)[0];
    expect(toForged).toMatchObject({ kind: 'say', to: [{ session: lone, alias: `alias-${lone.slice(0, 1)}`, title: null, machine: null }] });
    expect(JSON.stringify([entry, toForged])).not.toMatch(/forged/);
    // a legacy entry of that session is named by its legacy lifecycle, as legacy
    const old = ev({ kind: 'say', writer: `oldmini/${lone}`, from: 'old', to: '*', text: 'before the move', ts: T(2) }, { label: 'legacy' });
    expect(project([old], withForged)[0]).toMatchObject({ kind: 'say', label: 'legacy', from: { alias: 'forged-alias', machine: 'forged-machine', title: 'A forged title' } });
  });

  it('names a session the lifecycle does not by its event’s alias and its writer’s machine', () => {
    const lone = 'dddddddd-4444-4444-8444-dddddddddddd';
    const [entry] = project([ev({ kind: 'say', writer: `oldmini/${lone}`, from: 'stray', to: [{ session: B, alias: 'ci-opt' }], text: 'hi', ts: T(0) })]);
    expect(entry).toMatchObject({ kind: 'say', from: { session: lone, alias: 'stray', title: null, machine: 'oldmini' }, owners: [] });
  });
});

describe('channelEntries: people’s words', () => {
  it('draws a device’s words by its member, you as You, with their recipients', () => {
    const to = [{ session: A, alias: 'maws-45' }];
    const entries = project([human(ANA, 0, 'hi all'), human(OWNER, 1, '@maws-45 status?', { to })], { me: OWNER.id });
    expect(entries).toMatchObject([
      { kind: 'words', member: ANA.id, name: 'Ana', you: false, to: '*', text: 'hi all', at: T(0), label: 'verified' },
      { kind: 'words', member: OWNER.id, name: 'You', you: true, to, text: '@maws-45 status?' },
    ]);
  });

  it('a migrated word with no author is named by its member id', () => {
    const [entry] = project([ev({ kind: 'human', writer: 'hub/legacy', from: 'human', member: ANA.id, to: '*', text: 'from before', ts: T(0) }, { label: 'migrated', by: 'mini' })]);
    expect(entry).toMatchObject({ kind: 'words', name: 'member ana00000', label: 'migrated', by: 'mini' });
  });

  it('draws the words not yet in the log after it, in order, each in its state', () => {
    const entries = project([say(A, [B], 0)], {
      me: OWNER.id,
      tail: [
        { key: 'n1', text: 'one', to: '*', state: 'sending' },
        { key: 'n2', text: 'two', to: '*', state: { refused: 'not-reachable' } },
        { key: 'n3', text: 'three', to: '*', state: 'not-sent' },
      ],
    });
    expect(entries.slice(1)).toMatchObject([
      { kind: 'words', key: 't:n1', name: 'You', you: true, text: 'one', offset: null, at: null, state: 'sending' },
      { kind: 'words', key: 't:n2', text: 'two', state: { refused: 'not-reachable' } },
      { kind: 'words', key: 't:n3', text: 'three', state: 'not-sent' },
    ]);
  });
});

describe('channelEntries: earlier to-human entries', () => {
  it('draws a message, a question with its choices and an answer, each by its session', () => {
    const entries = project([
      ev({ kind: 'message', writer: `mini/${A}`, from: 'maws-45', text: 'Relay fixed', ts: T(0) }),
      ev({ kind: 'question', writer: `mini/${A}`, from: 'maws-45', text: ['Ship it?', 'Now?'], choices: ['yes', 'no'], src: 'q1', ts: T(1) }),
      ev({ kind: 'answered', writer: `mini/${A}`, from: 'maws-45', text: 'yes', src: 'q1', ts: T(2) }),
    ]);
    expect(entries).toMatchObject([
      { kind: 'host', host: 'message', text: 'Relay fixed', party: { alias: 'maws-45', title: 'Fix the relay', machine: 'mini' } },
      { kind: 'host', host: 'question', text: 'Ship it?\n\nNow?', choices: ['yes', 'no'] },
      { kind: 'host', host: 'answered', text: 'yes' },
    ]);
  });
});

describe('waitingFor', () => {
  const KEY = `smns:${SMNS}` as OrgKey;
  const local = (id: string, key: OrgKey | null, smnsId: string | null): ProjectRecord =>
    ({ id: addressOf(TEST_MACHINE, id), name: 'maws', directory: `/w/${id}`, hidden: false, discovered: false, org: key === null ? null : { key, name: 'maws', smnsId } }) as unknown as ProjectRecord;
  const record = (id: string, projectId: string | null): SessionRecord => ({ appId: addressOf(TEST_MACHINE, id), projectId }) as unknown as SessionRecord;
  const item = (appSessionId: string, id: string, over: Partial<AttentionItem> = {}): AttentionItem =>
    ({ id: id as AttentionId, appSessionId: appSessionId as AppSessionId, kind: 'permission', state: 'pending', createdAt: T(Number(id.slice(1))), request: { requestId: `r-${id}`, toolUseId: null, taskId: null, agentId: null }, ...over }) as unknown as AttentionItem;

  it('takes the project’s sessions’ open requests, local and listed, oldest first, and leaves out other projects, greyed machines and notices', () => {
    const mine = local('p1', KEY, SMNS);
    const other = local('p2', 'smns:other' as OrgKey, 'other');
    const projects = new Map<ProjectId, ProjectRecord>([[mine.id, mine], [other.id, other]]);
    const index = orgIndex(projects.values(), TEST_MACHINE);
    const s1 = record('s1', mine.id);
    const s2 = record('s2', other.id);
    const remote = addressOf(OTHER_MACHINE, 'r1') as AppSessionId;
    const grey = addressOf(OTHER_MACHINE, 'g1') as AppSessionId;
    const listed = new Map<AppSessionId, ListedSession>([
      [remote, { machine: OTHER_MACHINE, orgKey: KEY } as unknown as ListedSession],
      [grey, { machine: OTHER_MACHINE, orgKey: KEY } as unknown as ListedSession],
    ]);
    const bySession = new Map<AppSessionId, AttentionItem[]>([
      [s1.appId, [item(s1.appId, 'i3'), item(s1.appId, 'i9', { state: 'retired' }), item(s1.appId, 'i8', { kind: 'error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } })]],
      [s2.appId, [item(s2.appId, 'i1')]],
      [remote, [item(remote, 'i2', { kind: 'question' })]],
      [grey, [item(grey, 'i4')]],
    ]);
    const found = waitingFor({ project: SMNS, index, projects, records: new Map([[s1.appId, s1], [s2.appId, s2]]), listed, bySession, greyed: new Set([grey]) });
    expect(found.map((i) => i.id)).toEqual(['i2', 'i3']);
    expect(waitingFor({ project: 'nobody', index, projects, records: new Map(), listed, bySession, greyed: new Set() })).toEqual([]);
  });

  // UC-1 (A17): the project channel's waiting cards read the one predicate, so an answered request has no card
  it('takes no request whose answer was delivered', () => {
    const mine = local('p1', KEY, SMNS);
    const s1 = record('s1', mine.id);
    const bySession = new Map<AppSessionId, AttentionItem[]>([[s1.appId, [item(s1.appId, 'i3', { state: 'delivered' })]]]);
    expect(waitingFor({ project: SMNS, index: orgIndex([mine], TEST_MACHINE), projects: new Map([[mine.id, mine]]), records: new Map([[s1.appId, s1]]), listed: new Map(), bySession, greyed: new Set() })).toEqual([]);
  });

  // ticket 644: another machine's session whose folder is the registry's location there is the project's as the sidebar
  // files it: by its listing, so not while its listing's key is none of the key table's (its machine's row holds it)
  it('takes another machine’s session as the sidebar files it, by its listing, though the registry knows its project', () => {
    const registry: OrgProjects = {
      ...EMPTY_REGISTRY,
      projects: [{ id: SMNS, name: 'maws', hub: true, renamable: true, locations: [{ machine: OTHER_MACHINE, pid: 'p9', path: '/w/p9', key: KEY, name: 'maws', source: 'remote', acts: true }] }],
      keys: { [SMNS]: KEY },
    };
    const projects = registryRecords(registry, TEST_MACHINE);
    const index = orgIndex(projects.values(), TEST_MACHINE, registry);
    const held = { appId: addressOf(OTHER_MACHINE, 'r1'), projectId: addressOf(OTHER_MACHINE, 'p9') } as unknown as SessionRecord;
    const bySession = new Map<AppSessionId, AttentionItem[]>([[held.appId, [item(held.appId, 'i5')]]]);
    const waiting = (orgKey: OrgKey | null) => waitingFor({
      project: SMNS, index, projects, records: new Map([[held.appId, held]]),
      listed: new Map([[held.appId, { machine: OTHER_MACHINE, orgKey } as unknown as ListedSession]]), bySession, greyed: new Set(),
    }).map((i) => i.id);
    expect(waiting(null), 'its listing’s key is none of the table’s').toEqual([]);
    expect(waiting(KEY), 'listing and registry agree').toEqual(['i5']);
  });

  it('names the project by its smnsId', () => {
    const mine = local('p1', KEY, SMNS);
    const index = orgIndex([mine], TEST_MACHINE);
    expect(channelProjectName(index, SMNS)).toBe('maws');
    expect(channelProjectName(index, 'nobody')).toBeNull();
  });
});

// UX wave U11a M5 (S-10; Interfaces §F, "The Channel's entries"): the projects that have a channel, as the sidebar's menus
// answer it (has-channel.test.tsx holds the two equal on the sidebar itself).
describe('channelProjects and channelOfRow', () => {
  const HUB = '2a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
  const LOCAL = '3b4c5d6e-7f80-4192-a3a4-b5c6d7e8f9a0';
  const SEEN = '4c5d6e7f-8091-4203-b4b5-c6d7e8f9a0b1';
  const QUIET = '5d6e7f80-91a2-4314-c5c6-d7e8f9a0b1c2';
  const checkout = (id: string, name: string, org: { key: string; smnsId: string | null } | null, over: Partial<ProjectRecord> = {}): ProjectRecord =>
    ({ id: addressOf(TEST_MACHINE, id), name, directory: `/w/${id}`, order: 0, createdAt: T(0), org: org === null ? undefined : { ...org, name, source: org.smnsId === null ? 'folder' : 'smns' }, ...over }) as unknown as ProjectRecord;
  const registry: OrgProjects = {
    projects: [
      { id: HUB, name: 'Orchard', hub: true, renamable: false, locations: [] },
      { id: LOCAL, name: 'Ledger', hub: false, renamable: true, locations: [] },
      { id: SEEN, name: 'Reports', hub: true, renamable: false, locations: [] },
      { id: QUIET, name: 'Quiet', hub: false, renamable: false, locations: [] },
    ],
    keys: { [HUB]: `smns:${HUB}` as OrgKey, [LOCAL]: `smns:${LOCAL}` as OrgKey, [SEEN]: `id:${SEEN}` as OrgKey, [QUIET]: `id:${QUIET}` as OrgKey },
    moved: {},
    removals: [],
    seen: {},
  };
  const records = [
    checkout('p-north', 'northwind', { key: `smns:${SMNS}`, smnsId: SMNS }), // a .smns project the registry does not hold
    checkout('p-orchard', 'Orchard', { key: `smns:${HUB}`, smnsId: HUB }), // a hub project of the registry
    checkout('p-ledger', 'Ledger', { key: `smns:${LOCAL}`, smnsId: LOCAL }), // a registry project kept off the hub
    checkout('p-scratch', 'scratch', { key: 'folder:/w/p-scratch', smnsId: null }), // a folder with no project id
    checkout('p-hidden', 'hidden', { key: 'smns:hidden-one', smnsId: 'hidden-one' }, { hidden: true }), // no row: hidden
    checkout('p-north-2', 'northwind (copy)', { key: 'smns:north-copy', smnsId: SMNS }), // a second row of the same id
  ];
  const index = orgIndex(records, TEST_MACHINE, registry);

  it('lists each project of a shown row that has a channel once, by its row’s name, in name order', () => {
    expect(channelProjects(index)).toEqual([
      { project: SMNS, name: 'northwind' },
      { project: HUB, name: 'Orchard' },
      { project: SEEN, name: 'Reports' },
    ]);
  });

  it('answers a row’s channel: a hub project’s id, a .smns project’s id, and null for a project kept off the hub, a folder or a key no row has', () => {
    const rowOf = (record: ProjectRecord) => index.keyOf(record);
    expect(channelOfRow(rowOf(records[0]), index)).toBe(SMNS);
    expect(channelOfRow(rowOf(records[1]), index)).toBe(HUB);
    expect(channelOfRow(rowOf(records[2]), index)).toBeNull();
    expect(channelOfRow(rowOf(records[3]), index)).toBeNull();
    expect(channelOfRow(`id:${SEEN}` as RowKey, index)).toBe(SEEN);
    expect(channelOfRow(`id:${QUIET}` as RowKey, index)).toBeNull();
    expect(channelOfRow('smns:nobody' as RowKey, index)).toBeNull();
  });

  it('lists nothing signed out of every project id', () => {
    expect(channelProjects(orgIndex([records[3]], TEST_MACHINE))).toEqual([]);
  });
});

// M7b (Interfaces §O; M7b's Renderer bullet): every machine's to-human entries, each named by its session's title and its
// machine, a question with its choices and its answer, one ask's questions grouped by their `ask/<askId>/` src, "as of"
// on an offline machine's and greyed on an unavailable one's, placed by time among the log's entries.
describe('the to-human entries', () => {
  const lb = (app: string, ...anchor: string[]) => [SMNS, 'lane-b', app, ...anchor].map(encodeURIComponent).join('/');
  let n = 0;
  const host = (machine: typeof TEST_MACHINE, minute: number, over: Partial<ChannelHost> = {}): ChannelHost => {
    n += 1;
    const id = over.id ?? `e${n}`;
    return { key: `${machine} ${id}`, machine, id, lane: 'A', session: A, kind: 'message', text: `said at ${minute}`, at: T(minute), src: `${SMNS}/mini%2F${A}/${n}`, order: n, ...over };
  };
  const live = (machine: typeof TEST_MACHINE, name: string, over: Partial<ChannelMachine> = {}): ChannelMachine => ({ machine, name, state: 'live', asOf: T(0), ...over });
  const MACHINES = [live(TEST_MACHINE, 'MacBook'), live(OTHER_MACHINE, 'mini')];
  const mine = recordOf(addressOf(TEST_MACHINE, 'app-1'), { title: { text: 'Local chat', source: 'user' } });
  const theirs: ListedSession = { ...remoteRow(OTHER_MACHINE, 'app-2', { title: 'Studio build' }), appId: addressOf(OTHER_MACHINE, 'app-2' as AppSessionId) };
  const named = (hosts: ChannelHost[], machines = MACHINES) =>
    toHumanEntries({ hosts, machines, sessions, records: new Map([[mine.appId, mine]]), listed: new Map([[theirs.appId, theirs]]) });

  it('names a lane A session by its lifecycle’s alias and title, a lane B one by its record or its listing, with its machine', () => {
    const entries = named([
      host(OTHER_MACHINE, 1),
      host(TEST_MACHINE, 2, { lane: 'B', session: 'app-1' }),
      host(OTHER_MACHINE, 3, { lane: 'B', session: 'app-2' }),
      host(OTHER_MACHINE, 4, { session: 'dddddddd-4444-4444-8444-dddddddddddd' }),
    ]);
    expect(entries.map((e) => [e.machine, e.machineName, e.name, e.title])).toEqual([
      [OTHER_MACHINE, 'mini', 'maws-45', 'Fix the relay'],
      [TEST_MACHINE, 'MacBook', 'Local chat', null],
      [OTHER_MACHINE, 'mini', 'Studio build', null],
      [OTHER_MACHINE, 'mini', 'dddddddd', null],
    ]);
    // a machine the channel's list doesn't hold has no name of its own here: the chip reads the roster's
    expect(named([host(OTHER_MACHINE, 1)], [live(TEST_MACHINE, 'MacBook')]).map((e) => e.machineName)).toEqual([null]);
    expect(entries.every((e) => e.kind === 'to-human' && e.host === 'message' && e.asOf === null && !e.greyed)).toBe(true);
  });

  it('draws a question with its choices and its answer, groups one ask’s questions by their ask/<askId>/ src, and keeps an answer to no question held on its own', () => {
    const app = { lane: 'B' as const, session: 'app-1' };
    const entries = named([
      host(TEST_MACHINE, 1, { ...app, kind: 'question', text: 'Which branch?', choices: ['main', 'dev'], src: lb('app-1', 'ask', 'k1', 'q1') }),
      host(TEST_MACHINE, 1, { ...app, kind: 'question', text: 'Ship it?', src: lb('app-1', 'ask', 'k1', 'q2') }),
      host(TEST_MACHINE, 2, { ...app, kind: 'question', text: 'Another ask', src: lb('app-1', 'ask', 'k2', 'q1') }),
      host(TEST_MACHINE, 3, { ...app, kind: 'answered', text: 'main', src: lb('app-1', 'ask', 'k1', 'q1', 'answered') }),
      host(TEST_MACHINE, 4, { ...app, kind: 'question', text: 'Need input?', choices: ['yes'], src: lb('app-1', 'text', 'u1', '0', 'q0') }),
      host(TEST_MACHINE, 5, { ...app, kind: 'answered', text: 'yes', src: lb('app-1', 'answer', 'u1', '0', 'q0', T(5)) }),
      host(OTHER_MACHINE, 6, { ...app, session: 'app-2', kind: 'answered', text: 'not this machine’s', src: lb('app-1', 'ask', 'k2', 'q1', 'answered') }),
      host(OTHER_MACHINE, 7, { kind: 'answered', text: 'lane A answers stand alone' }),
    ]);
    const drawn = entries.map((e) => (e.host === 'question' ? ['question', e.questions.map((q) => [q.text, q.choices, q.answer?.text ?? null])] : [e.host, e.text]));
    expect(drawn).toEqual([
      ['question', [['Which branch?', ['main', 'dev'], 'main'], ['Ship it?', [], null]]],
      ['question', [['Another ask', [], null]]],
      ['question', [['Need input?', ['yes'], 'yes']]],
      ['answered', 'not this machine’s'],
      ['answered', 'lane A answers stand alone'],
    ]);
    const first = entries[0] as Extract<ToHumanEntry, { host: 'question' }>;
    expect(first.questions[0].answer).toEqual({ text: 'main', at: T(3) });
  });

  it('marks an offline or read-once machine’s entries "as of" its time, an unavailable one’s greyed, a live one’s neither', () => {
    const entries = named(
      [host(TEST_MACHINE, 1), host(OTHER_MACHINE, 2), host(OTHER_MACHINE, 3, { machine: 'ThirdMachineRef0000000' as typeof TEST_MACHINE, key: 'third e' })],
      [live(TEST_MACHINE, 'MacBook'), live(OTHER_MACHINE, 'mini', { state: 'offline', asOf: T(40) }), live('ThirdMachineRef0000000' as typeof TEST_MACHINE, 'old', { state: 'unavailable', asOf: T(9) })],
    );
    expect(entries.map((e) => [e.asOf, e.greyed])).toEqual([
      [null, false],
      [T(40), false],
      [T(9), true],
    ]);
  });

  it('places them by time among the log’s entries, before the words the log doesn’t hold yet', () => {
    const log = project([human(OWNER, 1, 'first'), say(A, [B], 5), human(ANA, 10, 'later')], { tail: [{ key: 'n1', text: 'mine', to: '*', state: 'sending' }] });
    const toHuman = named([host(OTHER_MACHINE, 3, { text: 'at 3' }), host(OTHER_MACHINE, 7, { text: 'at 7' }), host(OTHER_MACHINE, 20, { text: 'at 20' })]);
    const placed: StreamEntry[] = placeByTime(log, toHuman);
    expect(placed.map((e) => (e.kind === 'to-human' ? `to-human:${e.at}` : e.kind === 'words' && e.offset === null ? 'tail' : `${e.kind}`))).toEqual([
      'words',
      `to-human:${T(3)}`,
      'say',
      `to-human:${T(7)}`,
      'words',
      `to-human:${T(20)}`,
      'tail',
    ]);
    expect(placeByTime([], toHuman)).toEqual(toHuman);
  });
});
