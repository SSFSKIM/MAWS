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
import { orgIndex } from '../stores/org-projects';
import type { ListedSession } from '../stores/sessions';
import { TEST_MACHINE, OTHER_MACHINE } from '../../../../test/support/machine';
import { channelEntries, channelProjectName, waitingFor, type ChannelEntry } from './project';

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
  { session: A, alias: 'maws-45', machine: 'mini', title: 'Fix the relay', member: true },
  { session: B, alias: 'ci-opt', machine: 'build-vm', title: null, member: true },
  { session: C, alias: 'third', machine: 'mini', title: 'A third', member: false },
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

  it('names the project by its smnsId', () => {
    const mine = local('p1', KEY, SMNS);
    const index = orgIndex([mine], TEST_MACHINE);
    expect(channelProjectName(index, SMNS)).toBe('maws');
    expect(channelProjectName(index, 'nobody')).toBeNull();
  });
});
