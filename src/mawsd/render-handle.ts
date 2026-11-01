// The render seam as `mawsd` holds it before it is loaded (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §B, §G; acceptance 8): on `mawsd`'s run path, so it imports the seam's chunk (render-seam.ts) only at the
// first request, never at start. The engine host's `maws.artifact.capture` and `maws.artifact.export` (daemon.ts's
// onRaw), the library's Export (the front's `artifacts.export`, and O4's Send to through `RenderService`) and the e2e's
// capture load it; the front's render-client facts (a ready, an end, an answer) reach it only once it is loaded, since
// only a loaded seam starts a render host. A load that fails (a bundle replaced under this daemon) answers the asker
// with its reason, and the next request tries again. From `stop()` on nothing loads: a request is refused at once.
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { DaemonRender } from '@shared/ipc/schema/daemon';
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { FrontRender } from './front';
import type { RenderSeam, RenderSeamOptions, RenderService } from './render-seam';

export type RenderChunk = typeof import('./render-seam');
export const loadRenderChunk = (): Promise<RenderChunk> => import('./render-seam');

export interface RenderHandleOptions {
  machine: string;
  load(): Promise<RenderChunk>; // rejects with the reason it may not load (daemon.ts's bundle-swap check)
  compose(chunk: RenderChunk): RenderSeamOptions; // the daemon's wiring, given the loaded chunk's command line and authors
  answerEngine: RenderSeamOptions['answerEngine']; // a refusal's answer when the seam could not load
  log(line: string): void;
}

export interface RenderHandle extends RenderService {
  event(name: string, payload: unknown): boolean; // true for a render request (taken, answered here or by the seam)
  front: FrontRender;
  captureForE2e(request: MawsArtifactCapture): Promise<MawsArtifactCapturedResult>;
  loaded(): RenderSeam | null;
  status(): DaemonRender;
  stop(): Promise<void>;
}

const OFF: DaemonRender = { state: 'off', detail: null, pid: null, starts: 0, requests: 0 };

export function createRenderHandle({ machine, load, compose, answerEngine, log }: RenderHandleOptions): RenderHandle {
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
      clientReady: () => (seam ? seam.clientReady() : log('[render] a render client said ready with no render seam loaded: not taken')),
      clientGone: () => seam?.clientGone(),
      answer: (input) => seam?.answer(input) ?? false,
      exportForLibrary: (input) => handle.exportForLibrary(input),
    },
    loaded: () => seam,
    status: () => seam?.status() ?? OFF,
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
