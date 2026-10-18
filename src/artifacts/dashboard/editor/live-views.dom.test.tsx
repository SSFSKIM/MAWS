// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4; the M3 entry): the editor over a tab's live
// datasets. A live view's source label says the stale time from the live clock and the live bridge's pause beside the
// descriptor's own state, relabelled in place when either moves, never re-reading or redrawing its figure; a history
// preview's view keeps its saved label. The source sheet keeps the rows and time it captured, and beside them a separately
// identified live query block: its server and tool, permission in words, Allow, Revoke, Refresh and (paused for want of a
// session) Start, only while its captured query is still the live one; a newer fetch or a replaced query asks for an
// explicit reopening. A sheet opened over a history preview, or on a file, has no live controls.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayedDocument } from '../../document/editor/nodes/views';
import type { DatasetPage } from '../../host';
import { newDoc } from '../../yjs';
import { setDataset, type DatasetDescriptor } from '../datasets';
import { SnapshotReader } from '../snapshots';
import { DATASET_STATES, utcTime } from '../states';
import { createChartRenderer } from './chart-view';
import { queryIdentity } from '../query';
import { type LiveDatasets, type LiveQueryStatus, type LiveSnapshot } from './live';
import { SourceSheet } from './SourceSheet';
import { SourceSheetState } from './sheet';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const SOURCE = { kind: 'query' as const, server: 'fixture', tool: 'rows', args: { region: 'north' }, schedule: 30, staleAfter: 120 };
const fetched = (ref = 'assets/query-1.json', at = AT, more: Partial<DatasetDescriptor> = {}): DatasetDescriptor =>
  ({ title: 'Live sales', source: { ...SOURCE, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: { kind: 'human' } }, state: { status: 'ok', at }, ...more }) as DatasetDescriptor;
const file: DatasetDescriptor = {
  title: 'Sales file',
  source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'c'.repeat(64), size: 64 },
  columns: [{ name: 'v', type: 'number' }],
  rows: 1,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
};
const page: DatasetPage = { columns: [{ name: 'v', type: 'number' }], rows: [[7]], total: 1, truncated: false };
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};
const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  cleanup();
  document.body.replaceChildren();
});

// A tab's live datasets as the editor reads them: a store the test moves, and gestures it records.
class FakeLive implements LiveDatasets {
  private listeners = new Set<() => void>();
  private current: LiveSnapshot;
  clock = AT;
  grant = vi.fn<(id: string) => Promise<void>>(async () => {});
  revoke = vi.fn<(id: string) => Promise<void>>(async () => {});
  refresh = vi.fn<(id: string) => Promise<void>>(async () => {});
  start = vi.fn(async () => {});
  openSession = vi.fn<(id: string) => void>(() => {});
  constructor(status: Partial<LiveQueryStatus> = {}, shown = true) {
    this.current = { shown, needsStart: false, start: { phase: 'idle' }, queries: new Map([['sales', this.status(status)]]) };
  }
  status(patch: Partial<LiveQueryStatus> = {}): LiveQueryStatus {
    return { identity: queryIdentity(SOURCE), server: 'fixture', tool: 'rows', schedule: 30, snapshot: { ref: 'assets/query-1.json', at: AT }, error: null /* E3 panel */, permission: 'read', pause: null, busy: null, ...patch };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.current;
  now = () => this.clock;
  set(patch: Partial<LiveSnapshot>, status?: Partial<LiveQueryStatus> | null) {
    const queries = new Map(this.current.queries);
    if (status === null) queries.delete('sales');
    else if (status) queries.set('sales', this.status(status));
    this.current = { ...this.current, ...patch, queries };
    for (const listener of [...this.listeners]) listener();
  }
}

function drawView(live: FakeLive, revision?: number) {
  const readDataset = vi.fn(async () => page);
  const renderChart = createChartRenderer({ reader: new SnapshotReader({ readDataset } as never, 'dash1'), actorName: () => 'You', openSource: () => {}, live });
  const doc = newDoc();
  setDataset(doc, 'sales', fetched());
  const into = document.createElement('div');
  document.body.append(into);
  releases.push(renderChart(into, { attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'v', y: 'v', title: 'Sales' } } } as unknown as PMNode, { artifactId: 'dash1', host: {} as never, renderDiagram: async () => '', displayed: displayedDocument(doc, revision) }));
  const label = () => into.querySelector<HTMLButtonElement>('button.dash-source-label')!.textContent;
  return { readDataset, label, into };
}

describe('a live view’s label (E3 M3)', () => {
  it('says the bridge’s pause and the stale time in place, relabelled without reading or redrawing the figure', async () => {
    const live = new FakeLive({ pause: 'noRoute' });
    const v = drawView(live);
    await settle();
    const base = `Live sales · fixture · rows · updated ${utcTime(AT)} by You`;
    expect(v.label()).toBe(`${base} · ${DATASET_STATES.paused}`);
    const figure = v.into.querySelector('svg');
    act(() => live.set({}, { permission: 'none' }));
    expect(v.label()).toBe(`${base} · ${DATASET_STATES.notAllowed}`);
    live.clock = AT + 120_000;
    act(() => live.set({}, { permission: 'read' }));
    expect(v.label()).toBe(`${base} · ${DATASET_STATES.staleSince(AT + 120_000)}`);
    expect(v.into.querySelector('button.dash-source-label')!.getAttribute('aria-label')).toContain(DATASET_STATES.staleSince(AT + 120_000));
    expect(v.readDataset).toHaveBeenCalledTimes(1);
    expect(v.into.querySelector('svg')).toBe(figure);
  });

  it('in a history preview keeps the version’s saved label: no live pause, no live clock', async () => {
    const live = new FakeLive({ pause: 'noRoute' });
    live.clock = AT + 10 ** 7;
    const v = drawView(live, 4);
    await settle();
    expect(v.label()).toBe(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`);
  });
});

function mountSheet(live: FakeLive | undefined, reopen = vi.fn()) {
  const sheet = new SourceSheetState();
  const readDataset = vi.fn(async () => page);
  render(<SourceSheet artifactId="dash1" sheet={sheet} reader={new SnapshotReader({ readDataset }, 'dash1')} host={{ downloadAsset: vi.fn() }} actorName={() => 'You'} live={live} onReopen={reopen} />);
  return { sheet, readDataset, reopen };
}
const block = () => within(screen.getByRole('dialog')).getByRole('group', { name: 'Live query' });

describe('the source sheet’s live query (E3 M3)', () => {
  it('names the live query, its permission in words, and offers Allow while it has no read grant', async () => {
    const live = new FakeLive({ permission: 'none' });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    const live_ = block();
    expect(within(live_).getByText('fixture · rows')).toBeTruthy();
    expect(within(live_).getByText('Not allowed')).toBeTruthy();
    expect(within(live_).getByText('Refreshes every 30 seconds while this dashboard is on screen')).toBeTruthy();
    expect(within(live_).queryByRole('button', { name: /^Revoke/ })).toBeNull();
    expect(within(live_).getByRole('button', { name: 'Refresh Live sales' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(live_).getByRole('button', { name: 'Allow fixture · rows to read' }));
    expect(live.grant).toHaveBeenCalledWith('sales');
  });

  it('with a read grant offers Revoke and Refresh, the rows captured unchanged by a revoke', async () => {
    const live = new FakeLive();
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText('Allowed to read')).toBeTruthy();
    fireEvent.click(within(block()).getByRole('button', { name: 'Refresh Live sales' }));
    expect(live.refresh).toHaveBeenCalledWith('sales');
    fireEvent.click(within(block()).getByRole('button', { name: 'Revoke fixture · rows' }));
    expect(live.revoke).toHaveBeenCalledWith('sales');
    act(() => live.set({}, { permission: 'none' }));
    expect(within(block()).getByText('Not allowed')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getAllByRole('row')).toHaveLength(2); // the captured rows stay
    expect(m.readDataset).toHaveBeenCalledTimes(1);
  });

  it('while the dashboard is not on screen, Refresh waits and says why', async () => {
    const live = new FakeLive({}, false);
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByRole('button', { name: 'Refresh Live sales' }).hasAttribute('disabled')).toBe(true);
    expect(within(block()).getByText('Refresh is available while this dashboard is on screen.')).toBeTruthy();
  });

  it('paused for want of a session explains it and offers the owner’s Start, its words and the session it opened', async () => {
    const live = new FakeLive({ pause: 'noRoute' });
    live.set({ needsStart: true });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText(/No live session for this dashboard has this server/)).toBeTruthy();
    fireEvent.click(within(block()).getByRole('button', { name: 'Start session' }));
    expect(live.start).toHaveBeenCalledTimes(1);
    act(() => live.set({ start: { phase: 'card', appSessionId: 'a1111111-1111-4111-8111-111111111111', words: 'Trust this folder first' } }));
    expect(within(block()).getByRole('status').textContent).toBe('Trust this folder first');
    fireEvent.click(within(block()).getByRole('button', { name: 'Open session' }));
    expect(live.openSession).toHaveBeenCalledWith('a1111111-1111-4111-8111-111111111111');
    act(() => live.set({ start: { phase: 'starting', appSessionId: 'a1111111-1111-4111-8111-111111111111' } }));
    expect(within(block()).getByRole('button', { name: 'Start session' }).hasAttribute('disabled')).toBe(true);
  });

  it('a grant refused for want of a session explains it beside Start; with no grant and no pause, says how to allow it', async () => {
    const live = new FakeLive({ permission: 'none', pause: 'noRoute' });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText('Not allowed')).toBeTruthy();
    expect(within(block()).getByText(/No live session for this dashboard has this server/)).toBeTruthy();
    expect(within(block()).getByRole('button', { name: 'Start session' })).toBeTruthy();
    act(() => live.set({}, { permission: 'none', pause: null }));
    expect(within(block()).getByText('Allow it to read before this dashboard can refresh it.')).toBeTruthy();
    expect(within(block()).queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  it('a newer fetch keeps the captured rows and time, and offers to show the latest on an explicit reopening', async () => {
    const live = new FakeLive({ snapshot: { ref: 'assets/query-2.json', at: AT + 60_000 } });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`)).toBeTruthy();
    expect(within(block()).getByText(`Newer rows were fetched at ${utcTime(AT + 60_000)}; the rows here are the ones captured when the source opened.`)).toBeTruthy();
    expect(m.readDataset).toHaveBeenCalledWith('dash1', 'assets/query-1.json', { format: 'json' });
    fireEvent.click(within(block()).getByRole('button', { name: 'Show latest' }));
    expect(m.reopen).toHaveBeenCalledWith('sales');
  });

  it('a query replaced or removed since the capture has no controls, only the way to the current one', async () => {
    const live = new FakeLive({ identity: queryIdentity({ ...SOURCE, args: { region: 'south' } }) });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText(/This query was replaced or removed/)).toBeTruthy();
    for (const name of [/^Allow/, /^Revoke/, /^Refresh/, 'Start session']) expect(within(block()).queryByRole('button', { name })).toBeNull();
    fireEvent.click(within(block()).getByRole('button', { name: 'Show current' }));
    expect(m.reopen).toHaveBeenCalledWith('sales');
    act(() => live.set({}, null));
    expect(within(block()).getByText(/This query was replaced or removed/)).toBeTruthy();
  });

  it('opened over a history preview, or on a file, shows no live controls at all', async () => {
    const live = new FakeLive({ pause: 'noRoute' });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }], 'sales', undefined, undefined, true));
    await settle();
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Live query' })).toBeNull();
    expect(within(screen.getByRole('dialog')).queryAllByRole('button', { name: /Allow|Revoke|Refresh|Start/ })).toHaveLength(0);
    act(() => m.sheet.open([{ id: 'file', descriptor: file }]));
    await settle();
    expect(within(screen.getByRole('dialog')).queryByRole('group', { name: 'Live query' })).toBeNull();
  });
});

// E3 M3 fix (Decision Log 12): the sheet says the concrete refusal, not a generic "allow it", and does not offer the
// gesture that was just refused; reopening offers it once more. A history preview or suggestion review that begins while
// the sheet is open takes its live controls away, its captured rows and hold kept, and returns them when it ends.
describe('the source sheet’s live query after a refusal (E3 M3 fix)', () => {
  it('a grant refused as not read-only says so, takes Allow and Refresh away, and offers Allow again on reopening', async () => {
    const live = new FakeLive({ permission: 'none' });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    fireEvent.click(within(block()).getByRole('button', { name: 'Allow fixture · rows to read' }));
    act(() => live.set({}, { permission: 'none', pause: 'mayWrite' }));
    expect(within(block()).getByText('This tool may change data, so it cannot refresh a dataset.')).toBeTruthy();
    expect(within(block()).queryByText('Allow it to read before this dashboard can refresh it.')).toBeNull();
    expect(within(block()).queryByRole('button', { name: /^Allow/ })).toBeNull();
    expect(within(block()).getByRole('button', { name: 'Refresh Live sales' }).hasAttribute('disabled')).toBe(true);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }])); // the owner opens it again: one more try
    await settle();
    expect(within(block()).getByText('This tool may change data, so it cannot refresh a dataset.')).toBeTruthy();
    fireEvent.click(within(block()).getByRole('button', { name: 'Allow fixture · rows to read' }));
    expect(live.grant).toHaveBeenCalledTimes(2);
    act(() => live.set({}, { permission: 'none', pause: 'mayWrite' })); // refused again
    expect(within(block()).queryByRole('button', { name: /^Allow/ })).toBeNull();
  });

  it('a refresh that failed or the watch limit is said as itself, even with no read grant', async () => {
    const live = new FakeLive({ permission: 'none', pause: 'failed' });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText('The last refresh did not reach the dashboard.')).toBeTruthy();
    act(() => live.set({}, { permission: 'none', pause: 'watchLimit' }));
    expect(within(block()).getByText(/Too many live tools are open in MAWS/)).toBeTruthy();
  });

  it('a history preview or suggestion review begun while the sheet is open takes its controls away until it ends', async () => {
    const live = new FakeLive();
    const m = mountSheet(live);
    const lease = { ready: Promise.resolve(), invalidated: new Promise<void>(() => {}), release: vi.fn() };
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }], 'sales', lease));
    await settle();
    expect(within(block()).getByRole('button', { name: 'Revoke fixture · rows' })).toBeTruthy();
    act(() => m.sheet.setPreviewing(true));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('group', { name: 'Live query' })).toBeNull();
    expect(within(dialog).queryAllByRole('button', { name: /Allow|Revoke|Refresh|Start/ })).toHaveLength(0);
    expect(within(dialog).getAllByRole('row')).toHaveLength(2); // the captured rows stay, read once, still held
    expect(lease.release).not.toHaveBeenCalled();
    act(() => m.sheet.setPreviewing(false));
    expect(within(block()).getByRole('button', { name: 'Revoke fixture · rows' })).toBeTruthy();
    expect(m.readDataset).toHaveBeenCalledTimes(1);
  });
});

// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16): a newer fetch time is new
// provenance even when identical rows kept the ref, and the live block says the live descriptor's committed error in
// the source label's words beside its controls; the captured rows and time never change underneath.
describe('the source sheet’s live query after the panel (E3 panel)', () => {
  it('a refetch of identical rows (the same ref, a newer time) keeps the captured time and offers to show the latest', async () => {
    const live = new FakeLive();
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).queryByRole('button', { name: 'Show latest' })).toBeNull(); // the fetch it captured
    act(() => live.set({}, { snapshot: { ref: 'assets/query-1.json', at: AT + 60_000 } }));
    expect(within(block()).getByText(`Newer rows were fetched at ${utcTime(AT + 60_000)}; the rows here are the ones captured when the source opened.`)).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`)).toBeTruthy();
    expect(within(dialog).getAllByRole('row')).toHaveLength(2);
    expect(m.readDataset).toHaveBeenCalledTimes(1);
    fireEvent.click(within(block()).getByRole('button', { name: 'Show latest' }));
    expect(m.reopen).toHaveBeenCalledWith('sales');
  });

  it('says the live descriptor’s committed error beside Allowed, Revoke and Refresh, the captured label and rows unchanged', async () => {
    const words = 'the last refresh was refused: its structured content is neither an array of rows nor an object with a rows array';
    const live = new FakeLive({ error: words });
    const m = mountSheet(live);
    act(() => m.sheet.open([{ id: 'sales', descriptor: fetched() }]));
    await settle();
    expect(within(block()).getByText(words)).toBeTruthy();
    expect(within(block()).getByText('Allowed to read')).toBeTruthy();
    expect(within(block()).getByRole('button', { name: 'Revoke fixture · rows' })).toBeTruthy();
    expect(within(block()).getByRole('button', { name: 'Refresh Live sales' }).hasAttribute('disabled')).toBe(false);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`)).toBeTruthy(); // as captured
    expect(within(dialog).getAllByRole('row')).toHaveLength(2);
    expect(within(block()).queryByRole('button', { name: 'Show latest' })).toBeNull(); // a failure moves no fetch time
    act(() => live.set({}, { error: null })); // a later success
    expect(within(block()).queryByText(words)).toBeNull();
    expect(m.readDataset).toHaveBeenCalledTimes(1);
  });
});
