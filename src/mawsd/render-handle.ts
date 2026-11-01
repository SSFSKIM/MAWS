// The render seam as `mawsd` holds it before it is loaded (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §B, §G; acceptance 8): on `mawsd`'s run path, so it imports the seam's chunk (render-seam.ts) only at the
// first request, never at start. The engine host's `maws.artifact.capture` and `maws.artifact.export` (daemon.ts's
// onRaw), the library's Export (the front's `artifacts.export`, and O4's Send to through `RenderService`) and the e2e's
// capture load it; the front's render-client facts (a ready, an end, an answer) reach it only once it is loaded, since
// only a loaded seam starts a render host. A load that fails (a bundle replaced under this daemon) answers the asker
// with its reason, and the next request tries again. From `stop()` on nothing loads: a request is refused at once.
// P5 O5 M5: its `capabilities()` (the session capabilities' render entries) are the seam's once it is loaded, else read
// from the same facts without loading it (a seam not loaded has not failed).
// P5 O17 M5 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §D): `ensureBrowser` loads the seam, as a
// request does (a cua connection's first real primitive, the broker's demand); `dropBrowser` and the engine connections'
// answers reach a seam that is loaded (or loading) alone, since none other serves a session.
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { DaemonRender } from '@shared/ipc/schema/daemon';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserEngineResult } from '@shared/ipc/schema/browser-engine';
import type { EngineConnection } from './browser-work';
import type { BrowserDemand, BrowserTarget } from './cua-broker';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { FrontRender } from './front';
import type { RenderSeam, RenderSeamOptions, RenderService } from './render-seam';
import { renderCapabilities, type RenderCapabilities, type RenderFacts } from './session-capabilities'; // P5 O5 M5

export type RenderChunk = typeof import('./render-seam');
export const loadRenderChunk = (): Promise<RenderChunk> => import('./render-seam');

export interface RenderHandleOptions {
  machine: string;
  load(): Promise<RenderChunk>; // rejects with the reason it may not load (daemon.ts's bundle-swap check)
  compose(chunk: RenderChunk): RenderSeamOptions; // the daemon's wiring, given the loaded chunk's command line and authors
  answerEngine: RenderSeamOptions['answerEngine']; // a refusal's answer when the seam could not load
  facts(): Omit<RenderFacts, 'failure'>; // P5 O5 M5: what the render entries read while the seam is not loaded
  log(line: string): void;
}

export interface RenderHandle extends RenderService {
  event(name: string, payload: unknown): boolean; // true for a render request (taken, answered here or by the seam)
  front: FrontRender;
  captureForE2e(request: MawsArtifactCapture): Promise<MawsArtifactCapturedResult>;
  loaded(): RenderSeam | null;
  capabilities(): RenderCapabilities; // P5 O5 M5: never loads the seam
  status(): DaemonRender;
  stop(): Promise<void>;
  // P5 O17 M5 (§D): the sessions' headless browser
  ensureBrowser(demand: BrowserDemand): Promise<BrowserTarget>; // starts or joins the render host, sends prepare, resolves at its answer
  dropBrowser(appSessionId: AppSessionId): Promise<void>; // sends drop when the render host serves the session; resolves at its answer or the host's exit
  browserAnswer(engine: EngineConnection, input: { id: string; result: BrowserEngineResult }): boolean;
  browserEngine(appSessionId: AppSessionId): EngineConnection | null;
  browserWorkChanged(): void;
  unavailable(): string | null; // never loads the seam
}

const OFF: DaemonRender = { state: 'off', detail: null, pid: null, starts: 0, requests: 0 };

export function createRenderHandle({ machine, load, compose, answerEngine, facts, log }: RenderHandleOptions): RenderHandle {
  let seam: RenderSeam | null = null;
  let loading: Promise<RenderSeam> | null = null;
  let stopped = false;
  const restarting = `the render service is restarting on ${machine}`;

  const ensure = (): Promise<RenderSeam> => {
    if (seam) return Promise.resolve(seam);
    if (stopped) return Promise.reject(new Error(restarting));
    loading ??= load().then(
      (chunk) => {
        if (stopped) throw new Error(restarting);
        seam = chunk.createRenderSeam(compose(chunk));
        log('[render] the render seam loaded');
        return seam;
      },
      (error: unknown) => {
        loading = null; // the next request tries again
        throw new Error(`the render service could not start on ${machine}: ${messageOf(error)}`);
      },
    );
    return loading;
  };

  // A bridge's request the seam could not take: answered at once in the bridge's shape
  const refuse = (name: 'maws.artifact.capture' | 'maws.artifact.export', payload: unknown, error: unknown) => {
    const { appSessionId, requestId } = payload as { appSessionId: string; requestId: string };
    const failure = { ok: false as const, error: messageOf(error) };
    log(`[render] ${name} ${requestId} refused: ${failure.error}`);
    const answered = name === 'maws.artifact.capture' ? answerEngine('maws.artifact.captured', { appSessionId, requestId, result: failure }) : answerEngine('maws.artifact.exported', { appSessionId, requestId, answer: failure });
    void answered.catch(() => null);
  };

  const handle: RenderHandle = {
    event(name, payload) {
      if (name !== 'maws.artifact.capture' && name !== 'maws.artifact.export') return false;
      void ensure().then(
        (loaded) => (name === 'maws.artifact.capture' ? loaded.capture(payload as MawsArtifactCapture) : loaded.export(payload as MawsArtifactExport)),
        (error: unknown) => refuse(name, payload, error),
      );
      return true;
    },
    exportForLibrary: (input: CommandInput<'artifacts.export'>): Promise<CommandOutput<'artifacts.export'>> =>
      ensure().then(
        (loaded) => loaded.exportForLibrary(input),
        (error: unknown): never => {
          throw new HostCommandError(ipcError('host_unavailable', messageOf(error)));
        },
      ),
    captureForE2e: (request) => ensure().then((loaded) => loaded.captureForE2e(request)),
    front: {
      clientReady: (engine) => (seam ? seam.clientReady(engine) : log('[render] a render client said ready with no render seam loaded: not taken')),
      clientGone: (engine) => seam?.clientGone(engine),
      answer: (input) => seam?.answer(input) ?? false,
      exportForLibrary: (input) => handle.exportForLibrary(input),
    },
    loaded: () => seam,
    capabilities: () => seam?.capabilities() ?? renderCapabilities({ ...facts(), failure: null }),
    status: () => seam?.status() ?? OFF,
    // P5 O17 M5
    ensureBrowser: (demand) => ensure().then((loaded) => loaded.ensureBrowser(demand)),
    async dropBrowser(appSessionId) {
      if (!seam && loading) await loading.catch(() => null);
      await seam?.dropBrowser(appSessionId);
    },
    browserAnswer: (engine, input) => seam?.browserAnswer(engine, input) ?? false,
    browserEngine: (appSessionId) => seam?.browserEngine(appSessionId) ?? null,
    browserWorkChanged: () => seam?.browserWorkChanged(),
    unavailable: () => seam?.unavailable() ?? null,
    async stop() {
      stopped = true;
      if (!seam && loading) await loading.catch(() => null); // a load in flight ends refused (above)
      await seam?.stop();
    },
  };
  return handle;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
