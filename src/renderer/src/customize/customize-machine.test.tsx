// P5 O6 M4 (the task review): Customize is this machine's until O4, so its pages are only this machine's projects,
// directories and live sessions: another machine's same path is never read or changed here as if it were this one's.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { CustomizeView } from './CustomizeView';
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
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomizeView section="skills" /></QueryClientProvider>);
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
