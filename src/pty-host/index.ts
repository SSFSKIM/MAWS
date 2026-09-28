// The PTY host (charter §4.1): the utility process that owns terminals, so a shell outlives the page that asked for
// it. Serves the `pty.*` commands over node-pty (`ptys.ts`); C9 extends it.
import { hostPing, runHost } from '@shared/host/runtime';
import { createPtys } from './ptys';

const HOST_VERSION = __MAWS_VERSION__;

runHost(HOST_VERSION, (on, emit) => {
  const ptys = createPtys(emit, HOST_VERSION);
  on('pty.ping', async () => hostPing(HOST_VERSION));
  on('pty.spawn', async (input) => ptys.spawn(input));
  on('pty.write', async (input) => ptys.write(input));
  on('pty.resize', async (input) => ptys.resize(input));
  on('pty.kill', async (input) => ptys.kill(input));
});
