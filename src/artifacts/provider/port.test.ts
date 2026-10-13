import { encodeAwarenessUpdate } from '@y/protocols/awareness';
import { describe, expect, it, vi } from 'vitest';
import { applyV1, checkUpdate, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../yjs';
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

  describe('a well-framed frame whose payload is broken', () => {
    // A live replica with one unacked local update, so the accounting a broken peer must not lose is visible.
    function liveWithUnsaved() {
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
      pump(replicaEnd, hostEnd);
      expect(provider.state).toMatchObject({ phase: 'live', unsaved: 1 });
      return { provider, log, replicaEnd, hostEnd };
    }

    it.each([
      ['an awareness update', { type: 'awareness', update: new Uint8Array([255]) }],
      ['a state vector', { type: 'step1', sv: new Uint8Array([5, 1]) }],
      ['a sync update', { type: 'update', update: new Uint8Array([255, 255, 255]) }],
      ['a step 2', { type: 'step2', update: new Uint8Array([1, 2, 3, 255]) }],
    ] as [string, Frame][])('logs and disconnects on %s that does not decode, keeping what was unsaved', (_, frame) => {
      const { provider, log, replicaEnd, hostEnd } = liveWithUnsaved();
      hostEnd.postMessage(encodeFrame(frame));
      expect(() => replicaEnd.deliver()).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/dropped the connection/));
      expect(replicaEnd.closed).toBe(true);
      expect(provider.state).toMatchObject({ phase: 'off', synced: false, unsaved: 1 });
    });
  });

  describe('listeners that throw', () => {
    it('surface a subscriber’s error without dropping the connection or the other subscribers', () => {
      const host = new TestHost();
      const [replicaEnd, hostEnd] = MemoryPort.pair();
      host.attach(hostEnd);
      const doc = newDoc();
      const log = vi.fn();
      const provider = new PortProvider(doc, { log });
      provider.connect(replicaEnd);
      pump(replicaEnd, hostEnd);
      const seen: SaveState[] = [];
      provider.subscribe(() => {
        throw new Error('the editor’s bug');
      });
      provider.subscribe((state) => seen.push(state));
      const before = stateVector(host.doc);
      type(host.doc, 0, 'remote');
      hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(host.doc, before) }));
      expect(() => replicaEnd.deliver()).toThrow('the editor’s bug');
      expect(text(doc)).toBe('remote');
      expect(seen.length).toBeGreaterThan(0);
      expect(log).not.toHaveBeenCalled();
      expect(provider.state.phase).toBe('live');
      expect(replicaEnd.closed).toBe(false);
    });

    it('surface an onRestored listener’s error without dropping the connection', () => {
      const host = new TestHost();
      const [replicaEnd, hostEnd] = MemoryPort.pair();
      host.attach(hostEnd);
      const provider = new PortProvider(newDoc(), { log: quiet });
      provider.connect(replicaEnd);
      pump(replicaEnd, hostEnd);
      provider.onRestored(() => {
        throw new Error('the editor’s bug');
      });
      hostEnd.postMessage(encodeFrame({ type: 'restored', revision: 3, versionId: 1 }));
      expect(() => replicaEnd.deliver()).toThrow('the editor’s bug');
      expect(provider.state.phase).toBe('live');
      expect(replicaEnd.closed).toBe(false);
    });
  });

  describe('holdRemote (the composition hold, Decision Log 20)', () => {
    // A live replica of a host whose later writes are sent as update frames; `write` returns nothing, `remote` the doc.
    function heldReplica() {
      const host = new TestHost();
      host.holdAcks = true;
      const [replicaEnd, hostEnd] = MemoryPort.pair();
      host.attach(hostEnd);
      const doc = newDoc();
      const log = vi.fn();
      const provider = new PortProvider(doc, { log });
      provider.connect(replicaEnd);
      pump(replicaEnd, hostEnd);
      // The remote changes the replica's doc integrates, one per apply.
      const applies: number[] = [];
      onUpdate(doc, (update, origin) => {
        if (origin === provider) applies.push(update.length);
      });
      const write = (at: number, value: string) => {
        const before = stateVector(host.doc);
        type(host.doc, at, value);
        hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(host.doc, before) }));
      };
      return { host, provider, doc, log, applies, replicaEnd, hostEnd, write };
    }

    it('buffers remote updates while held and applies the run merged, once, when cleared', () => {
      const { host, provider, doc, log, applies, replicaEnd, hostEnd, write } = heldReplica();
      provider.holdRemote(true);
      write(0, 'one ');
      write(4, 'two'); // depends on the first
      write(7, ' three');
      pump(replicaEnd, hostEnd);
      expect(text(doc)).toBe('');
      provider.holdRemote(false);
      expect(applies).toHaveLength(1);
      expect(text(doc)).toBe('one two three');
      expect(text(doc)).toBe(text(host.doc));
      expect(log).not.toHaveBeenCalled(); // cleared by the editor, not the cap
    });

    it('splits the merged runs at a buffered restored frame', () => {
      const { host, provider, doc, applies, replicaEnd, hostEnd, write } = heldReplica();
      const events: string[] = [];
      provider.onRestored(({ versionId }) => events.push(`${versionId}:${text(doc)}`));
      provider.holdRemote(true);
      write(0, 'a');
      write(1, 'b');
      hostEnd.postMessage(encodeFrame({ type: 'restored', revision: 9, versionId: 4 }));
      write(2, 'c');
      write(3, 'd');
      pump(replicaEnd, hostEnd);
      provider.holdRemote(false);
      expect(applies).toHaveLength(2);
      expect(events).toEqual(['4:abcd']); // listeners run after the frames of one release
      expect(text(doc)).toBe(text(host.doc));
    });

    it('answers a host step 1 at once while held, and buffers the host’s step 2', () => {
      const host = new TestHost();
      type(host.doc, 0, 'on the host');
      const doc = newDoc();
      const provider = new PortProvider(doc, { log: quiet });
      provider.holdRemote(true);
      type(doc, 0, 'composing ');
      const [replicaEnd, hostEnd] = MemoryPort.pair();
      host.attach(hostEnd);
      provider.connect(replicaEnd);
      pump(replicaEnd, hostEnd);
      expect(provider.state).toMatchObject({ phase: 'live', synced: false, unsaved: 0 });
      expect(text(host.doc)).toContain('composing');
      expect(text(doc)).toBe('composing ');
      const applies: number[] = [];
      onUpdate(doc, (update, origin) => {
        if (origin === provider) applies.push(update.length);
      });
      for (const value of ['x', 'y']) {
        const before = stateVector(host.doc);
        type(host.doc, 0, value);
        hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(host.doc, before) }));
      }
      pump(replicaEnd, hostEnd);
      provider.holdRemote(false);
      expect(applies).toHaveLength(2); // the step 2 keeps its place; the two updates after it merge
      expect(provider.state.synced).toBe(true);
      expect(text(doc)).toBe(text(host.doc));
    });

    it('buffers a restored frame behind the updates already buffered, so it still follows its update', () => {
      const { provider, doc, replicaEnd, hostEnd, write } = heldReplica();
      const events: string[] = [];
      provider.onRestored(({ versionId }) => events.push(`${versionId}:${text(doc)}`));
      provider.holdRemote(true);
      write(0, 'restored text');
      hostEnd.postMessage(encodeFrame({ type: 'restored', revision: 9, versionId: 4 }));
      pump(replicaEnd, hostEnd);
      expect(events).toEqual([]);
      provider.holdRemote(false);
      expect(events).toEqual(['4:restored text']);
    });

    it('lets a restored frame through when nothing is buffered', () => {
      const { provider, replicaEnd, hostEnd, write } = heldReplica();
      const events: number[] = [];
      provider.onRestored(({ versionId }) => events.push(versionId));
      write(0, 'x'); // so the restored frame is not the one directly after the step 2 (the first sync's catch-up)
      pump(replicaEnd, hostEnd);
      provider.holdRemote(true);
      hostEnd.postMessage(encodeFrame({ type: 'restored', revision: 9, versionId: 4 }));
      pump(replicaEnd, hostEnd);
      expect(events).toEqual([4]);
    });

    it('lets awareness and acks through while held', () => {
      const { host, provider, doc, replicaEnd, hostEnd } = heldReplica();
      provider.holdRemote(true);
      type(doc, 0, 'typed while composing');
      pump(replicaEnd, hostEnd);
      expect(provider.state.unsaved).toBe(1);
      host.ack(hostEnd);
      const peer = new PortProvider(newDoc(), { log: quiet });
      peer.awareness.setLocalState({ user: { name: 'Claude' } });
      hostEnd.postMessage(encodeFrame({ type: 'awareness', update: encodeAwarenessUpdate(peer.awareness, [peer.doc.clientID]) }));
      pump(replicaEnd, hostEnd);
      expect(provider.state.unsaved).toBe(0);
      expect(provider.awareness.getStates().get(peer.doc.clientID)).toEqual({ user: { name: 'Claude' } });
      peer.destroy();
    });

    it('clears a hold by itself after 5 s', () => {
      vi.useFakeTimers();
      try {
        const { provider, doc, log, replicaEnd, hostEnd, write } = heldReplica();
        provider.holdRemote(true);
        write(0, 'late');
        pump(replicaEnd, hostEnd);
        vi.advanceTimersByTime(4999);
        expect(text(doc)).toBe('');
        expect(log).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(text(doc)).toBe('late');
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/hold reached its 5 s cap.*1 buffered frame/));
        write(4, ' and live'); // the hold is off: applied on arrival
        pump(replicaEnd, hostEnd);
        expect(text(doc)).toBe('late and live');
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts the 5 s when the hold is set again', () => {
      vi.useFakeTimers();
      try {
        const { provider, doc, replicaEnd, hostEnd, write } = heldReplica();
        provider.holdRemote(true);
        write(0, 'late');
        pump(replicaEnd, hostEnd);
        vi.advanceTimersByTime(4000);
        provider.holdRemote(true);
        vi.advanceTimersByTime(4000);
        expect(text(doc)).toBe('');
        vi.advanceTimersByTime(1000);
        expect(text(doc)).toBe('late');
      } finally {
        vi.useRealTimers();
      }
    });

    it('discards the buffer on disconnect; the next connection’s step 2 brings everything', () => {
      const { host, provider, doc, replicaEnd, hostEnd, write } = heldReplica();
      provider.holdRemote(true);
      write(0, 'from the host');
      pump(replicaEnd, hostEnd);
      hostEnd.close();
      provider.holdRemote(false);
      expect(text(doc)).toBe('');
      const [replicaEnd2, hostEnd2] = MemoryPort.pair();
      host.attach(hostEnd2);
      provider.connect(replicaEnd2);
      pump(replicaEnd2, hostEnd2);
      expect(text(doc)).toBe('from the host');
    });
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
