// The engine host's `artifacts.*` and `spaces.*` surface over the real store (docs/doperpowers/plans/2026-10-12-p3-a-store.md,
// M4): every host-owned command has a handler and one deadline shape, the store's refusals reach the caller typed, the
// test-only commands answer only under MAWS_E2E=1, the change feed is emitted, and a document port main posts is
// attached for a document kind and closed for anything else.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { MessagePortMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortProvider, type PortLike } from '@artifacts/provider/port';
import { newDoc } from '@artifacts/yjs';
import { HostCommandError, type DocPortHandler, type HostEmit, type HostOn } from '@shared/host/runtime';
import { commands, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '.';
import { ARTIFACTS_DEADLINE_SHAPES, registerArtifacts } from './register';

let dir: string;
let documents: Documents | null;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let emitted: { name: EventName; payload: unknown }[];
let docHandler: DocPortHandler | null;
let surface: { close(): void } | null;

function register(env: Record<string, string> = {}, docs: Documents | null = documents): void {
  handlers = new Map();
  emitted = [];
  docHandler = null;
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    expect(validateEventPayload(name, payload).ok, name).toBe(true);
    emitted.push({ name, payload });
    return true;
  };
  surface = registerArtifacts(on, emit, { onDocPort: (handler) => void (docHandler = handler) }, { documents: docs, env });
}

// A call as the runtime makes it: the input validated first, the output checked against the registry after.
async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}: ${JSON.stringify(checked.error)}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}
async function refusal(name: CommandName, input: unknown): Promise<unknown> {
  try {
    await call(name, input);
  } catch (error) {
    expect(error).toBeInstanceOf(HostCommandError);
    return (error as HostCommandError).ipcError;
  }
  throw new Error(`${name} was not refused`);
}

// A MessagePortMain stand-in over a Node MessagePort (Electron's delivers `{data}` events and a `close`).
function asPortMain(port: MessagePort): MessagePortMain {
  return {
    postMessage: (message: unknown) => port.postMessage(message),
    on: (event: string, listener: (arg?: unknown) => void) => (event === 'message' ? port.on('message', (data) => listener({ data })) : port.on('close', () => listener())),
    start: () => port.start(),
    close: () => port.close(),
  } as unknown as MessagePortMain;
}
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};

// What is durable, read through a connection of its own as another process (or the store after a crash) would see it.
const durable = (sql: string, ...params: string[]): number => {
  const db = new DatabaseSync(join(dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0;
  } finally {
    db.close();
  }
};
const committedRevision = (artifactId: string) => durable('SELECT MAX(seq) AS n FROM artifact_updates WHERE artifactId = ?', artifactId);
const insert = (artifactId: string, text: string) => documents!.service.writeAs(artifactId, { kind: 'human' }, (doc) => doc.get('root').insert(0, text));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-artifacts-ipc-'));
  documents = openDocuments(dir, () => {});
  register();
});
afterEach(() => {
  surface?.close();
  documents?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the artifacts and spaces surface (M4)', () => {
  it('has a handler and exactly one deadline shape for every command the engine host owns in both namespaces', () => {
    const owned = Object.entries(commands).filter(([name, spec]) => /^(artifacts|spaces)\./.test(name) && spec.owner === 'engine-host').map(([name]) => name);
    expect(Object.keys(ARTIFACTS_DEADLINE_SHAPES).sort()).toEqual(owned.sort());
    expect([...handlers.keys()].sort()).toEqual(owned.sort());
    // each is answered from the store at its commit: nothing waits on an engine or a control round trip
    expect(new Set(Object.values(ARTIFACTS_DEADLINE_SHAPES))).toEqual(new Set(['immediate']));
  });

  it('creates, lists, reads, updates and deletes as the human, each row with its live revision, and emits each change', async () => {
    const { artifact } = await call('artifacts.create', { kind: 'document', title: 'Plan' });
    expect(artifact).toMatchObject({ kind: 'document', title: 'Plan', createdBy: { kind: 'human' }, revision: 0, agentEditsAsSuggestions: false });
    const page = await call('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>hi</p>') } });
    expect(page.artifact.revision).toBeGreaterThan(0);
    expect((await call('artifacts.list', {})).artifacts.map((row: { title: string }) => row.title).sort()).toEqual(['Page', 'Plan']);
    expect((await call('artifacts.list', { filter: { kind: 'html' } })).artifacts.map((row: { id: string }) => row.id)).toEqual([page.artifact.id]);
    expect((await call('artifacts.search', { query: 'pla' })).artifacts.map((row: { id: string }) => row.id)).toEqual([artifact.id]);
    const updated = await call('artifacts.update', { artifactId: artifact.id, title: 'Plan B', pinned: true, agentEditsAsSuggestions: true });
    expect(updated.artifact).toMatchObject({ title: 'Plan B', pinned: true, agentEditsAsSuggestions: true });
    await call('artifacts.delete', { artifactId: artifact.id });
    expect((await call('artifacts.get', { artifactId: artifact.id })).artifact).toBeNull();
    expect((await call('artifacts.get', { artifactId: artifact.id, includeDeleted: true })).artifact?.title).toBe('Plan B');
    expect(emitted.filter((e) => e.name === 'artifacts.changed').map((e) => (e.payload as { change: string }).change)).toEqual(['created', 'created', 'updated', 'deleted']);
  });

  it('versions, restores, reads a version’s state and the attributions, as the human', async () => {
    register({ MAWS_E2E: '1' });
    const { artifact } = await call('artifacts.create', { kind: 'document', title: 'Notes' });
    await call('artifacts.testWrite', { artifactId: artifact.id, opId: 'w1', ops: [{ op: 'setAttr', key: 'title', value: 'one' }], appSessionId: 'app-1' });
    const { versionId } = await call('artifacts.saveVersion', { artifactId: artifact.id, label: 'First' });
    await call('artifacts.testWrite', { artifactId: artifact.id, opId: 'w2', ops: [{ op: 'setAttr', key: 'title', value: 'two' }] });
    const versions = (await call('artifacts.versions', { artifactId: artifact.id })).versions;
    expect(versions.find((v: { id: number }) => v.id === versionId)).toMatchObject({ kind: 'named', label: 'First', actor: { kind: 'human' } });
    const restored = await call('artifacts.restore', { artifactId: artifact.id, versionId });
    expect(restored.revision).toBeGreaterThan(0);
    const state = await call('artifacts.versionState', { artifactId: artifact.id, versionId: restored.versionId });
    expect(state.bytes).toBeInstanceOf(Uint8Array);
    const doc = newDoc();
    const { applyV2 } = await import('@artifacts/yjs');
    applyV2(doc, state.bytes);
    expect(doc.get('root').getAttr('title')).toBe('one');
    expect((await call('artifacts.attributions', { artifactId: artifact.id, fromSeq: 0, toSeq: restored.revision })).bytes.length).toBeGreaterThan(0);
    await call('artifacts.markViewed', { artifactId: artifact.id });
    expect((await call('artifacts.get', { artifactId: artifact.id })).artifact?.lastViewedAt).toEqual(expect.any(Number));
    expect(await call('artifacts.pruneVersions', { olderThan: 0 })).toEqual({ removed: 0 });
  });

  it('answers the store’s refusals as typed IpcErrors carrying the reason and its data', async () => {
    const missing = '22222222-2222-4222-8222-222222222222';
    expect(await refusal('artifacts.update', { artifactId: missing, title: 'x' })).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound', data: {} } });
    expect(await refusal('artifacts.create', { kind: 'document', title: 'x', content: { path: '/tmp/x' } })).toMatchObject({ code: 'invalid_input', issues: { reason: 'invalid' } });
    const system = (await call('artifacts.create', { kind: 'design_system', title: 'House' })).artifact;
    const governed = (await call('artifacts.create', { kind: 'document', title: 'Doc', designSystemId: system.id })).artifact;
    expect(await refusal('artifacts.delete', { artifactId: system.id })).toMatchObject({ code: 'invalid_input', issues: { reason: 'designSystemInUse', data: { artifactIds: [governed.id] } } });
    expect(await refusal('artifacts.content', { artifactId: governed.id })).toMatchObject({ issues: { reason: 'notFound' } });
  });

  it('refuses the test writer and the loop delay unless the host runs under MAWS_E2E=1, and serves both under it', async () => {
    const { artifact } = await call('artifacts.create', { kind: 'document', title: 'Notes' });
    const write = { artifactId: artifact.id, opId: 'op-1', ops: [{ op: 'insertText', index: 0, text: 'hi' }] };
    expect(await refusal('artifacts.testWrite', write)).toMatchObject({ code: 'internal', message: expect.stringContaining('MAWS_E2E') });
    expect(await refusal('artifacts.testLoopDelay', {})).toMatchObject({ code: 'internal' });
    surface!.close();
    register({ MAWS_E2E: '1' });
    const first = await call('artifacts.testWrite', write);
    expect(await call('artifacts.testWrite', write)).toEqual(first); // the op id replays
    const delay = await call('artifacts.testLoopDelay', { reset: true });
    expect(Object.keys(delay).sort()).toEqual(['max', 'mean', 'p50', 'p99']);
  });

  it('keeps the defaults main relays, serves a byte kind’s file and an asset, and reports the store healthy', async () => {
    const system = (await call('artifacts.create', { kind: 'design_system', title: 'House' })).artifact;
    await call('artifacts.setDefaults', { owner: system.id, spaces: {} });
    expect(documents!.store.defaults()).toEqual({ owner: system.id, spaces: {} });
    const page = (await call('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>v1</p>'), name: 'page.html' } })).artifact;
    const content = await call('artifacts.content', { artifactId: page.id });
    expect(content).toMatchObject({ revision: page.revision, name: 'page.html', size: 9 });
    const asset = await call('artifacts.uploadAsset', { artifactId: page.id, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(asset.ref).toBe('assets/logo.png');
    expect(await call('artifacts.content', { artifactId: page.id, path: 'assets/logo.png' })).toMatchObject({ name: 'logo.png', size: 3 });
    expect(await refusal('artifacts.content', { artifactId: page.id, path: '../store.sqlite' })).toMatchObject({ issues: { reason: 'notFound' } });
    const file = join(dir, 'report.txt');
    writeFileSync(file, 'report');
    const linked = (await call('artifacts.create', { kind: 'file', title: 'Report', content: { path: file } })).artifact;
    expect((await call('artifacts.content', { artifactId: linked.id })).path).toBe(file);
    expect(await call('artifacts.status', undefined)).toEqual({ status: 'ok', reason: null });
  });

  it('serves Spaces and emits their changes', async () => {
    const { space } = await call('spaces.create', { name: 'Teaching' });
    expect((await call('spaces.update', { spaceId: space.id, name: 'Lessons' })).space.name).toBe('Lessons');
    expect((await call('spaces.list', undefined)).spaces.map((s: { name: string }) => s.name)).toEqual(['Lessons']);
    await call('spaces.delete', { spaceId: space.id });
    expect(emitted.filter((e) => e.name === 'spaces.changed').map((e) => (e.payload as { change: string }).change)).toEqual(['created', 'updated', 'deleted']);
  });

  it('answers unavailable for every command when the store did not open, and closes every document port', async () => {
    surface!.close();
    register({}, null);
    expect(await call('artifacts.status', undefined)).toEqual({ status: 'unavailable', reason: expect.any(String) });
    expect(await refusal('artifacts.list', {})).toMatchObject({ code: 'internal', issues: { reason: 'unavailable' } });
    const { port1, port2 } = new MessageChannel();
    const closed = new Promise<void>((resolve) => port2.once('close', () => resolve()));
    docHandler!({ t: 'doc', channel: 1, artifactId: '33333333-3333-4333-8333-333333333333', actor: { kind: 'human' } }, asPortMain(port1));
    await closed;
  });
});

describe('answers released after the batch they read (Decision Log 33)', () => {
  // Each read below is taken while another write's rows sit in the open batch.
  const opened = () => expect(documents!.storage.db.isTransaction).toBe(true);

  it('lists and searches rows only once the batch they saw commits', async () => {
    await call('artifacts.create', { kind: 'document', title: 'Plan' });
    const creating = call('artifacts.create', { kind: 'document', title: 'Second' });
    opened();
    expect((await call('artifacts.list', {})).artifacts).toHaveLength(durable('SELECT COUNT(*) AS n FROM artifacts'));
    await creating;
    const searching = call('artifacts.create', { kind: 'document', title: 'Planned' });
    opened();
    expect((await call('artifacts.search', { query: 'plan' })).artifacts).toHaveLength(durable("SELECT COUNT(*) AS n FROM artifacts WHERE title LIKE '%plan%'"));
    await searching;
  });

  it('answers a row’s live revision only once the rows behind it commit', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    void insert(plan.id, 'a');
    opened();
    const got = (await call('artifacts.get', { artifactId: plan.id })).artifact!;
    expect(got.revision).toBe(plan.revision + 1);
    expect(committedRevision(plan.id)).toBe(got.revision);
  });

  it('lists versions and reads a version’s state only once the batch they saw commits', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    const saving = call('artifacts.saveVersion', { artifactId: plan.id, label: 'First' });
    opened();
    const versions = (await call('artifacts.versions', { artifactId: plan.id })).versions;
    expect(versions).toHaveLength(durable('SELECT COUNT(*) AS n FROM artifact_versions WHERE artifactId = ?', plan.id));
    const { versionId } = await saving;
    void insert(plan.id, 'b');
    opened();
    expect((await call('artifacts.versionState', { artifactId: plan.id, versionId })).bytes).toBeInstanceOf(Uint8Array);
    expect(committedRevision(plan.id)).toBe(plan.revision + 1);
  });

  it('serves a byte kind’s content only once its revision commits', async () => {
    const page = (await call('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>v1</p>') } })).artifact;
    void documents!.store.writeContent(page.id, { bytes: new TextEncoder().encode('<p>v2</p>') }, { kind: 'human' });
    opened();
    const content = await call('artifacts.content', { artifactId: page.id });
    expect(content.revision).toBeGreaterThan(page.revision);
    expect(committedRevision(page.id)).toBe(content.revision);
  });

  it('answers the attributions only once the rows they merge commit', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    void insert(plan.id, 'a');
    opened();
    await call('artifacts.attributions', { artifactId: plan.id, fromSeq: 0, toSeq: 1_000 });
    expect(committedRevision(plan.id)).toBe(plan.revision + 1);
  });

  it('lists Spaces only once the batch they saw commits', async () => {
    const spacing = call('spaces.create', { name: 'Teaching' });
    opened();
    expect((await call('spaces.list', undefined)).spaces).toHaveLength(durable('SELECT COUNT(*) AS n FROM spaces'));
    await spacing;
  });

  it('answers a write with the revision it reads only once any batch open at that read commits', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    // Another writer whose batch opens between the update's commit and its answer's read.
    void documents!.service.whenCommitted().then(() => void insert(plan.id, 'meanwhile'));
    const updated = (await call('artifacts.update', { artifactId: plan.id, title: 'Plan B' })).artifact;
    expect(updated.revision).toBe(plan.revision + 1);
    expect(committedRevision(plan.id)).toBe(updated.revision);
  });

  it('fails the answers whose batch fails, rather than reveal rows the store took back', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    const commit = vi.spyOn(documents!.storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const writing = insert(plan.id, 'lost');
    const saving = call('artifacts.saveVersion', { artifactId: plan.id, label: 'lost' });
    const reads = [
      call('artifacts.get', { artifactId: plan.id }),
      call('artifacts.list', {}),
      call('artifacts.versions', { artifactId: plan.id }),
      call('artifacts.versionState', { artifactId: plan.id, seq: plan.revision + 1 }),
      call('artifacts.attributions', { artifactId: plan.id, fromSeq: 0, toSeq: 1_000 }),
    ];
    const outcomes = await Promise.allSettled([writing, saving, ...reads]);
    expect(outcomes.map((o) => o.status)).toEqual(Array(7).fill('rejected'));
    commit.mockRestore();
    expect((await call('artifacts.get', { artifactId: plan.id })).artifact!.revision).toBe(plan.revision);
    expect((await call('artifacts.versions', { artifactId: plan.id })).versions).toEqual([]);
  });
});

describe('write refusals released after the batch they read (Decision Log 33)', () => {
  it('answers a rename of an artifact whose delete is in the open batch with that batch’s failure, not notFound', async () => {
    const plan = (await call('artifacts.create', { kind: 'document', title: 'Plan' })).artifact;
    const commit = vi.spyOn(documents!.storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const deleting = call('artifacts.delete', { artifactId: plan.id });
    const renaming = call('artifacts.update', { artifactId: plan.id, title: 'Plan B' });
    const [deleted, renamed] = await Promise.allSettled([deleting, renaming]);
    expect(deleted.status).toBe('rejected');
    expect(renamed.status).toBe('rejected');
    expect((renamed as PromiseRejectedResult).reason).not.toBeInstanceOf(HostCommandError); // the runtime's `internal`
    expect(durable('SELECT COUNT(*) AS n FROM artifacts WHERE id = ? AND deletedAt IS NULL', plan.id)).toBe(1);
    commit.mockRestore();
    expect((await call('artifacts.update', { artifactId: plan.id, title: 'Plan B' })).artifact.title).toBe('Plan B');
  });

  it('answers a design system’s delete refused for a governed artifact still in the open batch only once it commits, and fails with it', async () => {
    const system = (await call('artifacts.create', { kind: 'design_system', title: 'House' })).artifact;
    const commit = vi.spyOn(documents!.storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const governing = call('artifacts.create', { kind: 'document', title: 'Governed', designSystemId: system.id });
    const dropping = call('artifacts.delete', { artifactId: system.id });
    const [governed, dropped] = await Promise.allSettled([governing, dropping]);
    expect(governed.status).toBe('rejected');
    expect(dropped.status).toBe('rejected');
    expect((dropped as PromiseRejectedResult).reason).not.toBeInstanceOf(HostCommandError);
    commit.mockRestore();
    const again = call('artifacts.create', { kind: 'document', title: 'Governed', designSystemId: system.id });
    expect(await refusal('artifacts.delete', { artifactId: system.id })).toMatchObject({ issues: { reason: 'designSystemInUse' } });
    expect(durable('SELECT COUNT(*) AS n FROM artifacts WHERE designSystemId = ?', system.id)).toBe(1); // released after the commit
    await again;
  });
});

describe('document ports from main (Decision Log 13)', () => {
  it('attaches a document kind’s port with main’s actor: a provider on the other end syncs, writes and is acked', async () => {
    register({ MAWS_E2E: '1' });
    const { artifact } = await call('artifacts.create', { kind: 'document', title: 'Notes' });
    await call('artifacts.testWrite', { artifactId: artifact.id, opId: 'seed', ops: [{ op: 'insertText', index: 0, text: 'seed' }] });
    const { port1, port2 } = new MessageChannel();
    docHandler!({ t: 'doc', channel: 1, artifactId: artifact.id, actor: { kind: 'human' } }, asPortMain(port1));
    const doc = newDoc();
    const provider = new PortProvider(doc);
    provider.connect(port2 as unknown as PortLike);
    await until(() => provider.state.synced);
    expect(doc.get('root').toString()).toBe('seed');
    doc.get('root').insert(4, '!');
    await until(() => provider.state.unsaved === 0 && provider.state.revision > artifact.revision);
    expect(documents!.service.live(artifact.id).get('root').toString()).toBe('seed!');
    expect(emitted.some((e) => e.name === 'artifacts.changed' && (e.payload as { artifactId: string }).artifactId === artifact.id)).toBe(true);
    provider.destroy();
  });

  it('closes the port of a byte kind and of an unknown artifact, and logs why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = (await call('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new Uint8Array([60]) } })).artifact;
    for (const artifactId of [page.id, '44444444-4444-4444-8444-444444444444']) {
      const { port1, port2 } = new MessageChannel();
      const closed = new Promise<void>((resolve) => port2.once('close', () => resolve()));
      docHandler!({ t: 'doc', channel: 2, artifactId, actor: { kind: 'human' } }, asPortMain(port1));
      await closed;
    }
    expect(error).toHaveBeenCalledTimes(2);
  });
});
