// `window.maws`, built over the preload's `ipcRenderer`. The preload is the allowlist gate: only names in the X2
// registries cross, commands go out on their command channel, events come in on theirs with the IPC event object
// stripped. Validation of what comes back is the renderer client's (`src/renderer/src/ipc/client.ts`), and of what
// goes out main's router; the preload stays a thin, name-checking pipe.
import type { IpcRenderer, WebUtils } from 'electron';
import { commandChannel, eventChannel, type MawsBridge } from '@shared/ipc/schema';
import { isCommandName, isEventName } from '@shared/ipc/validate';

export type BridgeTransport = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>;

// C7: `files` is Electron's `webUtils` in the preload; absent (tests), no file has a path.
export function createBridge(ipc: BridgeTransport, files?: Pick<WebUtils, 'getPathForFile'>): MawsBridge {
  return {
    // Every outcome is a `CommandResult`: an unknown name, a rejected transport and main's own answer alike.
    invoke: async (name, input) => {
      if (!isCommandName(name)) {
        return { ok: false, error: { code: 'unknown_command', message: `unknown command: ${String(name)}` } };
      }
      try {
        return await ipc.invoke(commandChannel(name), input);
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
      }
    },
    // A subscription has no result channel, so an unknown name is a programming error at the call site: throw.
    on: (name, listener) => {
      if (!isEventName(name)) throw new TypeError(`unknown event: ${String(name)}`);
      const channel = eventChannel(name);
      const forward = (_event: unknown, payload: unknown) => listener(payload as Parameters<typeof listener>[0]);
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
