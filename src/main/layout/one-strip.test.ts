// UX wave U13a, A7 (section, "As read"; the U13a plan's M1): the sessions main counts as open from `main.tabs`, this
// machine's (`sessionsInTabs`) and other machines' (`remoteSessionsInTabs`), are the same for a stored value before and
// after it is read into one strip and stored again, so the upgrade stops no session and drops no stream. Every id is
// invented.
import { expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { type LayoutMain, storedMain, storedMainSchema, stripOf } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { remoteSessionsInTabs } from '../lane-b/remote-interest';
import { sessionsInTabs } from './open-session-tabs';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const bare = (n: number) => `s${n}` as AppSessionId;
const session = (appSessionId: string, pinned = false) => ({ id: `session:${appSessionId}`, kind: 'session', appSessionId, pinned });
const agent = (appSessionId: string) => ({ id: `agent:${appSessionId}:a1`, kind: 'agent', appSessionId, agentId: 'a1', pinned: false });
const diff = (appSessionId: string) => ({ id: `diff:${appSessionId}:HEAD`, kind: 'diff', appSessionId, ref: 'HEAD', pinned: false });
const at = (n: number, machine = LOCAL) => addressOf(machine, bare(n));
const pane = (tabs: { id: string }[]) => ({ tabs, activeTabId: tabs[0]?.id ?? '' });
const set = (...panes: { id: string }[][]) => ({ panes: panes.map(pane), focusedPane: 0, splitRatio: 0.5 });

// What main counts from a value, for this machine's sessions and other machines'.
const counted = (value: unknown, local: MachineRef) => ({ here: sessionsInTabs(value, local), elsewhere: remoteSessionsInTabs(value, local) });
// The value as it is read into one strip and written back.
const rewritten = (value: unknown, local: MachineRef): LayoutMain => {
  const parsed = storedMainSchema(local).parse(value);
  return storedMain(stripOf(parsed).strip);
};

it('counts the same sessions, here and elsewhere, before and after a value of several sets is read into one strip', () => {
  const value = {
    version: 3,
    current: 'smns:invented-alpha',
    sets: {
      'smns:invented-alpha': set([session(at(1), true), agent(at(2))], [session(at(3, OTHER))]),
      none: set([diff(at(9))]), // a diff tab holds nothing open
      [`machine:${OTHER}`]: set([session(at(4, OTHER)), agent(at(5, OTHER))]),
      'remote:invented-beta': set([session(at(1), true), session(at(6))], [session(at(7, THIRD))]),
      [`folder:${LOCAL}:invented-gamma`]: set([agent(at(6)), session(at(8, THIRD))]),
    },
    closedTabs: [session(at(10)), session(at(11, OTHER))], // the history holds nothing open
  };
  const after = rewritten(value, LOCAL);
  expect(Object.keys(after.sets)).toEqual(['none']);
  for (const local of [LOCAL, OTHER, THIRD]) expect(counted(after, local)).toEqual(counted(value, local));
  expect([...sessionsInTabs(value, LOCAL)].sort()).toEqual([bare(1), bare(2), bare(6)]);
  expect(remoteSessionsInTabs(value, LOCAL)).toEqual(new Map([[OTHER, new Set(['s3', 's4', 's5'])], [THIRD, new Set(['s7', 's8'])]]));
});

it('counts the same sessions when the set `current` names is not stored, and for values from before O6 lifted with this machine', () => {
  const missingBase = { version: 3, current: 'smns:invented-gone', sets: { none: set([session(at(1))]), 'remote:invented-beta': set([session(at(2, OTHER))]) }, closedTabs: [] };
  expect(counted(rewritten(missingBase, LOCAL), LOCAL)).toEqual(counted(missingBase, LOCAL));
  const v2 = { version: 2, current: 'invented-project', sets: { 'invented-project': set([session(bare(1))]), none: set([agent(bare(2))], [session(bare(3))]) }, closedTabs: [] };
  expect(counted(rewritten(v2, LOCAL), LOCAL)).toEqual(counted(v2, LOCAL));
  expect(sessionsInTabs(v2, LOCAL).size).toBe(3);
  const v1 = { version: 1, panes: [pane([session(bare(1))]), pane([agent(bare(2))])], focusedPane: 1, splitRatio: 0.5, closedTabs: [] };
  expect(counted(rewritten(v1, LOCAL), LOCAL)).toEqual(counted(v1, LOCAL));
  expect(sessionsInTabs(v1, LOCAL).size).toBe(2);
});

