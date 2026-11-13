// UX wave U11a M5 (S-10; Interfaces §F, "The Channel's entries"; the execution document's M5, "Has a channel"): one rule
// for whether a project has a channel, `channelOfRow` and `channelProjects`, held equal to what the sidebar's two menus
// answer today on the same rows: a project row's menu (`project:<id>`) and a registry row's (`registry:<id>`) offer
// Channel, and open the channel of the project they name, exactly where the rule answers that project; every other row's
// menu, a machine's own row's included, offers no Channel. `sidebar/menus.tsx` keeps its own inline reading.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge, ProjectRecord } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useMachines } from '../stores/machines';
import { selectOrgIndex, type RowKey } from '../stores/org-projects';
import type { OrgProjects } from '../stores/registry';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { Sidebar } from '../sidebar/Sidebar';
import { CHANNEL } from './copy';
import { channelOfRow, channelProjects } from './project';

const NORTH = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const HUB = '2a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
const LOCAL = '3b4c5d6e-7f80-4192-a3a4-b5c6d7e8f9a0';
const SEEN = '4c5d6e7f-8091-4203-b4b5-c6d7e8f9a0b1';
const QUIET = '5d6e7f80-91a2-4314-c5c6-d7e8f9a0b1c2';

const here = (id: string) => addressOf(TEST_MACHINE, id);
const checkout = (id: string, order: number, name: string, key: string, smnsId: string | null): ProjectRecord =>
  project(here(id), order, { name, org: { key: key as OrgKey, name, source: smnsId === null ? 'folder' : 'smns', smnsId } });
// Five project rows, as many as the sidebar draws before its "Show more"; a folder with no project id is project.test.ts's.
const PROJECTS = [
  checkout('p-north', 0, 'northwind', `smns:${NORTH}`, NORTH), // a .smns project the registry does not hold
  checkout('p-orchard', 1, 'Orchard', `smns:${HUB}`, HUB), // a hub project of the registry
  checkout('p-ledger', 2, 'Ledger', `smns:${LOCAL}`, LOCAL), // a registry project kept off the hub
];
const REGISTRY: OrgProjects = {
  projects: [
    { id: HUB, name: 'Orchard', hub: true, renamable: false, locations: [] },
    { id: LOCAL, name: 'Ledger', hub: false, renamable: true, locations: [] },
    { id: SEEN, name: 'Reports', hub: true, renamable: false, locations: [] }, // seen only through its sessions: a registry row
    { id: QUIET, name: 'Quiet', hub: false, renamable: false, locations: [] }, // the same, kept off the hub
  ],
  keys: { [HUB]: `smns:${HUB}` as OrgKey, [LOCAL]: `smns:${LOCAL}` as OrgKey, [SEEN]: `id:${SEEN}` as OrgKey, [QUIET]: `id:${QUIET}` as OrgKey },
  moved: {},
  removals: [],
  seen: {},
};
const ELSEWHERE = addressOf(OTHER_MACHINE, 'loose' as AppSessionId); // a session on another machine in no project: its machine's own row

beforeEach(() => {
  resetShellStores();
  useAttention.setState({ loaded: true });
  window.maws = fakeClient({ 'org.view': null }).client as unknown as PreloadBridge;
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-12T10:00:00Z', generation: 0 },
    { ref: OTHER_MACHINE, name: 'studio-mini', local: false, state: 'up', since: '2026-11-12T10:00:00Z', generation: 0 },
  ]);
  useSessions.setState({
    loaded: true,
    projects: new Map(PROJECTS.map((p) => [p.id, p])),
    records: new Map([[ELSEWHERE, record(ELSEWHERE, { title: { text: 'Loose ends', source: 'user' } })]]),
    registry: REGISTRY,
  });
});
afterEach(() => {
  cleanup();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

/** What a row's menu answers: the channel its Channel item opens, or null when it offers none. */
async function menuAnswer(key: RowKey): Promise<string | null> {
  render(<Sidebar />);
  const row = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((el) => el.dataset.treeId === `p:${key}`);
  if (row === undefined) throw new Error(`no row ${key}`);
  fireEvent.contextMenu(row);
  const item = within(await screen.findByRole('menu')).queryByRole('menuitem', { name: CHANNEL.menuItem });
  if (item !== null) act(() => fireEvent.click(item));
  const tab = activeTab(useLayout.getState().main);
  // the closed menu hands focus back in a timer of its own, which must not land in the next row's menu and dismiss it
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  cleanup();
  if (item === null) return null;
  return tab?.kind === 'channel' ? tab.project : `not a channel tab: ${tab?.kind ?? 'none'}`;
}

describe('has a channel: one rule, the sidebar menus’ answer', () => {
  it('answers, for every row the sidebar draws, what that row’s menu answers', async () => {
    render(<Sidebar />);
    const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][data-kind="project"]')].map((row) => ({
      key: row.dataset.treeId!.slice('p:'.length) as RowKey,
      menu: row.dataset.menu!.slice(0, row.dataset.menu!.indexOf(':')),
    }));
    cleanup();
    // every kind of row the menus tell apart is among them
    expect(new Set(rows.map((r) => r.menu))).toEqual(new Set(['project', 'registry', 'machine']));
    const index = selectOrgIndex(useSessions.getState(), TEST_MACHINE);
    const answers: Record<string, string | null> = {};
    for (const { key } of rows) {
      answers[key] = await menuAnswer(key);
      useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    }
    expect(Object.fromEntries(rows.map(({ key }) => [key, channelOfRow(key, index)]))).toEqual(answers);
    // the cases, named: Channel where the project is the hub's or a .smns project's, and nowhere else
    expect(answers).toMatchObject({ [`smns:${NORTH}`]: NORTH, [`smns:${HUB}`]: HUB, [`id:${SEEN}`]: SEEN, [`smns:${LOCAL}`]: null, [`id:${QUIET}`]: null });
  });

  it('lists the projects whose rows’ menus offer Channel, each once', () => {
    const index = selectOrgIndex(useSessions.getState(), TEST_MACHINE);
    expect(channelProjects(index)).toEqual([
      { project: NORTH, name: 'northwind' },
      { project: HUB, name: 'Orchard' },
      { project: SEEN, name: 'Reports' },
    ]);
  });
});

