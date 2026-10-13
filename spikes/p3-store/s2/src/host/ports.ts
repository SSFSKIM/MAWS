// S2 → P3-A: the host's adapters from a concrete port to the document service's HostPort.
import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import type { HostPort } from './document-service';

// Electron's MessagePortMain (a utility process receives it on `process.parentPort`'s message event).
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

// A Node MessagePort (an agent replica's in-process channel).
export function fromNodePort(port: NodeMessagePort): HostPort {
  return {
    send: (frame) => port.postMessage(frame),
    close: () => port.close(),
    onMessage: (listener) => void port.on('message', listener),
    onClose: (listener) => void port.on('close', listener),
  };
}
