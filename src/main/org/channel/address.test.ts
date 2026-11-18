// Whom the owner's words address (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "People's
// words, sent"): a leading `@alias` names that session of the project, as `sminos say` reads tags, and untagged words go
// to everyone. The project's sessions are what its log's lifecycle events say: each session's latest `joined`,
// `retired`, `renamed` and `titled` from its own writer, by offset.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addressOf, isStamped, isUnstampedEnd, lifecycleOf, projectSessions } from './address';

/** The shared vectors' `retired` cases (apps/org-protocol/vectors/channel-rule.json), read as the file sminos copies. */
type ChannelRuleEvent = { kind: 'joined' | 'retired'; reason?: string; thread?: string };
const CHANNEL_RULE = JSON.parse(readFileSync(join(__dirname, '../../../../apps/org-protocol/vectors/channel-rule.json'), 'utf8')) as {
  retired: { name: string; steps: { event: ChannelRuleEvent; member: boolean }[] }[];
};

const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
const S3 = 'a2cf35be-3ade-47df-b6ab-d08753367102';
const joined = (session: string, alias: string, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 1, kind: 'joined', session, alias, machine });
const retired = (session: string, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 2, kind: 'retired', session, by: '', reason: 'ended' });
const renamed = (session: string, alias: string, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 3, kind: 'renamed', session, alias, name_source: 'user' });
const titled = (session: string, title: unknown, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 4, kind: 'titled', session, title });
type Logged = Record<string, unknown> & { writer: string };
/** The events at offsets 1, 2, …, in the order given, verified. */
const logged = (...events: Logged[]) => events.map((event, i) => ({ offset: i + 1, event, verdict: { label: 'verified' as const } }));

describe('the sessions a project log names', () => {
  it("keeps each session's latest membership, alias and title, from its own writer only", () => {
    const sessions = projectSessions(
      logged(joined(S1, 'maws-45'), joined(S2, 'ci-opt'), retired(S2), joined(S1, 'maws-46'), { ...joined(S3, 'forged'), writer: `mini/${S1}` }, titled(S1, '  the channel  '), renamed(S2, 'ci-opt-2', 'mini'), titled(S2, 42)),
    );
    expect(sessions).toEqual([
      { session: S1, alias: 'maws-46', machine: 'mini', title: 'the channel', member: true, authenticated: true },
      { session: S2, alias: 'ci-opt-2', machine: 'mini', title: null, member: false, authenticated: true },
    ]);
  });

  it('reads them by offset, whatever order they are given in', () => {
    const [a, b, c] = logged(joined(S1, 'maws-45'), retired(S1), joined(S1, 'maws-46'));
    expect(projectSessions([c, a, b])).toEqual([{ session: S1, alias: 'maws-46', machine: 'mini', title: null, member: true, authenticated: true }]);
  });

  it('reads an authenticated lifecycle alone when a session has one; a legacy one names a session without one, never a member, and says which', () => {
    const legacy = { label: 'legacy' as const };
    const [join, rename] = logged(joined(S1, 'maws-45'), renamed(S1, 'maws-46'));
    const entries = [
      join,
      { offset: 2, event: renamed(S1, 'hijacked'), verdict: legacy },
      { offset: 3, event: joined(S1, 'hijacked', 'mini'), verdict: legacy },
      { ...rename, offset: 4, verdict: { label: 'migrated' as const, by: 'mini' } },
      { offset: 5, event: titled(S1, 'forged'), verdict: legacy },
      { offset: 6, event: joined(S2, 'old-one'), verdict: legacy },
      { offset: 7, event: joined(S3, 'failed'), verdict: { failed: 'signature' } },
    ];
    const sessions = projectSessions(entries);
    expect(sessions).toEqual([
      { session: S1, alias: 'maws-46', machine: 'mini', title: null, member: true, authenticated: true },
      { session: S2, alias: 'old-one', machine: 'mini', title: null, member: false, authenticated: false },
    ]);
    expect(addressOf('@old-one hi', sessions)).toEqual({ ok: false, reason: 'no-member', detail: '@old-one' });
  });

  it('names the lifecycle an event is: its session and kind, from its own writer', () => {
    expect(lifecycleOf(joined(S1, 'maws-45'))).toEqual({ session: S1, kind: 'joined' });
    expect(lifecycleOf(titled(S1, 'x'))).toEqual({ session: S1, kind: 'titled' });
    expect(lifecycleOf({ ...joined(S3, 'forged'), writer: `mini/${S1}` })).toBeNull();
    expect(lifecycleOf({ writer: `mini/${S1}`, seq: 1, kind: 'say', session: S1 })).toBeNull();
  });
});

// sminos's threads (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md, Interfaces §G; the design's D7): a
// `retired` with reason `ended` and no `thread` is what a sminos from before threads writes when a thread's process
// ends, and it is passed by for a session whose latest `joined` carries its thread. Every other `retired` is honoured.
describe("a stopped thread's membership", () => {
  const THREAD = '11111111-1111-4111-8111-111111111111';
  /** One shared event as S1's own, from its own writer, with what each kind carries beside the fields the rule reads. */
  const asS1 = (event: ChannelRuleEvent, seq: number): Logged =>
    event.kind === 'joined' ? { ...joined(S1, 'maws-45'), seq, ...event } : { writer: `mini/${S1}`, seq, session: S1, by: '', ...event };
  /** S1's membership once the events are read, verified, at rising offsets. */
  const memberAfter = (events: Logged[]) => projectSessions(logged(...events)).find((s) => s.session === S1)?.member;
  const stampedJoin = { kind: 'joined', thread: THREAD } as const;
  const unstampedEnd = { kind: 'retired', reason: 'ended' } as const;

  for (const { name, steps } of CHANNEL_RULE.retired) {
    it(`passes the shared case: ${name}`, () => {
      const events = steps.map((s, i) => asS1(s.event, i + 1));
      expect(steps.map((_, i) => memberAfter(events.slice(0, i + 1)))).toEqual(steps.map((s) => s.member));
    });
  }

  it('reads the latest joined: an unstamped one after a stamped one leaves an unstamped end honoured', () => {
    expect(memberAfter([asS1(stampedJoin, 1), asS1({ kind: 'joined' }, 2), asS1(unstampedEnd, 3)])).toBe(false);
  });

  it('honours every other unstamped retired after a stamped joined', () => {
    for (const reason of ['moved', 'continued', 'retire']) expect(memberAfter([asS1(stampedJoin, 1), asS1({ kind: 'retired', reason }, 2)]), reason).toBe(false);
    expect(memberAfter([asS1(stampedJoin, 1), asS1({ kind: 'retired', reason: 'moved' }, 2), asS1(unstampedEnd, 3)])).toBe(false);
  });

  it('reads the entries by offset before the rule, whatever order they are given in', () => {
    // A `moved`, then a stamped `joined`, then an unstamped `ended`: a member, read by offset. Read in the order given
    // (joined, ended, moved), the `moved` would come last and end the membership.
    const [moved, join, end] = logged(asS1({ kind: 'retired', reason: 'moved' }, 1), asS1(stampedJoin, 2), asS1(unstampedEnd, 3));
    expect(projectSessions([join, end, moved]).map((s) => s.member)).toEqual([true]);
  });

  it('reads the joined of the provenance the session is read from: a legacy stamped joined passes no end by', () => {
    const [join, end] = logged(joined(S1, 'maws-45'), asS1(unstampedEnd, 3));
    const forged = { offset: 2, event: asS1(stampedJoin, 2), verdict: { label: 'legacy' as const } };
    expect(projectSessions([join, forged, { ...end, offset: 3 }]).map((s) => s.member)).toEqual([false]);
  });

  it('calls an event stamped only when its thread is a non-empty string, and an end unstamped only when it is not', () => {
    expect(isStamped(asS1(stampedJoin, 1))).toBe(true);
    for (const thread of [undefined, '', 7, null, {}]) expect(isStamped({ ...asS1({ kind: 'joined' }, 1), thread }), String(thread)).toBe(false);
    expect(isUnstampedEnd(asS1(unstampedEnd, 2))).toBe(true);
    expect(isUnstampedEnd(asS1({ kind: 'retired', reason: 'ended', thread: '' }, 2))).toBe(true);
    expect(isUnstampedEnd(asS1({ kind: 'retired', reason: 'ended', thread: THREAD }, 2))).toBe(false);
    expect(isUnstampedEnd(asS1({ kind: 'retired', reason: 'moved' }, 2))).toBe(false);
    expect(isUnstampedEnd(asS1({ kind: 'retired' }, 2))).toBe(false);
    expect(isUnstampedEnd({ ...asS1({ kind: 'joined' }, 1), reason: 'ended' })).toBe(false);
  });
});

describe('addressing', () => {
  const sessions = projectSessions(logged(joined(S1, 'maws-45'), joined(S2, 'ci-opt'), joined(S3, 'ci-opt', 'devcloud'), retired(S3, 'devcloud')));

  it('sends untagged words, and an @ inside the text, to everyone', () => {
    expect(addressOf('hello all', sessions)).toEqual({ ok: true, to: '*' });
    expect(addressOf('ping maws-45@mini later', sessions)).toEqual({ ok: true, to: '*' });
    expect(addressOf('@maws-45x', [])).toEqual({ ok: false, reason: 'no-member', detail: '@maws-45x' });
  });

  it('addresses the sessions the leading tags name, by alias, short id or quoted alias', () => {
    expect(addressOf('@maws-45 look at this', sessions)).toEqual({ ok: true, to: [{ session: S1, alias: 'maws-45' }] });
    expect(addressOf('@maws-45, @ci-opt: both of you', sessions)).toEqual({
      ok: true,
      to: [
        { session: S1, alias: 'maws-45' },
        { session: S2, alias: 'ci-opt' },
      ],
    });
    expect(addressOf(`@${S1.slice(0, 8)} by id`, sessions)).toEqual({ ok: true, to: [{ session: S1, alias: 'maws-45' }] });
    expect(addressOf('@"maws-45" quoted', sessions)).toEqual({ ok: true, to: [{ session: S1, alias: 'maws-45' }] });
  });

  it('refuses a tag that names no live session of the project, or more than one', () => {
    expect(addressOf('@nobody hi', sessions)).toEqual({ ok: false, reason: 'no-member', detail: '@nobody' });
    const twins = projectSessions(logged(joined(S1, 'twin'), joined(S2, 'twin', 'devcloud')));
    expect(addressOf('@twin hi', twins)).toEqual({ ok: false, reason: 'ambiguous', detail: '@twin' });
    expect(addressOf(`@twin#${S2.slice(0, 4)} hi`, twins)).toEqual({ ok: true, to: [{ session: S2, alias: 'twin' }] });
  });
});
