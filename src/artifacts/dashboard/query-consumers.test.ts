// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2): every portable consumer of a descriptor takes a
// query never fetched (`snapshot: null`, no `updated`) without asking for bytes: the exporters draw E2's no-data
// presentation labelled "not fetched" and the mirror lists the dataset without a data file; a fetched query reads its
// JSON snapshot by ref as a file's is read.
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { exportSource, defaultAuthorName } from '../document/export/source';
import { mirrorSlug } from '../library/mirror';
import { setDataset, type DatasetDescriptor } from './datasets';
import { exportTheme, exportView, prepareViews } from './export';
import { BAR, BOUND_AT, exportDashboard, SNAPSHOTS, OLD_REF } from './fixtures/export';
import { dashboardMirrorWriter } from './mirror';
import { renderFailure } from './render';
import { DATASET_STATES } from './states';

const theme = exportTheme();
const query = (snapshot: { ref: string; at: number } | null): DatasetDescriptor =>
  snapshot
    ? { title: 'Live sales', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot }, columns: [...SNAPSHOTS[OLD_REF].columns], rows: 3, updated: { at: snapshot.at, by: { kind: 'human' } }, state: { status: 'ok', at: BOUND_AT } }
    : { title: 'Live sales', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: BOUND_AT } };

describe('the exporters over a query (E3)', () => {
  it('draw a never-fetched query as the no-data presentation labelled "not fetched", reading nothing', async () => {
    const { doc } = exportDashboard();
    setDataset(doc, 'sales', query(null));
    const read = vi.fn(async () => SNAPSHOTS[OLD_REF]);
    const views = await prepareViews(doc, { read, theme, authorName: defaultAuthorName });
    expect(read).not.toHaveBeenCalled();
    let bar: ReturnType<typeof views> | undefined;
    for (const tab of exportSource(doc, 'Board').tabs)
      tab.body.descendants((node) => {
        if (node.type.name === 'chart' && node.attrs.id === 'c1') bar = views(node);
        return true;
      });
    expect(bar!.svg).toBe(renderFailure(BAR, theme, 'sales', DATASET_STATES.notFetched).svg);
    expect(bar!.sourceLabel).toBe('Live sales · fixture · rows · not fetched');
    expect(bar!.markdown).toContain('not fetched');
  });

  it('read a fetched query by its JSON snapshot ref and label it with its fetch time', async () => {
    const view = exportView({ spec: BAR, datasetId: 'sales', descriptor: query({ ref: 'assets/query-a.json', at: BOUND_AT }), table: SNAPSHOTS[OLD_REF], theme, by: 'Owner' });
    expect(view.sourceLabel).toBe('Live sales · fixture · rows · updated 2026-10-01 09:00 UTC by Owner');
    const { doc } = exportDashboard();
    setDataset(doc, 'sales', query({ ref: 'assets/query-a.json', at: BOUND_AT }));
    const read = vi.fn(async () => SNAPSHOTS[OLD_REF]);
    await prepareViews(doc, { read, theme, authorName: defaultAuthorName });
    expect(read).toHaveBeenCalledWith({ ref: 'assets/query-a.json', format: 'json' });
  });
});

describe('the mirror over a query (E3)', () => {
  const artifact = { id: '00000000-0000-4000-8000-0000000000d1', kind: 'dashboard', title: 'Sales board' } as Artifact;
  it('lists a never-fetched query as not fetched, with no data file and no read', () => {
    const { doc } = exportDashboard();
    setDataset(doc, 'sales', query(null));
    const readAsset = vi.fn(() => new Uint8Array());
    const { files } = dashboardMirrorWriter({ artifact, doc, assets: [], readAsset });
    expect(readAsset).not.toHaveBeenCalled();
    const slug = mirrorSlug(artifact);
    expect(Object.keys(files).filter((path) => path.startsWith(`${slug}/data/`))).toEqual([]);
    const listed = JSON.parse(files[`${slug}/datasets.json`] as string).datasets.sales;
    expect(listed).toMatchObject({ title: 'Live sales', file: null, format: 'json', rows: 0, notFetched: true, snapshot: { ref: null, source: 'fixture · rows', fetched: null } });
    expect(listed.problem).toBeUndefined();
  });
});
