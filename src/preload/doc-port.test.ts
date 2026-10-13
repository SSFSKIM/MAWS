// P3-A M4: the preload's half of a document port's route (Decision Log 13): a port main posts on `maws:doc-port` is
// re-posted to the page with `window.postMessage`'s transfer list, so the sandboxed page receives it as a MessagePort.
import { describe, expect, it, vi } from 'vitest';
import { DOC_PORT_CHANNEL, isDocPortMessage } from '@shared/ipc/doc-port';
import { forwardDocPorts } from './doc-port';

function harness() {
  let listener: ((event: { ports: { close(): void }[] }, message: unknown) => void) | null = null;
  const ipc = { on: vi.fn((channel: string, l: typeof listener) => void (channel === DOC_PORT_CHANNEL && (listener = l))) };
  const target = { postMessage: vi.fn() };
  forwardDocPorts(ipc as never, target as never);
  return { send: (message: unknown, ports: { close(): void }[]) => listener!({ ports }, message), target };
}

describe('the preload forwards document ports to the page', () => {
  it('re-posts the port with its channel and artifact, transferred', () => {
    const h = harness();
    const port = { close: vi.fn() };
    h.send({ channel: 5, artifactId: 'a1' }, [port]);
    expect(h.target.postMessage).toHaveBeenCalledWith({ maws: 'doc-port', channel: 5, artifactId: 'a1' }, '*', [port]);
    expect(isDocPortMessage(h.target.postMessage.mock.calls[0][0])).toBe(true);
    expect(port.close).not.toHaveBeenCalled();
  });

  it('closes the ports of a message that is not one port with a channel and an artifact, forwarding nothing', () => {
    const h = harness();
    const [a, b, c] = [{ close: vi.fn() }, { close: vi.fn() }, { close: vi.fn() }];
    h.send({ channel: 'x', artifactId: 'a1' }, [a]);
    h.send({ channel: 5, artifactId: 'a1' }, [b, c]);
    h.send({ channel: 6, artifactId: 'a1' }, []);
    expect(h.target.postMessage).not.toHaveBeenCalled();
    for (const port of [a, b, c]) expect(port.close).toHaveBeenCalled();
  });
});
