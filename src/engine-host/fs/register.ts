// The engine host's registration of C4's filesystem state service (C4 execution document, Architecture): the `fs.*`
// commands on C1's host runtime, the service started at load. The config home is read from this process's own
// environment exactly as the engine reads it (`CLAUDE_CONFIG_DIR`, else `~/.claude`); C1's supervisor forks the host
// with main's environment. When C3's login-shell capture lands in this host, the service reads the captured
// environment through the same accessor the launch contract uses.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { FsHoldersQuery, FsScanKnown } from '@shared/ipc/schema/fs';
import { resolveStorePaths } from './paths';
import { FsService } from './service';

export function registerFs(on: HostOn, emit: HostEmit, env: NodeJS.ProcessEnv = process.env): FsService {
  const service = new FsService({ paths: resolveStorePaths(env), emit });
  // The runtime hands a handler the schema's parsed value, typed as its input; the ids in it passed the branded
  // id schemas, which is what the brands stand for.
  on('fs.state', async () => service.state());
  on('fs.scan', async ({ known }) => service.scan((known ?? []) as FsScanKnown[]));
  on('fs.bind', async ({ bindings }) => service.bind(bindings as Pick<FsScanKnown, 'sessionId' | 'appSessionId'>[]));
  on('fs.holders', async (query) => service.holdersNow(query as FsHoldersQuery));
  on('fs.unfollow', async ({ appSessionId, agentId }) => service.unfollow(appSessionId as AppSessionId, agentId as AgentId | null));
  on('fs.subagents', async ({ appSessionId }) => service.subagents(appSessionId as AppSessionId));
  on('fs.agentEvents', async ({ appSessionId, agentId }) => service.agentEvents(appSessionId as AppSessionId, agentId as AgentId));
  on('fs.workflows', async ({ appSessionId }) => service.workflows(appSessionId as AppSessionId));
  on('fs.tasks', async ({ listId }) => service.tasks(listId));
  on('fs.readSpill', async (input) => service.readSpill(input));
  // carried from C3 until rebase: C3's `session.events` answers live sessions from its ring and delegates to
  // `eventsSnapshot` for the rest; until it lands, this answers every app session from disk. Disk-derived events carry
  // `seq: null`, so `afterSeq` selects nothing and `lastSeq` is 0 (C4 execution document, Cross-child reconciliation).
  on('session.events', async ({ appSessionId }) => ({ ...(await service.eventsSnapshot(appSessionId as AppSessionId, null)), lastSeq: 0 }));
  // end carried from C3
  service.start().catch((error: unknown) => console.error('[fs] the filesystem state service failed to start:', error instanceof Error ? error.message : error));
  return service;
}
