import { expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { openSessionTabs } from './open-session-tabs';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as AppSessionId;
const session = (appSessionId: AppSessionId) => ({ id: `session:${appSessionId}`, kind: 'session', appSessionId, pinned: false });

it('reads the session and agent tabs of every project’s set, not the closed-tab history, and follows each write', () => {
  let value: unknown = {
    version: 2, current: NO_PROJECT,
    sets: {
      [NO_PROJECT]: { panes: [{ tabs: [session(id(1))], activeTabId: `session:${id(1)}` }], focusedPane: 0, splitRatio: 0.5 },
      'proj-a': { panes: [{ tabs: [{ id: `agent:${id(2)}:a1`, kind: 'agent', appSessionId: id(2), agentId: 'a1', pinned: false }, { id: `diff:${id(4)}:HEAD`, kind: 'diff', appSessionId: id(4), ref: 'HEAD', pinned: false }], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 },
    },
    closedTabs: [session(id(3))],
  };
  const open = openSessionTabs({ get: () => value });
  expect([1, 2, 3, 4].map((n) => open(id(n)))).toEqual([true, true, false, false]);
  value = { ...(value as object), sets: {} };
  expect(open(id(1))).toBe(false);
  value = 'not a layout'; // the renderer shows its default tabs for this
  expect(open(id(1))).toBe(false);
});

// l1-sessions-13 review: a tab opened before the renderer's layout hydrates is not written yet, but it is on screen.
it('counts a session on screen as open, whatever main.tabs holds', () => {
  const onScreen = new Set([id(5)]);
  const open = openSessionTabs({ get: () => null }, (appSessionId) => onScreen.has(appSessionId));
  expect([open(id(5)), open(id(1))]).toEqual([true, false]);
});
