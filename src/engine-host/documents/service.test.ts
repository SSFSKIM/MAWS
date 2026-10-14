import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KindAdapter } from '@artifacts/host';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { adoptClientId, applyV1, applyV2, carriedBy, checkUpdate, contentIdsOf, decodeMap, deletedBy, diffV1, hasPending, idAt, insertedBy, mergeMaps, newDoc, stateVector, SuggestionError, type Doc, type Node } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostPort } from './ports';
import { DocumentService, IDLE_UNLOAD_MS, type Committed, type ServiceOptions } from './service';
import { SqliteDocumentStorage, StoreTooNewError } from './storage';

// The real check, made skippable once: the pending-state case needs an update the check would refuse to get through.
vi.mock('@artifacts/yjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@artifacts/yjs')>();
  return { ...real, checkUpdate: vi.fn(real.checkUpdate) };
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: sid('app-1') };

let dir: string;
let path: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let now: number;
let logs: string[];
let turns: (() => void)[]; // the service's deferred flushes, run by `tick` (manual) or by setImmediate (`live`)

const tick = () => {
  while (turns.length > 0) turns.shift()!();
};
function make(options: ServiceOptions = {}, live = false): void {
  storage = SqliteDocumentStorage.open(path, { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: (line) => logs.push(line), defer: live ? undefined : (run) => turns.push(run), ...options });
}
function reopen(options: ServiceOptions = {}, live = false): void {
  service.close();
  storage.close();
  make(options, live);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-docsvc-'));
  path = join(dir, 'store.sqlite');
  now = 10 * DAY;
  logs = [];
  turns = [];
  vi.mocked(checkUpdate).mockClear();
});
afterEach(() => {
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

// A replica end driven frame by frame: what the host sends is decoded into `received`; `send` hands the host a frame.
function raw(artifactId: string, actor: Actor) {
  let onMessage: ((data: unknown) => void) | null = null;
  let onClose: (() => void) | null = null;
  const end = {
    received: [] as Frame[],
    closed: false,
    doc: newDoc(),
    send: (frame: Frame | Uint8Array) => onMessage!(frame instanceof Uint8Array ? frame : encodeFrame(frame)),
    // One local edit as an update frame.
    edit(change: (doc: Doc) => void) {
      const before = stateVector(end.doc);
      change(end.doc);
      end.send({ type: 'update', update: diffV1(end.doc, before) });
    },
    take: () => end.received.splice(0),
    hangUp: () => onClose!(), // the replica closed its end (a window closed)
  };
  const port: HostPort = {
    send: (frame) => end.received.push(decodeFrame(frame)),
    close: () => void (end.closed = true),
    onMessage: (listener) => void (onMessage = listener),
    onClose: (listener) => void (onClose = listener),
  };
  const conn = service.attach(artifactId, port, actor);
  return Object.assign(end, { conn });
}

const committed = (sql: string, ...params: (string | number)[]) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
};
const rowCount = () => (committed('SELECT COUNT(*) AS n FROM artifact_updates')[0] as { n: number }).n;
const until = async (test: () => boolean) => {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};

describe('DocumentService: replicas, durability and reload', () => {
  it('reloads a doc written through two replicas identically from a fresh service on the same file', async () => {
    make({}, true);
    const a = service.replica(sid('app-a'), 'a1');
    const b = service.replica(sid('app-b'), 'a1');
    await Promise.all([a.whenSynced(), b.whenSynced()]);
    a.doc.get('root').setAttr('title', 'Plan');
    a.doc.get('root').insert(0, 'hello');
    b.doc.get('files').setAttr('index.md', '# notes');
    b.doc.get('root').setAttr('status', 'draft');
    const [ra, rb] = await Promise.all([a.whenSaved(), b.whenSaved()]);
    expect(Math.max(ra, rb)).toBe(service.revision('a1'));
    const same = (name: string) => isDeepStrictEqual(a.doc.get(name).toJSON(), b.doc.get(name).toJSON());
    await until(() => same('root') && same('files') && a.doc.get('files').getAttr('index.md') === '# notes');

    reopen({}, true);
    const c = service.replica(sid('app-c'), 'a1');
    await c.whenSynced();
    for (const name of ['root', 'files']) expect(c.doc.get(name).toJSON()).toEqual(a.doc.get(name).toJSON());
    expect(c.doc.get('root').getAttr('title')).toBe('Plan');
    expect(service.revision('a1')).toBe(Math.max(ra, rb));
  });

  it('commits a row before anything reveals it: the broadcast and the ack wait for the batch’s one commit', () => {
    make();
    const a = raw('a1', human);
    const b = raw('a1', human);
    tick();
    a.take();
    b.take();
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    a.edit((doc) => doc.get('t').insert(3, 'def'));
    expect(b.received).toEqual([]);
    expect(a.received).toEqual([]);
    expect(rowCount()).toBe(0);
    expect(service.stats.commits).toBe(0);
    tick();
    expect(rowCount()).toBe(2);
    expect(service.stats.commits).toBe(1); // one commit for the turn's two rows
    expect(b.take().map((frame) => frame.type)).toEqual(['update', 'update']);
    expect(a.take()).toEqual([{ type: 'ack', frames: 2, revision: service.revision('a1') }]);
  });

  it('answers a step 1 with a step 2 and, when the doc has a restore, the latest `restored` right after it', () => {
    make();
    storage.db.prepare("INSERT INTO artifact_versions (artifactId, seq, at, actor, kind) VALUES ('a1', 0, 1, 'human', 'restore')").run();
    const a = raw('a1', human);
    tick();
    expect(a.take().map((frame) => frame.type)).toEqual(['step1']);
    a.send({ type: 'step1', sv: stateVector(a.doc) });
    a.send({ type: 'step2', update: diffV1(a.doc) });
    tick();
    const frames = a.take();
    expect(frames.map((frame) => frame.type)).toEqual(['step2', 'restored', 'ack']);
    expect(frames[1]).toMatchObject({ type: 'restored', revision: 0 });

    service.announceRestored('a1', { revision: 7, versionId: 99 });
    tick();
    expect(a.take()).toEqual([{ type: 'restored', revision: 7, versionId: 99 }]);
    a.send({ type: 'step1', sv: stateVector(a.doc) });
    tick();
    expect(a.take().map((frame) => frame.type)).toEqual(['step2', 'restored']);
  });

  it('reports each commit through onCommitted with the artifact’s revision and who wrote its rows', () => {
    make();
    const seen: Committed[] = [];
    service.onCommitted((change) => seen.push(change));
    const a = raw('a1', human);
    const b = raw('a2', human);
    const c = raw('a2', agent);
    a.edit((doc) => doc.get('t').insert(0, 'x'));
    a.edit((doc) => doc.get('t').insert(1, 'y'));
    b.edit((doc) => doc.get('t').insert(0, 'z'));
    c.edit((doc) => doc.get('u').insert(0, 'w'));
    expect(seen).toEqual([]);
    tick();
    expect(seen).toEqual([
      { artifactId: 'a1', revision: service.revision('a1'), actors: [human] },
      { artifactId: 'a2', revision: service.revision('a2'), actors: [human, agent] },
    ]);
  });

  it('rewrites the head after a commit once the tail passes its bound, and a reload from head plus tail is the same doc', () => {
    make({ headTailRows: 3 });
    const a = raw('a1', human);
    for (const word of ['one ', 'two ', 'three ', 'four ']) a.edit((doc) => doc.get('t').insert(doc.get('t').length, word));
    tick();
    expect(committed("SELECT seq FROM artifact_head WHERE artifactId = 'a1'")).toEqual([{ seq: service.revision('a1') }]);
    a.edit((doc) => doc.get('t').insert(0, '> '));
    tick();
    reopen();
    expect(storage.load('a1').updates).toHaveLength(1); // the head plus the one row after it
    const b = raw('a1', human);
    b.send({ type: 'step1', sv: stateVector(b.doc) });
    tick();
    const step2 = b.take().find((frame) => frame.type === 'step2');
    if (step2?.type !== 'step2') throw new Error('no step 2');
    applyV1(b.doc, step2.update);
    expect(b.doc.get('t').toString()).toBe('> one two three four ');
  });
});

describe('DocumentService: untrusted frames', () => {
  it('closes a connection whose frame does not decode, keeping the doc and the other connections', () => {
    make();
    const a = raw('a1', human);
    const b = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    tick();
    b.send(new Uint8Array([0, 2, 9, 1])); // an update frame whose payload is cut short
    expect(b.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/./);
    a.edit((doc) => doc.get('t').insert(3, 'def'));
    tick();
    expect(service.loaded('a1')?.get('t').toString()).toBe('abcdef');
    expect(a.closed).toBe(false);
  });

  it('closes a connection that sends a gapped update or a host-only frame, and applies nothing', () => {
    make();
    const a = raw('a1', human);
    const b = raw('a1', human);
    const writer = newDoc();
    writer.get('t').insert(0, 'abc');
    const sv = stateVector(writer);
    writer.get('t').insert(3, 'def');
    b.send({ type: 'update', update: diffV1(writer, sv) }); // its first three clocks never came
    expect(b.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/gap|origin/);
    a.send({ type: 'ack', frames: 1, revision: 1 });
    expect(a.closed).toBe(true);
    tick();
    expect(service.loaded('a1')?.get('t').toString()).toBe(''); // nothing applied
    expect(rowCount()).toBe(0);
  });

  it('refuses a new struct under a clientID bound to another actor (a forged authorship), and accepts a restatement of it', () => {
    make();
    const a = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'mine'));
    tick();
    const forger = raw('a1', agent);
    // a restatement of the human's structs (a step 2 holding what the host has) is a no-op and passes
    forger.send({ type: 'step2', update: diffV1(a.doc) });
    expect(forger.closed).toBe(false);
    const sv = stateVector(a.doc);
    a.doc.get('t').insert(4, ' too');
    forger.send({ type: 'update', update: diffV1(a.doc, sv) }); // new structs under the human's clientID
    expect(forger.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/bound to another actor/);
    tick();
    expect(service.loaded('a1')?.get('t').toString()).toBe('mine');
  });

  it('evicts a doc left with pending state, sends nothing of that frame, and a re-attach reloads it from the store', () => {
    make();
    const a = raw('a1', human);
    const b = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    tick();
    b.take();
    const writer = newDoc();
    writer.get('t').insert(0, 'xyz');
    const sv = stateVector(writer);
    writer.get('t').insert(3, '!');
    vi.mocked(checkUpdate).mockReturnValueOnce(null);
    a.send({ type: 'update', update: diffV1(writer, sv) });
    expect(a.closed && b.closed).toBe(true);
    expect(logs.join('\n')).toMatch(/evicted a1/);
    tick();
    expect(b.received).toEqual([]);
    expect(service.loaded('a1')).toBeNull();
    const c = raw('a1', human);
    expect(service.loaded('a1')?.get('t').toString()).toBe('abc');
    expect(c.closed).toBe(false);
  });

  it('drops every open doc and closes their connections when a commit fails, revealing nothing', () => {
    make();
    const a = raw('a1', human);
    const b = raw('a1', human);
    tick();
    b.take();
    const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    tick();
    expect(logs.join('\n')).toMatch(/commit failed/);
    expect(a.closed && b.closed).toBe(true);
    expect(b.received).toEqual([]);
    expect(service.loaded('a1')).toBeNull();
    commit.mockRestore();
    expect(rowCount()).toBe(0);
  });

  it('treats a frame whose savepoint cannot be rolled back (SQLITE_FULL took the whole batch) as a failed commit', async () => {
    make();
    const a = raw('a1', human);
    const watcher1 = raw('a1', human);
    const b = raw('a2', human);
    const watcher2 = raw('a2', human);
    a.edit((doc) => doc.get('t').insert(0, 'base'));
    b.edit((doc) => doc.get('t').insert(0, 'other'));
    tick();
    for (const end of [a, watcher1, b, watcher2]) end.take();
    expect(rowCount()).toBe(2);

    // An earlier row of another document in the same batch, its answer waiting for the commit.
    const pending = service.writeAs('a2', agent, (doc) => doc.get('t').insert(5, ' uncommitted'));
    let settled: string | null = null;
    pending.then(
      () => (settled = 'resolved'),
      () => (settled = 'rejected'),
    );
    // The file cannot grow past its current pages: the next large row fails with SQLITE_FULL, which rolls back the
    // whole transaction, so the frame's savepoint is gone when the service tries to roll back to it.
    const { page_count } = storage.db.prepare('PRAGMA page_count').get() as { page_count: number };
    storage.db.exec(`PRAGMA max_page_count = ${page_count}`);
    a.edit((doc) => doc.get('t').insert(4, 'x'.repeat(128_000)));

    expect(logs.join('\n')).toMatch(/no such savepoint/);
    for (const end of [a, watcher1, b, watcher2]) expect(end.closed).toBe(true);
    expect(service.loaded('a1')).toBeNull();
    expect(service.loaded('a2')).toBeNull();
    expect(storage.db.isTransaction).toBe(false);
    tick();
    expect(turns).toEqual([]);
    for (const end of [a, watcher1, b, watcher2]) expect(end.received).toEqual([]); // nothing broadcast, nothing acked
    await Promise.resolve();
    expect(settled).toBe('rejected');
    expect(rowCount()).toBe(2);

    // A reattach reloads the committed state, and the store takes writes again.
    storage.db.exec('PRAGMA max_page_count = 1073741823');
    const c = raw('a1', human);
    const d = raw('a2', human);
    expect(service.loaded('a1')?.get('t').toString()).toBe('base');
    expect(service.loaded('a2')?.get('t').toString()).toBe('other');
    c.edit((doc) => doc.get('t').insert(0, '> '));
    tick();
    expect(rowCount()).toBe(3);
    expect(c.received.some((frame) => frame.type === 'ack')).toBe(true);
    expect(c.closed || d.closed).toBe(false);
  });
});

describe('DocumentService: authorship and provenance', () => {
  it('binds each clientID to the actor whose connection first wrote under it, crediting inserts by binding and deletions by connection', () => {
    make();
    const a = raw('a1', agent);
    a.edit((doc) => doc.get('t').insert(0, 'agent text'));
    tick();
    const h = raw('a1', human);
    applyV1(h.doc, diffV1(a.doc));
    h.send({ type: 'step2', update: diffV1(h.doc) }); // restates the agent's structs: no-ops, nothing rebound
    h.edit((doc) => {
      doc.get('t').delete(0, 6); // "agent " deleted by the human
      doc.get('t').insert(0, 'my '); // under the human's own clientID
    });
    tick();
    expect(storage.clientActor('a1', a.doc.clientID)).toEqual(agent);
    expect(storage.clientActor('a1', h.doc.clientID)).toEqual(human);
    expect(service.loaded('a1')?.get('t').toString()).toBe('my text');
    const map = service.provenance('a1');
    const t = h.doc.get('t');
    expect(insertedBy(map, idAt(t, 0)!)?.actor).toBe('human'); // "my "
    expect(insertedBy(map, idAt(t, 3)!)?.actor).toBe('session:app-1'); // "text"
    expect(deletedBy(map, { client: a.doc.clientID, clock: 0 })?.actor).toBe('human');
    expect(committed("SELECT actor FROM artifact_updates WHERE artifactId = 'a1' ORDER BY seq")).toEqual([{ actor: 'session:app-1' }, { actor: 'human' }]);
  });

  it('answers who inserted and deleted a range identically before and after the head rewrite, log pruning and 30-day tiering', () => {
    make({ headTailRows: 2 });
    const a = raw('a1', agent);
    a.edit((doc) => doc.get('t').insert(0, 'drafted by the agent'));
    tick();
    now += 3 * MIN + 17_000; // off the minute: times are floored at write
    const h = raw('a1', human);
    applyV1(h.doc, diffV1(a.doc));
    h.edit((doc) => {
      doc.get('t').delete(0, 8); // "drafted " deleted by the human
      doc.get('t').insert(0, 'Written ');
    });
    tick();
    const ids = [
      { client: a.doc.clientID, clock: 0 }, // deleted
      { client: a.doc.clientID, clock: 5 }, // deleted
      { client: a.doc.clientID, clock: 12 }, // "the agent", kept
      { client: h.doc.clientID, clock: 0 }, // "Written "
    ];
    const answer = (map: ReturnType<typeof service.provenance>) => ids.map((id) => ({ inserted: insertedBy(map, id), deleted: deletedBy(map, id) }));
    const fromStore = () => answer(mergeMaps(storage.provenance('a1').map(decodeMap)));
    const fresh = answer(service.provenance('a1'));
    expect(fresh).toEqual([
      { inserted: { actor: 'session:app-1', at: 10 * DAY }, deleted: { actor: 'human', at: 10 * DAY + 3 * MIN } },
      { inserted: { actor: 'session:app-1', at: 10 * DAY }, deleted: { actor: 'human', at: 10 * DAY + 3 * MIN } },
      { inserted: { actor: 'session:app-1', at: 10 * DAY }, deleted: null },
      { inserted: { actor: 'human', at: 10 * DAY + 3 * MIN }, deleted: null },
    ]);
    expect(fromStore()).toEqual(fresh);
    expect(committed("SELECT seq FROM artifact_head WHERE artifactId = 'a1'")).toEqual([{ seq: service.revision('a1') }]);

    now += 40 * DAY;
    expect(storage.pruneLog(now)).toBe(1); // the log is gone but its newest row (Decision Log 37a); provenance is not
    expect(storage.tierAttributions(now)).toEqual({ merged: 3, written: 2 });
    expect(committed("SELECT DISTINCT tier FROM artifact_attributions WHERE artifactId = 'a1'")).toEqual([{ tier: 'day' }]);
    expect(fromStore()).toEqual(fresh);
    reopen();
    expect(answer(service.provenance('a1'))).toEqual(fresh);
    expect(service.revision('a1')).toBeGreaterThan(0);
  });
});

describe('DocumentService: host-originated writes', () => {
  it('writes through the actor’s host replica: one row per write credited to the actor, answered after the commit', async () => {
    make({}, true);
    const watcher = service.replica(sid('app-9'), 'a1');
    await watcher.whenSynced();
    const r1 = await service.writeAs('a1', agent, (doc) => doc.get('t').insert(0, 'hello'));
    expect(r1).toBe(service.revision('a1'));
    expect(rowCount()).toBe(1); // committed before the answer
    const r2 = await service.writeAs('a1', agent, (doc) => doc.get('t').insert(5, '!'));
    expect(r2).toBeGreaterThan(r1);
    expect(await service.writeAs('a1', agent, () => {})).toBe(r2); // nothing written: no row, the same revision
    await until(() => watcher.doc.get('t').toString() === 'hello!');
    const hostClients = () => committed('SELECT clientId, actor FROM client_actors WHERE host = 1 ORDER BY actor');
    expect(hostClients()).toEqual([{ clientId: expect.any(Number), actor: 'session:app-1' }]);
    const [{ clientId }] = hostClients() as { clientId: number }[];

    reopen({}, true);
    await service.writeAs('a1', agent, (doc) => doc.get('t').insert(0, '> '));
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, '# '));
    expect(hostClients()).toEqual([
      { clientId: expect.any(Number), actor: 'human' },
      { clientId, actor: 'session:app-1' }, // reused across the reload: one host clientID per actor
    ]);
    expect(committed('SELECT actor FROM artifact_updates ORDER BY seq').map((row) => (row as { actor: string }).actor)).toEqual(['session:app-1', 'session:app-1', 'session:app-1', 'human']);
    const reader = service.replica(sid('app-9'), 'a1');
    await reader.whenSynced();
    expect(reader.doc.get('t').toString()).toBe('# > hello!');
  });

  it('rejects a write whose edit throws, takes back its rows and evicts the doc', async () => {
    make({}, true);
    await service.writeAs('a1', agent, (doc) => doc.get('t').insert(0, 'kept'));
    await expect(
      service.writeAs('a1', agent, (doc) => {
        doc.get('t').insert(0, 'half');
        throw new Error('broken edit');
      }),
    ).rejects.toThrow(/broken edit/);
    expect(logs.join('\n')).toMatch(/evicted a1: broken edit/);
    const reader = service.replica(sid('app-9'), 'a1');
    await reader.whenSynced();
    expect(reader.doc.get('t').toString()).toBe('kept');
    expect(rowCount()).toBe(1);
  });

  it('reads on the actor’s host replica (readAs, Decision Log 41b): no frame, no row, and the write after it uses that replica', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'hello'));
    const rows = rowCount();
    const appended = service.stats.rowsAppended;
    let seen: Doc | null = null;
    const text = service.readAs('a1', agent, (doc) => {
      seen = doc;
      return doc.get('t').toString();
    });
    expect(text).toBe('hello');
    expect(service.stats.rowsAppended).toBe(appended); // nothing written, nothing queued
    await service.whenCommitted();
    expect(rowCount()).toBe(rows);
    // the replica the read warmed is the one the actor's next write goes through
    await service.writeAs('a1', agent, (doc) => {
      expect(doc).toBe(seen);
      doc.get('t').insert(5, '!');
    });
    expect(service.readAs('a1', agent, (doc) => doc.get('t').toString())).toBe('hello!');
  });

  it('refuses a readAs that edits: nothing reaches the live doc, and the actor’s next write starts from the live state', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'hello'));
    const appended = service.stats.rowsAppended;
    expect(() => service.readAs('a1', agent, (doc) => doc.get('t').insert(0, 'sneaked '))).toThrow(/read-only/);
    expect(service.stats.rowsAppended).toBe(appended);
    expect(service.readAs('a1', agent, (doc) => doc.get('t').toString())).toBe('hello'); // a fresh replica, from the live doc
    await service.writeAs('a1', agent, (doc) => doc.get('t').insert(5, '!'));
    expect(service.readAs('a1', agent, (doc) => doc.get('t').toString())).toBe('hello!');
    const reader = service.replica(sid('app-9'), 'a1');
    await reader.whenSynced();
    expect(reader.doc.get('t').toString()).toBe('hello!');
  });

  it('leaves a taken-back write’s actor out of the commit’s writers (M3 review finding 3)', async () => {
    make();
    const seen: Committed[] = [];
    service.onCommitted((change) => seen.push(change));
    const kept = service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'kept'));
    await expect(
      service.writeAs('a1', agent, (doc) => {
        doc.get('t').insert(0, 'lost');
        throw new Error('invalid edit');
      }),
    ).rejects.toThrow(/invalid edit/);
    tick();
    await kept;
    expect(seen).toEqual([{ artifactId: 'a1', revision: service.revision('a1'), actors: [human] }]);
  });
});

describe('DocumentService: suggestion docs (M8; Decision Log 23e)', () => {
  const text = (key: string) => service.live(key).get('t').toString();
  const keys = () => committed('SELECT artifactId, actor FROM artifact_updates ORDER BY seq');

  it('opens an artifact’s suggestion doc under `<artifactId>:suggest`: gc off, holding the main doc, its writes its own rows', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'The plan.'));
    const key = service.suggestionDoc('a1');
    expect(key).toBe('a1:suggest');
    expect(service.suggestionDoc('a1')).toBe(key);
    expect(service.live(key).gc).toBe(false);
    expect(text(key)).toBe('The plan.');
    await service.writeAs(key, agent, (doc) => doc.get('t').insert(8, ' and more'));
    expect(text(key)).toBe('The plan and more.');
    expect(text('a1')).toBe('The plan.');
    expect(keys()).toEqual([{ artifactId: 'a1', actor: 'human' }, { artifactId: 'a1:suggest', actor: 'session:app-1' }]);
    expect(service.revision(key)).toBe(2);
    expect(() => service.suggestionDoc(key)).toThrow(/is a suggestion doc/);
  });

  it('keeps it in step with the main doc after the main doc’s commit, logging nothing twice, and rebuilds it from both after a reload', async () => {
    make();
    const main = raw('a1', human);
    main.edit((doc) => doc.get('t').insert(0, 'one'));
    tick();
    const key = service.suggestionDoc('a1');
    const view = raw(key, human);
    view.send({ type: 'step1', sv: stateVector(view.doc) });
    tick();
    for (const frame of view.take()) if (frame.type === 'step2') applyV1(view.doc, frame.update);
    expect(view.doc.get('t').toString()).toBe('one');
    main.edit((doc) => doc.get('t').insert(0, 'zero '));
    expect(view.received).toEqual([]); // nothing revealed before the main doc’s row commits
    tick();
    const update = view.take().find((frame) => frame.type === 'update');
    expect(update).toBeDefined();
    applyV1(view.doc, (update as { update: Uint8Array }).update);
    expect(view.doc.get('t').toString()).toBe('zero one');
    expect(keys()).toEqual([{ artifactId: 'a1', actor: 'human' }, { artifactId: 'a1', actor: 'human' }]);

    void service.writeAs(key, agent, (doc) => doc.get('t').insert(8, ' (suggested)'));
    tick();
    reopen();
    void service.writeAs('a1', human, (doc) => doc.get('n').setAttr('status', 'done')); // while the suggestion doc is not loaded
    tick();
    expect(service.loaded(key)).toBeNull();
    expect(text(key)).toBe('zero one (suggested)');
    expect(service.live(key).get('n').getAttr('status')).toBe('done');
    expect(keys().filter((row) => (row as { artifactId: string }).artifactId === key)).toHaveLength(1);
  });

  it('drops a loaded suggestion doc with its main doc when a main write is taken back, so it never holds what the main doc lost', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'kept'));
    const key = service.suggestionDoc('a1');
    await expect(
      service.writeAs('a1', human, (doc) => {
        doc.get('t').insert(0, 'half ');
        throw new Error('broken edit');
      }),
    ).rejects.toThrow(/broken edit/);
    expect(service.loaded(key)).toBeNull();
    expect(text(key)).toBe('kept');
  });

  it('refuses a main doc frame carrying new structs under a clientID the suggestion doc binds to another actor (an editor applying a proposal itself)', () => {
    make();
    void service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'base'));
    tick();
    const synced = (end: ReturnType<typeof raw>) => {
      end.send({ type: 'step1', sv: stateVector(end.doc) });
      tick();
      for (const frame of end.take()) if (frame.type === 'step2') applyV1(end.doc, frame.update);
    };
    const proposer = raw(service.suggestionDoc('a1'), agent);
    synced(proposer);
    proposer.edit((doc) => doc.get('t').insert(4, ' and more'));
    tick();
    const forge = () => {
      const editor = raw('a1', human);
      synced(editor);
      const before = stateVector(editor.doc);
      applyV1(editor.doc, diffV1(proposer.doc, before)); // the agent's proposal, its structs under the agent's clientID
      editor.send({ type: 'update', update: diffV1(editor.doc, before) });
      return editor;
    };
    expect(forge().closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/bound to another actor/);
    expect(text('a1')).toBe('base');
    reopen(); // the suggestion doc not loaded: its binding is read from the store
    expect(forge().closed).toBe(true);
    expect(service.loaded('a1:suggest')).toBeNull();
    expect(text('a1')).toBe('base');
  });

  it('writes through a host replica of the suggestion doc that keeps deleted content (gc off), as the doc itself does', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'abc'));
    const key = service.suggestionDoc('a1');
    let replicaGc: boolean | null = null;
    await service.writeAs(key, agent, (doc) => {
      replicaGc = doc.gc;
      doc.get('t').delete(1, 1);
    });
    expect(replicaGc).toBe(false);
    expect(text(key)).toBe('ac');
    expect(text('a1')).toBe('abc');
  });
});

describe('DocumentService: inherited bindings and suggestion replicas (M8 review findings 1 and 2)', () => {
  const synced = (end: ReturnType<typeof raw>) => {
    end.send({ type: 'step1', sv: stateVector(end.doc) });
    tick();
    for (const frame of end.take()) if (frame.type === 'step2') applyV1(end.doc, frame.update);
  };
  // A replica of the suggestion doc that extends `client` (a clientID of the main doc) as the human: a forgery.
  const extendAs = (client: number) => {
    const end = raw('a1:suggest', human);
    synced(end);
    adoptClientId(end.doc, client);
    end.edit((doc) => doc.get('t').insert(0, 'forged '));
    return end;
  };
  const sessionClient = (artifactId: string, actor: string) =>
    (committed('SELECT clientId FROM client_actors WHERE artifactId = ? AND actor = ? ORDER BY firstSeq DESC', artifactId, actor)[0] as { clientId: number }).clientId;

  it('refuses a suggestion-doc frame extending a clientID the main doc binds to another actor, the main doc loaded or not', () => {
    make();
    void service.writeAs('a1', agent, (doc) => doc.get('t').insert(0, 'base'));
    tick();
    service.suggestionDoc('a1');
    const client = sessionClient('a1', 'session:app-1');
    expect(extendAs(client).closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/bound to another actor \(session:app-1\)/);
    reopen();
    service.suggestionDoc('a1');
    expect(service.loaded('a1')).toBeNull();
    expect(extendAs(client).closed).toBe(true);
    expect(service.live('a1:suggest').get('t').toString()).toBe('base');
  });

  it('refuses one extending a clientID that reached the suggestion doc from a later main-doc write', () => {
    make();
    void service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'base'));
    tick();
    service.suggestionDoc('a1');
    const other: Actor = { kind: 'session', appSessionId: sid('app-2') };
    void service.writeAs('a1', other, (doc) => doc.get('t').insert(4, '!')); // flows into the loaded suggestion doc unlogged
    tick();
    expect(extendAs(sessionClient('a1', 'session:app-2')).closed).toBe(true);
    expect(service.live('a1:suggest').get('t').toString()).toBe('base!');
  });

  it('gives an agent replica of the suggestion doc a suggestion doc of its own (gc off), also when it is rebuilt', async () => {
    make({}, true);
    const replica = service.replica(sid('app-7'), service.suggestionDoc('a1'));
    await replica.whenSynced();
    expect(replica.doc.gc).toBe(false);
    expect(replica.doc.isSuggestionDoc).toBe(true);
    expect(() => replica.edit(() => { throw new Error('a failed plan'); })).toThrow(/a failed plan/);
    expect(replica.doc.gc).toBe(false);
    expect(replica.doc.isSuggestionDoc).toBe(true);
  });
});

describe('DocumentService: accepting and rejecting suggestions (M8; Decision Log 45)', () => {
  const text = (key: string) => service.live(key).get('t').toString();
  const at = (key: string, index: number) => idAt(service.live(key).get('t'), index)!;
  const span = (key: string, from: number, to: number) => ({ start: at(key, from), end: at(key, to) });
  const rows = (key: string) => committed('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq', key).map((row) => (row as { actor: string }).actor);
  const proposedAt = 10 * DAY;
  // The main doc reads "The plan."; the agent proposes, in one write, " Zed." at its end and then "Intro. " at its
  // start, so "Intro. " holds the later clocks.
  async function proposed(): Promise<string> {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'The plan.'));
    const key = service.suggestionDoc('a1');
    await service.writeAs(key, agent, (doc) => {
      const t = doc.get('t');
      t.insert(9, ' Zed.');
      t.insert(0, 'Intro. ');
    });
    expect(text(key)).toBe('Intro. The plan. Zed.');
    return key;
  }

  it('accepts out of write order by copy: the acceptor’s row, the suggester’s provenance and time, the proposals gone from the suggestion doc, no gap on any replica', async () => {
    const key = await proposed();
    const mainReplica = service.replica(sid('app-8'), 'a1');
    const suggestionReplica = service.replica(sid('app-9'), key);
    await Promise.all([mainReplica.whenSynced(), suggestionReplica.whenSynced()]);
    now += 5 * MIN;
    const revision = await service.acceptSuggestion('a1', [span(key, 0, 6)], human); // "Intro. ": the later clocks first
    expect(revision).toBe(service.revision('a1'));
    expect(text('a1')).toBe('Intro. The plan.');
    expect(text(key)).toBe('Intro. The plan. Zed.');
    expect(rows('a1')).toEqual(['human', 'human']);
    expect(rows(key)).toEqual(['session:app-1', 'human']); // the proposal, then its originals deleted by the acceptor
    const provenance = service.provenance('a1');
    expect(insertedBy(provenance, at('a1', 0))).toEqual({ actor: 'session:app-1', at: proposedAt });
    expect(carriedBy(provenance, at('a1', 0))).toBe('accept');
    const copyClient = at('a1', 0).client;
    expect(at(key, 0).client).toBe(copyClient); // the suggestion doc shows the copy, its original deleted
    expect(copyClient).not.toBe((committed('SELECT clientId FROM client_actors WHERE artifactId = ?', key)[0] as { clientId: number }).clientId);
    expect(committed('SELECT actor, host FROM client_actors WHERE artifactId = ? AND clientId = ?', 'a1', copyClient)).toEqual([{ actor: 'session:app-1', host: 0 }]);

    await service.acceptSuggestion('a1', [span(key, 16, 20)], human); // " Zed."
    expect(text('a1')).toBe('Intro. The plan. Zed.');
    await until(() => mainReplica.doc.get('t').toString() === 'Intro. The plan. Zed.' && suggestionReplica.doc.get('t').toString() === 'Intro. The plan. Zed.');
    for (const doc of [service.live('a1'), service.live(key), mainReplica.doc, suggestionReplica.doc]) expect(hasPending(doc)).toBe(false);
    // nothing proposed is left: an accept over the whole text writes nothing
    const before = rows('a1').length;
    await service.acceptSuggestion('a1', [span(key, 0, 20)], human);
    expect(rows('a1')).toHaveLength(before);
  });

  it('rejects: a proposed insert leaves the suggestion doc only; a proposed deletion comes back content-identical, written by the rejector and still credited to its author', async () => {
    make({}, true);
    const writer: Actor = { kind: 'session', appSessionId: sid('app-2') };
    await service.writeAs('a1', writer, (doc) => doc.get('t').insert(0, 'The plan.'));
    const key = service.suggestionDoc('a1');
    await service.writeAs(key, agent, (doc) => doc.get('t').insert(9, ' Zed.'));
    await service.writeAs(key, agent, (doc) => doc.get('t').delete(0, 4)); // "The " struck, apart from " Zed."
    expect(text(key)).toBe('plan. Zed.');
    const mainRows = rows('a1').length;
    await service.rejectSuggestion('a1', [span(key, 5, 5)]); // " Zed."
    expect(text(key)).toBe('plan.');
    expect(text('a1')).toBe('The plan.');
    expect(rows('a1')).toHaveLength(mainRows); // the main doc was not written
    let struck = service.live(key).get('t')._start;
    while (struck && !struck.deleted) struck = struck.right as typeof struck;
    const original = { client: struck!.id.client, clock: struck!.id.clock };
    now += 5 * MIN;
    await service.rejectSuggestion('a1', [{ start: original, end: original }]);
    expect(text('a1')).toBe('The plan.');
    expect(text(key)).toBe('The plan.');
    expect(rows('a1').at(-1)).toBe('human'); // the rejector writes the copy
    const restored = at('a1', 0);
    expect(restored).not.toEqual(original);
    expect(insertedBy(service.provenance('a1'), restored)).toEqual({ actor: 'session:app-2', at: proposedAt }); // its author, its time
    expect(carriedBy(service.provenance('a1'), restored)).toBe('reject');
  });

  it('keeps a human’s concurrent edit to the main doc through an accept and a reject', async () => {
    const key = await proposed();
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(4, 'whole '));
    expect(text(key)).toBe('Intro. The whole plan. Zed.');
    await service.acceptSuggestion('a1', [span(key, 0, 6)], human);
    await service.rejectSuggestion('a1', [span(key, 22, 26)]);
    expect(text('a1')).toBe('Intro. The whole plan.');
    expect(text(key)).toBe('Intro. The whole plan.');
  });

  it('refuses a range with no content or that would split an inserted block from its words, writing nothing; a forged clientID stays refused after an accept', async () => {
    const key = await proposed();
    const count = rowCount();
    await expect(service.acceptSuggestion('a1', [{ start: { client: 1, clock: 0 }, end: { client: 1, clock: 0 } }], human)).rejects.toBeInstanceOf(SuggestionError);
    expect(rowCount()).toBe(count);
    await service.acceptSuggestion('a1', [span(key, 0, 6)], human);
    // a replica of the main doc writing under the copy's clientID (bound to the suggester) is refused
    const copyClient = at('a1', 0).client;
    const forger = service.replica(sid('app-5'), 'a1');
    await forger.whenSynced();
    adoptClientId(forger.doc, copyClient);
    forger.doc.get('t').insert(0, 'forged ');
    await until(() => service.stats.rejected.some((r) => r.reason.includes(`clientID ${copyClient}, bound to another actor`)));
    expect(text('a1')).toBe('Intro. The plan.');
  });
});

describe('DocumentService: suggestions, fix wave 1', () => {
  const sessionA: Actor = { kind: 'session', appSessionId: sid('app-a') };
  const sessionB: Actor = { kind: 'session', appSessionId: sid('app-b') };
  const text = (key: string) => service.live(key).get('t');
  // The ids of the formatting markers of a text, in order.
  const markers = (key: string) => {
    const out: { client: number; clock: number }[] = [];
    for (let item = text(key)._start; item; item = item.right as typeof item) {
      if (!item.deleted && (item.content as { key?: unknown }).key !== undefined) out.push({ client: item.id.client, clock: item.id.clock });
    }
    return out;
  };

  it('credits a mixed-author range’s format change to its proposer and its inserted text to its own, each at its proposal’s time', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'x z'));
    const key = service.suggestionDoc('a1');
    const boldAt = now;
    await service.writeAs(key, sessionA, (doc) => doc.get('t').format(0, 1, { bold: true })); // A: bold on the existing "x"
    now += 2 * MIN;
    const typedAt = now;
    await service.writeAs(key, sessionB, (doc) => doc.get('t').insert(1, 'y')); // B: a character beside it
    now += 5 * MIN;
    const [open] = markers(key);
    await service.acceptSuggestion('a1', [{ start: open, end: idAt(text(key), 1)! }], human);
    expect(text('a1').toDelta().toJSON()).toEqual(text(key).toDelta().toJSON());
    expect(text('a1').toString()).toContain('y');
    const provenance = service.provenance('a1');
    const copied = markers('a1');
    expect(copied.length).toBeGreaterThan(0);
    for (const marker of copied) {
      expect(insertedBy(provenance, marker)).toEqual({ actor: 'session:app-a', at: boldAt });
      expect(carriedBy(provenance, marker)).toBe('accept');
    }
    expect(insertedBy(provenance, idAt(text('a1'), 1)!)).toEqual({ actor: 'session:app-b', at: typedAt });
  });

  it('accepts a mixed-author range whose copy merges formatting runs: characters credited per author, the markers to the proposer who set them', async () => {
    make({}, true);
    await service.writeAs('a1', human, (doc) => {
      doc.get('t').insert(0, 'ab');
      doc.get('t').format(0, 1, { bold: true }); // "a" bold already: the copy of a bold "b" merges into its run
    });
    const key = service.suggestionDoc('a1');
    const boldAt = now;
    await service.writeAs(key, sessionA, (doc) => doc.get('t').format(1, 1, { bold: true }));
    now += 2 * MIN;
    const typedAt = now;
    await service.writeAs(key, sessionB, (doc) => doc.get('t').insert(2, 'c'));
    now += 5 * MIN;
    const before = new Set(markers('a1').map(({ client, clock }) => `${client}:${clock}`));
    const [first] = markers(key);
    await service.acceptSuggestion('a1', [{ start: first, end: idAt(text(key), 2)! }], human);
    expect(text('a1').toDelta().toJSON()).toEqual(text(key).toDelta().toJSON());
    const provenance = service.provenance('a1');
    expect(insertedBy(provenance, idAt(text('a1'), 2)!)).toEqual({ actor: 'session:app-b', at: typedAt }); // "c"
    const copied = markers('a1').filter(({ client, clock }) => !before.has(`${client}:${clock}`));
    expect(copied.length).toBeGreaterThan(0);
    for (const marker of copied) expect(insertedBy(provenance, marker)).toEqual({ actor: 'session:app-a', at: boldAt }); // only A set bold
  });
});

describe('DocumentService: the idle unload (Decision Log 29b)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());
  // Event-loop turns (the agent replica's ports), since `setTimeout` is faked here.
  const settle = async (test: () => boolean) => {
    for (let i = 0; i < 2_000 && !test(); i++) await new Promise((resolve) => setImmediate(resolve));
    expect(test()).toBe(true);
  };

  it('keeps a document loaded for 60 s after its last connection closes, and a reattach within them gets the same doc', () => {
    make();
    const load = vi.spyOn(storage, 'load');
    const a = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    tick();
    const doc = service.loaded('a1');
    a.hangUp();
    tick();
    vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1);
    expect(service.loaded('a1')).toBe(doc);
    const b = raw('a1', human); // within the grace period: no reload
    expect(service.loaded('a1')).toBe(doc);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IDLE_UNLOAD_MS); // held again: the first grace period was called off
    expect(service.loaded('a1')).toBe(doc);
    b.hangUp();
    tick();
    vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1);
    expect(service.loaded('a1')).toBe(doc); // counted from the last close
    vi.advanceTimersByTime(1);
    expect(service.loaded('a1')).toBeNull();
    raw('a1', human);
    expect(load).toHaveBeenCalledTimes(2);
    expect(service.loaded('a1')?.get('t').toString()).toBe('abc');
  });

  it('counts the grace period of a document nobody attached from its last write, and never unloads under uncommitted rows', async () => {
    make();
    const first = service.writeAs('a1', agent, (doc) => doc.get('t').insert(0, 'one'));
    tick();
    await first;
    const doc = service.loaded('a1');
    vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1);
    const second = service.writeAs('a1', agent, (doc) => doc.get('t').insert(3, ' two')); // its rows wait for the commit
    vi.advanceTimersByTime(1); // the grace period ends with the write uncommitted: the doc stays
    expect(service.loaded('a1')).toBe(doc);
    tick();
    expect(await second).toBe(service.revision('a1'));
    vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1);
    expect(service.loaded('a1')).toBe(doc);
    vi.advanceTimersByTime(1);
    expect(service.loaded('a1')).toBeNull();
    expect(service.readState('a1').revision).toBe(await second);
  });

  it('never unloads a document while an agent replica holds it; the grace period starts when the replica closes', async () => {
    make({}, true);
    const r = service.replica(sid('app-1'), 'a1');
    await r.whenSynced();
    r.doc.get('t').insert(0, 'agent text');
    await r.whenSaved();
    const doc = service.loaded('a1');
    vi.advanceTimersByTime(10 * IDLE_UNLOAD_MS);
    expect(service.loaded('a1')).toBe(doc);
    service.closeSession(sid('app-1'));
    await settle(() => vi.getTimerCount() === 1); // the replica's port closed and the flush started the grace period
    vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1);
    expect(service.loaded('a1')).toBe(doc);
    vi.advanceTimersByTime(1);
    expect(service.loaded('a1')).toBeNull();
  });

  it('unloads at once at shutdown, leaving no timer behind', () => {
    make();
    const a = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    tick();
    a.hangUp();
    tick();
    expect(vi.getTimerCount()).toBe(1);
    service.close();
    expect(service.loaded('a1')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('DocumentService on a newer app’s store', () => {
  it('serves the doc read-only: a restating step 2 is acked, a changing update is refused with storeTooNew, writeAs rejects', async () => {
    make();
    const a = raw('a1', human);
    a.edit((doc) => doc.get('t').insert(0, 'old'));
    tick();
    service.close();
    storage.close();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    make();
    const b = raw('a1', human);
    b.send({ type: 'step1', sv: stateVector(b.doc) });
    b.send({ type: 'step2', update: diffV1(b.doc) });
    tick();
    const frames = b.take();
    expect(frames.map((frame) => frame.type)).toEqual(['step1', 'step2', 'ack']);
    const step2 = frames[1];
    if (step2.type === 'step2') applyV1(b.doc, step2.update);
    expect(b.doc.get('t').toString()).toBe('old');
    b.edit((doc) => doc.get('t').insert(3, '!'));
    expect(b.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/storeTooNew/);
    await expect(service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'x'))).rejects.toThrow(StoreTooNewError);
  });
});

describe('DocumentService: agent replicas (Decision Log 9)', () => {
  it('keys a replica by session and artifact, captures its base, and answers each save with the revision', async () => {
    make({}, true);
    const r = service.replica(sid('app-1'), 'a1');
    expect(service.replica(sid('app-1'), 'a1')).toBe(r);
    expect(service.replica(sid('app-2'), 'a1')).not.toBe(r);
    expect(service.replica(sid('app-1'), 'a2')).not.toBe(r);
    await r.whenSynced();
    r.doc.get('t').insert(0, 'abc');
    const revision = await r.whenSaved();
    expect(revision).toBe(service.revision('a1'));
    expect(committed('SELECT actor FROM artifact_updates')).toEqual([{ actor: 'session:app-1' }]);
    const base = r.captureBase();
    expect(base.revision).toBe(revision);
    expect(r.base).toBe(base);
    const copy = newDoc();
    applyV2(copy, base.state);
    expect(copy.get('t').toString()).toBe('abc');
  });

  it('closes replicas idle for 10 minutes and at the session’s end, and reconnects one the host closed, re-sending what it held', async () => {
    const adapter: KindAdapter = {
      kind: 'document',
      afterUpdate(doc) {
        if (doc.get('t').toString().includes('boom')) throw new Error('boom');
      },
    };
    make({ adapters: [adapter], kindOf: () => 'document' }, true);
    const r = service.replica(sid('app-1'), 'a1');
    const other = service.replica(sid('app-2'), 'a1');
    await Promise.all([r.whenSynced(), other.whenSynced()]);
    r.doc.get('t').insert(0, 'abc');
    await r.whenSaved();
    other.doc.get('t').insert(0, 'boom'); // evicts the doc: every connection closes
    await until(() => r.provider.state.phase === 'off');
    await expect(r.whenSaved()).rejects.toThrow(/closed/);
    r.doc.get('t').insert(3, 'def'); // made while disconnected: carried
    expect(service.replica(sid('app-1'), 'a1')).toBe(r); // reconnected
    await r.whenSaved();
    expect(service.loaded('a1')?.get('t').toString()).toContain('abcdef');

    now += 9 * 60_000;
    service.replica(sid('app-1'), 'a1'); // a call: app-1's replica is used now, app-2's is not
    now += 2 * 60_000;
    service.closeIdleReplicas();
    expect(other.closed).toBe(true);
    expect(r.closed).toBe(false);
    service.closeSession(sid('app-1'));
    expect(r.closed).toBe(true);
    expect(service.replica(sid('app-1'), 'a1')).not.toBe(r);
  });

  it('ships an edit as one update, and sends nothing of an edit that throws, re-syncing a fresh replica from the host (Decision Log 25i)', async () => {
    make({}, true);
    const r = service.replica(sid('app-1'), 'a1');
    await r.whenSynced();
    const frames = service.stats.contentFramesIn;
    r.edit((doc) => {
      doc.get('t').insert(0, 'one ');
      doc.get('t').insert(4, 'two');
      doc.get('meta').setAttr('k', 1);
    });
    await r.whenSaved();
    expect(service.stats.contentFramesIn).toBe(frames + 1);
    expect(() =>
      r.edit((doc) => {
        doc.get('t').insert(0, 'half ');
        throw new Error('invalid op');
      }),
    ).toThrow('invalid op');
    await r.whenSynced();
    expect(r.doc.get('t').toString()).toBe('one two');
    expect(service.loaded('a1')?.get('t').toString()).toBe('one two');
    r.edit((doc) => doc.get('t').insert(7, '!'));
    await r.whenSaved();
    expect(service.loaded('a1')?.get('t').toString()).toBe('one two!');
    expect(rowCount()).toBe(2);
  });

  it('relays the agent’s presence to other replicas and clears it at the turn’s end and when the replica closes (Decision Log 23d)', async () => {
    make({}, true);
    const r = service.replica(sid('app-1'), 'a1');
    const watcher = service.replica(sid('app-2'), 'a1');
    await Promise.all([r.whenSynced(), watcher.whenSynced()]);
    const presenceOf = () => watcher.provider.awareness.getStates().get(r.doc.clientID) ?? null;
    r.setPresence({ editing: { blocks: ['b1'] }, name: 'Fix the build', color: '--author-3' });
    await until(() => presenceOf() !== null);
    expect(presenceOf()).toEqual({ editing: { blocks: ['b1'] }, name: 'Fix the build', color: '--author-3' });
    service.clearPresence(sid('app-1'));
    await until(() => presenceOf() === null);
    r.setPresence({ name: 'Fix the build', color: '--author-3' });
    await until(() => presenceOf() !== null);
    service.closeSession(sid('app-1'));
    await until(() => presenceOf() === null);
  });
});

describe('DocumentService: kind adapters (Decision Log 18, 21)', () => {
  it('runs beforeApply on the raw bytes before the apply, lands its forwarding edit and afterUpdate’s write in the same commit, credited to the incoming actor through its host replica', () => {
    const calls: string[] = [];
    let seen: { incoming: Uint8Array; textBefore: string } | null = null;
    let afterSaw: Uint8Array | null = null;
    const adapter: KindAdapter = {
      kind: 'document',
      beforeApply(live, incoming, info) {
        seen = { incoming, textBefore: live.get('t').toString() };
        calls.push(`beforeApply ${info.artifactId} ${info.actor.kind} step2=${info.step2}`);
        return info.step2 ? null : (doc) => doc.get('log').insert(doc.get('log').length, 'forwarded;');
      },
      afterUpdate(doc, info) {
        afterSaw = info.update;
        calls.push(`afterUpdate ${info.artifactId} ${info.actor.kind}`);
        if (doc.get('meta').getAttr('repaired') !== true) doc.get('meta').setAttr('repaired', true);
      },
    };
    make({ adapters: [adapter], kindOf: () => 'document' });
    const watcher = raw('a1', human);
    tick();
    watcher.take();
    const a = raw('a1', agent);
    const before = stateVector(a.doc);
    a.doc.get('t').insert(0, 'abc');
    const sent = diffV1(a.doc, before);
    const commits = service.stats.commits;
    a.send({ type: 'update', update: sent });
    expect(seen).toEqual({ incoming: sent, textBefore: '' }); // the raw bytes, before they were applied
    expect(calls).toEqual(['beforeApply a1 session step2=false', 'afterUpdate a1 session']); // each told the doc's key (Decision Log 27)
    expect(contentIdsOf(afterSaw!).inserts.clients.has(a.doc.clientID)).toBe(true); // the applied update
    expect(watcher.received).toEqual([]); // nothing revealed before the commit
    expect(rowCount()).toBe(0);
    tick();
    expect(service.stats.commits).toBe(commits + 1); // one commit for the update, the forwarding edit and the repair
    expect(watcher.take().map((frame) => frame.type)).toEqual(['update', 'update', 'update']); // revealed together
    expect(a.take().map((frame) => frame.type)).toEqual(['step1', 'update', 'update', 'ack']); // the sender gets the hooks' writes
    expect(committed('SELECT actor FROM artifact_updates ORDER BY seq')).toEqual([{ actor: 'session:app-1' }, { actor: 'session:app-1' }, { actor: 'session:app-1' }]);
    const [hostClient] = committed('SELECT clientId, actor FROM client_actors WHERE host = 1') as { clientId: number; actor: string }[];
    expect(hostClient.actor).toBe('session:app-1');
    const live = service.loaded('a1')!;
    expect(live.get('log').toString()).toBe('forwarded;');
    expect(live.get('meta').getAttr('repaired')).toBe(true);
    const forwarded = idAt(live.get('log'), 0)!;
    expect(forwarded.client).toBe(hostClient.clientId);
    expect(insertedBy(service.provenance('a1'), forwarded)?.actor).toBe('session:app-1');

    // a step 2 tells the hook so; a restatement integrates nothing, so no afterUpdate
    calls.length = 0;
    a.send({ type: 'step2', update: diffV1(a.doc) });
    expect(calls).toEqual(['beforeApply a1 session step2=true']);
  });

  it('rejects the frame when beforeApply throws: nothing applied, nothing written, the doc and the others go on', () => {
    let throwNext = false;
    const adapter: KindAdapter = {
      kind: 'document',
      beforeApply() {
        if (throwNext) throw new Error('refused by the kind');
        return null;
      },
    };
    make({ adapters: [adapter], kindOf: () => 'document' });
    const watcher = raw('a1', human);
    const a = raw('a1', agent);
    tick();
    watcher.take();
    throwNext = true;
    a.edit((doc) => doc.get('t').insert(0, 'abc'));
    expect(a.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toMatch(/beforeApply threw: refused by the kind/);
    tick();
    expect(watcher.received).toEqual([]);
    expect(watcher.closed).toBe(false);
    expect(service.loaded('a1')?.get('t').toString()).toBe('');
    expect(rowCount()).toBe(0);
    throwNext = false;
    watcher.edit((doc) => doc.get('t').insert(0, 'fine'));
    tick();
    expect(rowCount()).toBe(1);
  });

  it.each(['forwarding edit', 'afterUpdate'])('evicts the doc when the %s throws after the apply: that frame’s rows are taken back and nothing of it is sent', (where) => {
    const boom = (doc: Doc) => {
      if (doc.get('t').toString().includes('boom')) throw new Error(`${where} failed`);
    };
    const adapter: KindAdapter = where === 'afterUpdate' ? { kind: 'document', afterUpdate: boom } : { kind: 'document', beforeApply: () => boom };
    make({ adapters: [adapter], kindOf: () => 'document' });
    const watcher = raw('a1', human);
    const a = raw('a1', agent);
    a.edit((doc) => doc.get('t').insert(0, 'fine '));
    tick();
    watcher.take();
    watcher.edit((doc) => doc.get('notes').insert(0, 'kept')); // an earlier frame of the same batch
    a.edit((doc) => doc.get('t').insert(5, 'boom'));
    expect(a.closed && watcher.closed).toBe(true);
    expect(logs.join('\n')).toMatch(new RegExp(`evicted a1: ${where} failed`));
    tick();
    expect(watcher.received).toEqual([]);
    expect(rowCount()).toBe(2); // "fine " and "kept"; "boom" was never committed
    raw('a1', human); // a re-attach reloads the doc from the store
    const live = service.loaded('a1')!;
    expect(live.get('t').toString()).toBe('fine ');
    expect(live.get('notes').toString()).toBe('kept');
  });
});

describe('DocumentService: what the hooks return (Decision Log 23c, 25j)', () => {
  const thread = (threadId: string, status: 'open' | 'resolved') => ({ threadId, status, quote: 'q', createdAt: 1, updatedAt: 2 });

  it('writes afterUpdate’s thread rows in the update’s commit, and carries a move’s authorship into the update’s attribution row', () => {
    let pending: { from: [number, number][]; to: [number, number][] } | null = null; // the move the next update makes
    let moved: { from: [number, number][]; to: [number, number][] } | null = null;
    const adapter: KindAdapter = {
      kind: 'document',
      afterUpdate(doc, info) {
        const ids = contentIdsOf(info.update);
        if (moved || ids.deletes.isEmpty()) return { threads: { upsert: [thread('t1', 'open')] } };
        // the update deleted "ab" and re-inserted it: report the move (the test knows the ids)
        moved = pending!;
        return { threads: { upsert: [thread('t1', 'resolved')], remove: ['t0'] }, provenance: [{ kind: 'move', ...moved }] };
      },
    };
    make({ adapters: [adapter], kindOf: () => 'document' });
    storage.writeThreads('a1', { upsert: [thread('t0', 'open')] });
    storage.commit();
    const a = raw('a1', agent);
    const h = raw('a1', human);
    tick();
    a.edit((doc) => doc.get('t').insert(0, 'ab'));
    tick();
    expect(committed('SELECT threadId, status FROM artifact_threads ORDER BY threadId')).toEqual([
      { threadId: 't0', status: 'open' },
      { threadId: 't1', status: 'open' },
    ]);
    applyV1(h.doc, diffV1(service.loaded('a1')!));
    const text = h.doc.get('t');
    const from: [number, number][] = [0, 1].map((i) => [idAt(text, i)!.client, idAt(text, i)!.clock]);
    h.doc.transact(() => {
      text.delete(0, 2);
      text.insert(0, 'x');
      text.insert(1, 'ab');
    });
    pending = { from, to: [1, 2].map((i) => [idAt(text, i)!.client, idAt(text, i)!.clock]) };
    const commits = service.stats.commits;
    h.send({ type: 'update', update: diffV1(h.doc, stateVector(service.loaded('a1')!)) });
    tick();
    expect(service.stats.commits).toBe(commits + 1);
    expect(committed('SELECT threadId, status FROM artifact_threads ORDER BY threadId')).toEqual([{ threadId: 't1', status: 'resolved' }]);
    const map = mergeMaps((committed('SELECT bytes FROM artifact_attributions ORDER BY fromSeq') as { bytes: Uint8Array }[]).map((row) => decodeMap(row.bytes)));
    const [b1, b2] = pending.to.map(([client, clock]) => ({ client, clock }));
    expect(insertedBy(map, b1)?.actor).toBe('session:app-1'); // the mover is credited with no characters
    expect(carriedBy(map, b2)).toBe('move');
    expect(insertedBy(map, idAt(text, 0)!)?.actor).toBe('human');
    expect(insertedBy(service.provenance('a1'), b1)?.actor).toBe('session:app-1'); // the cache agrees
  });

  it('carries authorship into every row of a frame: the forwarded edit’s and the repair’s, in seq order against the rows before them (Decision Log 29a)', () => {
    const ids = (text: Node, from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => idAt(text, from + i)!).map(({ client, clock }) => [client, clock] as [number, number]);
    let humanText: [number, number][] = []; // the ids of the human's "hello", which the hooks copy
    const adapter: KindAdapter = {
      kind: 'document',
      // the agent's keystroke landed in a block the human's text was moved out of: the hook replays "he" where it lives now
      beforeApply: (_live, _incoming, info) => (info.actor.kind === 'session' && !info.step2 ? (doc) => doc.get('fwd').insert(0, 'he') : null),
      afterUpdate(doc, info) {
        if (info.actor.kind !== 'session') return;
        doc.get('rep').insert(0, 'hello'); // a repair copying the forwarded "he" and the human's "llo"
        const fwd = ids(doc.get('fwd'), 0, 2);
        const rep = ids(doc.get('rep'), 0, 5);
        return {
          provenance: [
            { kind: 'move', from: humanText.slice(0, 2), to: fwd }, // the forwarding row: from rows of earlier frames
            { kind: 'retype', from: [...fwd, ...humanText.slice(2)], to: rep }, // the repair row: "he" from the forwarding row of this frame
          ],
        };
      },
    };
    make({ adapters: [adapter], kindOf: () => 'document' });
    const h = raw('a1', human);
    h.edit((doc) => doc.get('t').insert(0, 'hello'));
    tick();
    humanText = ids(h.doc.get('t'), 0, 5);
    const humanAt = now - (now % MIN);
    now += 7 * MIN;
    const a = raw('a1', agent);
    applyV1(a.doc, diffV1(h.doc, stateVector(a.doc))); // the agent has the human's text, so its "X" lands before it
    a.edit((doc) => doc.get('t').insert(0, 'X'));
    tick();

    const live = service.loaded('a1')!;
    expect([live.get('t').toString(), live.get('fwd').toString(), live.get('rep').toString()]).toEqual(['Xhello', 'he', 'hello']);
    const seqs = (committed("SELECT seq FROM artifact_updates WHERE artifactId = 'a1' ORDER BY seq") as { seq: number }[]).map((row) => row.seq);
    expect(seqs).toHaveLength(4); // the human's row, then the frame's three: its own update, the forwarding, the repair
    const rows = committed("SELECT fromSeq, bytes FROM artifact_attributions WHERE artifactId = 'a1' ORDER BY fromSeq") as { fromSeq: number; bytes: Uint8Array }[];
    expect(rows.map((row) => row.fromSeq)).toEqual(seqs); // one attribution row per log row
    const [, own, forwarded, repaired] = rows.map((row) => decodeMap(row.bytes));
    const at = (id: [number, number]) => ({ client: id[0], clock: id[1] });
    const agentAt = now - (now % MIN);
    expect(insertedBy(own, idAt(live.get('t'), 0)!)).toEqual({ actor: 'session:app-1', at: agentAt }); // no carry: as before
    const fwd = ids(live.get('fwd'), 0, 2).map(at);
    const rep = ids(live.get('rep'), 0, 5).map(at);
    for (const id of fwd) expect([insertedBy(forwarded, id), carriedBy(forwarded, id)]).toEqual([{ actor: 'human', at: humanAt }, 'move']);
    for (const id of rep) expect([insertedBy(repaired, id), carriedBy(repaired, id)]).toEqual([{ actor: 'human', at: humanAt }, 'retype']);

    const answer = (map: ReturnType<typeof service.provenance>) => [...fwd, ...rep].map((id) => insertedBy(map, id)?.actor);
    const everyHuman = Array.from({ length: 7 }, () => 'human');
    expect(answer(service.provenance('a1'))).toEqual(everyHuman); // the cache agrees
    reopen();
    expect(answer(service.provenance('a1'))).toEqual(everyHuman); // and so does a reload
  });

  it('runs writeAs’s afterWrite and inFrame inside the write’s savepoint: one commit, and a throw takes the write back', async () => {
    make({}, true);
    const revision = await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'restored'), {
      afterWrite: (doc) => {
        doc.get('meta').setAttr('orphans', 1);
        return { threads: { upsert: [thread('t1', 'open')] } };
      },
      inFrame: (at) => storage.db.prepare("INSERT INTO meta (key, value) VALUES ('seen', ?)").run(String(at)),
    });
    expect(committed("SELECT value FROM meta WHERE key = 'seen'")).toEqual([{ value: String(revision) }]);
    expect(committed('SELECT actor FROM artifact_updates ORDER BY seq')).toEqual([{ actor: 'human' }, { actor: 'human' }]);
    expect(committed('SELECT threadId FROM artifact_threads')).toEqual([{ threadId: 't1' }]);
    await expect(
      service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'lost'), {
        inFrame: () => {
          throw new Error('the version could not be written');
        },
      }),
    ).rejects.toThrow(/version could not be written/);
    expect(rowCount()).toBe(2);
    expect(service.readState('a1').revision).toBe(revision);
  });

  it('commits rows written through inBatch with the turn’s batch, answers after the commit, and takes them back on a throw', async () => {
    make();
    const answer = service.inBatch(() => {
      storage.db.prepare("INSERT INTO meta (key, value) VALUES ('k', 'v')").run();
      return 'done';
    });
    let settled = false;
    void answer.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(committed('SELECT value FROM meta')).toEqual([]);
    tick();
    expect(await answer).toBe('done');
    expect(committed('SELECT value FROM meta')).toEqual([{ value: 'v' }]);
    await expect(
      service.inBatch(() => {
        storage.db.prepare("INSERT INTO meta (key, value) VALUES ('k2', 'v')").run();
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    tick();
    expect(committed('SELECT key FROM meta')).toEqual([{ key: 'k' }]);
  });

  it('reads a doc’s state without opening it, and rewrites a requested head after the next commit', async () => {
    make({ idleUnloadMs: 0 }, true);
    const revision = await service.writeAs('a1', human, (doc) => doc.get('t').insert(0, 'hello'));
    await until(() => service.loaded('a1') === null);
    const { revision: at, state } = service.readState('a1');
    expect(at).toBe(revision);
    expect(service.loaded('a1')).toBeNull();
    const doc = newDoc();
    applyV2(doc, state);
    expect(doc.get('t').toString()).toBe('hello');
    service.requestHead('a1');
    await until(() => committed('SELECT seq FROM artifact_head').length === 1);
    expect(committed('SELECT seq FROM artifact_head')).toEqual([{ seq: revision }]);
  });
});

