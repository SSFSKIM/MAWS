// The render host's life (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3, Interfaces §A, §E), in
// plain Node so a test drives it with no Electron: root.ts supplies the Electron side and the render library.
//
// Before Electron's `ready`, synchronously: the profile from `--render-host <profile>`, its daemon directory checked (a
// profile no `mawsd` serves is refused before anything is written), and the render host's own `userData`,
// `<profile>/mawsd/render-host/`, cleared and made, so Chromium's profile lock, caches and the capture partition never
// meet the app's (nothing in it is kept). Then the `machine.sock` link (its refusal is the exit's reason), `ready`, the
// sessions' policies and the scheme proxy to `artifacts.sock`, the library composed over the link's commands, and
// `ready` said to the front. From then on each `render.request` is handed to the library as it arrives and answered
// once with `render.answer` when its work ends; `render.exit` takes no further request and exits 0 when the work in
// flight is answered; the connection's end exits 0 at once (nothing could be answered).
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { daemonPaths, type DaemonPaths } from '@shared/daemon/files';
import { assertPrivateDirectory } from '@shared/host/private-path';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { events as renderEvents, RenderRequestSchema, type RenderAnswer, type RenderAuthors, type RenderRequest } from '@shared/ipc/schema/render';
import { readTolerant } from '@shared/ipc/tolerant';
import { connectRenderClient, hostCall, type RenderClient, type RenderClientOptions } from './client';

const RenderHostGenerationSchema = renderEvents['render.hostGeneration']; // P5 O5 M4

export const RENDER_HOST_FLAG = '--render-host';
export const RENDER_HOST_DIR = 'render-host'; // under the daemon's directory
export const EXIT_USAGE = 2; // no profile named
export const EXIT_UNREACHABLE = 1; // no mawsd to serve
export const EXIT_FAILED = 70; // the render host itself failed (EX_SOFTWARE): root.ts's `fatal`

// What the render host asks of the render library (src/render/compose.ts's `Render`)
// P5 O5 M4: an export is handed the Word comment authors its request carries (`mawsd`'s), beside the request
export interface RenderLibrary {
  capture(request: MawsArtifactCapture): Promise<MawsArtifactCapturedResult>;
  export(request: MawsArtifactExport, options: { authors?: RenderAuthors }): Promise<MawsArtifactExportAnswer>;
  exportForLibrary(input: CommandInput<'artifacts.export'>, options: { authors?: RenderAuthors }): Promise<CommandOutput<'artifacts.export'>>;
}

export type EngineCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

export interface RenderHostDeps {
  argv: readonly string[];
  build(): string; // this build's id, for the hello
  userData(dir: string): void; // before `ready`: Electron's userData, the accessory policy, the window-all-closed guard
  ready(): Promise<void>; // Electron's ready, the Dock hidden
  sessions(paths: DaemonPaths): void; // the capture partition's policies and scheme proxy, the default session's guard
  // the library and the e2e's seams; P5 O5 M4: `hostGeneration`, the engine host's link generation `mawsd` last posted
  // (render.hostGeneration), the library's one recapture of a dashboard across an engine host's restart
  compose(call: EngineCall, profile: string, hostGeneration: () => number): RenderLibrary;
  connect?: (paths: DaemonPaths, options: RenderClientOptions) => ReturnType<typeof connectRenderClient>;
  log(line: string): void;
  exit(code: number): void;
}

// `--render-host <profile>`'s profile, or null
export function renderHostProfile(argv: readonly string[]): string | null {
  const at = argv.indexOf(RENDER_HOST_FLAG);
  const profile = at < 0 ? undefined : argv[at + 1];
  return profile === undefined || profile === '' || profile.startsWith('--') ? null : profile;
}

export async function startRenderHost(deps: RenderHostDeps): Promise<void> {
  const { log } = deps;
  const refuse = (code: number, why: string) => {
    log(`[render-host] cannot start: ${why}`);
    deps.exit(code);
  };
  const profile = renderHostProfile(deps.argv);
  if (profile === null) return refuse(EXIT_USAGE, `${RENDER_HOST_FLAG} names no profile directory`);
  const paths = daemonPaths(profile);
  try {
    assertPrivateDirectory(paths.dir);
  } catch (error) {
    return refuse(EXIT_UNREACHABLE, `no mawsd serves ${profile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const userData = join(paths.dir, RENDER_HOST_DIR);
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(userData, { mode: 0o700 });
  deps.userData(userData);

  let serving: RequestLoop | null = null; // the front posts to a ready client alone, so no event comes before it exists
  let generation = 0; // P5 O5 M4: render.hostGeneration's last
  const reached = await (deps.connect ?? connectRenderClient)(paths, {
    build: deps.build(),
    onEvent: (name, payload) => {
      if (name !== 'render.hostGeneration') return serving?.event(name, payload);
      const read = readTolerant(RenderHostGenerationSchema, payload);
      if (read.ok) generation = read.value.generation;
    },
  });
  if (!reached.ok) return refuse(EXIT_UNREACHABLE, reached.why);
  const { client } = reached;
  let ending = false;
  void client.closed.then((why) => {
    if (ending) return;
    ending = true;
    log(`[render-host] ${why}: exiting`);
    deps.exit(0);
  });
  await deps.ready();
  deps.sessions(paths);
  const library = deps.compose(hostCall(client.invoke), profile, () => generation);
  serving = requestLoop(library, client, log, () => {
    if (ending) return;
    ending = true;
    log('[render-host] render.exit: the work in flight is answered; exiting');
    client.close();
    deps.exit(0);
  });
  client.ready();
  log(`[render-host] ready: serving ${profile} (mawsd pid ${client.welcome.pid}, wire ${client.welcome.protocol}.${client.welcome.minor})`);
}

interface RequestLoop {
  event(name: string, payload: unknown): void;
}

// Each request handed to the library in arrival order and answered once; `render.exit` ends the loop when nothing is in
// flight, and a request after it is answered that the render host is ending.
function requestLoop(library: RenderLibrary, client: Pick<RenderClient, 'invoke'>, log: (line: string) => void, ended: () => void): RequestLoop {
  const inFlight = new Set<string>();
  let exiting = false;
  const answer = async (id: string, value: RenderAnswer) => {
    const posted = await client.invoke('render.answer', { id, answer: value });
    if (!posted.ok) log(`[render-host] render.answer for ${id} was refused: ${posted.error.code} ${posted.error.message}`);
  };
  const settle = (id: string) => {
    inFlight.delete(id);
    if (exiting && inFlight.size === 0) ended();
  };
  const run = (request: RenderRequest): Promise<RenderAnswer> => {
    switch (request.kind) {
      case 'capture':
        return library.capture(request.request);
      case 'export':
        return library.export(request.request, { ...(request.authors && { authors: request.authors }) });
      case 'libraryExport':
        return library.exportForLibrary(request.request, { ...(request.authors && { authors: request.authors }) });
    }
  };
  return {
    event(name, payload) {
      if (name === 'render.exit') {
        exiting = true;
        if (inFlight.size === 0) ended();
        return;
      }
      if (name !== 'render.request') return;
      const read = readTolerant(RenderRequestSchema, payload);
      if (!read.ok) {
        const id = (payload as { id?: unknown } | null)?.id;
        log(`[render-host] dropped a malformed render.request${typeof id === 'string' ? ` (${id})` : ''}`);
        if (typeof id === 'string' && id !== '') void answer(id, { ok: false, error: 'the render host could not read the request' });
        return;
      }
      const request = read.value;
      if (exiting) return void answer(request.id, { ok: false, error: 'the render host is ending' });
      if (inFlight.has(request.id)) return log(`[render-host] dropped a second render.request ${request.id}`);
      inFlight.add(request.id);
      void run(request)
        .then((value) => value, failure)
        .then((value) => answer(request.id, value))
        .finally(() => settle(request.id));
    },
  };
}

// A library export's refusal keeps its IPC error (its code and issues), as the router answers it in the app
function failure(error: unknown): RenderAnswer {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message, ipcError: error instanceof HostCommandError ? error.ipcError : ipcError('internal', message) };
}
