// P5 O6 M4 (the task review): Customize is this machine's until O4, so its pages are only this machine's projects,
// directories and live sessions: another machine's same path is never read or changed here as if it were this one's.
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, C9): through both views and the four Show
// values, every command the page sends names this machine.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { addressOf, machineOf } from '@shared/machine/address';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { project, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { forgetKeptOperations } from '../widgets/plugins/operation';
import { mountCustomize } from '../test-support/customize-page';
import { openDiscover, useCustomizeProject } from './open';

const P = at('project-one' as ProjectId);
const R = addressOf(OTHER_MACHINE, 'project-b' as ProjectId); // B's project, at the same path as P
let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient({ 'plugins.env': { binary: null, binaryError: 'Unavailable', configHome: '/config', globalConfig: '/config/.claude.json' }, 'customization.inventory': { skills: [], servers: [], warnings: [], serversRead: true } });
  window.maws = preloadOf(fake);
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'One', directory: '/one' })], [R, project(R, 1, { name: 'On B', directory: '/one' })]]), records: new Map(), engine: new Map() });
});
afterEach(() => {
  cleanup();
  forgetKeptOperations();
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  useMachines.setState({ loaded: new Set() });
  useCustomizeProject.setState({ projectId: undefined }, true);
});
// U13a: the page's project is the current project, the row of the session in front
const front = (projectId: ProjectId) => {
  const id = addressOf(machineOf(projectId), 'session-in-front' as AppSessionId);
  useSessions.setState((s) => ({ records: new Map([...s.records, [id, record(id, { projectId })]]) }));
  useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) });
  useLayout.getState().openTab({ kind: 'session', appSessionId: id });
};
const mount = () => mountCustomize({ view: 'mine', show: 'skills' });
const inventoryCwds = () => fake.invoked('customization.inventory').map((input) => (input as { cwd: string | null }).cwd);

it('offers only this machine’s projects, and shows the user configuration when the focused project is another machine’s', async () => {
  front(R);
  mount();
  await waitFor(() => expect(inventoryCwds()).toEqual([null]));
  const options = [...(screen.getByRole('combobox', { name: 'Project' }) as HTMLSelectElement).options].map((o) => o.value);
  expect(options).toEqual(['', P]);
});

it('attaches only this machine’s live sessions in the page’s directory', async () => {
  front(P);
  const here = { ...status('live-here'), appSessionId: at('live-here' as AppSessionId), cwd: '/one' };
  const there = { ...status('live-there'), appSessionId: addressOf(OTHER_MACHINE, 'live-there' as AppSessionId), cwd: '/one' };
  useSessions.setState({ engine: new Map([[here.appSessionId, here], [there.appSessionId, there]]) });
  mount();
  await waitFor(() => expect(inventoryCwds()).toEqual(['/one']));
  const options = [...((await screen.findByRole('combobox', { name: 'Live session' })) as HTMLSelectElement).options].map((o) => o.value);
  expect(options).toEqual([here.appSessionId]);
});

it('Open Discover names this machine’s project for a directory, never another machine’s of the same path', () => {
  useSessions.setState({ projects: new Map([[R, project(R, 0, { name: 'On B', directory: '/two' })]]) });
  const strip = useLayout.getState().main;
  openDiscover('/two');
  expect(useCustomizeProject.getState()).toEqual({ projectId: null, directory: '/two' });
  expect(useLayout.getState().destination).toEqual({ kind: 'customize', view: 'discover', show: 'plugins' }); // UX wave U7b: a page, no tab
  expect(useLayout.getState().main).toBe(strip);
});

it('with another machine’s project in front and its session ready, every command of a walk through both views and the four Show values names this machine', async () => {
  front(R);
  const there = { ...status('live-there'), appSessionId: addressOf(OTHER_MACHINE, 'live-there' as AppSessionId), cwd: '/one' };
  useSessions.setState({ engine: new Map([[there.appSessionId, there]]) });
  mountCustomize({ view: 'mine', show: 'all' });
  await waitFor(() => expect(inventoryCwds()).toEqual([null])); // the user configuration's page
  const header = () => document.querySelector<HTMLElement>('[data-customize-header]')!;
  for (const view of ['My items', 'Discover'] as const) {
    fireEvent.click(within(header()).getByRole('radio', { name: view }));
    for (const show of ['All', 'Plugins', 'Skills', 'Connectors'] as const) {
      fireEvent.click(within(within(header()).getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name: show }));
      await act(async () => {});
      expect(screen.queryByRole('combobox', { name: 'Live session' })).toBeNull();
    }
  }
  const sent = [...new Set(fake.calls.filter((call) => call.startsWith('invoke ')).map((call) => call.slice('invoke '.length)))] as Parameters<FakeClient['machines']>[0][];
  expect(sent).toEqual(expect.arrayContaining(['customization.inventory', 'catalog.home']));
  expect(sent.filter((name) => fake.machines(name).some((machine) => machine !== TEST_MACHINE))).toEqual([]);
  expect(inventoryCwds().every((cwd) => cwd === null)).toBe(true);
});
