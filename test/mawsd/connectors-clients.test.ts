// The connectors over machine.sock, per client (P5 O4 M2; docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// acceptance 4 and M2's Proves): two clients of mawsd's services front open leases on one artifact; one client's page
// goes (`clientGone`) and its leases close, the operation it had running withdrawn from the engine host, while the
// other's lease keeps refreshing its watch; a sign-in hands the engine's authorization URL to the asking client alone
// through the client port (OX4) and fails as not opened once that client is gone. The front is mawsd's, served as the
// daemon serves it; the connectors and their sign-in are composed on its bus as the spine's root composes them, over
// the scripted engine host of the connector service's own suite.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { serveSocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { MachineRef } from '@shared/machine/ref';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { composeConnectors } from '../../src/services/connectors';
import { startSignIn } from '../../src/services/connectors/sign-in';
import { project, record } from '../support/builders';
import { CONNECTOR_ART as ART, FakeConnectorHost } from '../support/fake-connector-host';
import { fakeSpineView } from '../support/fake-spine-view';
import { FakeEngineHost } from './fake-engine-host';
import { connectFront } from './front-client';

const TOKEN = 'connectors-clients-token';
const IDENTITY: SupervisorIdentity = { protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'test', capabilities: [], wire: 'test', pid: process.pid, startedAt: new Date().toISOString() };
const MACHINE = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };
const ROWS = { server: 'fixture', tool: 'rows' };
const SESSION = 'a1111111-1111-4111-8111-111111111111';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

async function lab() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mk-'))); // a socket path stays under the 104-byte bound
  const path = join(dir, 'machine.sock');
  const front: ServicesFront = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: new FakeEngineHost().hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => MACHINE,
    isApp: () => false,
    log: () => {},
  });
  const host = new FakeConnectorHost();
  host.grants.set(JSON.stringify([ROWS.server, ROWS.tool]), 'read');
  const view = fakeSpineView({ records: [record('app-own', { projectId: 'proj' as never, directory: '/repo' })], projects: [project('proj', 0, { directory: '/repo' })] });
  const connectors = composeConnectors({
    hosts: { dispatch: host.dispatch as never, onEvent: host.onEvent as never, onState: host.onState as never, onStreaming: host.onStreaming as never, streaming: host.streaming as never },
    bus: front.bus,
    view,
    realpath: (p) => p,
    port: front.port,
    log: () => {},
  });
  // the engine's own MCP sign-in: a server needing auth, whose authorization URL waits for the browser
  let status: ((payload: { appSessionId: string; status: { process: string; cwd: string } }) => void) | null = null;
  const signIn = startSignIn({
    bus: front.bus,
    host: {
      call: (async (name: string, input: { redirectUri: string }) => {
        if (name === 'customization.serverEndpoints') return { ok: true, value: { servers: [{ name: 'linear', scope: 'user', path: '/cfg/.claude.json', transport: 'http', url: null }] } };
        if (name === 'session.mcpStatus') return { ok: true, value: { mcpServers: [{ name: 'linear', status: 'needs-auth', scope: 'user', transport: 'http' }] } };
        if (name === 'session.mcpAuthenticate') return { ok: true, value: { ok: true, answer: { authUrl: `http://127.0.0.1:9/authorize?redirect_uri=${encodeURIComponent(input.redirectUri)}`, requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 's' } } };
        throw new Error(`unexpected ${name}`);
      }) as never,
    },
    onSessionStatus: (listener) => ((status = listener), () => (status = null)),
    onHostLost: () => () => {},
    sessions: async () => [],
    hostStreaming: () => true,
    onHostStreaming: () => () => {},
    port: front.port,
    listen: async () => ({ port: 53_100, close: async () => {} }),
  });
  status!({ appSessionId: SESSION, status: { process: 'ready', cwd: '/repo' } });
  const server: Server = createServer();
  serveSocketClients(server, {
    many: { runtimeFor: (client) => front.runtimeFor(client) },
    badToken: 'close',
    identity: () => IDENTITY,
    counts: () => ({ liveSessions: 0, rows: 0 }),
    token: () => TOKEN,
    onExit: () => {},
    log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => (signIn.stop(), connectors.stop(), front.close(), server.close(), rmSync(dir, { recursive: true, force: true })));
  return { host, connect: (appPid: number) => connectFront(path, TOKEN, appPid, cleanups) };
}

type Client = Awaited<ReturnType<Awaited<ReturnType<typeof lab>>['connect']>>;

// A page's watching lease: the app's window report, the lease, its declaration, shown, and a watch of the rows
async function watching(client: Client, page: string): Promise<{ leaseId: string; watchId: string }> {
  expect(await client.request('connectors.windowShown', { shown: true }, page)).toMatchObject({ ok: true });
  const opened = (await client.request('connectors.open', { artifactId: ART }, page)) as { ok: true; value: { leaseId: string } };
  const { leaseId } = opened.value;
  expect(await client.request('connectors.declare', { leaseId, tools: [ROWS] }, page)).toMatchObject({ ok: true, value: { ok: true } });
  expect(await client.request('connectors.visibility', { leaseId, visible: true }, page)).toMatchObject({ ok: true });
  const watch = (await client.request('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } }, page)) as { ok: true; value: { ok: true; watchId: string } };
  return { leaseId, watchId: watch.value.watchId };
}
const updatesFor = (client: Client, leaseId: string) => client.of('connectors.watchUpdate').filter((event) => event.payload.leaseId === leaseId);

describe('the connectors over machine.sock, per client', () => {
  it('one page’s end closes its leases, withdrawing what it ran, while the other client’s lease keeps refreshing', async () => {
    const { host, connect } = await lab();
    host.endAtStart = true; // each operation ends as it starts: a watch's first refresh publishes at once
    const a = await connect(41);
    const b = await connect(42);
    const mine = await watching(a, 'page:a');
    const theirs = await watching(b, 'page:b');
    await vi.waitFor(() => expect(updatesFor(b, mine.leaseId).length).toBeGreaterThan(0)); // D9: every update to every client
    await vi.waitFor(() => expect(updatesFor(b, theirs.leaseId).length).toBeGreaterThan(0));

    // a call of A's left running in the engine host when its page goes
    host.endAtStart = false;
    a.send('connectors.call', { leaseId: mine.leaseId, request: ROWS }, 'page:a');
    await vi.waitFor(() => expect(host.started()).toHaveLength(3));
    const running = host.started().at(-1)!;
    a.gone('page:a');
    await vi.waitFor(() => expect(host.dispatched).toContainEqual({ name: 'connectors.cancel', input: { operationId: running } }));

    host.endAtStart = true;
    const heardMine = updatesFor(b, mine.leaseId).length;
    const heardTheirs = updatesFor(b, theirs.leaseId).length;
    expect(await b.request('connectors.refresh', { leaseId: theirs.leaseId, watchId: theirs.watchId }, 'page:b')).toMatchObject({ ok: true, value: { refreshing: true } });
    await vi.waitFor(() => expect(updatesFor(b, theirs.leaseId).length).toBeGreaterThan(heardTheirs));
    expect(updatesFor(b, mine.leaseId)).toHaveLength(heardMine); // A's watch ended with its lease
    // A's lease is gone for a page of A's that asks again
    expect(await a.request('connectors.refresh', { leaseId: mine.leaseId, watchId: mine.watchId }, 'page:a2')).not.toMatchObject({ ok: true, value: { refreshing: true } });
  });

  it('a sign-in asks the asking client alone to open the authorization URL, and fails as not opened once that client is gone', async () => {
    const { connect } = await lab();
    const a = await connect(51);
    const b = await connect(52);
    const started = (await a.request('connectors.signIn', { name: 'linear', scope: 'user', cwd: null, path: '/cfg/.claude.json', appSessionId: SESSION }, 'page:a')) as { ok: true; value: { opId: string } };
    const { opId } = started.value;
    await vi.waitFor(() => expect(a.of('clientPort.request')).toHaveLength(1));
    expect(a.of('clientPort.request')[0]!.payload).toMatchObject({ kind: 'openExternal', client: 'page:a' });
    expect(b.of('clientPort.request')).toEqual([]); // only the asker is asked
    a.leave();
    await vi.waitFor(() => expect(b.of('connectors.signInChanged').filter((event) => event.payload.opId === opId).at(-1)?.payload).toMatchObject({ state: 'failed', message: 'the authorization URL was not opened: no client' }));
  });
});
