import { describe, expect, it, vi } from 'vitest';
import { applyV1, checkUpdate, diffV1, newDoc, stateVector, transact, type Doc } from '../yjs';
import { decodeFrame, encodeFrame, type Frame } from './frames';
import { PortProvider, type PortLike, type SaveState } from './port';

type Listener = (event: { data?: unknown }) => void;

// One end of an in-memory channel: posted messages wait in the peer's inbox until `deliver()`, so a test sees exactly
// what crossed and when. Messages are copied, as structured clone does; closing either end closes both and fires
// 'close' on each, as a Node MessagePort does.
class MemoryPort implements PortLike {
  peer!: MemoryPort;
  readonly inbox: Uint8Array[] = [];
  closed = false;
  private readonly listeners = { message: new Set<Listener>(), close: new Set<Listener>() };

  static pair(): [MemoryPort, MemoryPort] {
    const a = new MemoryPort();
    const b = new MemoryPort();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  postMessage(message: Uint8Array): void {
    if (!this.closed) this.peer.inbox.push(message.slice());
  }
  addEventListener(type: 'message' | 'close', listener: Listener): void {
    this.listeners[type].add(listener);
  }
  removeEventListener(type: 'message' | 'close', listener: Listener): void {
    this.listeners[type].delete(listener);
  }
  close(): void {
    if (this.closed) return;
    for (const end of [this, this.peer]) end.closed = true;
    for (const end of [this, this.peer]) for (const listener of [...end.listeners.close]) listener({});
  }
  deliver(): number {
    const messages = this.inbox.splice(0);
    for (const data of messages) for (const listener of [...this.listeners.message]) listener({ data });
    return messages.length;
  }
  frames(): Frame[] {
    return this.inbox.map(decodeFrame);
  }
}

// A minimal host for the provider to talk to: it sends step 1 on attach, answers step 1 with step 2 (followed directly
// by the document's latest `restored` frame, if it has one), checks and applies content frames, broadcasts nothing
// (one replica per test), and acks every content frame at once unless `holdAcks` is set. It plays S2's document
// service only as far as the replica can observe.
class TestHost {
  readonly doc: Doc = newDoc();
  revision = 0;
  holdAcks = false;
  latestRestore: { revision: number; versionId: number } | null = null;
  received = 0;
  readonly contentFrames: Frame['type'][] = [];

  attach(port: PortLike): void {
    port.addEventListener('message', ({ data }) => this.receive(port, decodeFrame(data)));
    port.postMessage(encodeFrame({ type: 'step1', sv: stateVector(this.doc) }));
  }

  ack(port: PortLike, frames = this.received): void {
    port.postMessage(encodeFrame({ type: 'ack', frames, revision: this.revision }));
  }

  private receive(port: PortLike, frame: Frame): void {
    if (frame.type === 'step1') {
      port.postMessage(encodeFrame({ type: 'step2', update: diffV1(this.doc, frame.sv) }));
      if (this.latestRestore) port.postMessage(encodeFrame({ type: 'restored', ...this.latestRestore }));
    }
    if (frame.type !== 'step2' && frame.type !== 'update') return;
    expect(checkUpdate(this.doc, frame.update)).toBeNull(); // never a gap: the handshake rule holds
    applyV1(this.doc, frame.update, 'replica');
    this.revision += 1;
    this.received += 1;
    this.contentFrames.push(frame.type);
    if (!this.holdAcks) this.ack(port);
  }
}

// Delivers both ways until nothing is in flight.
function pump(...ports: MemoryPort[]): void {
  while (ports.reduce((moved, port) => moved + port.deliver(), 0) > 0);
}

const text = (doc: Doc) => doc.get('t').toString();
const type = (doc: Doc, at: number, value: string) => transact(doc, () => doc.get('t').insert(at, value), 'local');
const quiet = () => {};

describe('PortProvider', () => {
  it('sends only step 1 and awareness until it has answered the host’s step 1, then its step 2 carries the edit', () => {
    const host = new TestHost();
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd); // the host's step 1 is in flight
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    provider.awareness.setLocalState({ user: { name: 'You' } });
    provider.connect(replicaEnd);
    type(doc, 0, 'typed during the handshake');

    expect(hostEnd.frames().map((frame) => frame.type)).toEqual(['step1', 'awareness']);
    expect(provider.state).toMatchObject({ phase: 'handshake', unsaved: 1 });

    replicaEnd.deliver(); // the host's step 1 arrives; the provider answers with its step 2
    expect(provider.state.phase).toBe('live');
    expect(hostEnd.frames().map((frame) => frame.type)).toEqual(['step1', 'awareness', 'step2']);
    pump(replicaEnd, hostEnd);
    expect(text(host.doc)).toBe('typed during the handshake');
    expect(host.contentFrames).toEqual(['step2']);
    expect(provider.state).toEqual({ phase: 'live', synced: true, unsaved: 0, revision: 1 });
  });

  it('carries updates made offline in its step 2 and clears them only on the ack of that frame', () => {
    const host = new TestHost();
    host.holdAcks = true;
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    type(doc, 0, 'one ');
    type(doc, 4, 'two');
    expect(provider.state).toMatchObject({ phase: 'off', unsaved: 2 });

    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd);
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    expect(text(host.doc)).toBe('one two');
    expect(host.contentFrames).toEqual(['step2']); // not sent one by one
    expect(provider.state.unsaved).toBe(2);

    host.ack(hostEnd, 0); // an ack that does not reach the step 2's frame number
    pump(replicaEnd, hostEnd);
    expect(provider.state.unsaved).toBe(2);
    host.ack(hostEnd, 1);
    pump(replicaEnd, hostEnd);
    expect(provider.state).toMatchObject({ unsaved: 0, revision: 1 });
  });

  it('sends live edits one update each and drops each from unsaved on its own ack', () => {
    const host = new TestHost();
    host.holdAcks = true;
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd);
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    type(doc, 0, 'a');
    type(doc, 1, 'b');
    pump(replicaEnd, hostEnd);
    expect(host.contentFrames).toEqual(['step2', 'update', 'update']);
    expect(provider.state.unsaved).toBe(2);
    host.ack(hostEnd, 2); // the step 2 and the first update are durable
    pump(replicaEnd, hostEnd);
    expect(provider.state.unsaved).toBe(1);
    host.ack(hostEnd, 3);
    pump(replicaEnd, hostEnd);
    expect(provider.state.unsaved).toBe(0);
  });

  it('moves unacked updates to carried on disconnect, and the next connection’s step 2 re-sends what that host lacks', () => {
    const base = new TestHost();
    type(base.doc, 0, 'base ');
    const lost = new TestHost(); // a host that received the edits and died before committing them
    applyV1(lost.doc, diffV1(base.doc));
    lost.holdAcks = true;
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    lost.attach(hostEnd);
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    type(doc, 5, 'unacked one, ');
    type(doc, 18, 'unacked two');
    pump(replicaEnd, hostEnd);
    expect(provider.state).toMatchObject({ phase: 'live', unsaved: 2 });

    hostEnd.close(); // the host is gone
    expect(provider.state).toMatchObject({ phase: 'off', synced: false, unsaved: 2 });

    const restarted = new TestHost(); // reloaded from the store: the base only
    applyV1(restarted.doc, diffV1(base.doc));
    const [replicaEnd2, hostEnd2] = MemoryPort.pair();
    restarted.attach(hostEnd2);
    provider.connect(replicaEnd2);
    pump(replicaEnd2, hostEnd2);
    expect(text(restarted.doc)).toBe('base unacked one, unacked two');
    expect(restarted.contentFrames).toEqual(['step2']);
    expect(provider.state).toMatchObject({ phase: 'live', synced: true, unsaved: 0 });
  });

  it('applies the host’s frames without echoing them back', () => {
    const host = new TestHost();
    type(host.doc, 0, 'from the host');
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd);
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    expect(text(doc)).toBe('from the host');

    const writer = newDoc();
    applyV1(writer, diffV1(host.doc));
    const before = stateVector(writer);
    type(writer, 0, 'more ');
    hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(writer, before) }));
    pump(replicaEnd, hostEnd);
    expect(text(doc)).toBe('more from the host');
    expect(host.contentFrames).toEqual(['step2']); // the replica's (empty) answer to step 1, nothing echoed
    expect(provider.state.unsaved).toBe(0);
  });

  describe('onRestored', () => {
    // A replica of `host` whose restore events are recorded with the text the doc held when each fired.
    function watched(host: TestHost) {
      const doc = newDoc();
      const provider = new PortProvider(doc, { log: quiet });
      const events: { versionId: number; revision: number; text: string }[] = [];
      const off = provider.onRestored((restored) => events.push({ ...restored, text: text(doc) }));
      const connect = () => {
        const [replicaEnd, hostEnd] = MemoryPort.pair();
        host.attach(hostEnd);
        provider.connect(replicaEnd);
        pump(replicaEnd, hostEnd);
        return { replicaEnd, hostEnd };
      };
      // A restore while connected, as the host sends it: the update, then the frame.
      const restore = (ends: { replicaEnd: MemoryPort; hostEnd: MemoryPort }, content: string, versionId: number) => {
        const before = stateVector(host.doc);
        type(host.doc, 0, content);
        host.revision += 1;
        host.latestRestore = { revision: host.revision, versionId };
        ends.hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(host.doc, before) }));
        ends.hostEnd.postMessage(encodeFrame({ type: 'restored', ...host.latestRestore }));
        pump(ends.replicaEnd, ends.hostEnd);
      };
      return { provider, events, off, connect, restore };
    }

    it('records the restore its first connect is told of without firing', () => {
      const host = new TestHost();
      host.latestRestore = { revision: 5, versionId: 3 };
      const replica = watched(host);
      replica.connect();
      expect(replica.events).toEqual([]);
    });

    it('fires once for a restore made while connected, after applying its update', () => {
      const host = new TestHost();
      const replica = watched(host);
      const ends = replica.connect();
      replica.restore(ends, 'the old state', 7);
      expect(replica.events).toEqual([{ versionId: 7, revision: host.revision, text: 'the old state' }]);
    });

    it('does not fire again for a restore it has seen when a reconnect re-sends it', () => {
      const host = new TestHost();
      host.latestRestore = { revision: 5, versionId: 3 };
      const replica = watched(host);
      const ends = replica.connect(); // records 3
      replica.restore(ends, 'x', 4); // fires 4
      ends.hostEnd.close();
      replica.connect(); // the host re-sends 4
      expect(replica.events.map((event) => event.versionId)).toEqual([4]);
    });

    it('fires on reconnect for a restore it missed while disconnected', () => {
      const host = new TestHost();
      const replica = watched(host);
      const ends = replica.connect();
      ends.hostEnd.close();
      type(host.doc, 0, 'restored meanwhile');
      host.revision += 1;
      host.latestRestore = { revision: host.revision, versionId: 9 };
      replica.connect();
      expect(replica.events).toEqual([{ versionId: 9, revision: host.latestRestore.revision, text: 'restored meanwhile' }]);
    });

    it('stops firing once unsubscribed', () => {
      const host = new TestHost();
      const replica = watched(host);
      const ends = replica.connect();
      replica.off();
      replica.restore(ends, 'y', 2);
      expect(replica.events).toEqual([]);
    });
  });

  it('drops the connection on a frame that does not decode, and keeps what it had not saved', () => {
    const host = new TestHost();
    host.holdAcks = true;
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd);
    const doc = newDoc();
    const log = vi.fn();
    const provider = new PortProvider(doc, { log });
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    type(doc, 0, 'x');
    hostEnd.postMessage(new Uint8Array([MSG_GARBAGE]));
    replicaEnd.deliver();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/unknown frame type/));
    expect(replicaEnd.closed).toBe(true);
    expect(provider.state).toMatchObject({ phase: 'off', unsaved: 1 });
  });

  it('exchanges awareness, and forgets the other side’s states when the connection ends', () => {
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    const a = new PortProvider(newDoc(), { log: quiet });
    const b = new PortProvider(newDoc(), { log: quiet });
    a.awareness.setLocalState({ user: { name: 'You' } });
    b.awareness.setLocalState({ user: { name: 'Claude' } });
    // Two replicas wired back to back stand in for the host relaying awareness.
    a.connect(replicaEnd);
    b.connect(hostEnd);
    pump(replicaEnd, hostEnd);
    expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ user: { name: 'Claude' } });
    replicaEnd.close();
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);
    expect(a.awareness.getLocalState()).toEqual({ user: { name: 'You' } });
  });

  it('notifies subscribers of every state change until they unsubscribe, and stops listening on destroy', () => {
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    const states: SaveState[] = [];
    const off = provider.subscribe((state) => states.push(state));
    type(doc, 0, 'a');
    expect(states.at(-1)).toMatchObject({ phase: 'off', unsaved: 1 });
    off();
    type(doc, 1, 'b');
    expect(states).toHaveLength(1);
    provider.destroy();
    type(doc, 2, 'c');
    expect(provider.state.unsaved).toBe(2);
  });

  it('destroys the awareness it made (its timer), and leaves one it was given to its owner', () => {
    const own = new PortProvider(newDoc(), { log: quiet });
    const ownDestroy = vi.spyOn(own.awareness, 'destroy');
    own.destroy();
    expect(ownDestroy).toHaveBeenCalledOnce();

    const given = new PortProvider(newDoc(), { log: quiet });
    const shared = new PortProvider(given.doc, { awareness: given.awareness, log: quiet });
    const sharedDestroy = vi.spyOn(given.awareness, 'destroy');
    shared.destroy();
    expect(sharedDestroy).not.toHaveBeenCalled();
    given.destroy();
  });

  it('runs over a real MessageChannel, the shape a DOM and a Node MessagePort share', async () => {
    const host = new TestHost();
    const { port1, port2 } = new MessageChannel();
    host.attach(port1 as unknown as PortLike);
    port1.start();
    const doc = newDoc();
    const provider = new PortProvider(doc, { log: quiet });
    const saved = new Promise<SaveState>((resolve) => {
      provider.subscribe((state) => {
        if (state.phase === 'live' && state.synced && state.unsaved === 0 && state.revision > 0) resolve(state);
      });
    });
    type(doc, 0, 'over a real port');
    provider.connect(port2 as unknown as PortLike);
    await expect(saved).resolves.toMatchObject({ revision: 1 });
    expect(text(host.doc)).toBe('over a real port');
    provider.destroy();
    port1.close();
  });
});

const MSG_GARBAGE = 99;
