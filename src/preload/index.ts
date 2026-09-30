// The only bridge between the sandboxed page and main: `window.maws` (X2 `MawsBridge`). Built with its dependencies
// bundled (`build.externalizeDeps: false`), because a sandboxed preload's `require` loads only `electron`, `events`,
// `timers` and `url`. The allowlist is X2's zod-free name lists (`@shared/ipc/names`), not the registries.
import { contextBridge, ipcRenderer, webUtils } from 'electron'; // C7: webUtils
import { createBridge } from './bridge';

contextBridge.exposeInMainWorld('maws', createBridge(ipcRenderer, webUtils)); // C7: webUtils for pathForFile
