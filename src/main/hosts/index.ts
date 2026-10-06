// Wires the host supervisor into main: the two utility-process entries (bundled by electron-vite's `?modulePath`,
// which evaluates to the emitted file's path in dev and inside the packaged asar alike), the `engine.hostState` and
// `pty.hostState` snapshot commands, and the events of the same names on every transition.
// E10: the engine host runs in the mode MAWS_HOST_MODE picks (mode.ts): detached (the supervisor, by default) or a
// utility process (under the harnesses); the pty host is always a utility process.
import { join } from 'node:path';
import { app, shell } from 'electron';
import engineHostPath from '../../engine-host/index?modulePath';
import ptyHostPath from '../../pty-host/index?modulePath';
import { SUPERVISOR_FILES } from '../../engine-host/supervisor-files';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { appIdentity } from './identity';
import { hostModeFromEnv } from './mode';
import { startHostStatus } from './status';
import { createHostSupervisor, type HostSupervisor } from './supervisor';

export function createHosts(): HostSupervisor {
  const mode = hostModeFromEnv(process.env);
  console.log(`[hosts] the engine host runs ${mode === 'detached' ? 'detached (the supervisor)' : 'as a utility process'}`);
  // E10 Task 2.4: one identity for the hello and for host.status, so the e2e seams (MAWS_E2E_BUILD_ID, MAWS_E2E_WIRE)
  // read the same in both
  const identity = appIdentity(engineHostPath, process.env);
  const supervisor = createHostSupervisor({
    hosts: {
      'engine-host': { modulePath: engineHostPath, serviceName: 'maws-engine-host', transport: mode },
      'pty-host': { modulePath: ptyHostPath, serviceName: 'maws-pty-host' },
    },
    emit,
    detached: { identity },
  });
  // E10: the engine host is told ready after main's resync (X13), which the session read side registers
  // (sessions/index.ts `hostEventSource`); with none registered (launch mode scenario) it is told at once.
  registerMainHandler('engine.hostState', () => supervisor.snapshot('engine-host'));
  registerMainHandler('pty.hostState', () => supervisor.snapshot('pty-host'));
  supervisor.onState('engine-host', (state) => emit('engine.hostState', state));
  supervisor.onState('pty-host', (state) => emit('pty.hostState', state));
  // E10: host.status (the supervisor's status with main's facts), host.restart and host.openLog
  startHostStatus({
    hosts: supervisor,
    appBuildId: identity.buildId,
    appWire: identity.wire,
    logPath: () => (mode === 'detached' ? join(app.getPath('userData'), 'supervisor', SUPERVISOR_FILES.log) : null),
    emit: (status) => void emit('host.status', status),
    register: registerMainHandler,
    openPath: (path) => shell.openPath(path),
  });
  return supervisor;
}
