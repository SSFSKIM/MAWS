import { expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { openSessionTabs } from './open-session-tabs';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as AppSessionId;
const session = (appSessionId: AppSessionId) => ({ id: `session:${appSessionId}`, kind: 'session', appSessionId, pinned: false });
const at = (appSessionId: AppSessionId, machine = LOCAL) => addressOf(machine, appSessionId);

// P5 O6 M2: version 3, as the renderer writes it, holds addresses; the sweep keeps the local machine's, by bare id.
it('reads the session and agent tabs of every project’s set, not the closed-tab history, and follows each write', () => {
  let value: unknown = {
    version: 3, current: NO_PROJECT,
    sets: {
      [NO_PROJECT]: { panes: [{ tabs: [session(at(id(1)))], activeTabId: `session:${at(id(1))}` }], focusedPane: 0, splitRatio: 0.5 },
      [at('proj-a' as AppSessionId)]: { panes: [{ tabs: [{ id: `agent:${at(id(2))}:a1`, kind: 'agent', appSessionId: at(id(2)), agentId: 'a1', pinned: false }, { id: `diff:${at(id(4))}:HEAD`, kind: 'diff', appSessionId: at(id(4)), ref: 'HEAD', pinned: false }], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 },
    },
    closedTabs: [session(at(id(3)))],
  };
  const open = openSessionTabs({ get: () => value }, LOCAL);
  expect([1, 2, 3, 4].map((n) => open(id(n)))).toEqual([true, true, false, false]);
  value = { ...(value as object), sets: {} };
  expect(open(id(1))).toBe(false);
  value = 'not a layout'; // the renderer shows its default tabs for this
  expect(open(id(1))).toBe(false);
});

// l1-sessions-13 review: a tab opened before the renderer's layout hydrates is not written yet, but it is on screen.
it('counts a session on screen as open, whatever main.tabs holds', () => {
  const onScreen = new Set([id(5)]);
  const open = openSessionTabs({ get: () => null }, LOCAL, (appSessionId) => onScreen.has(appSessionId));
  expect([open(id(5)), open(id(1))]).toEqual([true, false]);
});

it('keeps no other machine’s session, and reads a version 2 layout, from before O6, as the local machine’s', () => {
  const remote = at(id(1), OTHER);
  const elsewhere = openSessionTabs({ get: () => ({ version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: [session(remote)], activeTabId: `session:${remote}` }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] }) }, LOCAL);
  expect(elsewhere(id(1))).toBe(false);
  expect(openSessionTabs({ get: () => ({ version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: [session(at(id(1)))], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] }) }, LOCAL)(id(1))).toBe(true);
  const before = { version: 2, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: [session(id(1))], activeTabId: `session:${id(1)}` }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] };
  expect(openSessionTabs({ get: () => before }, LOCAL)(id(1))).toBe(true);
});
