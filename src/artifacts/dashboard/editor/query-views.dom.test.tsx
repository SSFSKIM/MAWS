// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2): the editor's chart view and the source sheet over
// a query never fetched (`snapshot: null`, no `updated`): E2's no-data presentation labelled "not fetched", no read of
// any bytes, and no Download of a snapshot that does not exist.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayedDocument } from '../../document/editor/nodes/views';
import { newDoc } from '../../yjs';
import { setDataset, type DatasetDescriptor } from '../datasets';
import { SnapshotReader } from '../snapshots';
import { DATASET_STATES } from '../states';
import { createChartRenderer } from './chart-view';
import { SourceSheet } from './SourceSheet';
import { SourceSheetState } from './sheet';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const unfetched: DatasetDescriptor = {
  title: 'Live sales',
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, schedule: 30, snapshot: null },
  columns: [],
  rows: 0,
  state: { status: 'ok', at: AT },
};
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};
const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  cleanup();
  document.body.replaceChildren();
});

describe('a never-fetched query in the editor (E3)', () => {
  it('draws the no-data figure labelled "not fetched" without reading, and its label opens the source', async () => {
    const readDataset = vi.fn();
    const opened: unknown[] = [];
    const renderChart = createChartRenderer({ reader: new SnapshotReader({ readDataset } as never, 'dash1'), actorName: () => 'You', openSource: (capture) => opened.push(capture) });
    const doc = newDoc();
    setDataset(doc, 'live', unfetched);
    const into = document.createElement('div');
    document.body.append(into);
    releases.push(renderChart(into, { attrs: { id: 'c1', source: 'live', spec: { view: 'bar', x: 'v', y: 'n', title: 'Live' } } } as unknown as PMNode, { artifactId: 'dash1', host: {} as never, renderDiagram: async () => '', displayed: displayedDocument(doc) }));
    await settle();
    expect(readDataset).not.toHaveBeenCalled();
    expect(into.querySelector('svg desc')?.textContent).toContain(DATASET_STATES.notFetched);
    const label = into.querySelector<HTMLButtonElement>('button.dash-source-label')!;
    expect(label.textContent).toBe('Live sales · fixture · rows · not fetched');
    label.click();
    expect(opened).toHaveLength(1);
  });

  it('opens the source sheet on it with no rows read and no Download', async () => {
    const readDataset = vi.fn();
    const downloadAsset = vi.fn();
    const sheet = new SourceSheetState();
    render(<SourceSheet artifactId="dash1" sheet={sheet} reader={new SnapshotReader({ readDataset } as never, 'dash1')} host={{ downloadAsset } as never} actorName={() => 'You'} />);
    act(() => sheet.open([{ id: 'live', descriptor: unfetched }]));
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Live sales · fixture · rows · not fetched')).toBeTruthy();
    expect(within(dialog).getByText('This query has not been fetched yet; there are no rows to show.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Download/ })).toBeNull();
    expect(within(dialog).queryByText('Reading the rows…')).toBeNull();
    expect(readDataset).not.toHaveBeenCalled();
    expect(downloadAsset).not.toHaveBeenCalled();
  });
});
