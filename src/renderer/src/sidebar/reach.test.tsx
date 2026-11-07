// A session's reach in the sidebar and the toolbar (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M6b's "At its end": a row's mark, Share from the row's menu and the session's header, hub projects only; Proves'
// renderer line: the marks and menus on listed rows). The mark: a lock for Private, a people mark for wider access or
// shares, read from the machine's policy for your own sessions and from the listing's audience for another's private one
// shared with you, with its access in the hover card. Share: a listed row you own in a hub project has a menu holding it,
// any other listed row none; a record of this Mac's in a hub project that its policy read names offers it; one in a
// local-only project, or while signed out, doesn't; it opens the Share sheet.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, type TabRef } from '@shared/ipc/schema/layout';
import type { OrgPolicy } from '@shared/ipc/schema/org';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import { project, record, remoteRow } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { Toolbar } from '../app/Toolbar';
import { queryClient } from '../ipc/query';
import { closeDialog } from '../sessions/dialogs';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { SHARE } from '../sessions/share/copy';
import { useAttention } from '../stores/attention';
import { useHubAccess } from '../stores/hub-access';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { usePeople } from '../stores/people';
import { usePolicies } from '../stores/policies';
import { useSessions, type ListedSession } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import type { ProjectKey } from './derive';
import { Sidebar } from './Sidebar';

const ME = 'member-me';
const SMNS = 'smns-proj-1';
const ORG = `smns:${SMNS}` as OrgKey;
const LOCAL_ONLY = 'folder:/src/scratch' as OrgKey;
const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
const hub = project(at('hub'), 0, { name: 'Northwind', org: { key: ORG, name: 'Northwind', source: 'smns', smnsId: SMNS } });
const scratch = project(at('scratch'), 1, { name: 'scratch', org: { key: LOCAL_ONLY, name: 'scratch', source: 'folder', smnsId: null } });
const mine = (id: string, over: Partial<ListedSession> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { orgKey: ORG, project: SMNS, owners: [ME], issued: '2026-11-07T10:00:00Z' }), appId: studio(id), ...over });
const entry = (session: string, access: 'private' | 'listed' | 'org-view', shares = 0): RecordPolicyEntry => ({ session, access, shares: Array.from({ length: shares }, (_, i) => ({ member: `m${i}`, grade: 'view' as const })), policyRev: 1 });
const reads = (...policies: OrgPolicy[]) => usePolicies.setState({ reads: new Map(policies.map((p) => [p.machine, p])) });
const supported = (machine: typeof TEST_MACHINE, ...policies: RecordPolicyEntry[]): OrgPolicy => ({ ok: true, machine, supported: true, policies });

const row = (name: string) => screen.getByRole('treeitem', { name });
const mark = (name: string) => row(name).querySelector('[data-reach]')?.getAttribute('aria-label') ?? null;
const fill = (listed: ListedSession[], records: SessionRecord[] = []) =>
  useSessions.setState({
    loaded: true,
    projects: new Map([hub, scratch].map((p) => [p.id, p])),
    records: new Map(records.map((r) => [r.appId, r])),
    listed: new Map(listed.map((l) => [l.appId, l])),
    members: new Map(),
    member: ME,
  });
const menuOf = async (name: string) => {
  fireEvent.contextMenu(row(name));
  return screen.findByRole('menu');
};

beforeEach(() => {
  resetShellStores();
  useAttention.setState({ loaded: true });
  useHubAccess.setState({ access: 'connected', member: ME });
  useMachines.getState().applyRoster([
    { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-07T10:00:00Z', generation: 0 },
    { ref: OTHER_MACHINE, name: 'studio-mini', local: false, state: 'up', since: '2026-11-07T10:00:00Z', generation: 0 },
  ]);
  act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG, LOCAL_ONLY, machineKey(OTHER_MACHINE)] as ProjectKey[] }));
  window.maws = fakeClient({ 'org.view': null }).client as unknown as PreloadBridge;
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  usePolicies.setState({ reads: new Map() });
  usePeople.setState({ on: new Set() });
  useHubAccess.setState({ access: null, member: null });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the reach mark', () => {
  it("marks your sessions by their machine's policy and another's private one by its listing, none at the default", () => {
    const here = record(at('here'), { projectId: hub.id, title: { text: 'Here, org can view', source: 'user' } });
    fill(
      [
        mine('p', { title: 'Private one' }),
        mine('s', { title: 'Shared one' }),
        mine('d', { title: 'Default one' }),
        mine('t', { title: 'Theirs, shared with me', owners: ['ana'], mine: false, audience: ['ana', ME] }),
      ],
      [here],
    );
    reads(supported(OTHER_MACHINE, entry('p', 'private'), entry('s', 'listed', 2), entry('d', 'listed')), supported(TEST_MACHINE, entry('here', 'org-view')));
    act(() => usePeople.setState({ on: new Set([ORG]) })); // others' rows are drawn while the project's People toggle is on
    render(<Sidebar />);
    expect(mark('Private one')).toBe('Private');
    expect(mark('Shared one')).toBe('Shared');
    expect(mark('Default one')).toBeNull();
    expect(mark('Here, org can view')).toBe('Shared');
    expect(mark('Theirs, shared with me')).toBe('Private');
    expect(row('Private one').querySelector('[data-reach]')!.getAttribute('title')).toBe('Private');
    expect(row('Shared one').querySelector('[data-reach]')!.getAttribute('title')).toBe('Listed · shared with 2 people');
  });

  it("says its access in the hover card, and another's private session that it is shared with you", async () => {
    fill([mine('s', { title: 'Shared one' })]);
    reads(supported(OTHER_MACHINE, entry('s', 'org-view', 1)));
    render(<Sidebar />);
    await userEvent.click(row('Shared one'));
    const card = await screen.findByRole('dialog', { name: 'Shared one' });
    expect(within(card).getByTestId('hover-reach').textContent).toBe('Org can view · shared with 1 person');
  });
});

describe('Share on a row', () => {
  it('gives a listed row you own in a hub project a menu holding Share, which opens the sheet; any other listed row has no menu', async () => {
    fill([mine('m', { title: 'Mine' }), mine('n', { title: 'No project', project: null, orgKey: null })]);
    render(
      <>
        <Sidebar />
        <SessionDialogs />
      </>,
    );
    expect(row('Mine').getAttribute('data-menu')).toBe(`session:${studio('m')}`);
    expect(row('No project').getAttribute('data-menu')).toBe('none');
    const menu = await menuOf('Mine');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([SHARE.menuItem]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: SHARE.menuItem }));
    expect(await screen.findByRole('dialog', { name: SHARE.title })).toBeTruthy();
  });

  it("offers Share on this Mac's record in a hub project its policy read names, or that can't keep a reach yet; not in a local-only project, nor signed out", async () => {
    const here = record(at('here'), { projectId: hub.id, title: { text: 'Here', source: 'user' } });
    const unnamed = record(at('unnamed'), { projectId: hub.id, title: { text: 'Not named', source: 'user' } });
    const local = record(at('local'), { projectId: scratch.id, title: { text: 'Local only', source: 'user' } });
    fill([], [here, unnamed, local]);
    reads(supported(TEST_MACHINE, entry('here', 'listed'), entry('local', 'listed')));
    render(<Sidebar />);
    const shareIn = async (name: string) => {
      const items = within(await menuOf(name)).queryAllByRole('menuitem').map((item) => item.textContent);
      await userEvent.keyboard('{Escape}');
      return items.includes(SHARE.menuItem);
    };
    expect(await shareIn('Here')).toBe(true);
    expect(await shareIn('Not named')).toBe(false);
    expect(await shareIn('Local only')).toBe(false);
    act(() => reads({ ok: true, machine: TEST_MACHINE, supported: false }));
    expect(await shareIn('Not named')).toBe(true);
    act(() => useHubAccess.setState({ access: null, member: null }));
    expect(await shareIn('Here')).toBe(false);
  });
});

describe('Share in the session header', () => {
  const tab = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
  it("holds Share in the Toolbar's session actions for a session you own", async () => {
    const user = userEvent.setup();
    fill([mine('m', { title: 'Mine', lane: 'A', availability: 'foreign_held' })]);
    act(() => useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [tab(studio('m'))], activeTabId: tab(studio('m')).id }] } } } }));
    render(
      <QueryClientProvider client={queryClient}>
        <Toolbar />
        <SessionDialogs />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    const actions = await screen.findByRole('menuitem', { name: 'Session actions' });
    act(() => actions.focus());
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: SHARE.menuItem }));
    expect(await screen.findByRole('dialog', { name: SHARE.title })).toBeTruthy();
  });
});
