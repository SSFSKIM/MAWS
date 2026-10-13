// One end of a document port as the document service sees it, and the adapters from the concrete ports to it (X24;
// P3-0's S2 `spikes/p3-store/s2/src/host/ports.ts`): Electron's MessagePortMain (a renderer's port in utility mode,
// M4), a Node MessagePort (an agent session's in-process replica), and later a socket channel (M5).
import type { MessagePort as NodeMessagePort } from 'node:worker_threads';

export interface HostPort {
  send(frame: Uint8Array): void;
  close(): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
}

// Electron's MessagePortMain (a utility process receives it with a parentPort message).
export interface MessagePortMainLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

export function fromMessagePortMain(port: MessagePortMainLike): HostPort {
  return {
    send: (frame) => port.postMessage(frame),
    close: () => port.close(),
    onMessage: (listener) => {
      port.on('message', (event) => listener(event.data));
      port.start();
    },
    onClose: (listener) => void port.on('close', listener),
  };
}

export function fromNodePort(port: NodeMessagePort): HostPort {
  return {
    send: (frame) => port.postMessage(frame),
    close: () => port.close(),
    onMessage: (listener) => void port.on('message', listener),
    onClose: (listener) => void port.on('close', listener),
  };
}
