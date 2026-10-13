// S2 on Yjs v14 → P3-A: an agent session's own replica of a host doc (§4.2's replica rule). It is synced in-process over a Node
// MessageChannel by the same provider the renderer uses, so its updates reach the host doc as a connection whose actor
// is the session, and the host's ack is what a tool call waits for before it answers.
import { MessageChannel } from 'node:worker_threads';
import * as Y from '@y/y';
import { PortProvider, type PortLike, type SaveState } from '../provider/port';
import type { DocumentService } from './document-service';
import { fromNodePort } from '../../src/host/ports';
import type { Actor } from './storage';

export class AgentReplica {
  readonly doc = new Y.Doc();
  readonly provider: PortProvider;

  constructor(service: DocumentService, docId: string, actor: Actor) {
    const { port1, port2 } = new MessageChannel();
    service.attach(docId, fromNodePort(port1), actor);
    this.provider = new PortProvider(this.doc);
    this.provider.connect(port2 as unknown as PortLike);
  }

  whenSynced(): Promise<void> {
    return this.until((s) => s.synced);
  }

  // Resolves once every local update is durable in the host's log (what an artifact_edit answers after).
  whenSaved(): Promise<number> {
    return this.until((s) => s.phase === 'live' && s.unsaved === 0).then(() => this.provider.state.revision);
  }

  close(): void {
    this.provider.destroy();
  }

  private until(test: (state: SaveState) => boolean): Promise<void> {
    if (test(this.provider.state)) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.provider.subscribe((state) => {
        if (!test(state)) return;
        off();
        resolve();
      });
    });
  }
}
