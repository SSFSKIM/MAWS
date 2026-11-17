// UX wave U10b (fix wave 1, review item 4): the e2e hold on the window's document ports' outgoing frames.
import { afterEach, describe, expect, it } from 'vitest';
import type { PortLike } from '@artifacts/provider/port';
import { holdableDocPorts } from './held-frames';
import type { DocPorts } from './host';

const portWith = (sent: number[]): PortLike => ({ postMessage: (frame) => void sent.push(frame[0]!), addEventListener: () => {}, removeEventListener: () => {}, close: () => {} });
const portsOf = (port: PortLike): DocPorts => ({ take: () => Promise.resolve(port) });

describe('the hold on the document ports’ outgoing frames (e2e only)', () => {
  afterEach(() => delete window.__maws_docFrames);

  it('without the e2e flag is nothing: the window’s ports as they are, and no seam on the window', () => {
    const ports = portsOf(portWith([]));
    expect(holdableDocPorts(ports, window, false)).toBe(ports);
    expect(window.__maws_docFrames).toBeUndefined();
  });

  it('under the flag holds every port’s frames while held, and releases them in the order they were posted', async () => {
    const first: number[] = [];
    const second: number[] = [];
    const ports = holdableDocPorts({ take: (channel) => Promise.resolve(portWith(channel === 1 ? first : second)) }, window, true);
    const [a, b] = await Promise.all([ports.take(1), ports.take(2)]);
    a.postMessage(new Uint8Array([1]));
    window.__maws_docFrames!.hold();
    a.postMessage(new Uint8Array([2]));
    b.postMessage(new Uint8Array([3]));
    a.postMessage(new Uint8Array([4]));
    expect([first, second, window.__maws_docFrames!.held()]).toEqual([[1], [], 3]);
    window.__maws_docFrames!.release();
    expect([first, second, window.__maws_docFrames!.held()]).toEqual([[1, 2, 4], [3], 0]);
    b.postMessage(new Uint8Array([5]));
    expect(second).toEqual([3, 5]);
  });
});
