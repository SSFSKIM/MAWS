// `window.maws`, built over the preload's `ipcRenderer`. The preload is the allowlist gate: only names in the X2
// registries cross (their zod-free lists, `@shared/ipc/names`, so the preload bundles no schema), commands go out on their command channel, events come in on theirs with the IPC event object
// stripped. Validation of what comes back is the renderer client's (`src/renderer/src/ipc/client.ts`), and of what
// goes out main's router; the preload stays a thin, name-checking pipe.
// P5 O6 M2 (OX2): every invoke carries the machine it goes to, and every event the machine it came from, as the IPC
// message's last argument. The preload checks nothing about a machine (main's router validates it); an invoke that names
// none is the local machine's, the raw bridge's convenience for e2e specs and harness pages over bare ids.
// P5 O7 M4 (Interfaces §O): the last argument may instead be `{machine, session?}`, the session a path-class command is
// made from; it crosses as it is, and main's router reads both forms.
import type { IpcRenderer, WebUtils } from 'electron';
import { commandChannel, eventChannel, isBridgedCommandName, isBridgedEventName } from '@shared/ipc/names';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';

export type BridgeTransport = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>;

// C7: `files` is Electron's `webUtils` in the preload; absent (tests), no file has a path.
export function createBridge(ipc: BridgeTransport, localMachine: MachineRef, files?: Pick<WebUtils, 'getPathForFile'>): PreloadBridge {
  return {
    localMachine,
    // Every outcome is a `CommandResult`: an unknown name, a rejected transport and main's own answer alike.
    invoke: async (name, input, target = localMachine) => {
      if (!isBridgedCommandName(name)) {
        return { ok: false, error: { code: 'unknown_command', message: `unknown command: ${String(name)}` } };
      }
      try {
        return await ipc.invoke(commandChannel(name), input, target);
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
      }
    },
    // A subscription has no result channel, so an unknown name is a programming error at the call site: throw.
    on: (name, listener) => {
      if (!isBridgedEventName(name)) throw new TypeError(`unknown event: ${String(name)}`);
      const channel = eventChannel(name);
      const forward = (_event: unknown, payload: unknown, machine: unknown) =>
        listener(payload as Parameters<typeof listener>[0], machine as MachineRef | undefined);
      ipc.on(channel, forward);
      return () => void ipc.removeListener(channel, forward);
    },
    // C7 start: the path of a dropped file, from Electron only (§4.1: the renderer loads nothing by path itself); ''
    // when Electron has none for it (a file dragged from a browser) or refuses the argument.
    pathForFile: (file) => {
      try {
        return files?.getPathForFile(file) ?? '';
      } catch {
        return '';
      }
    },
    // C7 end
  };
}
