// The PTY host (charter §4.1): the utility process that owns terminals, so a shell outlives the page that asked for
// it. Serves C9's `pty.*` commands over the pty table (`table.ts`). The login-shell environment is captured once, here
// at start, without blocking the handshake with main; the first spawn waits for it.
//
// P5 O2 M4 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): one bundle, two modes, decided at load, as the engine
// host's: `process.parentPort` present → utility (forked by main, served over a MessagePort, unchanged); `--detached
// <dir>` in argv → socket mode (`detached.ts`: run as Node by `mawsd`, outliving the app, served over a Unix socket,
// logging to `<dir>/host.log`).
import { openSupervisorLog } from '../engine-host/supervisor-log';
import { hostPing, runHost, type HostRegister } from '@shared/host/runtime';
import { runPtyHostDetached } from './detached';
import { baseEnvironment, terminalEnvironment } from './env';
import { createPtyTable, type PtyTable } from './table';

const HOST_VERSION = __MAWS_VERSION__;

// P5 O2 M4: the mode, at load. `process.parentPort` is Electron's, present only in a utility process.
const detachedAt = process.argv.indexOf('--detached');
const detachedDir = detachedAt === -1 ? undefined : process.argv[detachedAt + 1];
const mode = (process as { parentPort?: unknown }).parentPort ? 'utility' : detachedDir ? 'detached' : null;
if (mode === null) throw new Error('the pty host runs as a utility process (process.parentPort) or detached (--detached <dir>)');

let table: PtyTable | null = null;
const register: HostRegister = (on, emit) => {
  const environment = baseEnvironment().then((base) => terminalEnvironment(base, { appVersion: HOST_VERSION, launcher: process.env }));
  const ptys = createPtyTable({ emit, environment });
  table = ptys;
  on('pty.ping', async () => hostPing(HOST_VERSION));
  on('pty.spawn', (input) => ptys.spawn(input));
  on('pty.write', async (input) => ptys.write(input));
  on('pty.resize', async (input) => ptys.resize(input));
  on('pty.kill', async (input) => ptys.kill(input));
  on('pty.ack', async (input) => ptys.ack(input));
  on('pty.checkpoint', async (input) => ptys.checkpoint(input));
  on('pty.attach', async (input) => ptys.attach(input));
  on('pty.list', async () => ptys.list());
  on('pty.foreground', (input) => ptys.foreground(input));
};

if (mode === 'utility') {
  runHost(HOST_VERSION, register);
} else {
  const dir = detachedDir!;
  runPtyHostDetached(HOST_VERSION, register, {
    dir,
    modulePath: process.argv[1], // the detached spawn names this bundle's entry as the script: its bytes are the build id
    log: openSupervisorLog(dir),
    table: () => {
      // the socket host runs the register before it listens, so a call that finds no table is a broken ordering
      if (!table) throw new Error('the detached entry called into the pty host before its register ran');
      return table;
    },
  });
}
