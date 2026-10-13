// The library's sync (the P3-L document, M1's sync rules): a reconciliation at every host connection, an entry refresh
// per change event (queued behind a reconciliation in flight), a stale refresh dropped, deletions, Space refreshes,
// and the text fetched when a row's revision moves past its indexed text's. A real index; a fake source whose answers
// the test releases one by one.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactSessionLink, Space } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactsChanged } from '@shared/ipc/schema/artifacts';
import type { LibraryEntry, LibraryEntryAnswer, LibrarySnapshot } from '@shared/ipc/schema/library';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { LibrarySync, type LibrarySource } from './sync';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SPACE = uuid(0xa1);

function entry(n: number, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: uuid(n), kind: 'document', title: `Artifact ${n}`, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
    agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 2, ...over,
  };
}
const link = (n: number, appSessionId = 'sess-1', role: ArtifactSessionLink['role'] = 'created'): ArtifactSessionLink => ({ artifactId: uuid(n), appSessionId: appSessionId as AppSessionId, role, lastAt: 1 });
const snapshot = (artifacts: LibraryEntry[], links: ArtifactSessionLink[] = [], spaces: Space[] = []): LibrarySnapshot => ({ artifacts, links, spaces });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

// A host the test drives: every read waits in its queue until the test answers it.
class FakeSource implements LibrarySource {
  live = true;
  readonly calls: string[] = [];
  readonly snapshots: Deferred<LibrarySnapshot>[] = [];
  readonly entries = new Map<string, Deferred<LibraryEntryAnswer>[]>();
  readonly texts = new Map<string, Deferred<{ revision: number; text: string }>[]>();
  readonly spaceLists: Deferred<Space[]>[] = [];
  private streamingListeners = new Set<() => void>();
  private changeListeners = new Set<(change: ArtifactsChanged) => void>();
  private spaceListeners = new Set<() => void>();

  snapshot(): Promise<LibrarySnapshot> {
    this.calls.push('snapshot');
    const d = deferred<LibrarySnapshot>();
    this.snapshots.push(d);
    return d.promise;
  }
  entry(artifactId: string): Promise<LibraryEntryAnswer> {
    this.calls.push(`entry ${artifactId}`);
    return this.wait(this.entries, artifactId);
  }
  text(artifactId: string): Promise<{ revision: number; text: string }> {
    this.calls.push(`text ${artifactId}`);
    return this.wait(this.texts, artifactId);
  }
  spaces(): Promise<Space[]> {
    this.calls.push('spaces');
    const d = deferred<Space[]>();
    this.spaceLists.push(d);
    return d.promise;
  }
  streaming(): boolean {
    return this.live;
  }
  onStreaming(listener: () => void): () => void {
    this.streamingListeners.add(listener);
    return () => this.streamingListeners.delete(listener);
  }
  onArtifactChanged(listener: (change: ArtifactsChanged) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }
  onSpacesChanged(listener: () => void): () => void {
    this.spaceListeners.add(listener);
    return () => this.spaceListeners.delete(listener);
  }

  connect(): void {
    this.live = true;
    for (const listener of this.streamingListeners) listener();
  }
  changed(n: number, change: ArtifactsChanged['change'], revision = 1): void {
    for (const listener of this.changeListeners) listener({ artifactId: uuid(n), kind: 'document', revision, change });
  }
  spacesChanged(): void {
    for (const listener of this.spaceListeners) listener();
  }
  // The oldest pending read of an artifact.
  pendingEntry(n: number): Deferred<LibraryEntryAnswer> {
    const d = this.entries.get(uuid(n))?.shift();
    if (!d) throw new Error(`no pending entry read of ${n}`);
    return d;
  }
  pendingText(n: number): Deferred<{ revision: number; text: string }> {
    const d = this.texts.get(uuid(n))?.shift();
    if (!d) throw new Error(`no pending text read of ${n}`);
    return d;
  }
  pendingTexts(): number {
    return [...this.texts.values()].reduce((sum, list) => sum + list.length, 0);
  }
  private wait<T>(map: Map<string, Deferred<T>[]>, id: string): Promise<T> {
    const d = deferred<T>();
    let list = map.get(id);
    if (!list) map.set(id, (list = []));
    list.push(d);
    return d.promise;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The text settle's clock, advanced by the test (the promise ticks stay real).
class FakeClock {
  now = 0;
  private next = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  readonly set = (fn: () => void, ms: number): number => {
    this.timers.set(++this.next, { at: this.now + ms, fn });
    return this.next;
  };
  readonly clear = (handle: unknown): void => void this.timers.delete(handle as number);
  pending(): number {
    return this.timers.size;
  }
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (const [handle, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.now) continue;
      this.timers.delete(handle);
      timer.fn();
    }
    await settle();
  }
}
const SETTLE_MS = 1_000;

describe('LibrarySync', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let source: FakeSource;
  let sync: LibrarySync;
  let warn: ReturnType<typeof vi.spyOn>;
  let clock: FakeClock;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    source = new FakeSource();
    clock = new FakeClock();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    sync?.stop();
    index.close();
    dir.dispose();
    vi.restoreAllMocks();
  });
  const start = async () => {
    sync = new LibrarySync(index.library, source, { settleMs: SETTLE_MS, timers: { set: clock.set, clear: clock.clear } });
    sync.start();
    await settle();
  };
  const ids = () => index.library.list().rows.map((row) => row.id).sort();
  const title = (n: number) => index.library.get(uuid(n))?.title;
  const textReads = () => source.calls.filter((call) => call.startsWith('text'));

  it('reconciles at start when the host is already streaming, and at every connection after', async () => {
    await start();
    expect(source.calls).toEqual(['snapshot']);
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    expect(ids()).toEqual([uuid(1)]);

    source.connect();
    await settle();
    expect(source.calls.filter((call) => call === 'snapshot')).toHaveLength(2);
    source.snapshots[1].resolve(snapshot([entry(2)], [link(2)], [{ id: SPACE, name: 'Work', createdAt: 1 }]));
    await settle();
    expect(ids()).toEqual([uuid(2)]);
    expect(index.library.spaces()).toMatchObject([{ id: SPACE, name: 'Work' }]);
  });

  it('waits for the host’s connection when it is not streaming at start', async () => {
    source.live = false;
    await start();
    expect(source.calls).toEqual([]);
    source.connect();
    await settle();
    expect(source.calls).toEqual(['snapshot']);
  });

  it('heals a missed event at the next connection’s snapshot', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1), entry(2)]));
    await settle();
    // the host renamed 1 and deleted 2 while main was not listening (no event reached it)
    source.connect();
    await settle();
    source.snapshots[1].resolve(snapshot([entry(1, { title: 'Renamed while away' })]));
    await settle();
    expect(ids()).toEqual([uuid(1)]);
    expect(title(1)).toBe('Renamed while away');
  });

  it('a host that cannot answer the snapshot leaves the index as it is, with the reason logged', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.connect();
    await settle();
    source.snapshots[1].reject(new Error('library.snapshot: internal: this host has no handler for library.snapshot'));
    await settle();
    expect(ids()).toEqual([uuid(1)]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[library]'), expect.stringContaining('no handler for library.snapshot'));
  });

  it('refreshes one entry per change event, its links with it', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.changed(1, 'linked');
    await settle();
    source.pendingEntry(1).resolve({ artifact: entry(1), links: [link(1, 'sess-2', 'edited')] });
    await settle();
    expect(index.library.get(uuid(1))!.sessions).toMatchObject([{ appSessionId: 'sess-2', roles: ['edited'] }]);
    source.changed(3, 'created', 1);
    await settle();
    source.pendingEntry(3).resolve({ artifact: entry(3), links: [] });
    await settle();
    expect(ids()).toEqual([uuid(1), uuid(3)]);
  });

  it('drops an entry answer older than the indexed revision (revisions only rise)', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1, { revision: 5, title: 'At 5' })]));
    await settle();
    source.changed(1, 'updated', 4);
    await settle();
    source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 4, title: 'At 4' }), links: [] });
    await settle();
    expect(title(1)).toBe('At 5');
  });

  it('never has two reads of one entry out at once, so a later rename is never overwritten by an earlier answer', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.changed(1, 'updated');
    await settle();
    source.changed(1, 'updated'); // a second rename while the first read is out
    await settle();
    expect(source.calls.filter((call) => call === `entry ${uuid(1)}`)).toHaveLength(1);
    source.pendingEntry(1).resolve({ artifact: entry(1, { title: 'First' }), links: [] });
    await settle();
    source.pendingEntry(1).resolve({ artifact: entry(1, { title: 'Second' }), links: [] });
    await settle();
    expect(title(1)).toBe('Second');
  });

  it('removes a deleted artifact without asking the host', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1), entry(2)]));
    await settle();
    source.changed(2, 'deleted', 3);
    await settle();
    expect(ids()).toEqual([uuid(1)]);
    expect(source.calls.some((call) => call.startsWith('entry'))).toBe(false);
  });

  it('an entry answer naming no artifact removes the row', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.changed(1, 'updated', 2);
    await settle();
    source.pendingEntry(1).resolve({ artifact: null, links: [] });
    await settle();
    expect(ids()).toEqual([]);
  });

  it('queues an event behind a reconciliation in flight, so a snapshot taken before it never undoes it', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1), entry(2)]));
    await settle();
    source.connect(); // a reconciliation is out
    await settle();
    source.changed(1, 'updated', 2); // the host renamed 1 after it read the snapshot
    source.changed(2, 'deleted', 2);
    await settle();
    expect(source.calls.some((call) => call.startsWith('entry'))).toBe(false);
    expect(ids()).toEqual([uuid(1), uuid(2)]);
    source.snapshots[1].resolve(snapshot([entry(1, { title: 'Before' }), entry(2)]));
    await settle();
    source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 2, title: 'After' }), links: [] });
    await settle();
    expect(title(1)).toBe('After');
    expect(ids()).toEqual([uuid(1)]);
  });

  it('a reconciliation waits for the entry reads already out', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.changed(1, 'updated');
    await settle();
    source.connect();
    await settle();
    expect(source.snapshots).toHaveLength(1); // not yet: the read of 1 is out
    source.pendingEntry(1).resolve({ artifact: entry(1, { title: 'Old read' }), links: [] });
    await settle();
    expect(source.snapshots).toHaveLength(2);
    source.snapshots[1].resolve(snapshot([entry(1, { title: 'Snapshot' })]));
    await settle();
    expect(title(1)).toBe('Snapshot');
  });

  it('refreshes the Spaces on spaces.changed, queued behind a reconciliation', async () => {
    await start();
    source.spacesChanged();
    await settle();
    expect(source.calls).toEqual(['snapshot']);
    source.snapshots[0].resolve(snapshot([]));
    await settle();
    expect(source.calls).toEqual(['snapshot', 'spaces']);
    source.spaceLists[0].resolve([{ id: SPACE, name: 'Fresh', createdAt: 1 }]);
    await settle();
    expect(index.library.spaces()).toMatchObject([{ name: 'Fresh', count: 0 }]);
  });

  // Decision Log 18(a): text is read only after a revision settles (the mirror's settle, 1 s)
  describe('text', () => {
    it('reads no text before a landed row’s revision settles, then the rows a reconciliation landed, two at a time', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1, { updatedAt: 30 }), entry(2, { updatedAt: 20 }), entry(3, { updatedAt: 10 })]));
      await settle();
      await clock.advance(SETTLE_MS - 1);
      expect(textReads()).toEqual([]);
      await clock.advance(1);
      expect(textReads()).toEqual([`text ${uuid(1)}`, `text ${uuid(2)}`]);
      source.pendingText(1).resolve({ revision: 1, text: 'alpha words' });
      await settle();
      expect(textReads()).toHaveLength(3);
      source.pendingText(2).resolve({ revision: 1, text: 'beta words' });
      source.pendingText(3).resolve({ revision: 1, text: 'gamma words' });
      await settle();
      expect(index.library.list({ query: 'words' }).rows).toHaveLength(3);
      expect(index.library.needingText()).toEqual([]);
    });

    it('postpones the read while new revisions keep arriving, and indexes the latest once editing stops', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1, { revision: 1 })]));
      await settle();
      for (const revision of [2, 3, 4]) {
        await clock.advance(SETTLE_MS - 100); // another revision lands before the last one settled
        source.changed(1, 'updated', revision);
        await settle();
        source.pendingEntry(1).resolve({ artifact: entry(1, { revision }), links: [] });
        await settle();
        expect(textReads()).toEqual([]);
      }
      await clock.advance(SETTLE_MS - 1);
      expect(textReads()).toEqual([]);
      await clock.advance(1);
      expect(textReads()).toEqual([`text ${uuid(1)}`]);
      source.pendingText(1).resolve({ revision: 4, text: 'the latest words' });
      await settle();
      expect(index.library.list({ query: 'latest' }).rows).toHaveLength(1);
      expect(index.library.needingText()).toEqual([]);
    });

    it('a change that leaves the revision (a rename) neither reads nor postpones the text', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1, { revision: 1 })]));
      await settle();
      await clock.advance(SETTLE_MS);
      source.pendingText(1).resolve({ revision: 1, text: 'first' });
      await settle();
      source.changed(1, 'updated', 1);
      await settle();
      source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 1, title: 'Renamed' }), links: [] });
      await settle();
      await clock.advance(SETTLE_MS);
      expect(textReads()).toHaveLength(1);

      source.changed(1, 'updated', 2);
      await settle();
      source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 2 }), links: [] });
      await settle();
      await clock.advance(SETTLE_MS - 500);
      source.changed(1, 'updated', 2); // a rename during the settle: the timer is not reset
      await settle();
      source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 2, title: 'Again' }), links: [] });
      await settle();
      await clock.advance(500);
      source.pendingText(1).resolve({ revision: 2, text: 'second' });
      await settle();
      expect(index.library.list({ query: 'second' }).rows).toHaveLength(1);
      expect(index.library.list({ query: 'first' }).rows).toHaveLength(0);
    });

    it('a row wanted again while its read is out is read once more after it, never twice at once', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1, { revision: 1 })]));
      await settle();
      await clock.advance(SETTLE_MS);
      source.changed(1, 'updated', 3);
      await settle();
      source.pendingEntry(1).resolve({ artifact: entry(1, { revision: 3 }), links: [] });
      await settle();
      await clock.advance(SETTLE_MS);
      expect(textReads()).toHaveLength(1);
      source.pendingText(1).resolve({ revision: 1, text: 'old' }); // the read sent at revision 1
      await settle();
      expect(textReads()).toHaveLength(2);
      source.pendingText(1).resolve({ revision: 3, text: 'current' });
      await settle();
      expect(textReads()).toHaveLength(2);
      expect(index.library.needingText()).toEqual([]);
    });

    it('a deletion during the settle cancels the read', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1), entry(2)]));
      await settle();
      source.changed(1, 'deleted', 2);
      await settle();
      source.changed(2, 'updated', 2);
      await settle();
      source.pendingEntry(2).resolve({ artifact: null, links: [] });
      await settle();
      expect(clock.pending()).toBe(0);
      await clock.advance(SETTLE_MS);
      expect(textReads()).toEqual([]);
    });

    it('a text the host cannot read is logged and left until the row’s revision moves', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1)]));
      await settle();
      await clock.advance(SETTLE_MS);
      source.pendingText(1).reject(new Error('library.text: internal: gone'));
      await settle();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[library]'), expect.stringContaining('gone'));
      expect(source.pendingTexts()).toBe(0);
    });

    it('reads no text while the host is not streaming', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1)]));
      await settle();
      source.live = false;
      await clock.advance(SETTLE_MS);
      expect(textReads()).toEqual([]);
    });

    it('stop cancels every settle', async () => {
      await start();
      source.snapshots[0].resolve(snapshot([entry(1), entry(2)]));
      await settle();
      expect(clock.pending()).toBe(2);
      sync.stop();
      expect(clock.pending()).toBe(0);
      await clock.advance(SETTLE_MS);
      expect(textReads()).toEqual([]);
    });
  });

  it('a stopped drain sends no further entry read, its later batches included', async () => {
    await start();
    source.snapshots[0].resolve(snapshot([]));
    await settle();
    for (let n = 1; n <= 12; n++) source.changed(n, 'created');
    await settle();
    const reads = () => source.calls.filter((call) => call.startsWith('entry'));
    expect(reads()).toHaveLength(8); // ENTRY_READS_IN_FLIGHT
    sync.stop();
    for (let n = 1; n <= 8; n++) source.pendingEntry(n).resolve({ artifact: entry(n), links: [] });
    await settle();
    expect(reads()).toHaveLength(8);
    expect(ids()).toEqual([]);
  });

  it('after stop applies nothing that comes back and follows no event', async () => {
    await start();
    sync.stop();
    source.snapshots[0].resolve(snapshot([entry(1)]));
    await settle();
    source.changed(2, 'created');
    source.connect();
    await settle();
    expect(ids()).toEqual([]);
    expect(source.calls).toEqual(['snapshot']);
  });
});
