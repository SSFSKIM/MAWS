// The app's side of the connectors (P5 O4 M2, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §B, §F;
// D8, D28, D32). The connectors run with the spine (src/services/connectors/, `mawsd`'s on the daemon shape, main's
// embedded root's on the embedded one); what stays in the app, composed here on both shapes:
//
// - the window reporter (./windows.ts), whose reports go through main's own route under each page's client;
// - the one-time adoption of the format 1 grants (./adoption.ts), once per launch: at the machine host's first streaming
//   on the daemon shape (at once if it already streams), right away on the embedded one, whose spine is composed;
// - at each streaming of the machine host after the first (a restarted `mawsd`, which holds no lease and no report),
//   every page marked unreported, then `connectors.reset` told to the windows, whose connectors clients rebuild their
//   leases (src/renderer/src/artifacts/connectors.ts). The embedded shape never tells it.
// - P5 O4 (whole-branch review): the adoption is once per launch when its pass settles every record. A pass that left a
//   record the machine could not take yet (`retry`: the updated app's first streaming can be a pre-O4 `mawsd`'s, which
//   answers `connectors.adoptGrant` unknown_command before the build check restarts it) runs again at the machine host's
//   next streaming, beside the reset; at once when that streaming came while it ran. One pass at a time. A pass the
//   sealer stopped never asks for a retry (./adoption.ts), so the Keychain is asked at most once in the launch; a pass run
//   again after the sealer opened records asks it nothing, since Electron's safeStorage keeps the encryptor it got.
import type { ClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import type { ServicesBus } from '@shared/spine/bus';
import type { ClientWindowShown } from '../client/window-shown';
import type { BeforeHook } from '../ipc/router';
import { startWindowReporter } from './windows';

export interface AppConnectorsDeps {
  // the daemon shape's machine host (`mawsd`'s services front); null on the embedded shape
  machine: { streaming(): boolean; onStreaming(listener: () => void): () => void } | null;
  windowShown(client: ClientRef): ClientWindowShown | null; // the window that shows a page (electronWindowShown), or null
  invoke: ServicesBus['invoke']; // main's own route
  before(names: readonly CommandName[], hook: BeforeHook): () => void; // the router's seam (beforeCommand)
  emit(name: 'connectors.reset', payload: Record<string, never>): void; // to every window
  adopt(): Promise<{ retry: boolean }>; // the legacy grants' adoption pass (./adoption.ts)
  log?: (line: string) => void;
}

export interface AppConnectors {
  stop(): void;
}

export function startAppConnectors({ machine, windowShown, invoke, before, emit, adopt, log = (line) => console.warn(`[connectors] ${line}`) }: AppConnectorsDeps): AppConnectors {
  const reporter = startWindowReporter({
    windowShown,
    report: async (client, shown) => (await invoke('connectors.windowShown', { shown }, { client }).catch(() => null))?.ok === true,
    before,
    log,
  });
  // P5 O4 (whole-branch review): `due` until a pass settles every record for good; `streamedMeanwhile`, a streaming of
  // the machine host heard while a pass ran, whose machine that pass may not have reached
  let adoption: 'due' | 'running' | 'settled' = 'due';
  let streamedMeanwhile = false;
  let stopped = false;
  const adoptWhenDue = () => {
    if (stopped) return;
    if (adoption === 'running') {
      streamedMeanwhile = true;
      return;
    }
    if (adoption === 'settled') return;
    adoption = 'running';
    streamedMeanwhile = false;
    const failed = (error: unknown) => {
      adoption = 'settled';
      log(`the legacy grants were not adopted: ${error instanceof Error ? error.message : String(error)}`);
    };
    const settle = ({ retry }: { retry: boolean }) => {
      adoption = retry ? 'due' : 'settled';
      if (!retry || stopped) return;
      if (streamedMeanwhile) adoptWhenDue();
      else log(`the machine could not take every legacy grant yet; the machine host's next streaming adopts them`);
    };
    try {
      void adopt().then(settle, failed);
    } catch (error) {
      failed(error); // never a throw into main's startup
    }
  };
  if (machine === null) {
    adoptWhenDue();
    return {
      stop: () => {
        stopped = true;
        reporter.stop();
      },
    };
  }
  let streamed = machine.streaming();
  if (streamed) adoptWhenDue();
  const offStreaming = machine.onStreaming(() => {
    if (!streamed) {
      streamed = true;
      adoptWhenDue();
      return;
    }
    reporter.reportAgain(); // before the windows hear it, so a rebuilt lease's first command reports first
    emit('connectors.reset', {});
    adoptWhenDue(); // P5 O4 (whole-branch review): a pass the machine could not complete runs again
  });
  return {
    stop: () => {
      stopped = true;
      offStreaming();
      reporter.stop();
    },
  };
}
