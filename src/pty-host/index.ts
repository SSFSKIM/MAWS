// The PTY host (charter §4.1): the utility process that owns terminals, so a shell outlives the page that asked for
// it. Serves C9's `pty.*` commands over the pty table (`register.ts`, `table.ts`).
//
// P5 O2 M4 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): one bundle, two modes, decided at load, as the engine
// host's: `process.parentPort` present → utility (forked by main, served over a MessagePort, unchanged); `--detached
// <dir>` in argv → socket mode (`detached.ts`: run as Node by `mawsd`, outliving the app, served over a Unix socket,
// logging to `<dir>/host.log`).
import { openSupervisorLog } from '../engine-host/supervisor-log';
import { runHost } from '@shared/host/runtime';
import { runPtyHostDetached } from './detached';
import { ptyHostRegister } from './register';

const HOST_VERSION = __MAWS_VERSION__;

// P5 O2 M4: the mode, at load. `process.parentPort` is Electron's, present only in a utility process.
const detachedAt = process.argv.indexOf('--detached');
const detachedDir = detachedAt === -1 ? undefined : process.argv[detachedAt + 1];
const mode = (process as { parentPort?: unknown }).parentPort ? 'utility' : detachedDir ? 'detached' : null;
if (mode === null) throw new Error('the pty host runs as a utility process (process.parentPort) or detached (--detached <dir>)');

const host = ptyHostRegister({ hostVersion: HOST_VERSION, ...(mode === 'detached' && { opsDir: detachedDir }) }); // P5 O7 M3: the ledger beside the lock

if (mode === 'utility') {
  runHost(HOST_VERSION, host.register);
} else {
  const dir = detachedDir!;
  runPtyHostDetached(HOST_VERSION, host.register, {
    dir,
    modulePath: process.argv[1], // the detached spawn names this bundle's entry as the script: its bytes are the build id
    log: openSupervisorLog(dir),
    table: () => {
      // the socket host runs the register before it listens, so a call that finds no table is a broken ordering
      const table = host.table();
      if (!table) throw new Error('the detached entry called into the pty host before its register ran');
      return table;
    },
  });
}
