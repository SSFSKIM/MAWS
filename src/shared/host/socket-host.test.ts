// The socket host's exit order (socket-host.ts `stop`), over a real Unix socket (#473): what the host wrote before its
// exit reaches a client that is slow to read. An engine host's last status (`holder.detached`, the evidence its handover
// completed) is written just before the exit order runs; a process that exits with bytes still queued in its socket
// drops them, and a supervisor that never hears that status reads the handover's exit as a crash.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyId } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { buildIdOf } from '../../engine-host/supervisor-files';
import type { HostEmit } from './runtime';
import { startSocketHost, type SocketHost } from './socket-host';
import { PEER_CAPABILITIES, SOCKET_PROTOCOL, splitLines } from './socket-protocol';

const FILES = { lock: 'host.lock', breakLock: 'host.lock.break', token: 'host.token' };

let root: string;
const hosts: SocketHost[] = [];
const sockets: Socket[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-sockhost-'));
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const host of hosts.splice(0)) if (!host.stopping()) await host.stop('exit');
  rmSync(root, { recursive: true, force: true });
});

describe('the socket host’s exit order', () => {
  it('exits only once what it wrote has left its socket, so a client slow to read still gets the last line', async () => {
    const dir = join(root, 'host');
    const modulePath = join(root, 'host.js');
    writeFileSync(modulePath, '// the host bundle');
    let emit: HostEmit | null = null;
    const exit = vi.fn<(code: number) => void>();
    const host = await startSocketHost(
      {
        kind: 'pty host',
        hostVersion: 'test',
        dir,
        files: FILES,
        socketPath: join(dir, 'host.sock'),
        modulePath,
        register: (_on, e) => void (emit = e),
        badToken: 'close',
        capabilities: PEER_CAPABILITIES.ptyHost,
        counts: () => ({ liveSessions: 0, rows: 0 }),
        shutdown: async () => undefined,
        exitWhenIdle: () => {},
        log: () => {},
      },
      { exit },
    );
    expect(host).not.toBeNull();
    hosts.push(host!);

    const socket = createConnection(join(dir, 'host.sock'));
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', resolve));
    const lines: string[] = [];
    const splitter = splitLines((line) => void lines.push(line), () => {});
    socket.on('data', (chunk: Buffer) => splitter.push(chunk));
    const token = readFileSync(join(dir, FILES.token), 'utf8');
    socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: buildIdOf(modulePath), capabilities: [], appPid: 4321 })}\n`);
    await vi.waitFor(() => expect(lines.some((line) => line.includes('"welcome"'))).toBe(true));
    socket.write(`${JSON.stringify({ t: 'ready' })}\n`);
    await vi.waitFor(() => expect(emit!('pty.exit', { ptyId: 'warm' as PtyId, exitCode: 0, signal: null })).toBe(true));

    // The client stops reading; the host writes far more than the kernel holds for it, then its last line, and exits.
    socket.pause();
    const data = new Uint8Array(4_096).fill(120);
    for (let i = 0; i < 64; i++) emit!('pty.data', { ptyId: 'bulk' as PtyId, offset: i * data.length, data });
    expect(emit!('pty.exit', { ptyId: 'last' as PtyId, exitCode: 0, signal: null })).toBe(true);
    void host!.stop('handover');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(exit, 'no exit while the client has not taken what was written').not.toHaveBeenCalled();

    socket.resume();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    await vi.waitFor(() => expect(lines.some((line) => line.includes('"last"'))).toBe(true));
  });
});
