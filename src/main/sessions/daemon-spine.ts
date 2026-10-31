// The daemon shape's spine as main holds it (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §E, §F): the spine runs in `mawsd`, so main reads it through its mirror over the services front
// (./spine-mirror.ts) and answers what the spine's services ask of this client through the Electron port
// (../client/port-answers.ts). The embedded shape's `startSpine` answers the same two needs in process. P5 O3-E M2: and
// gives the pages' checkout watches back at each streaming of `mawsd` (./watch-replay.ts).
import type { ClientPort } from '@shared/client/port';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { ClientRef } from '@shared/ipc/client';
import type { SpineView } from '@shared/spine/view';
import { startPortAnswers } from '../client/port-answers';
import type { DaemonStatusWatch } from '../hosts';
import { clientOfId } from '../ipc/clients';
import type { FilesChanged } from '@shared/ipc/schema/files';
import { createMirrorSpineView } from './spine-mirror';
import { installDaemonE2eSeams } from './daemon-e2e-seams';
import { createWatchReplay, type WatchReplay, type WatchReplayOptions } from './watch-replay';

export interface DaemonSpineOptions {
  hosts: HostSupervisor;
  daemon: DaemonStatusWatch;
  port: ClientPort; // main's Electron port
  browserSocket(): string | null; // this app's cua socket directory, once the browser runs
  emit(name: 'files.changed', payload: FilesChanged): void; // P5 O3-E: main's emit, for the watch replay's invalidations
  budgetsMs?: WatchReplayOptions['budgetsMs']; // the machine host's (COMMAND_BUDGETS_MS): the watch replay answers a page within git.watch's
}

export interface DaemonSpine {
  view: SpineView;
  /** A command main's router forwarded to `mawsd` for a page (the mirror keeps its visibility claims, the watch replay
   * its files watches, to give them back). */
  forwarded(name: string, input: unknown, client: ClientRef | undefined): void;
  /** P5 O3-E M2 (Interfaces §E): a page's git.watch and git.unwatch, which main's host dispatch routes through it. */
  watches: Pick<WatchReplay, 'owns' | 'dispatch'>;
  stop(): void;
}

export function startDaemonSpine({ hosts, daemon, port, browserSocket, emit, budgetsMs }: DaemonSpineOptions): DaemonSpine {
  const log = (line: string) => console.log(line);
  const mirror = createMirrorSpineView({ hosts, spineRefused: () => daemon.status()?.spine?.refused ?? null, onDaemonStatus: daemon.onStatus, browserSocket, log });
  const stopAnswers = startPortAnswers({ hosts, port, clientOfId, log });
  // the spine's state (a load the lock refused, one that succeeded after) changes at no host transition: host.status
  // reads it from the daemon's status, read again at each change of the mirror's availability
  const offAvailability = mirror.view.on('availability', () => daemon.refresh());
  const stopSeams = installDaemonE2eSeams(hosts, process.env); // M5b fix round 2: the e2e's spine seams, relayed to mawsd
  // P5 O3-E M2 (Interfaces §E; D8): the pages' git and files watches given back at each streaming of mawsd, as the
  // mirror gives back their visibility claims
  const watches = createWatchReplay({ hosts, emit, budgetsMs });
  const offReplay = hosts.onStreaming('machine', () => watches.replay());
  return {
    view: mirror.view,
    forwarded(name, input, client) {
      mirror.forwarded(name, input, client);
      watches.forwarded(name, input, client);
    },
    watches,
    stop() {
      offReplay();
      watches.stop();
      offAvailability();
      stopSeams();
      stopAnswers();
      mirror.stop();
    },
  };
}
