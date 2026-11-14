// UX wave U11a M5 (S-10; Interfaces §F, "The action"): View › Project channel. Its row stands after the Tabs rows and
// before Split, with no default chord and no rebinding while build F stands; its handler is registered exactly while the
// tab in front names a project that has a channel (a Channel tab's own project, or a session tab's row, a New chat's by
// its intent, read as the title bar's chip reads it: `sessionRow`), and opens that project's Channel, bringing an open one
// forward.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { ACTIONS, ACTION_IDS, isRebindable } from '@shared/keymap/actions';
import { project, record, remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { isActionEnabled, runAction, sessionRow } from '../keymap/actions-runtime';
import { useMachines } from '../stores/machines';
import { useLayout } from '../stores/layout';
import { activeTab, allTabs } from '../stores/layout-model';
import { useSessions, type ListedSession } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { connectChannelAction } from './open-action';

const SMNS = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const here = (id: string) => addressOf(TEST_MACHINE, id);
const NORTH: ProjectRecord = project(here('p-north'), 0, { name: 'northwind', org: { key: `smns:${SMNS}` as OrgKey, name: 'northwind', source: 'smns', smnsId: SMNS } });
const SCRATCH: ProjectRecord = project(here('p-scratch'), 1, { name: 'scratch', org: { key: 'folder:/work/p-scratch' as OrgKey, name: 'scratch', source: 'folder', smnsId: null } });
const IN_NORTH = here('s-north') as AppSessionId;
const IN_SCRATCH = here('s-scratch') as AppSessionId;
const NEW_CHAT = here('s-new') as AppSessionId;

const layout = () => useLayout.getState();
const channelTabs = () => allTabs(layout().main).filter((tab) => tab.kind === 'channel');
let disconnect: (() => void) | null = null;

beforeEach(() => {
  resetShellStores();
  useSessions.setState({
    loaded: true,
    projects: new Map([NORTH, SCRATCH].map((p) => [p.id, p])),
    records: new Map([record(IN_NORTH, { projectId: NORTH.id }), record(IN_SCRATCH, { projectId: SCRATCH.id })].map((r) => [r.appId, r])),
  });
  useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) }); // both machines' first snapshots are in
  disconnect = connectChannelAction();
});
afterEach(() => {
  disconnect?.();
  disconnect = null;
  useMachines.setState({ loaded: new Set() });
});

describe('channel.open: the row', () => {
  it('stands in View after the Tabs rows and before Split, with no default chord, and takes no rebinding while build F stands', () => {
    expect(ACTIONS['channel.open']).toEqual({ title: 'Project channel', chord: null, sink: 'menu', menu: 'view', scope: 'app' });
    const at = ACTION_IDS.indexOf('channel.open');
    expect(ACTION_IDS.slice(at - 1, at + 2)).toEqual(['tab.previous', 'channel.open', 'pane.split']);
    expect(isRebindable('channel.open')).toBe(false);
  });
});

describe('channel.open: registered while the tab in front has a project with a channel', () => {
  it('is unregistered with no tab in front, and with a tab that names no project', () => {
    expect(isActionEnabled('channel.open')).toBe(false);
    layout().openTab({ kind: 'diagnostics' });
    expect(activeTab(layout().main)?.kind).toBe('diagnostics');
    expect(isActionEnabled('channel.open')).toBe(false);
  });

  it('follows the session tab in front: registered for a project with a channel, unregistered when the front moves to one without', () => {
    layout().openTab({ kind: 'session', appSessionId: IN_NORTH });
    expect(isActionEnabled('channel.open')).toBe(true);
    layout().openTab({ kind: 'session', appSessionId: IN_SCRATCH });
    expect(isActionEnabled('channel.open')).toBe(false);
    layout().activateTab(`session:${IN_NORTH}`);
    expect(isActionEnabled('channel.open')).toBe(true);
  });

  it('opens the front session’s project’s Channel, and with it open brings it forward without a second tab', () => {
    layout().openTab({ kind: 'session', appSessionId: IN_NORTH });
    runAction('channel.open');
    expect(activeTab(layout().main)).toMatchObject({ kind: 'channel', project: SMNS });
    expect(isActionEnabled('channel.open')).toBe(true); // a Channel tab in front: its own project
    layout().activateTab(`session:${IN_NORTH}`);
    runAction('channel.open');
    expect(activeTab(layout().main)).toMatchObject({ kind: 'channel', project: SMNS });
    expect(channelTabs()).toHaveLength(1);
  });

  it('stays registered with a Channel tab in front, whatever the sidebar holds of its project', () => {
    layout().openTab({ kind: 'channel', project: 'a-project-no-row-names' });
    expect(isActionEnabled('channel.open')).toBe(true);
    runAction('channel.open');
    expect(channelTabs().map((tab) => tab.kind === 'channel' && tab.project)).toEqual(['a-project-no-row-names']);
  });

  it('reads a New chat by the project it was made in', () => {
    useSessions.getState().addUnstarted(NEW_CHAT, { projectId: NORTH.id, createdAt: '2026-11-12T10:00:00.000Z' });
    layout().openTab({ kind: 'session', appSessionId: NEW_CHAT });
    expect(isActionEnabled('channel.open')).toBe(true);
  });

  it('follows the projects too: registered once the front session’s project gains its channel', () => {
    layout().openTab({ kind: 'session', appSessionId: IN_SCRATCH });
    expect(isActionEnabled('channel.open')).toBe(false);
    const joined = { ...SCRATCH, org: { key: 'smns:joined' as OrgKey, name: 'scratch', source: 'smns' as const, smnsId: 'joined' } };
    useSessions.setState({ projects: new Map([NORTH, joined].map((p) => [p.id, p])) });
    expect(isActionEnabled('channel.open')).toBe(true);
    runAction('channel.open');
    expect(activeTab(layout().main)).toMatchObject({ kind: 'channel', project: 'joined' });
  });

  // The review of M5: another machine's terminal session that this Mac knows only by its listing (lane A, no record) is
  // filed as the sidebar files its row, by the listing's project.
  it('reads a session known only by its listing, lane A, by the listing’s project: a hub registry row', () => {
    const HUB = '2a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
    const KEY = `id:${HUB}` as OrgKey;
    const terminal = addressOf(OTHER_MACHINE, 'term-a') as AppSessionId;
    const listing: ListedSession = { ...remoteRow(OTHER_MACHINE, 'term-a', { lane: 'A', orgKey: KEY, project: HUB }), appId: terminal };
    useSessions.setState({
      registry: { projects: [{ id: HUB, name: 'Orchard', hub: true, renamable: false, locations: [] }], keys: { [HUB]: KEY }, moved: {}, removals: [], seen: {} },
      listed: new Map([[terminal, listing]]),
    });
    layout().openTab({ kind: 'session', appSessionId: terminal });
    expect(isActionEnabled('channel.open')).toBe(true);
    runAction('channel.open');
    expect(activeTab(layout().main)).toMatchObject({ kind: 'channel', project: HUB });
  });

  it('reads a listing whose project’s checkouts here are all hidden by that project, as a hidden project’s session is read', () => {
    const terminal = addressOf(OTHER_MACHINE, 'term-h') as AppSessionId;
    const hidden = { ...NORTH, hidden: true };
    const listing: ListedSession = { ...remoteRow(OTHER_MACHINE, 'term-h', { lane: 'A', orgKey: `smns:${SMNS}` as OrgKey, project: SMNS }), appId: terminal };
    useSessions.setState({ projects: new Map([hidden, SCRATCH].map((p) => [p.id, p])), listed: new Map([[terminal, listing]]) });
    layout().openTab({ kind: 'session', appSessionId: terminal });
    expect(isActionEnabled('channel.open')).toBe(true);
    runAction('channel.open');
    expect(activeTab(layout().main)).toMatchObject({ kind: 'channel', project: SMNS });
  });

  // U13a merged: the row is `sessionRow`'s, the one the title bar's chip names, so nothing is read of a session whose
  // machine has not answered in this run, and the action follows that machine's first snapshot in.
  it('reads the row the chip reads: none until the session’s machine has answered, then its project’s', () => {
    useMachines.setState({ loaded: new Set() });
    layout().openTab({ kind: 'session', appSessionId: IN_NORTH });
    expect(sessionRow(IN_NORTH)).toBeUndefined();
    expect(isActionEnabled('channel.open')).toBe(false);
    useMachines.setState({ loaded: new Set([TEST_MACHINE]) });
    expect(sessionRow(IN_NORTH)).toBe(`smns:${SMNS}`);
    expect(isActionEnabled('channel.open')).toBe(true);
  });

  it('leaves nothing registered once disconnected', () => {
    layout().openTab({ kind: 'session', appSessionId: IN_NORTH });
    disconnect?.();
    disconnect = null;
    expect(isActionEnabled('channel.open')).toBe(false);
  });
});
