// The engine host's registration of C4's filesystem state service (C4 execution document, Architecture): the `fs.*`
// commands on C1's host runtime, the service started at load. The config home is read from this process's own
// environment exactly as the engine reads it (`CLAUDE_CONFIG_DIR`, else `~/.claude`); C1's supervisor forks the host
// with main's environment. When C3's login-shell capture lands in this host, the service reads the captured
// environment through the same accessor the launch contract uses.
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
  service.start().catch((error: unknown) => console.error('[fs] the filesystem state service failed to start:', error instanceof Error ? error.message : error));
  return service;
}
