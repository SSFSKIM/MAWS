// The PTY host (charter §4.1): the utility process that owns terminals, so a shell outlives the page that asked for
// it. Serves C9's `pty.*` commands over the pty table (`table.ts`). The login-shell environment is captured once, here
// at start, without blocking the handshake with main; the first spawn waits for it.
import { hostPing, runHost } from '@shared/host/runtime';
import { baseEnvironment, terminalEnvironment } from './env';
import { createPtyTable } from './table';

const HOST_VERSION = __MAWS_VERSION__;

runHost(HOST_VERSION, (on, emit) => {
  const environment = baseEnvironment().then((base) => terminalEnvironment(base, { appVersion: HOST_VERSION }));
  const table = createPtyTable({ emit, environment });
  on('pty.ping', async () => hostPing(HOST_VERSION));
  on('pty.spawn', (input) => table.spawn(input));
  on('pty.write', async (input) => table.write(input));
  on('pty.resize', async (input) => table.resize(input));
  on('pty.kill', async (input) => table.kill(input));
  on('pty.ack', async (input) => table.ack(input));
  on('pty.checkpoint', async (input) => table.checkpoint(input));
  on('pty.attach', async (input) => table.attach(input));
  on('pty.list', async () => table.list());
  on('pty.foreground', (input) => table.foreground(input));
});
