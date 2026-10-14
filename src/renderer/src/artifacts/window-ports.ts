// The page's side of the preload's document-port route (P3-A M4; docs/doperpowers/plans/2026-10-12-p3-a-store.md,
// Decision Log 13), kept apart from host.ts so the ArtifactHost itself names no DOM type (P3-A M5).
import type { PortLike } from '@artifacts/provider/port';
import { isDocPortMessage } from '@shared/ipc/doc-port';
import type { DocPorts } from './host';

const PORT_WAIT_MS = 10_000; // how long an answered open waits for its port

// The page's side of the preload's route (src/preload/doc-port.ts): only a message whose source is this window itself is
// a port from main; a frame inside the page posting the same shape is ignored. A port nobody takes within the wait is
// closed.
export function windowDocPorts(win: Window): DocPorts & { dispose(): void } {
  const early = new Map<number, { port: MessagePort; timer: ReturnType<typeof setTimeout> }>();
  const waiting = new Map<number, (port: MessagePort) => void>();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win || !isDocPortMessage(event.data) || event.ports.length !== 1) return;
    const { channel } = event.data;
    const port = event.ports[0];
    const waiter = waiting.get(channel);
    if (waiter) {
      waiting.delete(channel);
      return waiter(port);
    }
    early.set(channel, { port, timer: setTimeout(() => early.delete(channel) && port.close(), PORT_WAIT_MS) });
  };
  win.addEventListener('message', onMessage);
  return {
    take: (channel, timeoutMs = PORT_WAIT_MS) => {
      const arrived = early.get(channel);
      if (arrived) {
        early.delete(channel);
        clearTimeout(arrived.timer);
        return Promise.resolve(arrived.port as unknown as PortLike);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(channel);
          reject(new Error(`no port arrived for document channel ${channel}`));
        }, timeoutMs);
        waiting.set(channel, (port) => {
          clearTimeout(timer);
          resolve(port as unknown as PortLike);
        });
      });
    },
    dispose: () => {
      win.removeEventListener('message', onMessage);
      for (const { port, timer } of early.values()) {
        clearTimeout(timer);
        port.close();
      }
      early.clear();
    },
  };
}
