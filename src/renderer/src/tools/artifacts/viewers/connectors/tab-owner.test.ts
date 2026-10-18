// P3-HD M3c2: a tab's MAWS server rows over the owner's dependency (./tab.ts; docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, Decision Log 29): read on the sheet's opening, again on main's targeted invalidation and on a change of
// the tools while open; superseded and post-disposal answers dropped; an owner action acknowledged, then read again.
// Without the dependency (H's tab) nothing is read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorServers } from '@shared/ipc/schema/connectors';
import type { ConnectorsOwner } from '../../../../artifacts/connector-owner';
import type { PagePort } from './relay';
import { ConnectorsTab } from './tab';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const HANDLE = '22222222-2222-4222-8222-222222222222';
const READ = { server: 'notes', tool: 'search' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const answer = (server: string): ConnectorServers => ({
  servers: [{ kind: 'source', handle: HANDLE, server, scope: 'user', transport: 'stdio', path: '/h/.claude.json', tools: ['search'], needsDiscovery: true }],
  saved: 'ok',
  withdrawnUnattributed: false,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(owner?: Partial<ConnectorsOwner>) {
  let changed: ((artifactId: string) => void) | null = null;
  const unlisten = vi.fn();
  const full: ConnectorsOwner = {
    servers: vi.fn(async () => answer('notes')),
    connect: vi.fn(async () => ({ accepted: true }) as const),
    reconnect: vi.fn(async () => ({ accepted: true }) as const),
    disconnect: vi.fn(async () => ({ accepted: true }) as const),
    onServersChanged: vi.fn((listener: (artifactId: string) => void) => {
      changed = listener;
      return unlisten;
    }),
    ...owner,
  };
  const host = {
    openConnectors: vi.fn(() => ({ declareTools: vi.fn(async (tools: unknown[]) => ({ ok: true as const, declared: tools })), setVisible: vi.fn(), close: vi.fn() })),
    connectorGrants: vi.fn(async () => [{ server: 'notes', tool: 'archive', fingerprint: 'f', mode: 'read' as const, grantedAt: 1 }]),
    grantConnectorTool: vi.fn(),
    revokeConnectorTool: vi.fn(),
  };
  const tab = new ConnectorsTab(ARTIFACT, { host: host as never, startSession: vi.fn(), owner: full });
  const port: PagePort & { send(data: unknown): void } = { onmessage: null, postMessage: () => {}, close: () => {}, send(data) { this.onmessage?.({ data } as MessageEvent); } };
  tab.attach(port);
  return { tab, owner: full, port, unlisten, changed: (artifactId: string) => changed?.(artifactId) };
}

afterEach(() => vi.restoreAllMocks());

describe('a tab’s MAWS server rows', () => {
  it('reads nothing without the owner’s dependency (H’s tab)', async () => {
    const tab = new ConnectorsTab(ARTIFACT, { host: { openConnectors: vi.fn(), connectorGrants: vi.fn(), grantConnectorTool: vi.fn(), revokeConnectorTool: vi.fn() } as never, startSession: vi.fn() });
    tab.openSheet();
    await flush();
    expect(tab.owned).toBe(false);
    expect(tab.view.getState().servers.rows).toBeNull();
  });

  it('reads on the sheet’s opening, for the declared tools then the granted ones', async () => {
    const { tab, owner, port } = setup();
    port.send({ id: 1, op: 'declare', tools: [READ] });
    await tab.readGrants();
    expect(owner.servers).not.toHaveBeenCalled(); // not before the sheet opens
    tab.openSheet();
    await flush();
    expect(owner.servers).toHaveBeenLastCalledWith(ARTIFACT, [READ, { server: 'notes', tool: 'archive' }]);
    expect(tab.view.getState().servers.rows).toEqual(answer('notes').servers);
  });

  it('drops a superseded read and one that answers after the tab went', async () => {
    const reads = [deferred<ConnectorServers>(), deferred<ConnectorServers>(), deferred<ConnectorServers>()];
    let at = 0;
    const { tab, unlisten, changed } = setup({ servers: vi.fn(() => {
        const read = reads[at]!;
        at += 1;
        return read.promise;
      }) });
    tab.openSheet();
    changed(ARTIFACT);
    reads[1]!.resolve(answer('newer'));
    await flush();
    reads[0]!.resolve(answer('older'));
    await flush();
    expect(tab.view.getState().servers.rows?.[0]).toMatchObject({ server: 'newer' });
    changed(ARTIFACT);
    tab.dispose();
    expect(unlisten).toHaveBeenCalled();
    reads[2]!.resolve(answer('late'));
    await flush();
    expect(tab.view.getState().servers.rows?.[0]).toMatchObject({ server: 'newer' });
  });

  it('reads again on this artifact’s invalidation while the sheet is open, and on a change of its tools', async () => {
    const { tab, owner, port, changed } = setup();
    tab.openSheet();
    await flush();
    changed('99999999-9999-4999-8999-999999999999'); // another artifact's
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(1);
    changed(ARTIFACT);
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(2);
    port.send({ id: 1, op: 'declare', tools: [READ] });
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(3);
    tab.closeSheet();
    changed(ARTIFACT);
    await flush();
    expect(owner.servers).toHaveBeenCalledTimes(3); // closed: the next opening reads
  });

  it('acknowledges an action, keeps a refusal by its target, and reads the rows again', async () => {
    const ack = deferred<{ accepted: false; why: 'busy' }>();
    const { tab, owner } = setup({ connect: vi.fn(() => ack.promise) });
    tab.openSheet();
    await flush();
    const connecting = tab.connectServer(HANDLE);
    expect(tab.view.getState().serverBusy).toBe(HANDLE);
    ack.resolve({ accepted: false, why: 'busy' });
    await connecting;
    expect(tab.view.getState()).toMatchObject({ serverBusy: null, servers: { refused: { target: HANDLE, why: 'busy' } } });
    expect(owner.servers).toHaveBeenCalledTimes(2);
    await tab.disconnectServer('33333333-3333-4333-8333-333333333333');
    expect(owner.disconnect).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
    expect(tab.view.getState().servers.refused).toBeNull();
  });
});
