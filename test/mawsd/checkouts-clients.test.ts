// The checkouts over machine.sock, per client (P5 O3-E M2; docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md,
// acceptance 2 and 3): two clients of mawsd's services front watch the same repository root and the same session
// directory; one client's page goes (`clientGone`) and its holds are released while the other's keep `git.changed` and
// `files.changed` coming; a connection's end releases what its pages still held; a watch in flight when its page ended
// holds nothing once it completes; and `files.reveal` asks the asking client through the client port (OX4), settled
// `noClient` once that client is gone. The front is mawsd's, served as the daemon serves it; the checkouts are composed
// on its bus as the spine's root composes them, over a fake view holding one session in a scratch repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { serveSocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import type { AppSessionId } from '@shared/graph/ids';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { MachineRef } from '@shared/machine/ref';
import type { ServicesBus } from '@shared/spine/bus';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { startCheckouts } from '../../src/services/checkouts-root';
import { record } from '../support/builders';
import { captureConsole } from '../support/console-capture';
import { fakeSpineView } from '../support/fake-spine-view';
import { FakeEngineHost } from './fake-engine-host';
import { connectFront } from './front-client';

const TOKEN = 'checkouts-clients-token';
const IDENTITY: SupervisorIdentity = { protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'test', capabilities: [], wire: 'test', pid: process.pid, startedAt: new Date().toISOString() };
const MACHINE = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };
const APP = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

async function lab() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mc-'))); // a socket path stays under the 104-byte bound
  const path = join(dir, 'machine.sock');
  const repository = join(dir, 'repo');
  mkdirSync(join(repository, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repository]);
  writeFileSync(join(repository, 'src', 'a.ts'), 'export {};\n');
  const front: ServicesFront = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: new FakeEngineHost().hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => MACHINE,
    isApp: () => false,
    log: () => {},
  });
  // what each checkout handler answered, whoever it went to (a gone client's answer goes nowhere)
  const answered: { name: string; value: unknown }[] = [];
  const bus: ServicesBus = {
    ...front.bus,
    register: (name, handler) =>
      front.bus.register(name, (async (input: never, context: never) => {
        const value = await handler(input, context);
        answered.push({ name, value });
        return value;
      }) as typeof handler),
  };
  const checkouts = startCheckouts({ view: fakeSpineView({ records: [record(APP, { directory: repository })] }), bus, clientPort: front.port, engineEnv: Promise.resolve({}), env: {}, uploadRoots: null });
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
  cleanups.push(() => (checkouts.stop(), front.close(), server.close(), rmSync(dir, { recursive: true, force: true })));
  return { repository, answered, connect: (appPid: number) => connectFront(path, TOKEN, appPid, cleanups) };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the checkouts over machine.sock, per client', () => {
  it('git.watch: one page’s end releases its holds while the other client keeps git.changed; a connection’s end releases the rest; a watch in flight at its page’s end holds nothing', async () => {
    const lines = captureConsole('log', /^\[git\] /);
    const { repository, connect } = await lab();
    const a = await connect(11);
    const b = await connect(12);
    expect(await a.request('git.watch', { directory: repository }, 'page:a')).toMatchObject({ ok: true, value: { repoRoot: repository } });
    expect(await b.request('git.watch', { directory: join(repository, 'src') }, 'page:b')).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b.of('git.changed')).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ repoRoot: repository, reason: 'initial' }) })));
    expect(lines.lines()).toEqual([`[git] watching ${repository}`]);

    a.gone('page:a');
    await settle(100);
    expect(lines.lines()).toHaveLength(1); // b still holds the root
    const before = b.of('git.changed').length;
    writeFileSync(join(repository, 'src', 'b.ts'), 'export const b = 1;\n');
    await vi.waitFor(() => expect(b.of('git.changed').length).toBeGreaterThan(before), { timeout: 10_000 });

    b.leave(); // its page never said gone: the connection's end releases it
    await vi.waitFor(() => expect(lines.lines()).toEqual([`[git] watching ${repository}`, `[git] released ${repository}`]));

    // a watch whose page ends before it completes is dropped as it completes, never held
    const c = await connect(13);
    c.send('git.watch', { directory: repository }, 'page:c');
    c.gone('page:c');
    await settle(500);
    expect(lines.lines()).toHaveLength(2);
    const quiet = c.of('git.changed').length;
    writeFileSync(join(repository, 'src', 'c.ts'), 'export const c = 1;\n');
    await settle(1_000);
    expect(c.of('git.changed')).toHaveLength(quiet);
  });

  it('files.watch: one page’s end releases its hold while the other client keeps files.changed; a connection’s end releases the rest; a watch in flight at its page’s end holds nothing', async () => {
    const { repository, connect } = await lab();
    const src = join(repository, 'src');
    const a = await connect(21);
    const b = await connect(22);
    const observer = await connect(23); // watches nothing: hears whatever the front posts
    expect(await a.request('files.watch', { appSessionId: APP, path: src }, 'page:a')).toMatchObject({ ok: true });
    expect(await b.request('files.watch', { appSessionId: APP, path: src }, 'page:b')).toMatchObject({ ok: true });
    a.gone('page:a');
    await settle(100);
    writeFileSync(join(src, 'one.ts'), '1\n');
    await vi.waitFor(() => expect(observer.of('files.changed')).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ appSessionId: APP, path: join(src, 'one.ts') }) })), { timeout: 10_000 });

    b.leave();
    await settle(300);
    const heard = observer.of('files.changed').length;
    writeFileSync(join(src, 'two.ts'), '2\n');
    await settle(1_000);
    expect(observer.of('files.changed')).toHaveLength(heard); // nobody holds the directory

    const c = await connect(24);
    c.send('files.watch', { appSessionId: APP, path: src }, 'page:c');
    c.gone('page:c');
    await settle(500);
    writeFileSync(join(src, 'three.ts'), '3\n');
    await settle(1_000);
    expect(observer.of('files.changed')).toHaveLength(heard);
  });

  it('files.reveal asks the asking client through the client port, and settles noClient once that client is gone', async () => {
    const { repository, answered, connect } = await lab();
    const a = await connect(31);
    const b = await connect(32);
    const file = join(repository, 'src', 'a.ts');
    a.send('files.reveal', { appSessionId: APP, path: file }, 'page:a');
    await vi.waitFor(() => expect(a.of('clientPort.request')).toHaveLength(1));
    expect(a.of('clientPort.request')[0]!.payload).toMatchObject({ kind: 'reveal', client: 'page:a' });
    expect(b.of('clientPort.request')).toEqual([]); // only the asker is asked
    a.leave();
    await vi.waitFor(() => expect(answered.filter((entry) => entry.name === 'files.reveal')).toEqual([{ name: 'files.reveal', value: { revealed: false, message: expect.any(String) } }]));
  });
});
