// The only bridge between the sandboxed page and main: `window.maws` (X2 `MawsBridge`). Built with its dependencies
// bundled (`build.externalizeDeps: false`), because a sandboxed preload's `require` loads only `electron`, `events`,
// `timers` and `url`. The allowlist is X2's zod-free name lists (`@shared/ipc/names`), not the registries.
import { contextBridge, ipcRenderer, webUtils } from 'electron'; // C7: webUtils
import { createBridge } from './bridge';
import { forwardDocPorts } from './doc-port'; // P3-A M4
import { exposeProcessMemory } from './process-memory'; // P3-E (E2 M6)

contextBridge.exposeInMainWorld('maws', createBridge(ipcRenderer, webUtils)); // C7: webUtils for pathForFile
// P3-A M4: a document's MessagePort, re-posted to the page (`globalThis` is the preload's window; the node project has no DOM)
forwardDocPorts(ipcRenderer, globalThis as unknown as Parameters<typeof forwardDocPorts>[1]);
// P3-E (E2 M6): the renderer's own memory for the dashboard scale gate, an e2e launch only (./process-memory.ts)
exposeProcessMemory(process.env, contextBridge, () => process.getProcessMemoryInfo());
