// The Worker as the suites load it: the deployed Worker, with one seam the deployed one does not have. Its `Machine`
// can be armed to throw on its next send of one frame kind, as a failed RPC from a `Project` would; a suite arms it
// through the object's own fetch, which only Miniflare reaches (`LocalHub.failNextSend`), never through the Worker.
import { Machine as DeployedMachine } from '../../src/objects/machine';
import type { DownFrame } from '../../src/protocol/machine';
import { SEND_FAULT_PATH } from './send-fault';

export { default, Project, Registry } from '../../src/worker';

export class Machine extends DeployedMachine {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== SEND_FAULT_PATH) return super.fetch(request);
    this.ctx.storage.kv.put('send-fault', url.searchParams.get('kind') ?? '');
    return new Response('armed');
  }

  async send(frame: DownFrame, generation?: number): Promise<'written' | 'offline'> {
    if (this.ctx.storage.kv.get<string>('send-fault') === frame.t) {
      this.ctx.storage.kv.delete('send-fault');
      throw new Error(`a failure the suite injected into the send of ${frame.t}`);
    }
    return super.send(frame, generation);
  }
}
