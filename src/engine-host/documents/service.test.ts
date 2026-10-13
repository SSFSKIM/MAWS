import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KindAdapter } from '@artifacts/host';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { applyV1, applyV2, checkUpdate, contentIdsOf, decodeMap, deletedBy, diffV1, idAt, insertedBy, mergeMaps, newDoc, stateVector, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { HostPort } from './ports';
import { DocumentService, type ServiceOptions } from './service';
import { SqliteDocumentStorage, StoreTooNewError } from './storage';

// The real check, made skippable once: the pending-state case needs an update the check would refuse to get through.
vi.mock('@artifacts/yjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@artifacts/yjs')>();
  return { ...real, checkUpdate: vi.fn(real.checkUpdate) };
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' };

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
  };
  const port: HostPort = {
    send: (frame) => end.received.push(decodeFrame(frame)),
    close: () => void (end.closed = true),
    onMessage: (listener) => void (onMessage = listener),
    onClose: () => {},
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
    const a = service.replica('app-a', 'a1');
    const b = service.replica('app-b', 'a1');
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
    const c = service.replica('app-c', 'a1');
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

  it('reports each commit through onCommitted with the artifact’s revision', () => {
    make();
    const seen: { artifactId: string; revision: number }[] = [];
    service.onCommitted((change) => seen.push(change));
    const a = raw('a1', human);
    const b = raw('a2', human);
    a.edit((doc) => doc.get('t').insert(0, 'x'));
    a.edit((doc) => doc.get('t').insert(1, 'y'));
    b.edit((doc) => doc.get('t').insert(0, 'z'));
    expect(seen).toEqual([]);
    tick();
    expect(seen).toEqual([
      { artifactId: 'a1', revision: service.revision('a1') },
      { artifactId: 'a2', revision: service.revision('a2') },
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
    expect(service.loaded('a1')).toBeNull(); // nobody holds it: unloaded after the flush
    expect(rowCount()).toBe(0);
    raw('a1', human);
    expect(service.loaded('a1')?.get('t').toString()).toBe('');
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
    expect(storage.pruneLog(now)).toBe(2); // the log is gone; provenance is not
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
    const watcher = service.replica('app-9', 'a1');
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
    const reader = service.replica('app-9', 'a1');
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
    const reader = service.replica('app-9', 'a1');
    await reader.whenSynced();
    expect(reader.doc.get('t').toString()).toBe('kept');
    expect(rowCount()).toBe(1);
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
    const r = service.replica('app-1', 'a1');
    expect(service.replica('app-1', 'a1')).toBe(r);
    expect(service.replica('app-2', 'a1')).not.toBe(r);
    expect(service.replica('app-1', 'a2')).not.toBe(r);
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
    const r = service.replica('app-1', 'a1');
    const other = service.replica('app-2', 'a1');
    await Promise.all([r.whenSynced(), other.whenSynced()]);
    r.doc.get('t').insert(0, 'abc');
    await r.whenSaved();
    other.doc.get('t').insert(0, 'boom'); // evicts the doc: every connection closes
    await until(() => r.provider.state.phase === 'off');
    await expect(r.whenSaved()).rejects.toThrow(/closed/);
    r.doc.get('t').insert(3, 'def'); // made while disconnected: carried
    expect(service.replica('app-1', 'a1')).toBe(r); // reconnected
    await r.whenSaved();
    expect(service.loaded('a1')?.get('t').toString()).toContain('abcdef');

    now += 9 * 60_000;
    service.replica('app-1', 'a1'); // a call: app-1's replica is used now, app-2's is not
    now += 2 * 60_000;
    service.closeIdleReplicas();
    expect(other.closed).toBe(true);
    expect(r.closed).toBe(false);
    service.closeSession('app-1');
    expect(r.closed).toBe(true);
    expect(service.replica('app-1', 'a1')).not.toBe(r);
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
        calls.push(`beforeApply ${info.actor.kind} step2=${info.step2}`);
        return info.step2 ? null : (doc) => doc.get('log').insert(doc.get('log').length, 'forwarded;');
      },
      afterUpdate(doc, info) {
        afterSaw = info.update;
        calls.push(`afterUpdate ${info.actor.kind}`);
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
    expect(calls).toEqual(['beforeApply session step2=false', 'afterUpdate session']);
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
    expect(calls).toEqual(['beforeApply session step2=true']);
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

