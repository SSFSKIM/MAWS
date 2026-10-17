// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): the host's main-only hold commands over the real store, as the runtime calls them. `artifacts.captureDatasetState`
// answers a dashboard's live or retained state with one hold over every snapshot its descriptors name; `holdAssets` and
// `releaseAssets` are main's own holds (behind a window's handle, a Download's). A hold is the connection's: an id
// another connection did not mint releases nothing, and the client going releases every hold it took.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDatasets, setDataset, snapshotOf } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { MAIN_ONLY_COMMANDS } from '@shared/ipc/names';
import type { CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';
import { registerDashboards, type Dashboards } from '.';

const human: Actor = { kind: 'human' };
let dir: string;
let documents: Documents;
let dashboards: Dashboards;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let surface: { close(): void };
let gone: (() => void)[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-holds-ipc-'));
  documents = openDocuments(dir, () => {})!;
  dashboards = registerDashboards({ documents });
  handlers = new Map();
  gone = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  surface = registerArtifacts(on, () => true, { onDocPort: () => {}, onClientGone: (hook) => (gone.push(hook), () => {}) }, { documents, env: {} });
});
afterEach(() => {
  surface.close();
  dashboards.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}

let serial = 0;
async function refresh(artifactId: string, datasetId: string): Promise<string> {
  let ref = '';
  const at = Date.now();
  serial += 1;
  await documents.store.writeWithAssets(
    artifactId,
    human,
    [{ bytes: new TextEncoder().encode(`[{"v":${serial}}]`), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, datasetId, { title: datasetId, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
    },
    { inFrame: (revision) => documents.store.retainQuerySnapshots(artifactId, datasetId, ref, revision) },
  );
  return ref;
}
const exists = (artifactId: string, ref: string) => documents.store.listAssets(artifactId).some((asset) => asset.ref === ref);
const churn = async (artifactId: string, datasetId: string) => {
  await refresh(artifactId, datasetId);
  await refresh(artifactId, datasetId);
  documents.store.collectRetiredAssets(artifactId);
};
const refsOf = (bytes: Uint8Array) => {
  const doc = newDoc();
  applyV2(doc, bytes);
  const refs = listDatasets(doc).map(({ descriptor }) => snapshotOf(descriptor)?.ref);
  doc.destroy();
  return refs;
};

describe('the hold commands (E3)', () => {
  it('are main-only engine-host commands', () => {
    for (const name of ['artifacts.captureDatasetState', 'artifacts.holdAssets', 'artifacts.releaseAssets'] as const) expect(MAIN_ONLY_COMMANDS).toContain(name);
  });

  it('captureDatasetState answers the live state with one hold over its snapshots, released by its id', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const one = await refresh(board.id, 'one');
    const two = await refresh(board.id, 'two');
    const captured = await call('artifacts.captureDatasetState', { artifactId: board.id });
    expect(captured.revision).toBe(documents.store.revision(board.id));
    expect(refsOf(captured.bytes).sort()).toEqual([one, two].sort());
    await churn(board.id, 'one');
    await churn(board.id, 'two');
    expect([exists(board.id, one), exists(board.id, two)]).toEqual([true, true]);
    expect(await call('artifacts.releaseAssets', { assetHoldId: captured.assetHoldId })).toEqual({ released: true });
    expect([exists(board.id, one), exists(board.id, two)]).toEqual([false, false]);
    expect(await call('artifacts.releaseAssets', { assetHoldId: captured.assetHoldId })).toEqual({ released: false }); // once
  });

  it('captureDatasetState answers a retained version’s state, holding the snapshots it pins', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const old = await refresh(board.id, 'live');
    const versionId = (await documents.store.createVersion(board.id, { kind: 'named', actor: human, label: 'v1' }))!;
    await refresh(board.id, 'live');
    await refresh(board.id, 'live');
    const captured = await call('artifacts.captureDatasetState', { artifactId: board.id, versionId });
    expect(captured.revision).toBe(documents.store.versions.version(board.id, versionId)!.seq);
    expect(refsOf(captured.bytes)).toEqual([old]);
    await documents.store.pruneVersions(board.id, Date.now() + 1);
    expect(exists(board.id, old)).toBe(true); // the export's hold outlives the version it read
    await call('artifacts.releaseAssets', { assetHoldId: captured.assetHoldId });
    expect(exists(board.id, old)).toBe(false);
  });

  it('holdAssets holds the refs named, all or none; an unknown hold id releases nothing', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const one = await refresh(board.id, 'live');
    const { assetHoldId } = await call('artifacts.holdAssets', { artifactId: board.id, refs: [one] });
    await churn(board.id, 'live');
    expect(exists(board.id, one)).toBe(true);
    expect(await call('artifacts.releaseAssets', { assetHoldId: randomUUID() })).toEqual({ released: false });
    expect(exists(board.id, one)).toBe(true);
    const refused = await call('artifacts.holdAssets', { artifactId: board.id, refs: [one, 'assets/gone.json'] }).catch((error: unknown) => error);
    expect((refused as HostCommandError).ipcError).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound', data: { ref: 'assets/gone.json', snapshotUnavailable: true } } });
    expect(await call('artifacts.releaseAssets', { assetHoldId })).toEqual({ released: true });
    expect(exists(board.id, one)).toBe(false);
  });

  it('releases every hold the client took when it goes; its ids then release nothing', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const one = await refresh(board.id, 'live');
    const { assetHoldId } = await call('artifacts.holdAssets', { artifactId: board.id, refs: [one] });
    const captured = await call('artifacts.captureDatasetState', { artifactId: board.id });
    await churn(board.id, 'live');
    expect(exists(board.id, one)).toBe(true);
    for (const hook of gone) hook();
    expect(exists(board.id, one)).toBe(false);
    expect(await call('artifacts.releaseAssets', { assetHoldId })).toEqual({ released: false });
    expect(await call('artifacts.releaseAssets', { assetHoldId: captured.assetHoldId })).toEqual({ released: false });
  });

  it('across a host restart a held, retired snapshot is collected at the reopen: its old id releases nothing, a fresh hold on it is refused as unavailable, the latest holds', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const old = await refresh(board.id, 'live');
    const { assetHoldId } = await call('artifacts.holdAssets', { artifactId: board.id, refs: [old] });
    await churn(board.id, 'live');
    expect(exists(board.id, old)).toBe(true); // held, retired
    // the host process goes and comes back: its holds lived only as long as it
    surface.close();
    dashboards.close();
    documents.close();
    documents = openDocuments(dir, () => {})!;
    dashboards = registerDashboards({ documents });
    handlers = new Map();
    gone = [];
    const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
    surface = registerArtifacts(on, () => true, { onDocPort: () => {}, onClientGone: (hook) => (gone.push(hook), () => {}) }, { documents, env: {} });
    expect(exists(board.id, old)).toBe(false); // collected at the reopen
    expect(await call('artifacts.releaseAssets', { assetHoldId })).toEqual({ released: false });
    const refused = await call('artifacts.holdAssets', { artifactId: board.id, refs: [old] }).catch((error: unknown) => error);
    expect((refused as HostCommandError).ipcError).toMatchObject({ issues: { reason: 'notFound', data: { snapshotUnavailable: true } } });
    const latest = await call('artifacts.captureDatasetState', { artifactId: board.id });
    expect(refsOf(latest.bytes).every((ref) => ref !== undefined && exists(board.id, ref))).toBe(true);
    await call('artifacts.releaseAssets', { assetHoldId: latest.assetHoldId });
  });

  it('refuses a capture of an artifact that has no document, and bounds the refs one hold names', async () => {
    const page = await documents.store.create({ kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>x</p>') } }, human);
    const refused = await call('artifacts.captureDatasetState', { artifactId: page.id }).catch((error: unknown) => error);
    expect((refused as HostCommandError).ipcError).toMatchObject({ issues: { reason: 'invalid' } });
    const artifactId = '11111111-1111-4111-8111-111111111111';
    expect(validateCommandInput('artifacts.holdAssets', { artifactId, refs: [] }).ok).toBe(false);
    expect(validateCommandInput('artifacts.holdAssets', { artifactId, refs: Array.from({ length: 65 }, (_, i) => `assets/${i}.json`) }).ok).toBe(false);
    expect(validateCommandInput('artifacts.holdAssets', { artifactId, refs: ['content/1/index.html'] }).ok).toBe(false);
  });
});
