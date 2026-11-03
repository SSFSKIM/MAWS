// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, acceptance 6): the Connectors sheet of another
// machine's artifact is drawn from the device's rights there (`link.rights`, the latest `remote.session` of that machine)
// and the machine's offer (a `not-offered` refusal it gave), never from the lane or the machine: a part either lacks is
// greyed with why, and a refusal there is said in its words.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ConnectorDeclareOutcome, ConnectorToolRef } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ConnectorServerRow } from '@shared/ipc/schema/connectors';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../../test/support/machine';
import { ArtifactCommandError } from '../../../../artifacts/command-error';
import type { ConnectorsOwner } from '../../../../artifacts/connector-owner';
import { recordArtifactMachine, resetArtifactMachines } from '../../../../artifacts/machines';
import { connectRemoteSurfaces, heardRefusal, REMOTE_SURFACE_WORDS as W, resetRemoteSurfaces } from '../../../../artifacts/remote-surfaces';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../../../lane-b/remote-session';
import { remoteSessionState } from '../../../../lane-b/test-support/remote-session';
import { useMachines } from '../../../../stores/machines';
import { ConnectorsSheet } from './ConnectorsSheet';
import type { PagePort } from './relay';
import { ConnectorsTab } from './tab';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const HANDLE = '22222222-2222-4222-8222-222222222223';
const ROWS: ConnectorServerRow[] = [{ kind: 'source', handle: HANDLE, server: 'wiki', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', tools: ['page'], needsDiscovery: true, connection: { state: 'needsConnect' } }];
const TOOL = { server: 'wiki', tool: 'page' };
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

// the device's link to the other machine as one of its sessions' `remote.session` says it
const linkSays = (rights: ('spawn' | 'shell' | 'machine-admin')[], member: string | null = 'member-1') =>
  act(() => applyRemoteSession(remoteSessionState(addressOf(OTHER_MACHINE, 'session-b' as AppSessionId), { link: { state: 'up', carrier: 'relay', refusal: null, member, rights } })));

function setup(lease: 'opens' | 'refused' = 'opens') {
  const owner: ConnectorsOwner = {
    servers: vi.fn(async () => ({ servers: ROWS, saved: 'ok' as const, withdrawnUnattributed: false })),
    connect: vi.fn(async () => ({ accepted: true }) as const),
    reconnect: vi.fn(async () => ({ accepted: true }) as const),
    disconnect: vi.fn(async () => ({ accepted: true }) as const),
    onServersChanged: vi.fn(() => () => {}),
  };
  const declared = (tools: ConnectorToolRef[]): ConnectorDeclareOutcome => (lease === 'opens' ? { ok: true, declared: tools } : { ok: false, state: 'invalid', reason: 'lease' });
  const host = {
    openConnectors: vi.fn(() => ({ declareTools: vi.fn(async (tools: ConnectorToolRef[]) => declared(tools)), setVisible: vi.fn(), close: vi.fn() })),
    connectorGrants: vi.fn(async () => []),
    grantConnectorTool: vi.fn(),
    revokeConnectorTool: vi.fn(),
  };
  const tab = new ConnectorsTab(ARTIFACT, { host: host as never, startSession: vi.fn(), owner });
  tabs.push(tab);
  const port: PagePort & { send(data: unknown): void } = { onmessage: null, postMessage: () => {}, close: () => {}, send(data) { this.onmessage?.({ data } as MessageEvent); } };
  tab.attach(port);
  port.send({ id: 1, op: 'declare', tools: [TOOL] });
  return { tab, owner, host, port };
}
const tabs: ConnectorsTab[] = [];
const open = async (tab: ConnectorsTab) => {
  tab.openSheet();
  render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
  await flush();
};
const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
// P5 O7 M5c (the architect's ruling on Touch ID at the sheet's opening): another machine's rows are read by the owner's
// explicit action, so the confirmation `machine-admin` asks there comes from that action
const SHOW = 'Show the connectors on mini';
const showServers = async () => {
  fireEvent.click(screen.getByRole('button', { name: SHOW }));
  await flush();
};

beforeEach(() => {
  recordArtifactMachine(ARTIFACT, OTHER_MACHINE, TEST_MACHINE);
  useMachines.setState({ machines: new Map<MachineRef, MachineState>([[OTHER_MACHINE, { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-02T00:00:00Z', generation: 1 }]]) });
});
afterEach(() => {
  for (const tab of tabs.splice(0)) tab.dispose();
  cleanup();
  resetArtifactMachines();
  resetRemoteLaneBStore();
  resetRemoteSurfaces();
  useMachines.setState({ machines: new Map() });
});

describe('greyed by the device’s rights there', () => {
  it('greys the grants and the servers without machine-admin, reads no rows, and reads them once the right is heard', async () => {
    linkSays(['spawn', 'shell']);
    const { tab, owner } = setup();
    await open(tab);
    expect(disabled('Allow wiki · page to read')).toBe(true);
    expect(disabled('Allow wiki · page once')).toBe(true);
    expect(text('[data-connectors-grants-greyed]')).toBe(W.needsAdmin('mini'));
    expect(text('[data-connectors-servers-greyed]')).toBe(W.needsAdmin('mini'));
    expect(owner.servers).not.toHaveBeenCalled();
    await tab.connectServer(HANDLE); // a gesture that reaches the tab anyway acts on nothing
    expect(owner.connect).not.toHaveBeenCalled();

    linkSays(['spawn', 'shell', 'machine-admin']);
    await flush();
    expect(owner.servers).not.toHaveBeenCalled(); // the right lets the owner read them; the owner's action reads them
    expect(disabled('Allow wiki · page to read')).toBe(false);
    expect(text('[data-connectors-grants-greyed]')).toBeNull();
    expect(text('[data-connectors-servers-greyed]')).toBeNull();
    await showServers();
    expect(owner.servers).toHaveBeenCalled();
    expect(disabled('Connect MAWS to wiki')).toBe(false);
  });

  it('greys nothing while the rights there are not known: no session heard, or no member yet', async () => {
    const { tab } = setup();
    await open(tab);
    expect(text('[data-connectors-servers-ask]')).toBe('Connectors on mini');
    linkSays([], null); // before the first caps
    await flush();
    expect(text('[data-connectors-servers-greyed]')).toBeNull();
    expect(disabled('Allow wiki · page to read')).toBe(false);
  });

  it('greys nothing of this Mac’s artifact, whatever another machine’s link says', async () => {
    resetArtifactMachines();
    linkSays([]);
    const { tab, owner } = setup();
    await open(tab);
    expect(owner.servers).toHaveBeenCalled();
    expect(text('[data-connectors-grants-greyed]')).toBeNull();
  });
});

describe('another machine’s rows, read on the owner’s action', () => {
  it('opens the sheet with no machine-admin call, says “Connectors on <machine>” with an action that reads them, and asks again at the next opening', async () => {
    linkSays(['machine-admin']);
    const { tab, owner, host, port } = setup();
    await open(tab);
    const adminCalls = () => [owner.servers, owner.connect, owner.reconnect, owner.disconnect, host.grantConnectorTool, host.revokeConnectorTool].map((fn) => (fn as unknown as Mock).mock.calls.length).reduce((sum, n) => sum + n, 0);
    expect(adminCalls()).toBe(0);
    expect(text('[data-connectors-servers-ask]')).toBe('Connectors on mini');
    expect(screen.queryByRole('button', { name: 'Connect MAWS to wiki' })).toBeNull();
    port.send({ id: 2, op: 'declare', tools: [{ server: 'wiki', tool: 'other' }] }); // the page's tools changed: still not read
    await flush();
    expect(adminCalls()).toBe(0);
    await showServers();
    expect(owner.servers).toHaveBeenCalledOnce();
    expect(text('[data-connectors-servers-ask]')).toBeNull();
    expect(disabled('Connect MAWS to wiki')).toBe(false);
    act(() => tab.closeSheet());
    act(() => tab.openSheet());
    await flush();
    expect(owner.servers).toHaveBeenCalledOnce(); // a new opening asks again
    expect(text('[data-connectors-servers-ask]')).toBe('Connectors on mini');
  });

  // P5 O7 M5c review 1: each read there is `machine-admin`, a Touch ID of its own, so after Show nothing reads them
  // unasked: what would read them again marks them stale, and the owner's Refresh reads them, once each
  it('after Show, marks the rows stale at every change instead of reading them, and reads them again only at Refresh', async () => {
    linkSays(['machine-admin']);
    const { tab, owner, port } = setup();
    let serversChanged: ((artifactId: string) => void) | null = null;
    vi.mocked(owner.onServersChanged).mockImplementation((listener) => ((serversChanged = listener), () => {}));
    await open(tab);
    await showServers();
    expect(owner.servers).toHaveBeenCalledOnce();
    expect(text('[data-connectors-servers-stale]')).toBeNull();
    expect(screen.queryByRole('button', { name: W.refreshConnectorsLabel('mini') })).toBeNull();
    // main's word, the page's tools, the grants read again, the rights heard again, an owner action: none reads there
    act(() => serversChanged!(ARTIFACT));
    port.send({ id: 2, op: 'declare', tools: [{ server: 'wiki', tool: 'other' }] });
    await act(() => tab.readGrants());
    linkSays([]);
    await flush();
    linkSays(['machine-admin']);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to wiki' }));
    await flush();
    expect(owner.connect).toHaveBeenCalledOnce();
    expect(owner.servers).toHaveBeenCalledOnce();
    expect(text('[data-connectors-servers-stale]')).toBe(W.connectorsMayBeStale('mini'));
    expect(screen.getByRole('button', { name: 'Connect MAWS to wiki' })).toBeTruthy(); // the rows still shown
    const refresh = screen.getByRole('button', { name: W.refreshConnectorsLabel('mini') });
    expect(refresh.textContent).toBe(W.refreshConnectors);
    fireEvent.click(refresh);
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(2);
    expect(text('[data-connectors-servers-stale]')).toBeNull();
    expect(screen.queryByRole('button', { name: W.refreshConnectorsLabel('mini') })).toBeNull();
    // the next opening asks again, with nothing stale
    act(() => tab.closeSheet());
    act(() => tab.openSheet());
    await flush();
    expect(tab.view.getState().serversStale).toBe(false);
    expect(owner.servers).toHaveBeenCalledTimes(2);
  });

  it('offers Refresh when the owner’s read there failed, and reads nothing until it is pressed', async () => {
    linkSays(['machine-admin']);
    const { tab, owner, port } = setup();
    vi.mocked(owner.servers).mockRejectedValueOnce(new ArtifactCommandError({ code: 'host_unavailable', message: 'connectors.servers: machine mini is not reachable' }));
    await open(tab);
    await showServers();
    port.send({ id: 2, op: 'declare', tools: [{ server: 'wiki', tool: 'other' }] });
    await flush();
    expect(owner.servers).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: W.refreshConnectorsLabel('mini') }));
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Connect MAWS to wiki' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: W.refreshConnectorsLabel('mini') })).toBeNull();
  });
});

describe('greyed by the machine’s offer', () => {
  it('says connectors on a machine that offers no leases need its app, until its feed opens again', async () => {
    const bus = new Map<string, (payload: unknown, from: { machine: MachineRef }) => void>();
    const stop = connectRemoteSurfaces({ localMachine: TEST_MACHINE, on: ((name: string, listener: never) => (bus.set(name, listener), () => bus.delete(name))) as never });
    const { tab } = setup('refused');
    await flush();
    expect(tab.view.getState().leaseRefused).toBe(true); // the page asked and found no lease: the header shows Connectors
    heardRefusal('connectors.open', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE);
    heardRefusal('connectors.open', { issues: { refusal: 'not-offered' } }, TEST_MACHINE, TEST_MACHINE); // this Mac's own: not an offer
    await open(tab);
    expect(text('[data-connectors-greyed]')).toBe(W.connectorsNeedApp('mini'));
    act(() => bus.get('artifacts.resync')!({}, { machine: OTHER_MACHINE }));
    expect(text('[data-connectors-greyed]')).toBeNull();
    stop();
  });

  it('greys the servers a machine doesn’t serve, in the same words', async () => {
    heardRefusal('connectors.servers', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE);
    const { tab, owner } = setup();
    await open(tab);
    expect(text('[data-connectors-servers-greyed]')).toBe(W.connectorsNeedApp('mini'));
    expect(owner.servers).not.toHaveBeenCalled();
  });
});

describe('a refusal there, in words', () => {
  it('says a grant the machine refused in its words, not as a route that failed, until a gesture succeeds', async () => {
    linkSays(['machine-admin']);
    const { tab, host } = setup();
    await open(tab);
    vi.mocked(host.grantConnectorTool).mockRejectedValueOnce(new ArtifactCommandError({ code: 'internal', message: 'artifacts.grantConnectorTool: refused grade by machine mini', issues: { refusal: 'grade' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow wiki · page to read' }));
    await flush();
    expect(text('[data-connector-detail]')).toBe(` · ${W.noRight('mini')}`);
    vi.mocked(host.grantConnectorTool).mockResolvedValueOnce({ ok: true, grant: { ...TOOL, fingerprint: 'f', mode: 'read', grantedAt: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow wiki · page to read' }));
    await flush();
    expect(text('[data-connector-detail]') ?? '').not.toContain(W.noRight('mini'));
  });

  it('reads a busy acknowledgment as busy on the machine, and the machine’s own refusals as theirs', async () => {
    linkSays(['machine-admin']);
    const { tab, owner } = setup();
    await open(tab);
    await showServers();
    vi.mocked(owner.connect).mockResolvedValueOnce({ accepted: false, why: 'busy' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to wiki' }));
    await flush();
    expect(text('[data-connector-server-refusal]')).toBe(` · ${W.busyOn('mini')}`);
    vi.mocked(owner.connect).mockRejectedValueOnce(new ArtifactCommandError({ code: 'internal', message: 'connectors.connect: refused step-up-cancelled by machine mini', issues: { refusal: 'step-up-cancelled' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to wiki' }));
    await flush();
    expect(text('[data-connector-server-refusal]')).toBe(` · ${W.cancelled}`);
    vi.mocked(owner.connect).mockRejectedValueOnce(new ArtifactCommandError({ code: 'internal', message: 'connectors.connect: refused grade by machine mini', issues: { refusal: 'grade' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to wiki' }));
    await flush();
    expect(text('[data-connector-server-refusal]')).toBe(` · ${W.noRight('mini')}`);
    vi.mocked(owner.connect).mockRejectedValueOnce(new ArtifactCommandError({ code: 'host_unavailable', message: 'connectors.connect: machine mini is not reachable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to wiki' }));
    await flush();
    expect(text('[data-connector-server-refusal]')).toBe(` · ${W.offline('mini')}`);
  });
});
