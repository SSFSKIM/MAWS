// The handlers for `files.*` (C8c execution document, M1; P5 O3-E: registered by the spine's root, in `mawsd` on the
// daemon shape). Every failure is `internal` with the service's message
// (the refusal `path outside the session's directories`, `unknown app session: <id>`, `not found: <path>`, …). Watches
// are held per requesting client, as `registerGitHandlers` holds git's: a client that ends (its page closes, crashes or
// reloads) releases whatever it still holds, since its page can no longer unwatch and a reloaded page watches afresh.
// UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §C): a read or an open outside
// the folders that asks by name (`named`) waits for the transcript's answer as long as its client lives, and no longer.
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientPort } from '@shared/client/port';
import type { ClientId, ClientRef, HandlerContext } from '@shared/ipc/client';
import type { FilesChanged, FilesReadUploadsInput, FilesReadUploadsOutput, FilesUploadInput, FilesUploadOutput } from '@shared/ipc/schema/files';
import type { ServicesBus } from '@shared/spine/bus';
import type { AllowlistRecord } from './allowlist';
import { createFilesService, type FilesService } from './service';
import { UPLOAD_READS_UNAVAILABLE, UPLOADS_UNAVAILABLE } from './upload';

export interface FilesHandlerDeps {
  bus: Pick<ServicesBus, 'register'>; // P5 O3-C: where files.* are answered
  emit(payload: FilesChanged): void;
  port: Pick<ClientPort, 'openExternal' | 'reveal'>; // the client port (OX4): files.openExternal, E1's files.reveal
  env?: NodeJS.ProcessEnv;
  admitted?: (appSessionId: AppSessionId, real: string) => Promise<boolean>; // E2: the deliverable reader's admission (Design §3)
  homes?: () => readonly string[]; // 2026-11-06: the machine's homes as the home-root rule reads them (a suite's fake one)
  upload?: (input: FilesUploadInput) => Promise<FilesUploadOutput>; // P5 O3-E M3 (./upload.ts); none: every upload refused
  readUploads?: (input: FilesReadUploadsInput) => Promise<FilesReadUploadsOutput>; // P5 O7 M8 (./upload.ts); none: every read refused
  named?: (appSessionId: AppSessionId, path: string, signal?: AbortSignal) => Promise<boolean>; // U6c: whether the transcript names the path (./named.ts); none: nothing admitted by name
}

// The service, plus the live clients it follows (for tests and diagnostics: an ended client leaves no entry behind).
export type FilesHandlers = FilesService & { readonly followed: ReadonlySet<ClientId> };

// `records`: whose directories a session may read (`allowlistOf`: its record, else its setup intent's location).
export function registerFilesHandlers(records: (appSessionId: AppSessionId) => AllowlistRecord | null, deps: FilesHandlerDeps): FilesHandlers {
  const { bus: { register }, upload, readUploads, ...service } = deps;
  const files = createFilesService({ records, ...service });
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
  // 2026-11-06: a remote request's roots leave out the machine's home (the context's `remote`, the endpoint seam's)
  const remote = (context: HandlerContext | undefined) => context?.remote === true; // a caller that passes no context is this machine's
  // U6c (M2 decision 4): per asking client, one signal that ends when the client does, made for the first request that
  // asks by name and dropped with the client; a caller with no context, or one from another machine (never asked), has none
  const ends = new Map<ClientId, AbortSignal>();
  const endOf = (named: boolean | undefined, context: HandlerContext | undefined): AbortSignal | undefined => {
    if (named !== true || context === undefined || remote(context)) return undefined;
    const { client } = context;
    const known = ends.get(client.id);
    if (known) return known;
    const ended = new AbortController();
    ends.set(client.id, ended.signal);
    client.onGone(() => {
      ends.delete(client.id);
      ended.abort();
    });
    return ended.signal;
  };
  register('files.list', ({ appSessionId, path }, context?: HandlerContext) => files.list({ appSessionId: session(appSessionId), path }, remote(context)));
  register('files.read', (input, context?: HandlerContext) => files.read({ ...input, appSessionId: session(input.appSessionId) }, remote(context), endOf(input.named, context)));
  register('files.write', (input, context?: HandlerContext) => files.write({ ...input, appSessionId: session(input.appSessionId) }, remote(context))); // E5
  register('files.watch', async ({ appSessionId, path }, context: HandlerContext) => {
    const { client } = context;
    follow(client);
    await files.watch(session(appSessionId), path, client.id, remote(context));
    if (!followed.has(client.id)) await files.unwatch(session(appSessionId), path, client.id); // released while in flight
  });
  register('files.unwatch', ({ appSessionId, path }, { client }) => files.unwatch(session(appSessionId), path, client.id));
  register('files.openExternal', ({ appSessionId, path, named }, context: HandlerContext) =>
    files.openExternal(session(appSessionId), path, context.client, { named, remote: remote(context), signal: endOf(named, context) }), // U6c
  );
  register('files.reveal', ({ appSessionId, path }, { client }) => files.reveal(session(appSessionId), path, client)); // E1
  // P5 O3-E M2 (Interfaces §D; D6): `library.read`'s reach, main-only, a path main resolved read with files.read's rules
  register('files.readResolved', (input) => files.readResolved(input));
  // P5 O3-E M3 (Interfaces §F): bytes written into the session's attachments directory; refused, with nothing written,
  // in a run that keeps no record of the upload roots (refused the spine)
  register('files.upload', (input) => (upload ? upload({ ...input, appSessionId: session(input.appSessionId) }) : Promise.resolve(UPLOADS_UNAVAILABLE)));
  // P5 O7 M8 ("The attachment"): the endpoint's read of a remote send's uploads, each a document block, before the send
  // reaches the engine host
  register('files.readUploads', (input) => (readUploads ? readUploads({ ...input, appSessionId: session(input.appSessionId) }) : Promise.resolve(UPLOAD_READS_UNAVAILABLE)));
  return Object.assign(files, { followed: followed as ReadonlySet<ClientId> });
}
