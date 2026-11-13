// l6-artifacts-07 (a) across builds (Interfaces §D of docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md).
// This build cancels Yjs's post-apply formatting clean-up in every doc it makes; build F (f1852de3a) builds its docs with
// Yjs's defaults. After a build swap, or for a document on another machine, a replica of one build syncs with a host of
// the other, and a store one build wrote is opened by the other. Nothing stored or sent changes form; these cases hold
// what each side does with the other's content. A service "built as F" is this service with the binding module's
// `newDoc` answering a doc with Yjs's defaults, as F's does; the replicas are PortProviders on docs of either build.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyV1, contentIdsOf, diffV1, newDoc, onUpdate, transact, type Doc } from '@artifacts/yjs';
import { newDoc as newDocOfThisBuild } from '@artifacts/yjs/doc';
import { liveMarkers, newDocAsF } from '@artifacts/yjs/format-cleanup.fixture';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { provided, type ProvidedReplica } from './provided-replica.fixture';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';

vi.mock('@artifacts/yjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@artifacts/yjs')>();
  return { ...real, newDoc: vi.fn(real.newDoc) };
});

type Build = 'this' | 'F';
const make: Record<Build, () => Doc> = { this: newDocOfThisBuild, F: newDocAsF };
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };

let dir: string;
let path: string;
let storage: SqliteDocumentStorage | null;
let service: DocumentService;
let logs: string[];
let turns: (() => void)[];
let replicas: ProvidedReplica[];
const tick = () => {
  while (turns.length > 0) turns.shift()!();
};

// A service on the test's file whose docs (the live doc, the host's replicas) are built as `build` builds them.
function host(build: Build): void {
  vi.mocked(newDoc).mockImplementation(make[build]);
  storage = SqliteDocumentStorage.open(path, { log: () => {} });
  service = new DocumentService(storage, { now: () => 1, log: (line) => logs.push(line), defer: (run) => turns.push(run) });
}
function closeHost(): void {
  for (const replica of replicas.splice(0)) replica.provider.destroy();
  service.close();
  storage?.close();
  storage = null;
}
const open = (build: Build, actor: Actor = human) => {
  const replica = provided(service, 'a1', actor, make[build]());
  replicas.push(replica);
  return replica;
};
const settle = () => {
  for (let moved = 1; moved > 0; ) {
    moved = replicas.reduce((n, replica) => n + replica.deliver(), 0) + turns.length;
    tick();
  }
};
const rows = (): string[] => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('SELECT actor FROM artifact_updates ORDER BY seq').all() as { actor: string }[]).map((row) => row.actor);
  } finally {
    db.close();
  }
};
const text = (doc: Doc) => doc.get('t');
const evicted = () => logs.filter((line) => line.includes('evicted'));
// The update frames a replica sent after its handshake's step 2.
const updatesSent = (replica: ProvidedReplica) => replica.sent.filter((type) => type === 'update').length;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-cross-build-'));
  path = join(dir, 'store.sqlite');
  logs = [];
  turns = [];
  replicas = [];
  storage = null;
});
afterEach(() => {
  if (storage) closeHost();
  vi.mocked(newDoc).mockImplementation(newDocOfThisBuild);
  rmSync(dir, { recursive: true, force: true });
});

// 'one word two' with the word bold, written by `writer` and synced to every replica open.
function boldWord(writer: ProvidedReplica): void {
  transact(writer.doc, () => {
    text(writer.doc).insert(0, 'one word two');
    text(writer.doc).format(4, 4, { bold: true });
  }, 'typed');
  settle();
}
const deleteWord = (replica: ProvidedReplica) => transact(replica.doc, () => text(replica.doc).delete(4, 4), 'typed');

// One writer bolds 'word' while another, not having seen the bold, deletes it (S1): the bold lands first.
function boldAndDeletionAtOnce(bolder: ProvidedReplica, deleter: ProvidedReplica): void {
  transact(bolder.doc, () => text(bolder.doc).insert(0, 'one word two'), 'typed');
  settle();
  deleter.hold = true;
  transact(bolder.doc, () => text(bolder.doc).format(4, 4, { bold: true }), 'typed');
  deleteWord(deleter);
  settle();
  deleter.hold = false;
  settle();
}

// An update's deletions as plain data.
const deletionsIn = (update: Uint8Array) => [...contentIdsOf(update).deletes.clients].map(([client, ranges]) => [client, ranges.getIds().map((range) => [range.clock, range.len])]);
// The one update `edit` makes on `doc`.
function updateOf(doc: Doc, edit: () => void): Uint8Array {
  const updates: Uint8Array[] = [];
  const off = onUpdate(doc, (update) => updates.push(update));
  edit();
  off();
  expect(updates).toHaveLength(1);
  return updates[0];
}

describe('a replica of this build on a host of build F', () => {
  it('deletes a whole bold word as one row, deleting what a doc of F deletes for the same edit', () => {
    host('F');
    const writer = open('this');
    settle();
    boldWord(writer);
    const before = rows().length;
    const asF = newDocAsF();
    applyV1(asF, diffV1(writer.doc));
    const theirs = updateOf(asF, () => text(asF).delete(4, 4));
    const ours = updateOf(writer.doc, () => deleteWord(writer));
    expect(deletionsIn(ours)).toEqual(deletionsIn(theirs)); // the four characters and the two markers they empty
    settle();
    expect(rows().slice(before)).toEqual(['human']);
    expect(evicted()).toEqual([]);
    expect(writer.closed).toBe(false);
    expect(text(service.loaded('a1')!).toString()).toBe('one  two');
  });

  it('sends nothing while it only reads another replica’s writes', () => {
    host('F');
    const writer = open('this');
    const reader = open('this', { kind: 'session', appSessionId: 'app-2' as AppSessionId });
    settle();
    boldWord(writer);
    deleteWord(writer);
    settle();
    expect(updatesSent(reader)).toBe(0);
    expect(reader.closed).toBe(false);
    expect(text(reader.doc).toString()).toBe('one  two');
  });
});

describe('a replica of build F on a host of this build', () => {
  it('sends nothing when the writer, of this build, deletes a bold word: the writer took its markers with it', () => {
    host('this');
    const writer = open('this');
    const reader = open('F', agent);
    settle();
    boldWord(writer);
    const before = rows().length;
    deleteWord(writer);
    settle();
    expect(rows().slice(before)).toEqual(['human']);
    expect(updatesSent(reader)).toBe(0);
    expect(liveMarkers(text(reader.doc))).toBe(0);
  });
});

describe('a store one build wrote, opened by the other', () => {
  it('F opens a store this build wrote with redundant markers: it loads, an F reader reads the same text and sends nothing, and its edit lands', () => {
    host('this');
    boldAndDeletionAtOnce(open('this'), open('this', agent));
    expect(rows()).toHaveLength(3);
    expect(liveMarkers(text(service.loaded('a1')!))).toBe(2);
    const written = text(service.loaded('a1')!).toString();
    closeHost();
    host('F');
    const live = service.live('a1'); // F may tidy some markers in memory while it applies the rows, with no row
    expect(text(live).toString()).toBe(written);
    const reader = open('F');
    settle();
    expect(updatesSent(reader)).toBe(0);
    expect(text(reader.doc).toString()).toBe(written);
    transact(reader.doc, () => text(reader.doc).insert(0, 'Z'), 'typed');
    settle();
    expect(rows()).toHaveLength(4);
    expect(reader.closed).toBe(false);
    expect(evicted()).toEqual([]);
    expect(text(service.loaded('a1')!).toString()).toBe(`Z${written}`);
  });

  it('this build opens a store F wrote: it reads the head and the rows as stored and removes nothing; a reader sends nothing', () => {
    host('F');
    // F's two writers at once, the deletion first: both land, and F's bolder tidies after the relay, a third row
    const bolder = open('F');
    const deleter = open('F', agent);
    transact(bolder.doc, () => text(bolder.doc).insert(0, 'one word two'), 'typed');
    settle();
    bolder.hold = true;
    transact(bolder.doc, () => text(bolder.doc).format(4, 4, { bold: true }), 'typed');
    deleteWord(deleter);
    settle();
    bolder.hold = false;
    settle();
    const stored = rows();
    const live = service.loaded('a1')!;
    const held = { markers: liveMarkers(text(live)), delta: text(live).toDelta() };
    closeHost();
    host('this');
    const loaded = service.live('a1');
    expect({ markers: liveMarkers(text(loaded)), delta: text(loaded).toDelta() }).toEqual(held);
    const reader = open('this');
    settle();
    expect(updatesSent(reader)).toBe(0);
    expect(rows()).toEqual(stored);
  });
});
