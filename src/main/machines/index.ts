// Main's machines (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Machine links"): the
// composition of the connection manager, its links, `machines.list` and `machines.changed`, and (in a build that is not
// packaged, started with MAWS_MACHINE_SERVE=1) the stand-in that serves this profile's machine services to another
// profile's app. The router reaches every other machine through `dispatch` (`RouterOptions.remote`).
//
// P5 O7 M1 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Composition"): the RL2 links' source (one link per
// machine the org session lists) joins the manager as its second source, `remote(ref)` is the one way main's consumers
// reach a machine's endpoint, and wake, unlock and focus probe every link (the network watch is the source's own).
import { join } from 'node:path';
import { app, powerMonitor } from 'electron';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgSession } from '../org/session';
import { loadPeerAddon, peerAddonPath } from '../browser/cua/peer';
import { emit, emitFrom } from '../ipc/events';
import type { MainContext, MainHandler, RemoteDispatch } from '../ipc/router';
import { configuredMachines } from './config';
import { KNOWN_MACHINES_FILE } from './known-machines';
import { createLocalLink } from './local-link';
import { createConnectionManager } from './manager';
import { machineServeAllowed } from './serve-gate';
import { serveMachineStandIn, type StandIn } from './serve-standin';
import { createSocketLink } from './socket-link';
import type { RemoteLink } from './remote/link';
import { createRemoteSource } from './remote/source';

export interface MachinesDeps {
  local: MachineRef;
  localName: string;
  userData: string;
  packaged: boolean;
  env: NodeJS.ProcessEnv;
  build: string; // this app's build, said in a link's hello and the stand-in's welcome
  resourcesPath: string; // where a packaged build keeps the peer-auth addon
  appRoot: string; // the development app root, where the addon's prebuild is
  session: OrgSession; // the org session the RL2 links read: signed out until O8's sign-in, or MAWS_DEV_ORG's in development
  register(name: 'machines.list', handler: MainHandler<'machines.list'>): void;
  dispatchLocal(name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
}

export interface Machines {
  dispatch: RemoteDispatch;
  remote(machine: MachineRef): RemoteLink | null; // the one link to that machine, or null when the org lists none
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void; // the roster changed: links were created or closed
  serve(): void; // the stand-in, behind its gate: once every handler is registered
  stop(): Promise<void>;
}

export function startMachines(deps: MachinesDeps): Machines {
  const { local, localName, userData, packaged, env, build, dispatchLocal } = deps;
  const log = (line: string) => console.log(`[machines] ${line}`);
  const remote = createRemoteSource({ session: deps.session, local, userData, log });
  const manager = createConnectionManager({
    local,
    localName,
    localLink: createLocalLink({ ref: local, name: localName, dispatchLocal }),
    knownMachinesFile: join(userData, KNOWN_MACHINES_FILE),
    configured: configuredMachines({ packaged, env, log }),
    emitFrom,
    connect: (dir) => createSocketLink({ dir, build, log }),
    remote,
    log,
  });
  const remoteListeners = new Set<(machines: readonly MachineRef[]) => void>();
  remote.onChanged(() => {
    const refs = remote.machines().map((machine) => machine.ref);
    for (const listener of [...remoteListeners]) listener(refs);
  });
  const onWake = () => remote.probeAll('wake');
  const onUnlock = () => remote.probeAll('unlock');
  const onFocus = () => remote.probeAll('focus');
  powerMonitor.on('resume', onWake);
  powerMonitor.on('unlock-screen', onUnlock);
  app.on('browser-window-focus', onFocus);
  deps.register('machines.list', () => ({ machines: manager.list() }));
  manager.onChanged((machines) => void emit('machines.changed', { machines }));

  let standIn: StandIn | null = null;
  return {
    dispatch: (machine, name, input, ctx) => manager.dispatch(machine, name, input, ctx),
    remote: (machine) => remote.link(machine),
    onRemote(listener) {
      remoteListeners.add(listener);
      return () => void remoteListeners.delete(listener);
    },
    serve() {
      if (standIn || !machineServeAllowed({ packaged, env })) return;
      try {
        const peer = loadPeerAddon(peerAddonPath({ packaged, resourcesPath: deps.resourcesPath, appRoot: deps.appRoot }));
        standIn = serveMachineStandIn({ userData, router: { dispatchLocal }, localRef: local, peer, log, build });
      } catch (error) {
        log(`cannot serve this machine: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async stop() {
      powerMonitor.off('resume', onWake);
      powerMonitor.off('unlock-screen', onUnlock);
      app.off('browser-window-focus', onFocus);
      manager.close();
      remote.close();
      await standIn?.close();
    },
  };
}
