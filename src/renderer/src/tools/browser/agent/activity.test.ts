// E13 (the in-app browser spec of 2026-10-08, "Action rows"): the windows keep what main says an agent did through cua
// (`browser.agent.activity`) per session, as live state for the transcript: in arrival order, numbered for stable row
// ids, bounded to the latest few hundred per session, and gone on reset (as on a window reload).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { BROWSER_ACTIVITY_KEPT, browserActivityOf, connectBrowserActivity, resetBrowserActivity } from './activity';

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
    for (let i = 1; i <= BROWSER_ACTIVITY_KEPT + 5; i++) send(A, i);
    const a = browserActivityOf(A);
    expect(a).toHaveLength(BROWSER_ACTIVITY_KEPT);
    expect(a[0]!.activity).toEqual({ kind: 'typed', chars: 6 });
    expect(a.at(-1)!.activity).toEqual({ kind: 'typed', chars: BROWSER_ACTIVITY_KEPT + 5 });
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
