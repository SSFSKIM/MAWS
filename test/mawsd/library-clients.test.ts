// The library's reads over machine.sock, per client (P5 O4 M3; docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// acceptance 6 and M3's Proves): `library.openExternally` from client A asks A alone, through the client port (OX4), to
// open the stored file, and settles `noClient` once the asking page has gone. The front is mawsd's, served as the daemon
// serves it; the library's reads are composed on its bus as the spine's root composes them, over an engine host that
// resolves the artifact's stored file.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { serveSocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { MachineRef } from '@shared/machine/ref';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { registerLibraryReads } from '../../src/services/library/files';
import { FakeEngineHost } from './fake-engine-host';
import { connectFront } from './front-client';

const TOKEN = 'library-clients-token';
const IDENTITY: SupervisorIdentity = { protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'test', capabilities: [], wire: 'test', pid: process.pid, startedAt: new Date().toISOString() };
const MACHINE = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };
const ART = '11111111-1111-4111-8111-111111111111';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

async function lab() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ml-'))); // a socket path stays under the 104-byte bound
  const path = join(dir, 'machine.sock');
  const stored = join(dir, 'report.pdf');
  writeFileSync(stored, '%PDF-1.4');
  const front: ServicesFront = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: new FakeEngineHost().hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => MACHINE,
    isApp: () => false,
    log: () => {},
  });
  const dispatch = (async (_owner: string, name: string) => {
    if (name !== 'artifacts.content') throw new Error(`unexpected ${name}`);
    return { ok: true, value: { revision: 1, kind: 'file', name: 'report.pdf', size: 8, sha256: 'x', path: stored } };
  }) as never;
  registerLibraryReads(front.bus.register, { hosts: { dispatch }, files: { readResolved: vi.fn() }, port: front.port, env: {}, artifactsRoot: '/no-exports-here' });
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
  cleanups.push(() => (front.close(), server.close(), rmSync(dir, { recursive: true, force: true })));
  return { stored, connect: (appPid: number) => connectFront(path, TOKEN, appPid, cleanups) };
}

describe('the library’s reads over machine.sock, per client', () => {
  it('opening a stored file asks the asking client alone, and settles no client once the asking page has gone', async () => {
    const { stored, connect } = await lab();
    const a = await connect(61);
    const b = await connect(62);
    const answer = a.request('library.openExternally', { artifactId: ART }, 'page:a');
    await vi.waitFor(() => expect(a.of('clientPort.request')).toHaveLength(1));
    expect(a.of('clientPort.request')[0]!.payload).toMatchObject({ kind: 'openExternal', client: 'page:a', request: { path: stored } });
    expect(b.of('clientPort.request')).toEqual([]); // only the asker is asked
    a.gone('page:a');
    expect(await answer).toMatchObject({ ok: true, value: { opened: false, message: 'no client' } });
  });
});
