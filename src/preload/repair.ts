// The repair window's preload (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Interfaces §B):
// `window.repair`, over the window's own three channels and nothing else. Its own preload entry
// (electron.vite.config.ts, out/preload/repair.js): a sandboxed preload can `require` no file of its own, so it shares no
// module with the app's preload or the browser's (bundle.test.ts checks the build); what it reads of @shared/repair is
// its constants, inlined.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { REPAIR_CHANNELS, type RepairBridge, type RepairState } from '@shared/repair';

const bridge: RepairBridge = {
  state: () => ipcRenderer.invoke(REPAIR_CHANNELS.state) as Promise<RepairState>,
  onState(listener) {
    const forward = (_event: IpcRendererEvent, state: RepairState) => listener(state);
    ipcRenderer.on(REPAIR_CHANNELS.changed, forward);
    return () => void ipcRenderer.removeListener(REPAIR_CHANNELS.changed, forward);
  },
  act: (action) => ipcRenderer.send(REPAIR_CHANNELS.act, action),
};

contextBridge.exposeInMainWorld('repair', bridge);
