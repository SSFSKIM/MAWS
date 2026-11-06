// Whom the owner's words address (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "People's
// words, sent"): a leading `@alias` names that session of the project, as `sminos say` reads tags, and untagged words go
// to everyone. The project's sessions are what its log's lifecycle events say.
import { describe, expect, it } from 'vitest';
import { addressOf, projectSessions } from './address';

const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
const S3 = 'a2cf35be-3ade-47df-b6ab-d08753367102';
const joined = (session: string, alias: string, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 1, kind: 'joined', session, alias, machine });
const retired = (session: string, machine = 'mini') => ({ writer: `${machine}/${session}`, seq: 2, kind: 'retired', session, by: '', reason: 'ended' });

describe('the sessions a project log names', () => {
  it("keeps each session's latest membership and alias, from its own writer only", () => {
    const sessions = projectSessions([joined(S1, 'maws-45'), joined(S2, 'ci-opt'), retired(S2), joined(S1, 'maws-46'), { ...joined(S3, 'forged'), writer: `mini/${S1}` }]);
    expect(sessions).toEqual([
      { session: S1, alias: 'maws-46', member: true },
      { session: S2, alias: 'ci-opt', member: false },
    ]);
  });
});

describe('addressing', () => {
  const sessions = projectSessions([joined(S1, 'maws-45'), joined(S2, 'ci-opt'), joined(S3, 'ci-opt', 'devcloud'), retired(S3, 'devcloud')]);

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
    const twins = projectSessions([joined(S1, 'twin'), joined(S2, 'twin', 'devcloud')]);
    expect(addressOf('@twin hi', twins)).toEqual({ ok: false, reason: 'ambiguous', detail: '@twin' });
    expect(addressOf(`@twin#${S2.slice(0, 4)} hi`, twins)).toEqual({ ok: true, to: [{ session: S2, alias: 'twin' }] });
  });
});
