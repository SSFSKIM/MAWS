// Whom the owner's words address (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "People's
// words, sent"): a leading `@alias` names that session of the project, as `sminos say` reads tags, and untagged words go
// to everyone. The project's sessions are what its log's lifecycle events say: each session's latest `joined`,
// `retired`, `renamed` and `titled` from its own writer, by offset.
import { describe, expect, it } from 'vitest';
import { addressOf, lifecycleOf, projectSessions } from './address';

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
      { session: S1, alias: 'maws-46', machine: 'mini', title: 'the channel', member: true },
      { session: S2, alias: 'ci-opt-2', machine: 'mini', title: null, member: false },
    ]);
  });

  it('reads them by offset, whatever order they are given in', () => {
    const [a, b, c] = logged(joined(S1, 'maws-45'), retired(S1), joined(S1, 'maws-46'));
    expect(projectSessions([c, a, b])).toEqual([{ session: S1, alias: 'maws-46', machine: 'mini', title: null, member: true }]);
  });

  it('reads an authenticated lifecycle alone when a session has one; a legacy one names a session without one, never a member', () => {
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
      { session: S1, alias: 'maws-46', machine: 'mini', title: null, member: true },
      { session: S2, alias: 'old-one', machine: 'mini', title: null, member: false },
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
