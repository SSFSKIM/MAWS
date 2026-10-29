// The stand-in (P5 O6 M3, "The stand-in"; acceptance 9): the real adapter over a real socket, against a router with
// handlers registered, reached by a real socket link; its directory's and files' modes, the symlink refusal, and the peer
// check with a fake addon (another uid, then no addon at all).
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import { REGISTRY } from '@shared/ipc/registry';
import type { MachineRef } from '@shared/machine/ref';
import { connectLines } from '../../../test/support/socket-lines';
import type { PeerAddon } from '../browser/cua/peer';
import { emit } from '../ipc/events';
import { CommandFailure, createRouter } from '../ipc/router';
import type { MachineLink } from './manager';
import { SERVE_DIR, serveMachineStandIn, type StandIn } from './serve-standin';
import { createSocketLink, MACHINE_SOCKET, MACHINE_TOKEN } from './socket-link';

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, BrowserWindow: { fromWebContents: () => null } }));

const B = 'StandinBMachineRef0000' as MachineRef;
const IDENTITY = { ref: B, name: 'standin-b', project: { key: `machine:${B}`, name: 'standin-b', smnsId: null } };
const TIMING = { fastRetryMs: 30, slowRetryMs: 60, helloTimeoutMs: 500, requestTimeoutMs: 1_000 };
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });
const addon = (uid: number | undefined): PeerAddon => ({ peer: () => ({ pid: process.pid, uid: uid ?? -1 }), process: () => null, version: 1 });
const mode = (path: string) => lstatSync(path).mode & 0o777;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function profile(): string {
  const userData = mkdtempSync(join(tmpdir(), 'maws-standin-'));
  cleanups.push(() => rmSync(userData, { recursive: true, force: true }));
  return userData;
}

function router() {
  const made = createRouter({ appUrl: 'http://localhost:5173/', local: B, registry: REGISTRY });
  made.install();
  made.registerMachine('machine.identity', () => IDENTITY);
  made.registerMachine('session.list', () => ({ sessions: [], revision: 5 })); // P5 O3-D M1: the spine's, `machine`-owned
  made.registerMachine('session.drafts.get', () => {
    throw new CommandFailure({ code: 'timeout', message: 'the index took too long' });
  });
  return made;
}

async function standIn(userData: string, peer: PeerAddon | null = addon(process.getuid?.())): Promise<{ standIn: StandIn; log: Mock<(line: string) => void> }> {
  const log = vi.fn<(line: string) => void>();
  const served = serveMachineStandIn({ userData, router: router(), localRef: B, peer, log, build: 'build-b' });
  cleanups.push(() => served.close());
  await served.ready;
  return { standIn: served, log };
}

function linkTo(userData: string): MachineLink {
  const link = createSocketLink({ dir: join(userData, SERVE_DIR), build: 'build-a', log: () => {}, timing: TIMING });
  cleanups.push(() => link.close());
  return link;
}

describe('the stand-in', () => {
  it('answers a command through the router, keeps a typed failure’s IpcError whole, and sends a link event emitted in main', async () => {
    const userData = profile();
    await standIn(userData);
    const link = linkTo(userData);
    const events: [string, unknown][] = [];
    link.onEvent((name, payload) => void events.push([name, payload]));
    await until(() => link.state() === 'up');
    expect(link.machine).toBe(B);
    const page = endableClientRef('page:1.1');
    await expect(link.dispatch('session.list', {}, page)).resolves.toEqual({ ok: true, value: { sessions: [], revision: 5 } });
    await expect(link.dispatch('session.drafts.get', { appSessionId: 'app-1' }, page)).resolves.toEqual({ ok: false, error: { code: 'timeout', message: 'the index took too long' } });

    await vi.waitFor(() => {
      emit('session.removed', { appSessionId: 'app-1' as never, revision: 6 }); // until the link's ready has landed
      expect(events).toContainEqual(['session.removed', { appSessionId: 'app-1', revision: 6 }]);
    });
    expect(emit('layout.saveAll', { requestId: 'r-1' })).toBe(true); // the app's own events stay home
    emit('session.removed', { appSessionId: 'app-2' as never, revision: 7 });
    await until(() => events.some(([, payload]) => (payload as { revision: number }).revision === 7));
    expect(events.every(([name]) => name === 'session.removed')).toBe(true);
  });

  it('serves from a 0700 directory, correcting a looser one, with a 0600 token of 64 hex characters and a 0600 socket', async () => {
    const userData = profile();
    mkdirSync(join(userData, SERVE_DIR), { mode: 0o755 });
    await standIn(userData);
    const dir = join(userData, SERVE_DIR);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, MACHINE_TOKEN))).toBe(0o600);
    expect(readFileSync(join(dir, MACHINE_TOKEN), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(lstatSync(join(dir, MACHINE_SOCKET)).isSocket()).toBe(true);
    expect(mode(join(dir, MACHINE_SOCKET))).toBe(0o600);
  });

  it('refuses a serve directory that is a symlink, writing nothing where it points', () => {
    const userData = profile();
    const elsewhere = profile();
    symlinkSync(elsewhere, join(userData, SERVE_DIR));
    const log = vi.fn();
    expect(() => serveMachineStandIn({ userData, router: router(), localRef: B, peer: addon(process.getuid?.()), log, build: 'build-b' })).toThrow(/symlink/);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('closes a peer of another uid before it reads a byte: the link never comes up', async () => {
    const userData = profile();
    const { log } = await standIn(userData, addon((process.getuid?.() ?? 0) + 1));
    const link = linkTo(userData);
    await until(() => log.mock.calls.some(([line]) => /refused a peer of uid/.test(line)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(link.state()).toBe('down');
    expect(link.machine).toBeNull();
  });

  it('refuses every peer when the peer-auth addon is unavailable, saying so once', async () => {
    const userData = profile();
    const { log } = await standIn(userData, null);
    const link = linkTo(userData);
    await until(() => log.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 150)); // the link has retried meanwhile
    expect(link.state()).toBe('down');
    expect(log.mock.calls.filter(([line]) => /addon is unavailable/.test(line))).toHaveLength(1);
  });

  it('ignores an exit: a client never stops this machine', async () => {
    const userData = profile();
    const { log } = await standIn(userData);
    const client = await connectLines(join(userData, SERVE_DIR, MACHINE_SOCKET));
    cleanups.push(() => void client.socket.destroy());
    const token = readFileSync(join(userData, SERVE_DIR, MACHINE_TOKEN), 'utf8');
    client.send({ t: 'hello', protocol: 3, token, minor: 1, build: 'build-a', capabilities: [], appPid: 1 });
    expect(await client.next()).toMatchObject({ t: 'welcome', build: 'build-b' });
    client.send({ t: 'exit', when: 'now' });
    await until(() => log.mock.calls.some(([line]) => /ignored exit now/.test(line)));
    expect(existsSync(join(userData, SERVE_DIR, MACHINE_SOCKET))).toBe(true);
    const link = linkTo(userData); // and it still serves
    await until(() => link.state() === 'up');
  });
});
