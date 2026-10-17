// P3-H: the connector grants in the host's artifact store (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and
// Decision Log 24 and 80; the P3 interface ledger's X23 grant rows): per artifact and per tool, beside the artifact,
// durable, gone with the artifact, never carried by a copy or a version, and one-use grants consumed at most once.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { ConnectorGrantChange, ConnectorGrantRequest } from '@shared/artifacts/connectors';
import { ArtifactStoreError, StoreTooNewError } from './errors';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

const human: Actor = { kind: 'human' };
const rows: ConnectorGrantRequest = { server: 'fixture', tool: 'rows', fingerprint: 'fp-1', mode: 'read' };
const send: ConnectorGrantRequest = { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1', mode: 'once' };
const page = (text: string) => ({ bytes: new TextEncoder().encode(text) });

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;
let turns: (() => void)[] | null; // the service's deferred commits when a test drives them (`manual`), else null
let changes: ConnectorGrantChange[];

function make(options: { manual?: boolean } = {}): void {
  turns = options.manual ? [] : null;
  const defer = turns ? (run: () => void) => turns!.push(run) : undefined;
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: () => {}, kindOf: (id) => storage.kindOf(id), defer });
  store = new ArtifactStore(service, storage, { root: dir, now: () => now, log: () => {} });
  changes = [];
  store.onConnectorGrantChange((change) => changes.push(change));
}
function reopen(options: { manual?: boolean } = {}): void {
  store.close();
  service.close();
  storage.close();
  make(options);
}
// Runs the commits a manual store deferred.
const tick = () => {
  while (turns && turns.length > 0) turns.shift()!();
};
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
// What the file holds, through a connection of its own: only committed rows.
const committed = (sql: string, ...params: string[]) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const grantsInFile = (artifactId: string) => committed('SELECT server, tool, fingerprint, mode FROM artifact_connector_grants WHERE artifactId = ? ORDER BY server, tool', artifactId);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-grants-'));
  now = Date.UTC(2026, 9, 16, 9, 0);
  make();
});
afterEach(() => {
  vi.restoreAllMocks();
  store?.close();
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ArtifactStore: connector grants (P3-H)', () => {
  it('grants per artifact and per tool, lists them authoritatively, re-grants in place and revokes one tool alone', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    const b = await store.create({ kind: 'html', title: 'Other page', content: page('<p>b</p>') }, human);
    expect(await store.connectorGrants(a.id)).toEqual([]);

    expect(await store.grantConnectorTool(a.id, rows)).toEqual({ ...rows, grantedAt: now });
    now += 1_000;
    await store.grantConnectorTool(a.id, send);
    expect(await store.connectorGrants(a.id)).toEqual([
      { ...rows, grantedAt: now - 1_000 },
      { ...send, grantedAt: now },
    ]);
    expect(await store.connectorGrants(b.id)).toEqual([]); // per artifact

    now += 1_000;
    const regranted = await store.grantConnectorTool(a.id, { ...rows, fingerprint: 'fp-2' });
    expect(regranted).toEqual({ ...rows, fingerprint: 'fp-2', grantedAt: now });
    expect((await store.connectorGrants(a.id)).filter((grant) => grant.tool === 'rows')).toEqual([regranted]);

    expect(await store.revokeConnectorTool(a.id, { server: 'fixture', tool: 'rows' })).toBe(true);
    expect(await store.revokeConnectorTool(a.id, { server: 'fixture', tool: 'rows' })).toBe(false); // nothing left to revoke
    expect((await store.connectorGrants(a.id)).map((grant) => grant.tool)).toEqual(['send_document']);
    expect(changes).toEqual([
      { artifactId: a.id, server: 'fixture', tool: 'rows', change: 'granted' },
      { artifactId: a.id, server: 'fixture', tool: 'send_document', change: 'granted' },
      { artifactId: a.id, server: 'fixture', tool: 'rows', change: 'granted' },
      { artifactId: a.id, server: 'fixture', tool: 'rows', change: 'revoked' },
    ]);
  });

  it('is no content change: a grant moves no revision, writes no version and announces no artifact change', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    const announced: unknown[] = [];
    store.onChange((change) => announced.push(change));
    const before = { revision: store.revision(a.id), versions: store.listVersions(a.id).length, updatedAt: store.get(a.id)!.updatedAt };
    now += 60_000;
    await store.grantConnectorTool(a.id, rows);
    await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' });
    await store.grantConnectorTool(a.id, send);
    await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' });
    await store.revokeConnectorTool(a.id, { server: 'fixture', tool: 'rows' });
    await settle();
    expect({ revision: store.revision(a.id), versions: store.listVersions(a.id).length, updatedAt: store.get(a.id)!.updatedAt }).toEqual(before);
    expect(announced).toEqual([]);
  });

  it('announces a grant change only once it has committed', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const seen: { change: string; inFile: number }[] = [];
    store.onConnectorGrantChange((change) => seen.push({ change: change.change, inFile: grantsInFile(a.id).length }));

    const granting = store.grantConnectorTool(a.id, rows);
    await settle();
    expect(seen).toEqual([]);
    expect(grantsInFile(a.id)).toEqual([]);
    tick();
    await granting;
    const revoking = store.revokeConnectorTool(a.id, rows);
    await settle();
    expect(seen).toEqual([{ change: 'granted', inFile: 1 }]);
    tick();
    await revoking;
    expect(seen).toEqual([
      { change: 'granted', inFile: 1 },
      { change: 'revoked', inFile: 0 },
    ]);
  });

  it('keeps grants across a restart, a one-use grant until its use and that use for good', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    reopen();
    expect((await store.connectorGrants(a.id)).map(({ tool, mode }) => ({ tool, mode }))).toEqual([
      { tool: 'rows', mode: 'read' },
      { tool: 'send_document', mode: 'once' },
    ]);
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' })).toEqual({ granted: true, mode: 'once' });
    reopen();
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' })).toEqual({ granted: false, refusal: 'notGranted' });
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).toEqual({ granted: true, mode: 'read' });
  });

  it('authorizes a read grant on every call and a one-use grant once, the use consumed and announced', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    const call = (tool: string) => store.authorizeConnectorCall(a.id, { server: 'fixture', tool, fingerprint: 'fp-1' });
    for (let i = 0; i < 3; i++) expect(await call('rows')).toEqual({ granted: true, mode: 'read' });
    expect(await call('send_document')).toEqual({ granted: true, mode: 'once' });
    expect(grantsInFile(a.id).map((grant) => grant.tool)).toEqual(['rows']); // the consumption is durable before the answer
    expect(await call('send_document')).toEqual({ granted: false, refusal: 'notGranted' });
    expect(await call('search')).toEqual({ granted: false, refusal: 'notGranted' });
    expect(changes.at(-1)).toEqual({ artifactId: a.id, server: 'fixture', tool: 'send_document', change: 'consumed' });
  });

  it('checks a call without consuming anything (main’s check before routing), answering as the authorization would', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    changes.length = 0;
    const once = { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' };
    for (let i = 0; i < 3; i++) expect(await store.checkConnectorCall(a.id, once)).toEqual({ granted: true, mode: 'once' });
    expect(await store.checkConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).toEqual({ granted: true, mode: 'read' });
    expect(await store.checkConnectorCall(a.id, { ...once, fingerprint: 'fp-2' })).toEqual({ granted: false, refusal: 'fingerprintChanged' });
    expect(await store.checkConnectorCall(a.id, { server: 'fixture', tool: 'search', fingerprint: 'fp-1' })).toEqual({ granted: false, refusal: 'notGranted' });
    expect(grantsInFile(a.id)).toHaveLength(2);
    expect(changes).toEqual([]);
    // the host's authorization just before the write is the one use
    expect(await store.authorizeConnectorCall(a.id, once)).toEqual({ granted: true, mode: 'once' });
    expect(await store.checkConnectorCall(a.id, once)).toEqual({ granted: false, refusal: 'notGranted' });
  });

  it('refuses a call whose tool fingerprint no longer matches, neither consuming nor dropping the grant, until the owner re-grants', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-2' })).toEqual({ granted: false, refusal: 'fingerprintChanged' });
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-2' })).toEqual({ granted: false, refusal: 'fingerprintChanged' });
    expect((await store.connectorGrants(a.id)).map((grant) => grant.fingerprint)).toEqual(['fp-1', 'fp-1']);
    await store.grantConnectorTool(a.id, { ...rows, fingerprint: 'fp-2' });
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-2' })).toEqual({ granted: true, mode: 'read' });
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).toEqual({ granted: false, refusal: 'fingerprintChanged' });
    expect(await store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' })).toEqual({ granted: true, mode: 'once' }); // still there
  });

  it('lets one of many concurrent uses of a one-use grant through, the rest refused only once that use has committed', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = store.grantConnectorTool(a.id, send);
    tick();
    await granting;

    const call = { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' };
    let settled = 0;
    const uses = [1, 2, 3, 4].map(() => store.authorizeConnectorCall(a.id, call).finally(() => (settled += 1)));
    await settle();
    expect(settled).toBe(0); // the refusals read the consuming batch and wait for its commit
    expect(grantsInFile(a.id)).toHaveLength(1);
    tick();
    const answers = await Promise.all(uses);
    expect(answers.filter((answer) => answer.granted)).toEqual([{ granted: true, mode: 'once' }]);
    expect(answers.filter((answer) => !answer.granted)).toEqual(Array(3).fill({ granted: false, refusal: 'notGranted' }));
    expect(grantsInFile(a.id)).toEqual([]);
    expect(changes.filter((change) => change.change === 'consumed')).toHaveLength(1);
  });

  it('fails every use when the consuming batch is lost, leaving the one-use grant unconsumed for the next', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = store.grantConnectorTool(a.id, send);
    tick();
    await granting;
    changes.length = 0;

    const call = { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' };
    const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const uses = Promise.allSettled([store.authorizeConnectorCall(a.id, call), store.authorizeConnectorCall(a.id, call)]);
    await settle();
    tick();
    expect((await uses).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    commit.mockRestore();
    expect(changes).toEqual([]);
    expect(grantsInFile(a.id)).toHaveLength(1);
    const again = store.authorizeConnectorCall(a.id, call);
    tick();
    expect(await again).toEqual({ granted: true, mode: 'once' });
  });

  it('refuses a call behind a revocation still committing, and at once after it', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = Promise.all([store.grantConnectorTool(a.id, rows), store.grantConnectorTool(a.id, send)]);
    tick();
    await granting;

    const revoking = Promise.all([store.revokeConnectorTool(a.id, rows), store.revokeConnectorTool(a.id, send)]);
    const reads = store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' });
    const use = store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' });
    tick();
    expect(await revoking).toEqual([true, true]);
    expect(await reads).toEqual({ granted: false, refusal: 'notGranted' });
    expect(await use).toEqual({ granted: false, refusal: 'notGranted' });
    expect(grantsInFile(a.id)).toEqual([]);
  });

  it('answers a read authorization only once the grant it saw has committed, and fails it with that commit', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const granting = store.grantConnectorTool(a.id, rows);
    const reading = store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' });
    const outcomes = Promise.allSettled([granting, reading]);
    await settle();
    tick();
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    commit.mockRestore();
    expect(changes).toEqual([]);
    const after = store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' });
    tick();
    expect(await after).toEqual({ granted: false, refusal: 'notGranted' });
  });

  it('deletes the grants with the artifact, in its delete’s own transaction, announcing each as revoked', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    const b = await store.create({ kind: 'html', title: 'Other page', content: page('<p>b</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    await store.grantConnectorTool(b.id, rows);
    changes.length = 0;

    const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(store.delete(a.id)).rejects.toThrow();
    commit.mockRestore();
    expect(store.get(a.id)).not.toBeNull(); // the delete was lost whole: the artifact and its grants stay
    expect(grantsInFile(a.id)).toHaveLength(2);
    expect(changes).toEqual([]);

    await store.delete(a.id);
    expect(grantsInFile(a.id)).toEqual([]);
    expect(grantsInFile(b.id)).toHaveLength(1);
    expect(changes).toEqual([
      { artifactId: a.id, server: 'fixture', tool: 'rows', change: 'revoked' },
      { artifactId: a.id, server: 'fixture', tool: 'send_document', change: 'revoked' },
    ]);
    await expect(store.connectorGrants(a.id)).rejects.toMatchObject({ code: 'notFound' });
    await expect(store.grantConnectorTool(a.id, rows)).rejects.toMatchObject({ code: 'notFound' });
    await expect(store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).rejects.toMatchObject({ code: 'notFound' });
    await expect(store.checkConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).rejects.toMatchObject({ code: 'notFound' });
    await expect(store.revokeConnectorTool(a.id, rows)).rejects.toMatchObject({ code: 'notFound' });
    reopen();
    expect(grantsInFile(a.id)).toEqual([]);
  });

  it('never carries a grant into a copy, and a version restore never brings a revoked one back', async () => {
    const doc = await store.create({ kind: 'document', title: 'Dashboard' }, human);
    await service.writeAs(doc.id, human, (d) => d.get('root').insert(0, 'first'));
    await store.grantConnectorTool(doc.id, rows);
    const v1 = (await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'granted' }))!;
    const live = await store.duplicate(doc.id, {}, human);
    const old = await store.duplicate(doc.id, { versionId: v1 }, human);
    expect(await store.connectorGrants(live.id)).toEqual([]);
    expect(await store.connectorGrants(old.id)).toEqual([]);

    const pageArtifact = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(pageArtifact.id, rows);
    expect(await store.connectorGrants((await store.duplicate(pageArtifact.id, {}, human)).id)).toEqual([]);

    await store.revokeConnectorTool(doc.id, rows);
    await service.writeAs(doc.id, human, (d) => d.get('root').insert(5, ' second'));
    await store.restore(doc.id, v1, human);
    expect(await store.connectorGrants(doc.id)).toEqual([]);
    expect(await store.authorizeConnectorCall(doc.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).toEqual({ granted: false, refusal: 'notGranted' });
  });

  it('refuses an invalid request with `invalid`, writing nothing', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    const bad = [{ ...rows, mode: 'write' }, { ...rows, server: '' }, { ...rows, fingerprint: '' }, { server: 'fixture', tool: 'rows' }] as unknown as ConnectorGrantRequest[];
    for (const request of bad) await expect(store.grantConnectorTool(a.id, request)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.revokeConnectorTool(a.id, { server: 'fixture', tool: '' })).rejects.toBeInstanceOf(ArtifactStoreError);
    await expect(store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows' } as never)).rejects.toMatchObject({ code: 'invalid' });
    expect(grantsInFile(a.id)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('on a store a newer MAWS wrote, lists the grants but refuses to grant, revoke or authorize a call', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    store.close();
    service.close();
    storage.close();
    const newer = new DatabaseSync(join(dir, 'store.sqlite'));
    newer.exec('PRAGMA user_version = 99');
    newer.close();
    make();
    expect(storage.readOnly).toBe(true);
    expect((await store.connectorGrants(a.id)).map((grant) => grant.tool)).toEqual(['rows', 'send_document']);
    await expect(store.grantConnectorTool(a.id, { ...rows, tool: 'search' })).rejects.toBeInstanceOf(StoreTooNewError);
    await expect(store.revokeConnectorTool(a.id, rows)).rejects.toBeInstanceOf(StoreTooNewError);
    // fail closed: a newer app's grant rows may mean more than this app reads, so none authorizes here
    await expect(store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).rejects.toBeInstanceOf(StoreTooNewError);
    await expect(store.authorizeConnectorCall(a.id, { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' })).rejects.toBeInstanceOf(StoreTooNewError);
    await expect(store.checkConnectorCall(a.id, { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' })).rejects.toBeInstanceOf(StoreTooNewError);
    expect(grantsInFile(a.id)).toHaveLength(2);
    expect(changes).toEqual([]);
  });
});

// P3-H H3b: the host's last word before it writes mcp_call. An authorization answers a snapshot across its commit
// barrier, so it alone is no fence: a revoke, a delete or a re-grant may land between it and the write. The fence is
// taken before the authorization and held synchronously at the write.
describe('ArtifactStore: the connector dispatch fence (P3-H H3b)', () => {
  const rowsCall = { server: 'fixture', tool: 'rows', fingerprint: 'fp-1' };
  const sendCall = { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1' };
  const ROWS = { server: 'fixture', tool: 'rows' };
  const SEND = { server: 'fixture', tool: 'send_document' };

  it('authorizes only the mode the caller expects, consuming no Allow once for a read and no read for a once', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, { ...rows, mode: 'once' }); // the read grant swapped to Allow once
    changes.length = 0;
    expect(await store.authorizeConnectorCall(a.id, rowsCall, 'read')).toEqual({ granted: false, refusal: 'wrongMode' });
    expect(grantsInFile(a.id)).toEqual([{ server: 'fixture', tool: 'rows', fingerprint: 'fp-1', mode: 'once' }]); // not consumed
    expect(changes).toEqual([]);
    await store.grantConnectorTool(a.id, { ...send, mode: 'read' });
    expect(await store.authorizeConnectorCall(a.id, sendCall, 'once')).toEqual({ granted: false, refusal: 'wrongMode' });
    // the fingerprint is compared before the mode, and neither consumes
    expect(await store.authorizeConnectorCall(a.id, { ...rowsCall, fingerprint: 'fp-2' }, 'once')).toEqual({ granted: false, refusal: 'fingerprintChanged' });
    expect(await store.authorizeConnectorCall(a.id, rowsCall, 'once')).toEqual({ granted: true, mode: 'once' });
    expect(grantsInFile(a.id).map((grant) => grant.tool)).toEqual(['send_document']);
  });

  it('holds a read call’s fence while nothing changed, and an Allow once’s after its own consumption', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    const readFence = store.connectorFence(a.id, rowsCall, 'read');
    expect(await store.authorizeConnectorCall(a.id, rowsCall, 'read')).toEqual({ granted: true, mode: 'read' });
    expect(store.connectorFenceHolds(readFence, rowsCall, 'read')).toBe('held');
    const onceFence = store.connectorFence(a.id, sendCall, 'once');
    expect(await store.authorizeConnectorCall(a.id, sendCall, 'once')).toEqual({ granted: true, mode: 'once' });
    expect(store.connectorFenceHolds(onceFence, sendCall, 'once')).toBe('held');
  });

  it('authorize → revoke while its batch is pending → commit: the fence refuses the write', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = Promise.all([store.grantConnectorTool(a.id, rows), store.grantConnectorTool(a.id, send)]);
    tick();
    await granting;

    const fence = store.connectorFence(a.id, rowsCall, 'read');
    const authorizing = store.authorizeConnectorCall(a.id, rowsCall, 'read'); // reads the grant now, answers at the commit
    const revoking = store.revokeConnectorTool(a.id, ROWS); // joins the batch the authorization waits for
    tick();
    expect(await authorizing).toEqual({ granted: true, mode: 'read' }); // the stale snapshot
    expect(await revoking).toBe(true);
    expect(store.connectorFenceHolds(fence, rowsCall, 'read')).toBe('revoked');

    // the same for an Allow once already consumed: its row is gone either way, the revoke is what the fence sees
    const onceFence = store.connectorFence(a.id, sendCall, 'once');
    const using = store.authorizeConnectorCall(a.id, sendCall, 'once');
    tick();
    expect(await using).toEqual({ granted: true, mode: 'once' });
    const revokingOnce = store.revokeConnectorTool(a.id, SEND);
    tick();
    expect(await revokingOnce).toBe(false); // nothing left to remove
    expect(store.connectorFenceHolds(onceFence, sendCall, 'once')).toBe('revoked');
  });

  it('refuses at the fence once the artifact is deleted, even before the delete commits', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = store.grantConnectorTool(a.id, rows);
    tick();
    await granting;
    const fence = store.connectorFence(a.id, rowsCall, 'read');
    const authorizing = store.authorizeConnectorCall(a.id, rowsCall, 'read');
    tick();
    expect(await authorizing).toEqual({ granted: true, mode: 'read' });
    const deleting = store.delete(a.id);
    expect(store.connectorFenceHolds(fence, rowsCall, 'read')).toBe('revoked'); // the delete's rows, not yet committed
    tick();
    await deleting;
    expect(store.connectorFenceHolds(fence, rowsCall, 'read')).toBe('revoked');
  });

  it('refuses a read call whose grant had been replaced when its fence was taken: another fingerprint, or Allow once', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, { ...rows, fingerprint: 'fp-2' });
    expect(store.connectorFenceHolds(store.connectorFence(a.id, rowsCall, 'read'), rowsCall, 'read')).toBe('fingerprintChanged');
    await store.grantConnectorTool(a.id, { ...rows, mode: 'once' });
    expect(store.connectorFenceHolds(store.connectorFence(a.id, rowsCall, 'read'), rowsCall, 'read')).toBe('wrongMode');
  });

  // A re-grant replaces the tool's grant whole. One that changes the authority a fence was taken for (the call's
  // fingerprint, the mode its check admitted) withdraws that authority as a revoke would, whether or not the old row is
  // still there to compare: an Allow once's own consumption took its row before the call was written.
  for (const [what, held, heldMode, replacement] of [
    ['a read grant replaced by Allow once', rowsCall, 'read', { ...rows, mode: 'once' }],
    ['a read grant replaced under another fingerprint', rowsCall, 'read', { ...rows, fingerprint: 'fp-2' }],
    ['an Allow once, used, re-granted under another fingerprint', sendCall, 'once', { ...send, fingerprint: 'fp-2' }],
    ['an Allow once, used, replaced by a read grant', sendCall, 'once', { ...send, mode: 'read' }],
  ] as const) {
    it(`breaks a fence the moment ${what} is asked for, before it commits, telling its holder synchronously`, async () => {
      reopen({ manual: true });
      const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
      tick();
      const a = await creation;
      const granting = Promise.all([store.grantConnectorTool(a.id, rows), store.grantConnectorTool(a.id, send)]);
      tick();
      await granting;
      const told: string[] = [];
      const fence = store.connectorFence(a.id, held, heldMode, () => told.push(held.tool));
      const other = store.connectorFence(a.id, held === rowsCall ? sendCall : rowsCall, held === rowsCall ? 'once' : 'read', () => told.push('other'));
      const authorizing = store.authorizeConnectorCall(a.id, held, heldMode); // an Allow once's use taken: its row goes
      tick();
      expect(await authorizing).toEqual({ granted: true, mode: heldMode });
      const regranting = store.grantConnectorTool(a.id, replacement);
      expect(told).toEqual([held.tool]); // asked for, nothing committed yet; the other tool's fence untouched
      expect(store.connectorFenceHolds(fence, held, heldMode)).toBe('revoked');
      tick();
      await regranting;
      expect(told).toEqual([held.tool]);
      expect(store.connectorFenceHolds(fence, held, heldMode)).toBe('revoked');
      expect(store.connectorFenceHolds(other, held === rowsCall ? sendCall : rowsCall, held === rowsCall ? 'once' : 'read')).toBe('held');
      expect(grantsInFile(a.id)).toContainEqual({ server: 'fixture', tool: held.tool, fingerprint: replacement.fingerprint, mode: replacement.mode }); // the replacement, unused
    });
  }

  it('leaves a fence held through an identical re-grant: the same read grant, or Allow once again after its use', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    const told: string[] = [];
    const readFence = store.connectorFence(a.id, rowsCall, 'read', () => told.push('rows'));
    const onceFence = store.connectorFence(a.id, sendCall, 'once', () => told.push('send'));
    expect(await store.authorizeConnectorCall(a.id, rowsCall, 'read')).toEqual({ granted: true, mode: 'read' });
    expect(await store.authorizeConnectorCall(a.id, sendCall, 'once')).toEqual({ granted: true, mode: 'once' });
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send); // a second Allow once, for the next call
    expect(told).toEqual([]);
    expect(store.connectorFenceHolds(readFence, rowsCall, 'read')).toBe('held');
    expect(store.connectorFenceHolds(onceFence, sendCall, 'once')).toBe('held');
    expect(grantsInFile(a.id)).toEqual([
      { server: 'fixture', tool: 'rows', fingerprint: 'fp-1', mode: 'read' },
      { server: 'fixture', tool: 'send_document', fingerprint: 'fp-1', mode: 'once' },
    ]);
  });

  it('breaks a fence the moment a revoke or delete is asked for, before it commits, telling its holder synchronously', async () => {
    reopen({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    tick();
    const a = await creation;
    const granting = Promise.all([store.grantConnectorTool(a.id, rows), store.grantConnectorTool(a.id, send)]);
    tick();
    await granting;
    const told: string[] = [];
    const rowsFence = store.connectorFence(a.id, rowsCall, 'read', () => told.push('rows'));
    const sendFence = store.connectorFence(a.id, sendCall, 'once', () => told.push('send'));
    const revoking = store.revokeConnectorTool(a.id, ROWS);
    expect(told).toEqual(['rows']); // asked for, nothing committed yet
    expect(store.connectorFenceHolds(rowsFence, rowsCall, 'read')).toBe('revoked');
    expect(store.connectorFenceHolds(sendFence, sendCall, 'read')).toBe('wrongMode'); // untouched: its grant is an Allow once
    const deleting = store.delete(a.id);
    expect(told).toEqual(['rows', 'send']);
    tick();
    await Promise.all([revoking, deleting]);
    expect(told).toEqual(['rows', 'send']); // each told once
  });

  for (const [what, ask] of [
    ['revoke', (id: string) => store.revokeConnectorTool(id, ROWS)],
    ['replacing re-grant', (id: string) => store.grantConnectorTool(id, { ...rows, mode: 'once' })],
  ] as const) {
    it(`breaks even when the ${what}’s batch is then lost (a refusal errs toward no call)`, async () => {
      reopen({ manual: true });
      const creation = store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
      tick();
      const a = await creation;
      const granting = store.grantConnectorTool(a.id, rows);
      tick();
      await granting;
      const told: string[] = [];
      const fence = store.connectorFence(a.id, rowsCall, 'read', () => told.push('rows'));
      const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      const asked = ask(a.id);
      await settle();
      tick();
      await expect(asked).rejects.toThrow();
      commit.mockRestore();
      expect(grantsInFile(a.id)).toEqual([{ server: 'fixture', tool: 'rows', fingerprint: 'fp-1', mode: 'read' }]); // rolled back
      expect(told).toEqual(['rows']);
      expect(store.connectorFenceHolds(fence, rowsCall, 'read')).toBe('revoked');
    });
  }

  it('a released fence is no longer told, and the store keeps nothing of it', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    const told: string[] = [];
    const fence = store.connectorFence(a.id, rowsCall, 'read', () => told.push('rows'));
    store.releaseConnectorFence(fence);
    await store.revokeConnectorTool(a.id, ROWS);
    expect(told).toEqual([]);
    expect((store as unknown as { fences: Map<string, unknown> }).fences.size).toBe(0);
  });

  it('is per tool: revoking one tool leaves another tool’s fence of the same artifact held', async () => {
    const a = await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human);
    await store.grantConnectorTool(a.id, rows);
    await store.grantConnectorTool(a.id, send);
    const fence = store.connectorFence(a.id, rowsCall, 'read');
    expect(await store.authorizeConnectorCall(a.id, rowsCall, 'read')).toEqual({ granted: true, mode: 'read' });
    await store.revokeConnectorTool(a.id, SEND);
    expect(store.connectorFenceHolds(fence, rowsCall, 'read')).toBe('held');
  });
});
