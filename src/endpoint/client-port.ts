// The client port across the channel (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and
// the client port"; §M, §T; A15; C7, OX4). A service in `mawsd` asks the client a request came from for an effect only
// that client can perform (`openExternal {url}`: a connector's consent page, the engine's MCP sign-in); a request from a
// remote device came under its channel's `ClientRef`, so the port's target for that ref is the channel.
//
// At admission each channel's target is registered under its ref (`EndpointServices.clientPort.serve`), which the services
// front's `route` consults after its own connections; the request, its deadline (`CLIENT_PORT_DEADLINE_MS`) and its
// correlation stay the port's own (src/mawsd/client-port.ts). The target posts a request as RL2's `client {id, kind,
// request}`, and the device's `clientAnswer {id, answer}` settles it through the handle, which answers with this channel's
// target as `from`: an id another channel was asked is refused there, as a `machine.sock` client's is. The channel's end
// closes the handle, which settles every request it was asked `noClient`.
//
// Only to a device whose `h1` listed `rl2.client-port`, and only the kinds a device answers once (`openExternal`, `reveal`,
// both timed): any other (a pick, a save, a confirm, a notification, the badge, focus) is posted nowhere, so the port
// answers `noClient` at once, as it does for a ref with no connection to ask. The machine's services ask a remote asker
// for nothing else, and a notification's further events, or a dialog with no deadline, would need a wire of their own.
import type { ClientAnswerMessage } from 'org-protocol';
import type { ClientPortRequest, PortTarget, RemotePortHandle } from '../mawsd/client-port';
import type { RemoteChannel } from './channels';
import type { EndpointServices } from './services';

/** The capability a device lists when it reads `client` and answers with `clientAnswer` (§M). */
export const CLIENT_PORT_CAPABILITY = 'rl2.client-port';
/** The port's kinds posted to a remote device: answered once, each under the port's deadline. */
export const RELAYED_KINDS: ReadonlySet<string> = new Set(['openExternal', 'reveal']);

export type ClientPortsContext = {
  /** `mawsd`'s port, as the endpoint reaches it once started (null before). */
  services(): Pick<EndpointServices, 'clientPort'> | null;
  log(line: string): void;
};

export class ClientPorts {
  readonly #ctx: ClientPortsContext;
  /** Each open channel's handle on its target. */
  readonly #handles = new Map<RemoteChannel, RemotePortHandle>();

  constructor(ctx: ClientPortsContext) {
    this.#ctx = ctx;
  }

  /** A channel admitted: its target registered under its ref until it closes. */
  admit(channel: RemoteChannel): void {
    const services = this.#ctx.services();
    if (services === null || channel.closed) return;
    const carries = channel.capabilities.includes(CLIENT_PORT_CAPABILITY);
    const target: PortTarget = {
      post: (request: ClientPortRequest) => carries && RELAYED_KINDS.has(request.kind) && channel.send({ t: 'client', id: request.id, kind: request.kind, request: request.request }),
    };
    const handle = services.clientPort.serve(channel.client, target);
    this.#handles.set(channel, handle);
    channel.onClose(() => {
      this.#handles.delete(channel);
      handle.close();
    });
  }

  /** The device's answer to a request it was asked on this channel; one it was not asked is refused, logged. */
  answer(channel: RemoteChannel, message: ClientAnswerMessage): void {
    const handle = this.#handles.get(channel);
    if (handle === undefined) return;
    try {
      handle.answer({ id: message.id, answer: message.answer });
    } catch (error) {
      this.#ctx.log(`endpoint: channel ${channel.key} answered client port request ${message.id.slice(0, 64)}, which it was not asked: ${(error as Error).message}`);
    }
  }
}
