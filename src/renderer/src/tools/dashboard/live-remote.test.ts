// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, acceptance 6 "Capabilities light up"; the task
// review's finding 3): a dashboard of another machine whose connector surface that machine doesn't offer says so in the
// spec's words, "Connectors on <machine> need its app", where its views say a live pause. Driven through the renderer's
// real client (its refusal hook marks the offer), the real connector host and the tab's own wiring of its live datasets,
// over a preload whose other machine refuses `connectors.open` `not-offered`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { livePauseLabel, livePauseOf } from '@artifacts/dashboard/editor/live';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { createConnectorHost } from '../../artifacts/connectors';
import { recordArtifactMachine, resetArtifactMachines } from '../../artifacts/machines';
import { connectRemoteSurfaces, REMOTE_SURFACE_WORDS, resetRemoteSurfaces } from '../../artifacts/remote-surfaces';
import { createClient, onCommandRefused } from '../../ipc/client';
import { useMachines } from '../../stores/machines';
import type { DocumentTabDeps } from '../document/tab-state';
import { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const LOCAL_A = '1f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const AT = Date.UTC(2026, 10, 2, 9, 0);
const query = (tool: string, schedule?: number) =>
  ({
    title: `Live ${tool}`,
    source: { kind: 'query', server: 'fixture', tool, args: {}, ...(schedule !== undefined && { schedule }), snapshot: null },
    columns: [],
    rows: 0,
    state: { status: 'ok', at: AT },
  }) as DatasetDescriptor;

// The preload: the other machine serves no connectors (`not-offered`); this Mac's lease opens, the rest it refuses plainly
function preload() {
  const sent: [CommandName, MachineRef | undefined][] = [];
  const bridge = {
    localMachine: TEST_MACHINE,
    invoke: (name: CommandName, _input: unknown, target?: MachineRef | { machine: MachineRef }) => {
      const machine = typeof target === 'string' ? target : target?.machine;
      sent.push([name, machine]);
      if (machine === OTHER_MACHINE) return Promise.resolve({ ok: false, error: { code: 'internal', message: `${name}: not offered`, issues: { refusal: 'not-offered' } } });
      if (name === 'connectors.open') return Promise.resolve({ ok: true, value: { leaseId: '22222222-2222-4222-8222-222222222222' } });
      if (name === 'artifacts.connectorGrants') return Promise.resolve({ ok: true, value: { grants: [] } });
      return Promise.resolve({ ok: false, error: { code: 'internal', message: `${name}: not here` } });
    },
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as PreloadBridge;
  return { client: createClient(() => bridge), sent };
}

function tabOf(artifactId: string, client: ReturnType<typeof preload>['client']) {
  const doc = newDoc();
  setDataset(doc, 'sales', query('rows', 60));
  setDataset(doc, 'manual', query('totals'));
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const handle = { doc, awareness: null, state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, holdRemote: () => {}, close: () => {} } as unknown as DocumentHandle;
  const host = { ...createConnectorHost(client), open: async () => handle, identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }) } as unknown as ArtifactHost;
  const deps: DocumentTabDeps = { host, ipc: client, log: () => {}, confirm: () => true, sessionTitle: () => undefined, sessions: () => [] };
  const tab = new DashboardTabState({ artifactId, kind: 'dashboard', surface: 'panel' }, deps);
  tabs.push(tab);
  return tab;
}
const said = (tab: DashboardTabState, id: string) => {
  const pause = livePauseOf(tab.live.snapshot().queries.get(id));
  return pause && livePauseLabel(pause); // the view's label, as chart-view.ts reads it
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const tabs: DashboardTabState[] = [];
const ends: (() => void)[] = [];
afterEach(() => {
  for (const tab of tabs.splice(0)) tab.dispose();
  for (const end of ends.splice(0)) end();
  resetArtifactMachines();
  resetRemoteSurfaces();
  useMachines.setState({ machines: new Map() });
});

describe('a remote dashboard whose machine doesn’t offer its connectors', () => {
  it('says “Connectors on <machine> need its app” where its scheduled and manual queries’ views say a pause', async () => {
    const { client } = preload();
    ends.push(connectRemoteSurfaces(client, onCommandRefused));
    recordArtifactMachine(A, OTHER_MACHINE, TEST_MACHINE);
    useMachines.setState({ machines: new Map<MachineRef, MachineState>([[OTHER_MACHINE, { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-02T00:00:00Z', generation: 1 }]]) });
    const tab = tabOf(A, client);
    await vi.waitFor(() => expect(tab.document.snapshot().ready).toBe(true));
    tab.setBodyShown(true);
    await settle();
    expect(said(tab, 'sales')).toBe('Connectors on mini need its app');
    expect(said(tab, 'sales')).toBe(REMOTE_SURFACE_WORDS.connectorsNeedApp('mini')); // the Connectors sheet's words
    expect(said(tab, 'manual')).toBeNull(); // a manual query is asked nothing until the owner's Refresh
    await tab.live.refresh('manual');
    expect(said(tab, 'manual')).toBe('Connectors on mini need its app');
  });

  it('says nothing of the kind for this Mac’s dashboard', async () => {
    const { client } = preload();
    ends.push(connectRemoteSurfaces(client, onCommandRefused));
    const tab = tabOf(LOCAL_A, client);
    await vi.waitFor(() => expect(tab.document.snapshot().ready).toBe(true));
    tab.setBodyShown(true);
    await settle();
    expect(said(tab, 'sales')).toBe('paused: not allowed'); // its own pause: no grant yet
  });
});
