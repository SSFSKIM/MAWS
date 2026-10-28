// Main's host supervisor (charter §4.1; §12 C1 *Utility processes, build and start*): the shared core
// (@shared/host/host-supervisor, which P5 O2 M3 moved out of main so `mawsd` runs it too) with the facts only Electron
// has. A utility host is forked here, `utilityProcess.fork` with a MessageChannelMain whose one end goes to the child
// with its hello; its stdout and stderr go to main's log line by line. The detached transport reads Electron's
// `userData` and `packaged` unless a caller brings its own.
import { createInterface } from 'node:readline';
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import {
  createHostSupervisor as createCore,
  type HostSpec,
  type HostSupervisor,
  type HostSupervisorOptions,
  type UtilityLink,
} from '@shared/host/host-supervisor';
import type { HostMessage } from '@shared/ipc/host-protocol';

export {
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  REQUEST_TIMEOUT_MS,
  RESTART_BACKOFF_MS,
  RESYNC_BOUND_MS,
  STOP_ALL_GRACE_MS,
  type HostFacts,
  type HostResync,
  type HostSpec,
  type HostSupervisor,
  type ResyncCancel,
} from '@shared/host/host-supervisor';

export type MainHostSupervisorOptions = Omit<HostSupervisorOptions, 'launchUtility' | 'userData' | 'packaged'> & Partial<Pick<HostSupervisorOptions, 'userData' | 'packaged'>>;

export function createHostSupervisor(options: MainHostSupervisorOptions): HostSupervisor {
  return createCore({ userData: () => app.getPath('userData'), packaged: () => app.isPackaged, ...options, launchUtility });
}

// Throws when the fork fails (both ends of the channel closed first); the core reads that as an exit.
function launchUtility(spec: HostSpec): UtilityLink {
  const { port1, port2 } = new MessageChannelMain();
  if (app.isPackaged) delete process.env.MAWS_RELAY_URL; // C11: the dev-only relay override (M6) never reaches a packaged host
  let child: UtilityProcess;
  try {
    child = utilityProcess.fork(spec.modulePath, [], { serviceName: spec.serviceName, stdio: 'pipe' });
  } catch (error) {
    port1.close();
    port2.close();
    throw error;
  }
  const owner = spec.serviceName.replace(/^maws-/, ''); // the log's prefix: `engine-host`, `pty-host`
  forwardOutput(owner, child);
  child.on('error', (type, location) => console.error(`[hosts] ${owner} fatal error ${type} at ${location}`));
  child.postMessage({ t: 'hello' } satisfies HostMessage, [port1]);
  // a document's port is only ever main's (MessageChannelMain's) end: the core passes on what main's callers gave it
  return { child, port: port2, postDoc: (message, port) => child.postMessage(message, [port as MessagePortMain]) };
}

// The hosts' stdout and stderr, line by line into main's log, prefixed with the host.
function forwardOutput(owner: string, child: UtilityProcess): void {
  if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => console.log(`[${owner}] ${line}`));
  if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => console.error(`[${owner}] ${line}`));
}
