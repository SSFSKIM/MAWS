// The only bridge between the sandboxed page and main: `window.maws` (X2 `MawsBridge`). Built with its dependencies
// bundled (`build.externalizeDeps: false`), because a sandboxed preload's `require` loads only `electron`, `events`,
// `timers` and `url`, and the allowlist below pulls in zod through the registries.
import { contextBridge, ipcRenderer } from 'electron';
import { createBridge } from './bridge';

contextBridge.exposeInMainWorld('maws', createBridge(ipcRenderer));
