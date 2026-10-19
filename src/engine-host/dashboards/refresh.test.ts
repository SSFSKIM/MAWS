// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3 and acceptance 3): a granted call's result becomes
// one validated immutable snapshot of a query dataset at the host boundary, over A's real store with the dashboard
// kind registered. Admission checks the call against the authoritative descriptor and captures its mutation identity;
// the publication commits the snapshot, the descriptor and its retention in one frame only while that identity, the
// caller's guard and the dashboard still hold, and collects what retention retired right after its commit. A bad
// result changes only the error state.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset, removeDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { registerDashboards, type Dashboards } from '.';
import { datasetRefresher, type RefreshScope, type RefreshStart } from './refresh';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-agent' as AppSessionId };
const QUERY = { kind: 'query' as const, server: 'fixture', tool: 'rows', args: { series: 'revenue', limit: 2 } };
const rowsOf = (...values: number[]) => values.map((v, t) => ({ t, v }));
const envelope = (rows: unknown[]) => ({ content: JSON.stringify({ rows }), structuredContent: { series: 'revenue', rows } });
const HELD = () => 'held' as const;

let userData: string;
let documents: Documents;
let dashboards: Dashboards;
let now: number;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-refresh-'));
  documents = openDocuments(userData, () => {})!;
  dashboards = registerDashboards({ documents });
  now = Date.UTC(2026, 9, 17, 12, 0, 0);
});
afterEach(() => {
  dashboards.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});
const store = () => documents.store;
const refresher = () => datasetRefresher(store(), { now: () => now });
const live = (id: string, dataset = 'live') => readDataset(store().service.live(id), dataset);
const unfetched = (over: Partial<DatasetDescriptor> = {}): DatasetDescriptor => ({ title: 'Live', source: { ...QUERY, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 }, ...over }) as DatasetDescriptor;
const write = (id: string, edit: Parameters<Documents['store']['writeWithAssets']>[3]) => store().writeWithAssets(id, human, [], edit);

async function board(descriptor: DatasetDescriptor = unfetched()): Promise<string> {
  const { id } = await store().create({ kind: 'dashboard', title: 'Board' }, human);
  await write(id, (doc) => setDataset(doc, 'live', descriptor));
  return id;
}
const start = (artifactId: string, over: Partial<RefreshStart> = {}): RefreshStart => ({ artifactId, server: QUERY.server, tool: QUERY.tool, arguments: { limit: 2, series: 'revenue' }, dataset: { id: 'live' }, ...over });
const page = (): RefreshScope => ({ actor: human, opId: null, admit: () => true });

async function admitted(artifactId: string, scope: RefreshScope = page(), over: Partial<RefreshStart> = {}) {
  const admission = await refresher().admit(start(artifactId, over), scope);
  if (!admission.ok) throw new Error(`refused: ${admission.refusal}`);
  return admission;
}
const assetsOf = (id: string) => store().listAssets(id).map((asset) => asset.ref);

describe('a query refresh at the host boundary', () => {
  it('publishes a valid result as one snapshot of the admitted array, the human’s, its metadata only in the answer', async () => {
    const id = await board();
    const before = store().revision(id);
    const publication = await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(107, 110)) }, HELD);
    const descriptor = live(id)!;
    expect(descriptor.source.kind).toBe('query');
    const snapshot = (descriptor.source as { snapshot: { ref: string; at: number } }).snapshot;
    expect(snapshot).toEqual({ ref: expect.stringMatching(/^assets\/query-[0-9a-f-]{36}\.json$/), at: now });
    expect(descriptor).toMatchObject({ columns: [{ name: 't', type: 'number' }, { name: 'v', type: 'number' }], rows: 2, updated: { at: now, by: human }, state: { status: 'ok', at: now } });
    expect((descriptor.source as { args: unknown }).args).toEqual(QUERY.args);
    const asset = store().listAssets(id).find((candidate) => candidate.ref === snapshot.ref)!;
    expect(new TextDecoder().decode(store().files.readAsset(id, asset.sha256))).toBe(JSON.stringify(rowsOf(107, 110))); // the array, never the envelope
    expect(documents.storage.db.prepare('SELECT querySnapshot FROM artifact_assets WHERE artifactId = ? AND assetId = ?').get(id, asset.assetId)).toEqual({ querySnapshot: 1 });
    expect(publication).toEqual({ published: { status: 'dataset', artifactId: id, id: 'live', revision: store().revision(id), columns: descriptor.columns, rows: 2 } });
    expect(store().revision(id)).toBeGreaterThan(before);
  });

  // E3 M2 residual: a failed collection neither changes the committed outcome nor withholds the scope's end
  it('ends the publication as committed when the collection after it throws, and reports the failure', async () => {
    const id = await board();
    const logs: string[] = [];
    vi.spyOn(store(), 'collectRetiredAssets').mockImplementation(() => {
      throw new Error('unlink EBUSY');
    });
    const ends: unknown[] = [];
    const admission = await datasetRefresher(store(), { now: () => now, log: (line) => logs.push(line) }).admit(start(id), { ...page(), ended: (end) => ends.push(end) });
    if (!admission.ok) throw new Error(admission.refusal);
    const publication = await admission.publish({ kind: 'result', result: envelope(rowsOf(1, 2)) }, HELD);
    expect(publication).toMatchObject({ published: { status: 'dataset', rows: 2, revision: store().revision(id) } });
    expect(ends).toEqual([publication]);
    expect(live(id)).toMatchObject({ rows: 2, state: { status: 'ok' } });
    expect(logs).toEqual([expect.stringMatching(/could not be collected.*unlink EBUSY/)]);
  });

  it('collects the snapshot its retention retired right after the commit, not at the next hold release or maintenance', async () => {
    const id = await board();
    const collect = vi.spyOn(store(), 'collectRetiredAssets');
    const refs: string[] = [];
    for (const v of [1, 2, 3]) {
      now += 30_000;
      await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(v)) }, HELD);
      refs.push((live(id)!.source as { snapshot: { ref: string } }).snapshot.ref);
    }
    expect(collect).toHaveBeenCalledTimes(3);
    expect(collect).toHaveBeenLastCalledWith(id);
    expect(assetsOf(id)).toEqual([refs[1], refs[2]]); // the latest two; the first retired and collected at once
  });

  it('records a malformed result as the error state alone: the previous snapshot, rows and provenance stay', async () => {
    const id = await board();
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1, 2)) }, HELD);
    const good = live(id)!;
    const assets = assetsOf(id);
    now += 60_000;
    // E3 M2 fix: each says which failure it recorded: the rows refused by validation, or the tool's own error
    const failures = ['validation', 'validation', 'validation', 'toolError'];
    for (const result of [{ content: 'rows 1 2' }, { content: '[]', structuredContent: { data: [] } }, envelope([{ t: 1, v: { nested: true } }]), { isError: true, content: 'boom' }]) {
      const publication = await (await admitted(id)).publish({ kind: 'result', result }, HELD);
      const failed = failures.shift();
      const after = live(id)!;
      expect(after.source).toEqual(good.source);
      expect(after.updated).toEqual(good.updated);
      expect({ columns: after.columns, rows: after.rows }).toEqual({ columns: good.columns, rows: good.rows });
      expect(after.state).toEqual({ status: 'error', message: expect.any(String), at: now });
      expect(assetsOf(id)).toEqual(assets);
      expect(publication).toEqual({ published: { status: 'dataset', artifactId: id, id: 'live', revision: store().revision(id), columns: good.columns, rows: 2, state: { status: 'error', message: after.state.message } }, failed });
    }
    // the words are the host's own, bounded, never the server's
    expect(live(id)!.state.message).not.toContain('boom');
    // a success afterwards clears the error
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(3)) }, HELD);
    expect(live(id)!.state).toEqual({ status: 'ok', at: now });
  });

  // E3 M2 fix (reviewer finding 1): an overflowing number never becomes a null cell of a new snapshot
  it('records an overflowing number in the text or the structured rows as a validation error: the previous snapshot, rows and provenance stay', async () => {
    const id = await board();
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1, 2)) }, HELD);
    const good = live(id)!;
    const assets = assetsOf(id);
    now += 60_000;
    for (const result of [{ content: '[{"t":0,"v":1e400}]' }, { content: '', structuredContent: { rows: [{ t: 0, v: Infinity }] } }]) {
      const publication = await (await admitted(id)).publish({ kind: 'result', result }, HELD);
      const after = live(id)!;
      expect(after.source).toEqual(good.source);
      expect(after.updated).toEqual(good.updated);
      expect({ columns: after.columns, rows: after.rows }).toEqual({ columns: good.columns, rows: good.rows });
      expect(after.state).toEqual({ status: 'error', message: 'the last refresh was refused: record 1 holds a number in "v" too large to read', at: now });
      expect(assetsOf(id)).toEqual(assets);
      expect(publication).toMatchObject({ published: { revision: store().revision(id), columns: good.columns, rows: 2, state: { status: 'error' } }, failed: 'validation' });
    }
  });

  // P3-F dashboard-model wave (scalpel-4#1): every failure after the admission writes the validation-error state and ends
  // the scope: a text result with one cell nested 10,000 deep (which no serializer can write), and a result whose very
  // reading throws, in the host's closed words
  it('records a cell nested too deep to serialize, and a result whose reading throws, as the validation error, ending the scope', async () => {
    const id = await board();
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1, 2)) }, HELD);
    const good = live(id)!;
    const assets = assetsOf(id);
    now += 60_000;
    const nested = { content: `[{"t":0,"v":${'['.repeat(10_000)}1${']'.repeat(10_000)}}]` };
    const throwing = {
      content: '',
      structuredContent: {
        rows: [
          {
            get v(): number {
              throw new Error('boom');
            },
          },
        ],
      },
    };
    // P4 (W1, tracker 2026-10-18 L246): the reading that threw is logged with its own message, the stored words unchanged
    for (const [result, message, logged] of [
      [nested, 'the last refresh was refused: record 1 holds a nested value in "v"', []],
      [throwing, 'the last refresh was refused: its rows could not be read', [`${id}'s dataset "live": its rows could not be read: boom`]],
    ] as const) {
      const ends: unknown[] = [];
      const logs: string[] = [];
      const admission = await datasetRefresher(store(), { now: () => now, log: (line) => logs.push(line) }).admit(start(id), { ...page(), ended: (end) => ends.push(end) });
      if (!admission.ok) throw new Error(admission.refusal);
      const publication = await admission.publish({ kind: 'result', result }, HELD);
      const after = live(id)!;
      expect(after.source).toEqual(good.source);
      expect({ columns: after.columns, rows: after.rows }).toEqual({ columns: good.columns, rows: good.rows });
      expect(after.state).toEqual({ status: 'error', message, at: now });
      expect(assetsOf(id)).toEqual(assets);
      expect(publication).toMatchObject({ published: { revision: store().revision(id), columns: good.columns, rows: 2, state: { status: 'error', message } }, failed: 'validation' });
      expect(ends).toEqual([publication]);
      expect(logs).toEqual(logged);
    }
  });

  it('records a tool failure, a result too large and a row key the rows break as the error state, a query never fetched staying unfetched', async () => {
    const id = await board(unfetched({ rowKey: 't' }));
    for (const [reason, failed] of [['toolError', 'toolError'], ['tooLarge', 'validation'], ['timeout', 'timeout']] as const) {
      const publication = await (await admitted(id)).publish({ kind: 'failed', reason }, HELD);
      expect(live(id)).toEqual({ ...unfetched({ rowKey: 't' }), state: { status: 'error', message: expect.any(String), at: now } });
      expect(publication).toMatchObject({ published: { columns: [], rows: 0, notFetched: true, state: { status: 'error' } }, failed });
    }
    await (await admitted(id)).publish({ kind: 'result', result: envelope([{ t: 1 }, { t: 1 }]) }, HELD);
    expect(live(id)!.state).toMatchObject({ status: 'error', message: expect.stringContaining('row key') });
    expect(assetsOf(id)).toEqual([]);
  });

  it('refuses admission for a call its dataset’s query does not name, a dataset that is not a query, a stale or future base', async () => {
    const id = await board();
    const refusal = async (over: Partial<RefreshStart>, artifactId = id) => {
      const admission = await refresher().admit(start(artifactId, over), page());
      expect(admission.ok).toBe(false);
      return (admission as { refusal: string }).refusal;
    };
    expect(await refusal({ server: 'other' })).toMatch(/query/);
    expect(await refusal({ tool: 'other' })).toMatch(/query/);
    expect(await refusal({ arguments: { series: 'revenue' } })).toMatch(/query/);
    expect(await refusal({ dataset: { id: 'nope' } })).toMatch(/no dataset/);
    expect(await refusal({ dataset: { id: 'live', baseRevision: store().revision(id) + 5 } })).toMatch(/newer/);
    const base = store().revision(id);
    await write(id, (doc) => setDataset(doc, 'live', unfetched({ title: 'Renamed' })));
    expect(await refusal({ dataset: { id: 'live', baseRevision: base } })).toMatch(/since/);
    const { id: html } = await store().create({ kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>hi</p>') } }, human);
    expect(await refusal({}, html)).toMatch(/dashboard/);
    const file: DatasetDescriptor = { title: 'File', source: { kind: 'file', ref: 'assets/a.csv', name: 'a.csv', format: 'csv', sha256: 'a'.repeat(64), size: 1 }, columns: [], rows: 0, updated: { at: 1, by: human }, state: { status: 'ok', at: 1 } };
    await write(id, (doc) => setDataset(doc, 'file', file));
    expect(await refusal({ dataset: { id: 'file' } })).toMatch(/not a query/);
  });

  it('discards a result whose guard broke before the commit: a revoke, a cancel, a request no longer live', async () => {
    const id = await board();
    const before = store().revision(id);
    expect(await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1)) }, () => 'revoked')).toEqual({ discarded: 'revoked', detail: expect.any(String) });
    expect(await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1)) }, () => 'cancelled')).toEqual({ discarded: 'cancelled', detail: expect.any(String) });
    let pending = true;
    const asked = await admitted(id, { actor: agent, opId: null, admit: () => pending });
    pending = false;
    expect(await asked.publish({ kind: 'failed', reason: 'toolError' }, HELD)).toEqual({ discarded: 'cancelled', detail: expect.any(String) });
    expect(store().revision(id)).toBe(before);
    expect(assetsOf(id)).toEqual([]);
    expect(live(id)).toEqual(unfetched());
  });

  it('discards success and failure alike once the dataset changed since admission: replaced (even by an equal descriptor), removed, restored, its dashboard deleted', async () => {
    const id = await board();
    const version = await store().createVersion(id, { kind: 'named', actor: human, label: 'v' });
    const changes: [string, () => Promise<unknown>][] = [
      ['an equal descriptor written back', () => write(id, (doc) => setDataset(doc, 'live', unfetched()))],
      ['another source', () => write(id, (doc) => setDataset(doc, 'live', unfetched({ source: { ...QUERY, tool: 'other', snapshot: null } })))],
      ['a restore', () => store().restore(id, version!, human)],
      ['a removal', () => write(id, (doc) => removeDataset(doc, 'live'))],
    ];
    for (const [what, change] of changes) {
      await write(id, (doc) => setDataset(doc, 'live', unfetched())); // the query again, freshly written
      const success = await admitted(id);
      const failure = await admitted(id);
      await change();
      const revision = store().revision(id);
      const descriptor = live(id);
      expect(await success.publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD), what).toMatchObject({ discarded: 'stale' });
      expect(await failure.publish({ kind: 'failed', reason: 'toolError' }, HELD), what).toMatchObject({ discarded: 'stale' });
      expect(store().revision(id), what).toBe(revision);
      expect(live(id), what).toEqual(descriptor);
    }
    await write(id, (doc) => setDataset(doc, 'live', unfetched()));
    const orphan = await admitted(id);
    await store().delete(id);
    expect(await orphan.publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD)).toMatchObject({ discarded: 'stale' });
  });

  // E3 M2 fix: the scope's admission is the prepare's last step, so only a publication that will commit is admitted
  it('asks the scope’s admission last, only of a publication every guard and the dataset’s identity still admit', async () => {
    const id = await board();
    let admissions = 0;
    const counted: RefreshScope = { actor: human, opId: null, admit: () => (admissions += 1, true) };
    const revoked = await admitted(id, counted);
    expect(await revoked.publish({ kind: 'result', result: envelope(rowsOf(1)) }, () => 'revoked')).toMatchObject({ discarded: 'revoked' });
    const stale = await admitted(id, counted);
    await write(id, (doc) => setDataset(doc, 'live', unfetched()));
    expect(await stale.publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD)).toMatchObject({ discarded: 'stale' });
    expect(admissions).toBe(0);
    await (await admitted(id, counted)).publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD);
    expect(admissions).toBe(1);
  });

  it('refuses admission as stale for a dashboard or dataset gone, or a dataset no longer this query; a future base is not stale', async () => {
    const id = await board();
    const admission = async (over: Partial<RefreshStart> = {}, artifactId = id) => refresher().admit(start(artifactId, over), page());
    expect(await admission({ arguments: { series: 'cost' } })).toMatchObject({ ok: false, stale: true });
    expect(await admission({ dataset: { id: 'nope' } })).toMatchObject({ ok: false, stale: true });
    const base = store().revision(id);
    await write(id, (doc) => setDataset(doc, 'live', unfetched({ title: 'Renamed' })));
    expect(await admission({ dataset: { id: 'live', baseRevision: base } })).toMatchObject({ ok: false, stale: true });
    expect(await admission({ dataset: { id: 'live', baseRevision: store().revision(id) + 5 } })).toEqual({ ok: false, refusal: expect.stringMatching(/newer/) });
    await store().delete(id);
    expect(await admission()).toMatchObject({ ok: false, stale: true });
  });

  it('lets only the first of concurrent completions commit; a prose or other-dataset edit meanwhile does not stop it', async () => {
    const id = await board();
    const first = await admitted(id);
    const second = await admitted(id);
    await write(id, (doc) => setDataset(doc, 'other', unfetched({ title: 'Other' })));
    expect(await first.publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD)).toHaveProperty('published');
    expect(await second.publish({ kind: 'result', result: envelope(rowsOf(2)) }, HELD)).toMatchObject({ discarded: 'stale' });
    expect(live(id)!.rows).toBe(1);
  });

  it('publishes an agent’s refresh as its session, recording the op’s answer in the publication’s frame', async () => {
    const id = await board();
    const base = store().revision(id);
    const answers: unknown[] = [];
    const scope: RefreshScope = { actor: agent, opId: 'app-agent/toolu_1', admit: () => true, ended: (end) => answers.push(end) };
    const publication = await (await admitted(id, scope, { dataset: { id: 'live', baseRevision: base } })).publish({ kind: 'result', result: envelope(rowsOf(5)) }, HELD);
    expect(live(id)!.updated).toEqual({ at: now, by: agent });
    expect(await store().replayOf('app-agent/toolu_1')).toEqual({ found: true, result: (publication as { published: unknown }).published });
    expect(answers).toEqual([publication]); // the scope hears how it ended
    // an error state is the op's first durable answer too
    const failed = await (await admitted(id, { ...scope, opId: 'app-agent/toolu_2' })).publish({ kind: 'failed', reason: 'toolError' }, HELD);
    expect(await store().replayOf('app-agent/toolu_2')).toEqual({ found: true, result: (failed as { published: unknown }).published });
    // a discarded one records nothing
    const discarded = await admitted(id, { ...scope, opId: 'app-agent/toolu_3' });
    await write(id, (doc) => setDataset(doc, 'live', unfetched()));
    expect(await discarded.publish({ kind: 'result', result: envelope(rowsOf(6)) }, HELD)).toMatchObject({ discarded: 'stale' });
    expect(await store().replayOf('app-agent/toolu_3')).toEqual({ found: false });
  });

  it('keeps one snapshot for repeated identical content, advancing its fetch time without another asset', async () => {
    const id = await board();
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD);
    const first = (live(id)!.source as { snapshot: { ref: string } }).snapshot.ref;
    now += 30_000;
    await (await admitted(id)).publish({ kind: 'result', result: envelope(rowsOf(1)) }, HELD);
    expect((live(id)!.source as { snapshot: { ref: string; at: number } }).snapshot).toEqual({ ref: first, at: now });
    expect(live(id)!.updated!.at).toBe(now);
    expect(assetsOf(id)).toEqual([first]);
  });
});
