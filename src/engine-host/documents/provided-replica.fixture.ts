// A replica as an open editor's is (imported by tests only): a PortProvider on its own doc, attached to the document
// service through two in-memory ends that carry nothing until the test delivers. With the service's flushes run by the
// test too, a test holds one replica's frames while another's land, and sees every frame a replica sends.
import { decodeFrame, type Frame } from '@artifacts/provider/frames';
import { PortProvider, type PortLike } from '@artifacts/provider/port';
import { newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { HostPort } from './ports';
import type { DocumentService } from './service';

export interface ProvidedReplica {
  doc: Doc;
  provider: PortProvider;
  /** The host closed this replica's connection (an eviction, a refused frame). */
  closed: boolean;
  /** The content frames (step 2, update) this replica has sent the host, in order. */
  sent: Frame['type'][];
  /** While set, what the replica posts waits on its side; what the host sends still arrives. */
  hold: boolean;
  /** Delivers what each side has posted (the replica's unless held); answers how many frames moved. */
  deliver(): number;
}

type Listener = (event: { data?: unknown }) => void;

export function provided(service: DocumentService, artifactId: string, actor: Actor, doc: Doc = newDoc()): ProvidedReplica {
  const toHost: Uint8Array[] = [];
  const toReplica: Uint8Array[] = [];
  let hostListener: ((data: unknown) => void) | null = null;
  const listeners = { message: new Set<Listener>(), close: new Set<Listener>() };
  const replica: ProvidedReplica = {
    doc,
    provider: new PortProvider(doc, { log: () => {} }),
    closed: false,
    sent: [],
    hold: false,
    deliver() {
      let moved = 0;
      if (!replica.hold) {
        for (const frame of toHost.splice(0)) {
          moved += 1;
          const { type } = decodeFrame(frame);
          if (type === 'step2' || type === 'update') replica.sent.push(type);
          hostListener?.(frame);
        }
      }
      for (const frame of toReplica.splice(0)) {
        moved += 1;
        for (const listener of [...listeners.message]) listener({ data: frame });
      }
      return moved;
    },
  };
  const replicaEnd: PortLike = {
    postMessage: (message) => void (replica.closed || toHost.push(message.slice())),
    addEventListener: (type, listener) => void listeners[type].add(listener),
    removeEventListener: (type, listener) => void listeners[type].delete(listener),
    close: () => {}, // the replica never hangs up in these tests
  };
  const hostEnd: HostPort = {
    send: (frame) => void (replica.closed || toReplica.push(frame)),
    close: () => {
      if (replica.closed) return;
      replica.closed = true;
      toHost.length = 0;
      toReplica.length = 0;
      for (const listener of [...listeners.close]) listener({});
    },
    onMessage: (listener) => void (hostListener = listener),
    onClose: () => {},
  };
  service.attach(artifactId, hostEnd, actor);
  replica.provider.connect(replicaEnd);
  return replica;
}
