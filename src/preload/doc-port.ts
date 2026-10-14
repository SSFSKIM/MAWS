// A document's port into the page (P3-A M4; docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13, S2's
// harness the precedent): a sandboxed, context-isolated preload cannot hand a MessagePort across `contextBridge`, so it
// re-posts what main sent on `maws:doc-port` to the page's own window with `window.postMessage`'s transfer list. The page
// (the renderer's ArtifactHost) takes only messages whose source is its own window, so a frame inside the page cannot
// pose as main.
import type { IpcRenderer } from 'electron';
import { DOC_PORT_CHANNEL, type DocPortMessage } from '@shared/ipc/doc-port';

type Port = { close(): void };

export function forwardDocPorts(ipc: Pick<IpcRenderer, 'on'>, target: { postMessage(message: unknown, targetOrigin: string, transfer: Port[]): void }): void {
  ipc.on(DOC_PORT_CHANNEL, (event: { ports: Port[] }, message: unknown) => {
    const { channel, artifactId } = (message ?? {}) as Partial<DocPortMessage>;
    if (typeof channel !== 'number' || typeof artifactId !== 'string' || event.ports.length !== 1) {
      for (const port of event.ports) port.close();
      return;
    }
    target.postMessage({ maws: 'doc-port', channel, artifactId } satisfies DocPortMessage, '*', [event.ports[0]]);
  });
}
