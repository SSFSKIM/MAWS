// The window's follow (UX wave U6b-4c, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, Interfaces §F;
// W1 (b), (c) and (h); K10): one `files.follow` per session, path and source at a time, sent only for a session on this
// Mac and an absolute path; `following` while any is under way for the session and path; `linkedCount` the follows of it
// answered `linked`. Invented sessions, paths and agents.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../../test/support/builders';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { useSessions } from '../../stores/sessions';
import { fail, installFakeMain, ok } from '../../test-support/code';
import { follow, following, linkedCount, resetFollows } from './follow';

const MAIN_A = 'app-a' as AppSessionId;
const A = at(MAIN_A);
const B = at('app-b' as AppSessionId);
const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId); // a session MAWS runs on another machine
const OUT = '/elsewhere/notes.txt';
const DOC = { file: '/r/docs/guide.md' };
const AGENT = { agent: 'agent-1' };

type Answer = ReturnType<typeof ok>;
// Main whose answers to `files.follow` the test gives, one per call, in order; every other command is not asked.
function held() {
  const answers: ((answer: Answer) => void)[] = [];
  const main = installFakeMain((name) => (name === 'files.follow' ? new Promise<Answer>((resolve) => answers.push(resolve)) : fail(`unexpected ${name}`)));
  const answer = async (n: number, value: Answer) => {
    answers[n](value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { ...main, answer, follows: () => main.callsOf('files.follow') };
}
const linked = ok({ status: 'linked' });
const settledNow = async (promise: Promise<void> | null) => {
  let done = false;
  void promise?.then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return promise === null || done;
};

describe('the window’s follow', () => {
  beforeEach(() => resetFollows());
  afterEach(() => {
    resetFollows();
    useSessions.setState({ records: new Map() });
  });

  it('sends one files.follow with the session, the path and the source; under way until answered; counted only when linked', async () => {
    const main = held();
    follow(A, OUT, DOC);
    expect(main.follows()).toEqual([{ appSessionId: MAIN_A, path: OUT, from: DOC }]);
    const under = following(A, OUT);
    expect(under).not.toBeNull();
    expect(await settledNow(under)).toBe(false);
    expect(linkedCount(A, OUT)).toBe(0);
    await main.answer(0, linked);
    expect(await settledNow(under)).toBe(true);
    expect(following(A, OUT)).toBeNull();
    expect(linkedCount(A, OUT)).toBe(1);
    for (const [n, status] of [[1, 'not-linked'], [2, 'inside']] as const) {
      follow(A, OUT, DOC);
      await main.answer(n, ok({ status }));
      expect(following(A, OUT)).toBeNull();
    }
    expect(linkedCount(A, OUT)).toBe(1); // neither moved it
    follow(A, OUT, DOC);
    await main.answer(3, linked);
    expect(linkedCount(A, OUT)).toBe(2);
    expect(linkedCount(B, OUT)).toBe(0); // per session
    expect(linkedCount(A, '/elsewhere/other.txt')).toBe(0); // and per path
  });

  it('sends nothing for no session, a session on another machine, or a path that is not absolute; this Mac’s absolute path is sent (K10)', () => {
    const main = held();
    follow(null, OUT, DOC);
    follow(REMOTE, OUT, DOC);
    follow(REMOTE, OUT, AGENT);
    follow(A, 'notes.txt', DOC);
    follow(A, '', DOC);
    expect(main.follows()).toEqual([]);
    expect(following(null, OUT)).toBeNull();
    expect(following(REMOTE, OUT)).toBeNull();
    expect(following(A, 'notes.txt')).toBeNull();
    follow(A, OUT, DOC); // the control
    expect(main.follows()).toEqual([{ appSessionId: MAIN_A, path: OUT, from: DOC }]);
  });

  it.each([
    ['a daemon of an older build', fail('unknown command: files.follow', 'unknown_command')],
    ['the host’s time-out', fail('timed out', 'timeout')],
    ['no host', fail('the host is not running', 'host_unavailable')],
    ['a caller that may not ask', fail('forbidden sender', 'forbidden_sender')],
  ])('a follow refused by %s settles as one that found nothing, and never rejects (W1 b)', async (_, answer) => {
    const main = held();
    follow(A, OUT, DOC);
    const under = following(A, OUT)!;
    await main.answer(0, answer);
    await expect(under).resolves.toBeUndefined();
    expect(following(A, OUT)).toBeNull();
    expect(linkedCount(A, OUT)).toBe(0);
  });

  it('a bridge that throws settles the follow too, and the call itself never throws', async () => {
    installFakeMain(() => Promise.reject(new Error('the bridge went away')));
    expect(() => follow(A, OUT, DOC)).not.toThrow();
    const under = following(A, OUT);
    await expect(under).resolves.toBeUndefined();
    expect(following(A, OUT)).toBeNull();
    expect(linkedCount(A, OUT)).toBe(0);
  });

  it('a second follow of the same session, path and source while one is under way sends nothing (W1 c); another source is a follow of its own, and following waits for both (W1 h)', async () => {
    const main = held();
    follow(A, OUT, DOC);
    follow(A, OUT, { file: '/r/docs/guide.md' });
    expect(main.follows()).toHaveLength(1);
    follow(A, OUT, AGENT);
    follow(A, OUT, AGENT);
    expect(main.follows()).toEqual([
      { appSessionId: MAIN_A, path: OUT, from: DOC },
      { appSessionId: MAIN_A, path: OUT, from: AGENT },
    ]);
    const under = following(A, OUT)!;
    await main.answer(0, linked);
    expect(await settledNow(under)).toBe(false); // the agent's is still under way
    expect(following(A, OUT)).not.toBeNull();
    expect(linkedCount(A, OUT)).toBe(1);
    await main.answer(1, ok({ status: 'not-linked' }));
    expect(await settledNow(under)).toBe(true);
    expect(following(A, OUT)).toBeNull();
    follow(A, OUT, DOC); // settled, so a new click is a new follow
    expect(main.follows()).toHaveLength(3);
  });

  it('another session’s follow of the same path, and this session’s of another path, are their own', () => {
    const main = held();
    follow(A, OUT, DOC);
    follow(B, OUT, DOC);
    follow(A, '/elsewhere/other.txt', DOC);
    expect(main.follows()).toHaveLength(3);
    expect(following(A, OUT)).not.toBeNull();
    expect(following(B, '/elsewhere/other.txt')).toBeNull();
  });

  it('a subagent’s follow is shared only under the engine session the record holds at the call: after /clear it is a follow of its own', () => {
    const main = held();
    const engine = (id: string | null) => useSessions.setState({ records: new Map([[A, record(A, { engineSessionId: id as SessionId | null })]]) });
    engine('engine-one');
    follow(A, OUT, AGENT);
    follow(A, OUT, AGENT);
    expect(main.follows()).toHaveLength(1);
    engine('engine-two'); // the session was bound to a new transcript
    follow(A, OUT, AGENT);
    expect(main.follows()).toHaveLength(2);
    useSessions.setState({ records: new Map() }); // no record known: its own key again
    follow(A, OUT, AGENT);
    follow(A, OUT, AGENT);
    expect(main.follows()).toHaveLength(3);
    expect(main.follows().every((input) => JSON.stringify(input) === JSON.stringify({ appSessionId: MAIN_A, path: OUT, from: AGENT }))).toBe(true); // the engine session is the window’s key, never sent
  });

  it('resetFollows forgets what is under way and every count', async () => {
    const main = held();
    follow(A, OUT, DOC);
    await main.answer(0, linked);
    follow(A, OUT, DOC);
    resetFollows();
    expect(following(A, OUT)).toBeNull();
    expect(linkedCount(A, OUT)).toBe(0);
  });
});
