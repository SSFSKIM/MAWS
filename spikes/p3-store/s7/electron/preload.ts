// S7b preload: S2's harness preload (spikes/p3-store/electron/preload.ts) unchanged but for its header: sandboxed and
// context-isolated as the app's; a document port from main is handed to the page's main world through
// window.postMessage's transfer list (Electron's documented route for MessagePorts).
import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.on('doc-port', (event, message: Record<string, unknown>) => {
  window.postMessage({ s2: 'doc-port', ...message }, '*', event.ports);
});

contextBridge.exposeInMainWorld('harness', {
  report: (message: unknown) => ipcRenderer.send('s2-report', message),
  onCommand: (listener: (command: unknown) => void) => ipcRenderer.on('s2-cmd', (_event, command) => listener(command)),
});
