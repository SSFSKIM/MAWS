import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from '@y/protocols/awareness';
import { describe, expect, it, vi } from 'vitest';
import { applyV1, checkUpdate, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../yjs';
import { decodeFrame, encodeFrame, type Frame } from './frames';
import type { ArtifactProvisional } from '@shared/artifacts/provisional';
import { PortProvider, type PortLike, type SaveState } from './port';
import { ProvisionalLayers } from '../provisional';

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
    expect(provider.state).toEqual({ phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0 });
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

    it('counts the frames received and those held (row 256): held while the hold stands, none once it is cleared, which releases them (D17)', () => {
      const { provider, replicaEnd, hostEnd, write } = heldReplica();
      const before = provider.counts();
      expect(before).toMatchObject({ held: 0, released: 0 });
      provider.holdRemote(true);
      write(0, 'one ');
      write(4, 'two');
      pump(replicaEnd, hostEnd);
      expect(provider.counts()).toEqual({ received: before.received + 2, held: 2, capped: 0, released: 0 });
      provider.holdRemote(false);
      expect(provider.counts()).toEqual({ received: before.received + 2, held: 0, capped: 0, released: 2 });
      write(7, ' three');
      pump(replicaEnd, hostEnd);
      expect(provider.counts()).toEqual({ received: before.received + 3, held: 0, capped: 0, released: 2 }); // applied on arrival, never held
      provider.holdRemote(true);
      provider.holdRemote(false); // a hold that buffered nothing releases nothing
      expect(provider.counts().released).toBe(2);
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
        expect(provider.counts().capped).toBe(0);
        // P4-B2 (D17): the cap is counted before its flush, so what the flush wakes (the drag probe) can tell it apart
        const seen: number[] = [];
        onUpdate(doc, (_update, origin) => {
          if (origin === provider) seen.push(provider.counts().capped);
        });
        vi.advanceTimersByTime(1);
        expect(text(doc)).toBe('late');
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/hold reached its 5 s cap.*1 buffered frame/));
        expect(seen).toEqual([1]);
        expect(provider.counts()).toMatchObject({ held: 0, capped: 1, released: 1 });
        write(4, ' and live'); // the hold is off: applied on arrival
        pump(replicaEnd, hostEnd);
        expect(text(doc)).toBe('late and live');
      } finally {
        vi.useRealTimers();
      }
    });

    it('counts a cap that cleared an empty hold as a cap that released nothing (D17)', () => {
      vi.useFakeTimers();
      try {
        const { provider } = heldReplica();
        provider.holdRemote(true);
        vi.advanceTimersByTime(5000);
        expect(provider.counts()).toMatchObject({ held: 0, capped: 1, released: 0 });
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

  // P3-F (artifact-protocol finding 5): presence comes back with a reconnect, without anyone moving a cursor
  it('takes the other side’s unchanged presence again after a reconnect', () => {
    const a = new PortProvider(newDoc(), { log: quiet });
    const b = new PortProvider(newDoc(), { log: quiet });
    a.awareness.setLocalState({ user: { name: 'You' } });
    b.awareness.setLocalState({ user: { name: 'Claude' } });
    const [aEnd, bEnd] = MemoryPort.pair();
    a.connect(aEnd);
    b.connect(bEnd);
    pump(aEnd, bEnd);
    aEnd.close();
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);
    const [aEnd2, bEnd2] = MemoryPort.pair();
    a.connect(aEnd2);
    b.connect(bEnd2);
    pump(aEnd2, bEnd2);
    expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ user: { name: 'Claude' } });
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: { name: 'You' } });
    a.destroy();
    b.destroy();
  });

  it('sends its own presence at a newer clock on every connect, so a peer that saw it removed takes it back', () => {
    const provider = new PortProvider(newDoc(), { log: quiet });
    provider.awareness.setLocalState({ user: { name: 'You' } });
    const peer = new Awareness(newDoc());
    const relay = (end: MemoryPort) => end.frames().forEach((frame) => frame.type === 'awareness' && applyAwarenessUpdate(peer, frame.update, 'host'));
    const [first, host1] = MemoryPort.pair();
    provider.connect(first);
    relay(host1);
    expect(peer.getStates().get(provider.doc.clientID)).toEqual({ user: { name: 'You' } });
    host1.close();
    removeAwarenessStates(peer, [provider.doc.clientID], 'host'); // the host's removal as relayed: at the client's last clock
    const [second, host2] = MemoryPort.pair();
    provider.connect(second);
    relay(host2);
    expect(peer.getStates().get(provider.doc.clientID)).toEqual({ user: { name: 'You' } });
    peer.destroy();
    provider.destroy();
  });

  // M4 (Decision Log 31c, parent 37's advisory): a renderer replica's cursor awareness goes out at most once per ~50 ms,
  // the last state winning, so one frame per keystroke does not cost every other window a relay and a render.
  describe('the awareness throttle', () => {
    const awarenessFrames = (end: MemoryPort) => end.frames().filter((frame) => frame.type === 'awareness');
    const stateIn = (frame: Frame, clientID: number) => {
      const peer = new PortProvider(newDoc(), { log: quiet });
      const [a, b] = MemoryPort.pair();
      peer.connect(a);
      b.postMessage(encodeFrame(frame));
      a.deliver();
      const state = peer.awareness.getStates().get(clientID);
      peer.destroy();
      return state;
    };

    it('sends the first change at once and coalesces the rest of the window into one frame carrying the latest state', () => {
      vi.useFakeTimers();
      try {
        const [replicaEnd, hostEnd] = MemoryPort.pair();
        const provider = new PortProvider(newDoc(), { log: quiet, awarenessThrottleMs: 50 });
        provider.connect(replicaEnd);
        hostEnd.inbox.splice(0);
        provider.awareness.setLocalStateField('cursor', 1);
        expect(awarenessFrames(hostEnd)).toHaveLength(1);
        provider.awareness.setLocalStateField('cursor', 2);
        provider.awareness.setLocalStateField('cursor', 3);
        expect(awarenessFrames(hostEnd)).toHaveLength(1);
        vi.advanceTimersByTime(50);
        const frames = awarenessFrames(hostEnd);
        expect(frames).toHaveLength(2);
        expect(stateIn(frames[1], provider.doc.clientID)).toEqual({ cursor: 3 });
        vi.advanceTimersByTime(200); // nothing pending: no frame
        expect(awarenessFrames(hostEnd)).toHaveLength(2);
        provider.awareness.setLocalStateField('cursor', 4); // a change after a quiet window goes at once
        expect(awarenessFrames(hostEnd)).toHaveLength(3);
        provider.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops a pending trailing frame at disconnect, the next connect sending the local state itself', () => {
      vi.useFakeTimers();
      try {
        const [replicaEnd, hostEnd] = MemoryPort.pair();
        const provider = new PortProvider(newDoc(), { log: quiet, awarenessThrottleMs: 50 });
        provider.connect(replicaEnd);
        provider.awareness.setLocalStateField('cursor', 1);
        provider.awareness.setLocalStateField('cursor', 2);
        hostEnd.close();
        vi.advanceTimersByTime(100);
        const [replicaEnd2, hostEnd2] = MemoryPort.pair();
        provider.connect(replicaEnd2);
        const frames = awarenessFrames(hostEnd2);
        expect(frames).toHaveLength(1);
        expect(stateIn(frames[0], provider.doc.clientID)).toEqual({ cursor: 2 });
        vi.advanceTimersByTime(100);
        expect(awarenessFrames(hostEnd2)).toHaveLength(1);
        provider.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('sends every change at once without the option (an agent replica in the host)', () => {
      const [replicaEnd, hostEnd] = MemoryPort.pair();
      const provider = new PortProvider(newDoc(), { log: quiet });
      provider.connect(replicaEnd);
      hostEnd.inbox.splice(0);
      for (let i = 0; i < 3; i++) provider.awareness.setLocalStateField('cursor', i);
      expect(awarenessFrames(hostEnd)).toHaveLength(3);
      provider.destroy();
    });
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

// P4-A2 (X35; the execution document's R2 and R3): the provisional frames and the `integrated` seq a layer's withdrawal waits on.
describe('the provisional layer’s frames (P4-A2)', () => {
  const provisional = (over: Partial<ArtifactProvisional> = {}): ArtifactProvisional => ({
    toolUseId: 'toolu_1' as ArtifactProvisional['toolUseId'], appSessionId: 'app-1' as ArtifactProvisional['appSessionId'], artifactId: 'a1', kind: 'document',
    state: 'streaming', at: 1, name: 'Claude', color: '--author-3', ops: [{ op: 'replace_text', block: 'p1', old: 'x', text: 'y' }], ...over,
  });
  function replica() {
    const host = new TestHost();
    host.holdAcks = true;
    const [replicaEnd, hostEnd] = MemoryPort.pair();
    host.attach(hostEnd);
    const doc = newDoc();
    const log = vi.fn();
    const provider = new PortProvider(doc, { log });
    provider.connect(replicaEnd);
    pump(replicaEnd, hostEnd);
    const write = (at: number, value: string, seq: number) => {
      const before = stateVector(host.doc);
      type(host.doc, at, value);
      hostEnd.postMessage(encodeFrame({ type: 'update', update: diffV1(host.doc, before), seq }));
    };
    const announce = (frame: ArtifactProvisional) => hostEnd.postMessage(encodeFrame({ type: 'provisional', json: JSON.stringify(frame) }));
    return { host, provider, doc, log, replicaEnd, hostEnd, write, announce };
  }

  it('tracks the highest row seq it integrated from update and step 2 frames, never from an ack', () => {
    const { provider, replicaEnd, hostEnd, write } = replica();
    expect(provider.state.integrated).toBe(0);
    write(0, 'a', 7);
    pump(replicaEnd, hostEnd);
    expect(provider.state.integrated).toBe(7);
    hostEnd.postMessage(encodeFrame({ type: 'ack', frames: 0, revision: 40 }));
    pump(replicaEnd, hostEnd);
    expect(provider.state.revision).toBe(40);
    expect(provider.state.integrated).toBe(7); // an ack says nothing about which rows this side holds
    write(1, 'b', 9);
    write(2, 'c', 8); // out of order on purpose: the highest seq counts
    pump(replicaEnd, hostEnd);
    expect(provider.state.integrated).toBe(9);
  });

  it('delivers a provisional frame to its listeners after the state listeners, and lets it pass the composition hold', () => {
    const { provider, replicaEnd, hostEnd, write, announce, doc } = replica();
    const order: string[] = [];
    provider.subscribe((state) => order.push(`state:${state.integrated}`));
    const frames: ArtifactProvisional[] = [];
    provider.onProvisional((frame) => {
      frames.push(frame);
      order.push(`provisional:${frame.state}:${provider.state.integrated}`);
    });
    order.length = 0;
    provider.holdRemote(true);
    announce(provisional({ state: 'streaming' }));
    pump(replicaEnd, hostEnd);
    expect(frames.map((f) => f.state)).toEqual(['streaming']); // not buffered: the layer moves while the person composes
    // the committed notice goes ahead of the row it names (the service's announceWrite), so it arrives before the
    // held update and the layer waits on `integrated`
    announce(provisional({ state: 'committed', commitSeq: 5 }));
    write(0, 'the real text', 5);
    pump(replicaEnd, hostEnd);
    expect(frames.map((f) => f.state)).toEqual(['streaming', 'committed']);
    expect(provider.state.integrated).toBe(0); // the row waits out the hold
    expect(text(doc)).toBe('');
    provider.holdRemote(false);
    expect(text(doc)).toBe('the real text');
    expect(provider.state.integrated).toBe(5);
    expect(order).toEqual(['state:0', 'provisional:streaming:0', 'state:0', 'provisional:committed:0', 'state:5']);
  });

  it('drops the connection on a provisional frame the shape refuses, as on any malformed frame', () => {
    const { provider, replicaEnd, hostEnd, log } = replica();
    hostEnd.postMessage(encodeFrame({ type: 'provisional', json: '{"state":"streaming"}' }));
    pump(replicaEnd, hostEnd);
    expect(provider.state.phase).toBe('off');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/provisional frame the shape refuses/));
  });

  it('stops delivering to a provisional listener once it unsubscribes, and forgets every listener on destroy', () => {
    const { provider, replicaEnd, hostEnd, announce } = replica();
    const heard: string[] = [];
    const off = provider.onProvisional((frame) => heard.push(frame.state));
    announce(provisional());
    pump(replicaEnd, hostEnd);
    off();
    announce(provisional({ state: 'dropped' }));
    pump(replicaEnd, hostEnd);
    expect(heard).toEqual(['streaming']);
    provider.destroy();
  });

  it.each(['committed', 'dropped'] as const)('bounds stale-call bookkeeping after 100 %s publishes without retaining their payloads', (state) => {
    const { provider, replicaEnd, hostEnd, announce, doc, host } = replica();
    const internal = provider as unknown as { ended: Set<string>; streaming: Map<string, ArtifactProvisional> };
    try {
      for (let i = 0; i < 100; i++) {
        const toolUseId = `publish-${i}` as ArtifactProvisional['toolUseId'];
        announce(provisional({ toolUseId, kind: 'presentation', ops: [{ op: 'file', path: 'project/slides/s1.html', text: `<section id="s1">${i}</section>` }] }));
        announce(provisional({ toolUseId, state, commitSeq: i + 1, ops: [] }));
        pump(replicaEnd, hostEnd);
        expect(internal.streaming.size).toBe(0);
      }
      expect(internal.ended.size, 'a long-lived connection retains only a recent stale-frame guard').toBeLessThanOrEqual(64);
      announce(provisional({ toolUseId: 'publish-99' as ArtifactProvisional['toolUseId'] }));
      pump(replicaEnd, hostEnd);
      let replayed = 0;
      provider.onProvisional(() => replayed++)();
      expect(replayed, 'the most recent ended call cannot re-enter replay').toBe(0);
      provider.disconnect();
      expect(internal.ended.size).toBe(0);
    } finally {
      provider.destroy();
      doc.destroy();
      host.doc.destroy();
    }
  });

  // G2 (G-R1's mid-stream condition): the host restates every open call to a connection in the flush that carries its
  // step 2, before an editor that opens the document has attached a listener (the open resolves on that step 2)
  it('keeps every call still streaming for a listener that attaches after its frames, files merged by path; not a dropped or committed one', () => {
    const { provider, replicaEnd, hostEnd, announce } = replica();
    const file = (path: string, text: string) => ({ op: 'file' as const, path, text });
    const deck = { kind: 'presentation' as const };
    // the restated frame (every file so far), then a tick that grew the last one only
    announce(provisional({ ...deck, toolUseId: 'toolu_1' as ArtifactProvisional['toolUseId'], ops: [file('project/slides/a.html', '<section id="a">A</section>'), file('project/slides/b.html', '<section id="b">B</section>'), file('project/slides/c.html', '<section id="c">C')] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_1' as ArtifactProvisional['toolUseId'], ops: [file('project/slides/c.html', '<section id="c">Ce')] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_2' as ArtifactProvisional['toolUseId'] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_2' as ArtifactProvisional['toolUseId'], state: 'dropped', ops: [] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_3' as ArtifactProvisional['toolUseId'] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_3' as ArtifactProvisional['toolUseId'], state: 'committed', commitSeq: 3, ops: [] }));
    announce(provisional({ ...deck, toolUseId: 'toolu_3' as ArtifactProvisional['toolUseId'] })); // a late tick after the commit: stale
    pump(replicaEnd, hostEnd);

    // the store over the provider as a handle presents it (a handle's state adds `readOnly`)
    const source = { onProvisional: (l: (frame: ArtifactProvisional) => void) => provider.onProvisional(l), subscribe: (l: (state: SaveState & { readOnly: boolean }) => void) => provider.subscribe((state) => l({ ...state, readOnly: false })), state: () => ({ ...provider.state, readOnly: false }) };
    const layers = new ProvisionalLayers(source);
    const stop = layers.attach();
    expect([...layers.get().keys()], 'the dropped and the committed calls are not replayed').toEqual(['toolu_1']);
    expect(layers.get().get('toolu_1' as never)!.ops).toEqual([file('project/slides/a.html', '<section id="a">A</section>'), file('project/slides/b.html', '<section id="b">B</section>'), file('project/slides/c.html', '<section id="c">Ce')]);
    stop();

    // the connection lost: nothing is kept; the next connection's step 2 brings the host's restatement again
    provider.disconnect();
    const again = new ProvisionalLayers(source);
    again.attach();
    expect(again.get().size).toBe(0);
  });
});
