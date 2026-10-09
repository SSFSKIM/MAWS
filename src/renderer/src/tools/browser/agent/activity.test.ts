// E13 (the in-app browser spec of 2026-10-08, "Action rows"): the windows keep what main says an agent did through cua
// (`browser.agent.activity`) per session, as live state for the transcript: in arrival order, numbered for stable row
// ids, bounded to the latest 500 per session (as main keeps), and gone on reset (as on a window reload).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_ACTIVITIES_KEPT } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { browserActivityOf, connectBrowserActivity, listBrowserActivity, resetBrowserActivity } from './activity';

type Answer = Awaited<ReturnType<Parameters<typeof installFakeMain>[0]>>;

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;
const TAB = 'b_000000000001';

let fake: FakeClient;
let disconnect: () => void;
const send = (appSessionId: AppSessionId, chars: number) => fake.event('browser.agent.activity', { appSessionId, tabId: TAB, at: '2026-10-08T10:00:00.000Z', activity: { kind: 'typed', chars } });

beforeEach(() => {
  resetBrowserActivity();
  fake = fakeClient({});
  disconnect = connectBrowserActivity(fake.client);
});
afterEach(() => {
  disconnect();
  resetBrowserActivity();
});

describe('the browser activity store', () => {
  it('keeps each session’s activity in arrival order, numbered, and apart from another session’s', () => {
    send(A, 1);
    send(B, 2);
    send(A, 3);
    const a = browserActivityOf(A);
    expect(a.map((entry) => entry.activity)).toEqual([{ kind: 'typed', chars: 1 }, { kind: 'typed', chars: 3 }]);
    expect(a[0]!.seq).toBeLessThan(a[1]!.seq);
    expect(a[0]).toMatchObject({ appSessionId: A, tabId: TAB, at: '2026-10-08T10:00:00.000Z' });
    expect(browserActivityOf(B).map((entry) => entry.activity)).toEqual([{ kind: 'typed', chars: 2 }]);
    expect(browserActivityOf('App-none' as AppSessionId)).toEqual([]);
  });

  it('keeps only the latest entries of a session', () => {
    for (let i = 1; i <= BROWSER_ACTIVITIES_KEPT + 5; i++) send(A, i);
    const a = browserActivityOf(A);
    expect(a).toHaveLength(BROWSER_ACTIVITIES_KEPT);
    expect(a[0]!.activity).toEqual({ kind: 'typed', chars: 6 });
    expect(a.at(-1)!.activity).toEqual({ kind: 'typed', chars: BROWSER_ACTIVITIES_KEPT + 5 });
  });

  it('forgets everything on reset, and stops listening once disconnected', () => {
    send(A, 1);
    const before = browserActivityOf(A);
    send(B, 1);
    expect(browserActivityOf(A)).toBe(before); // another session's activity leaves this one's list as it was
    resetBrowserActivity();
    expect(browserActivityOf(A)).toEqual([]);
    disconnect();
    send(A, 2);
    expect(browserActivityOf(A)).toEqual([]);
  });
});

// M3 fix wave: main keeps each session's activity for the app's life; a transcript that mounts lists it
// (`browser.agent.activities.list`, oldest first) and the store merges it under what the live events already brought,
// so a window reload or a re-mount shows the rows again.
describe('listing a session’s activity', () => {
  const entry = (at: string, chars: number) => ({ appSessionId: A, tabId: TAB, at, activity: { kind: 'typed' as const, chars } });
  let main: ReturnType<typeof installFakeMain>;
  let listed: ReturnType<typeof deferred<Answer>>;
  let stop: () => void;
  beforeEach(() => {
    disconnect(); // this block's events come through the app's client
    listed = deferred<Answer>();
    main = installFakeMain((name) => (name === 'browser.agent.activities.list' ? listed.promise : ok()));
    stop = connectBrowserActivity();
  });
  afterEach(() => {
    stop();
    delete (window as { maws?: unknown }).maws;
  });

  it('fills a fresh store from main, oldest first', async () => {
    const loading = listBrowserActivity(A);
    expect(main.callsOf('browser.agent.activities.list')).toEqual([{ appSessionId: A }]);
    listed.resolve(ok({ activities: [entry('2026-10-08T10:00:01.000Z', 1), entry('2026-10-08T10:00:02.000Z', 2)] }));
    await loading;
    expect(browserActivityOf(A).map((e) => e.activity)).toEqual([{ kind: 'typed', chars: 1 }, { kind: 'typed', chars: 2 }]);
  });

  it('keeps what live events brought, in place, and adds only what it lacked', async () => {
    main.emit('browser.agent.activity', entry('2026-10-08T10:00:02.000Z', 2));
    const loading = listBrowserActivity(A);
    main.emit('browser.agent.activity', entry('2026-10-08T10:00:03.000Z', 3)); // arrives while the list is on its way
    const live = browserActivityOf(A);
    listed.resolve(ok({ activities: [entry('2026-10-08T10:00:01.000Z', 1), entry('2026-10-08T10:00:02.000Z', 2)] }));
    await loading;
    const merged = browserActivityOf(A);
    expect(merged.map((e) => e.activity)).toEqual([{ kind: 'typed', chars: 1 }, { kind: 'typed', chars: 2 }, { kind: 'typed', chars: 3 }]);
    expect(merged[1]).toBe(live[0]); // the live entry itself (its number, so its row id), not the listed copy
    expect(merged[2]).toBe(live[1]);
  });

  it('changes nothing when main refuses or has nothing', async () => {
    main.emit('browser.agent.activity', entry('2026-10-08T10:00:02.000Z', 2));
    const before = browserActivityOf(A);
    const loading = listBrowserActivity(A);
    listed.resolve({ ok: false, error: { code: 'internal', message: 'no' } });
    await loading;
    expect(browserActivityOf(A)).toBe(before);
  });
});
