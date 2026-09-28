// The only bridge between the sandboxed page and main: `window.maws`.
// M1 placeholder: the registries are empty, so every command answers `unknown_command` and every event name is
// refused. M3 replaces both methods with the validated transport.
import { contextBridge } from 'electron';
import type { MawsBridge } from '@shared/ipc/schema';

const maws: MawsBridge = {
  invoke: async (name) => ({ ok: false, error: { code: 'unknown_command', message: `unknown command: ${String(name)}` } }),
  on: (name) => {
    throw new TypeError(`unknown event: ${String(name)}`);
  },
};

contextBridge.exposeInMainWorld('maws', maws);
