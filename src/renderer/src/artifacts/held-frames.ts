// UX wave U10b (fix wave 1, review item 4): in a window loaded for the e2e harness alone (`e2e=1`, ./e2e-seam.ts), a hold
// on every document port's outgoing frames (`window.__maws_docFrames`), so a scene can type an edit the host has not
// seen yet when an agent deletes the artifact. Without the flag the window's ports are returned as they are.
import type { PortLike } from '@artifacts/provider/port';
import type { DocPorts } from './host';

export interface DocFramesSeam {
  hold(): void;
  release(): void; // the held frames, posted in the order they were held
  held(): number;
}

declare global {
  interface Window {
    __maws_docFrames?: DocFramesSeam;
  }
}

export function holdableDocPorts(ports: DocPorts, win: Window, e2e: boolean): DocPorts {
  if (!e2e) return ports;
  let holding = false;
  const queue: (() => void)[] = [];
  win.__maws_docFrames = {
    hold: () => void (holding = true),
    release: () => {
      holding = false;
      for (const post of queue.splice(0)) post();
    },
    held: () => queue.length,
  };
  const holdable = (port: PortLike): PortLike => ({
    postMessage: (frame) => (holding ? void queue.push(() => port.postMessage(frame)) : port.postMessage(frame)),
    addEventListener: (type, listener) => port.addEventListener(type, listener),
    removeEventListener: (type, listener) => port.removeEventListener(type, listener),
    start: () => port.start?.(),
    close: () => port.close(),
  });
  return { take: async (channel, timeoutMs) => holdable(await ports.take(channel, timeoutMs)) };
}
