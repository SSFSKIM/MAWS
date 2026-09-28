// Wires the host supervisor into main: the two utility-process entries (bundled by electron-vite's `?modulePath`,
// which evaluates to the emitted file's path in dev and inside the packaged asar alike), the `engine.hostState` and
// `pty.hostState` snapshot commands, and the events of the same names on every transition.
import engineHostPath from '../../engine-host/index?modulePath';
import ptyHostPath from '../../pty-host/index?modulePath';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { createHostSupervisor, type HostSupervisor } from './supervisor';

export function createHosts(): HostSupervisor {
  const supervisor = createHostSupervisor({
    hosts: {
      'engine-host': { modulePath: engineHostPath, serviceName: 'maws-engine-host' },
      'pty-host': { modulePath: ptyHostPath, serviceName: 'maws-pty-host' },
    },
    emit,
  });
  registerMainHandler('engine.hostState', () => supervisor.snapshot('engine-host'));
  registerMainHandler('pty.hostState', () => supervisor.snapshot('pty-host'));
  supervisor.onState('engine-host', (state) => emit('engine.hostState', state));
  supervisor.onState('pty-host', (state) => emit('pty.hostState', state));
  return supervisor;
}
