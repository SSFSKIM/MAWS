// The engine host (charter §4.1): the utility process that owns the Claude Code processes. It serves C1's ping and the
// engine host's X2 surface (C3). It imports `electron` only through C1's runHost, and never resolves the engine
// through PATH (D-1, X6).
import { hostPing, runHost } from '@shared/host/runtime';
// C3 start
import { join } from 'node:path';
import { registerEngineIpc } from './ipc';
import { JOURNAL_KEEP_PER_SESSION, JOURNAL_MAX_AGE_DAYS, pruneJournals } from './journal';
// C3 end

const HOST_VERSION = __MAWS_VERSION__;

// C3 start: the app's userData directory, forwarded by main in the environment the host is forked with (the host
// protocol's `hello` carries no fields, and a utility process has no `app.getPath`). Without it the host would write
// its journals and state files nowhere it could find again, so it refuses to start.
const userData = process.env.MAWS_USER_DATA;
if (!userData) throw new Error('the engine host needs MAWS_USER_DATA (main forwards app.getPath("userData"))');
void pruneJournals(join(userData, 'engine-host', 'journal'), { keepPerSession: JOURNAL_KEEP_PER_SESSION, maxAgeDays: JOURNAL_MAX_AGE_DAYS }).catch((error: unknown) =>
  console.warn(`[engine-host] journal pruning failed: ${error instanceof Error ? error.message : String(error)}`),
);
// C3 end

runHost(HOST_VERSION, (on, emit) => {
  on('engine.ping', async () => hostPing(HOST_VERSION));
  // C3 start
  const { table } = registerEngineIpc(on, emit, { userData, replayEnabled: process.env.MAWS_ENGINE_REPLAY === '1', appVersion: HOST_VERSION });
  table.startSampling();
  // C3 end
});
