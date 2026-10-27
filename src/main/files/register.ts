// Main's handlers for `files.*` (C8c execution document, M1). Every failure is `internal` with the service's message
// (the refusal `path outside the session's directories`, `unknown app session: <id>`, `not found: <path>`, …). Watches
// are held per requesting client, as `registerGitHandlers` holds git's: a client that ends (its page closes, crashes or
// reloads) releases whatever it still holds, since its page can no longer unwatch and a reloaded page watches afresh.
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientPort } from '@shared/client/port';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { FilesChanged } from '@shared/ipc/schema/files';
import { registerMainHandler } from '../ipc/router';
import type { AllowlistRecord } from './allowlist';
import { createFilesService, type FilesService } from './service';

export interface FilesHandlerDeps {
  emit(payload: FilesChanged): void;
  port: Pick<ClientPort, 'openExternal' | 'reveal'>; // the client port (OX4): files.openExternal, E1's files.reveal
  env?: NodeJS.ProcessEnv;
  admitted?: (appSessionId: AppSessionId, real: string) => Promise<boolean>; // E2: the deliverable reader's admission (Design §3)
}

// The service, plus the live clients it follows (for tests and diagnostics: an ended client leaves no entry behind).
export type FilesHandlers = FilesService & { readonly followed: ReadonlySet<ClientId> };

// `records`: whose directories a session may read (`allowlistOf`: its record, else its setup intent's location).
export function registerFilesHandlers(records: (appSessionId: AppSessionId) => AllowlistRecord | null, deps: FilesHandlerDeps): FilesHandlers {
  const files = createFilesService({ records, ...deps });
  // A client is followed from its first watch until it ends. A watch in flight when its client ended is dropped when it
  // completes, rather than held by a page that can no longer unwatch it: a client no longer followed has ended.
  const followed = new Set<ClientId>();
  const follow = (client: ClientRef) => {
    if (followed.has(client.id)) return;
    followed.add(client.id);
    client.onGone(() => {
      followed.delete(client.id);
      files.release(client.id);
    });
  };
  const session = (id: string) => id as AppSessionId;
  registerMainHandler('files.list', ({ appSessionId, path }) => files.list({ appSessionId: session(appSessionId), path }));
  registerMainHandler('files.read', (input) => files.read({ ...input, appSessionId: session(input.appSessionId) }));
  registerMainHandler('files.write', (input) => files.write({ ...input, appSessionId: session(input.appSessionId) })); // E5
  registerMainHandler('files.watch', async ({ appSessionId, path }, { client }) => {
    follow(client);
    await files.watch(session(appSessionId), path, client.id);
    if (!followed.has(client.id)) await files.unwatch(session(appSessionId), path, client.id); // released while in flight
  });
  registerMainHandler('files.unwatch', ({ appSessionId, path }, { client }) => files.unwatch(session(appSessionId), path, client.id));
  registerMainHandler('files.openExternal', ({ appSessionId, path }, { client }) => files.openExternal(session(appSessionId), path, client));
  registerMainHandler('files.reveal', ({ appSessionId, path }, { client }) => files.reveal(session(appSessionId), path, client)); // E1
  return Object.assign(files, { followed: followed as ReadonlySet<ClientId> });
}
