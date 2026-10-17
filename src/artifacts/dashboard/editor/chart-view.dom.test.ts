// A dashboard's chart block in the editor (P3-E2 M3): the node view's drawing through E's renderer over the displayed
// document's descriptor and the snapshot it names; its caption, source label and notes; a replacement redrawing it
// without a stale paint winning; the displayed document moving; its release; and the host's hover around the figure.
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DatasetPage } from '../../host';
import { displayedDocument, type ViewEnvironment } from '../../document/editor/nodes/views';
import { newDoc, type Doc } from '../../yjs';
import { removeDataset, setDataset, type FileDatasetDescriptor } from '../datasets'; // E3: the file arm
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { coreExtensionOptions } from '../../document/ids';
import { editorExtensions } from '../../document/editor/extensions';
import { memoryEditorHost } from '../../document/editor/memory-host';
import { createChartRenderer, type SourceCapture } from './chart-view';
import { SnapshotReader } from '../snapshots';

const AT = Date.UTC(2026, 9, 16, 8, 30);
const descriptor = (ref: string, over: Partial<FileDatasetDescriptor> = {}): FileDatasetDescriptor => ({ // E3: the file arm of the descriptor union
  title: '지역별 매출',
  source: { kind: 'file', ref, name: 'sales.csv', format: 'csv', sha256: 'a'.repeat(64), size: 42 },
  columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number' }],
  rows: 3,
  updated: { at: AT, by: { kind: 'session', appSessionId: 'app-1' as AppSessionId } },
  state: { status: 'ok', at: AT },
  ...over,
});
const SNAPSHOTS: Record<string, DatasetPage> = {
  'assets/sales.csv': { columns: descriptor('').columns, rows: [['서울', 12], ['부산', 7], ['제주', 3]], total: 3, truncated: false },
  'assets/sales-2.csv': { columns: descriptor('').columns, rows: [['서울', 20], ['부산', 9], ['제주', 4]], total: 3, truncated: false },
};

interface Pending {
  ref: string;
  resolve(): void;
}
function world({ hold = false } = {}) {
  const pending: Pending[] = [];
  const readDataset = vi.fn((_artifactId: string, ref: string): Promise<DatasetPage> => {
    const page = SNAPSHOTS[ref];
    if (!page) return Promise.reject(new Error(`no asset ${ref}`));
    if (!hold) return Promise.resolve(page);
    return new Promise((resolve) => pending.push({ ref, resolve: () => resolve(page) }));
  });
  const opened: SourceCapture[] = [];
  const renderChart = createChartRenderer({ reader: new SnapshotReader({ readDataset } as never, 'dash1'), actorName: (actor) => (actor.kind === 'human' ? 'You' : 'Claude'), openSource: (capture) => opened.push(capture) });
  return { pending, readDataset, opened, renderChart };
}

const node = (source: string, spec: unknown = { view: 'bar', x: 'region', y: 'sales', title: 'Sales by region' }) => ({ attrs: { id: 'c1', source, spec } }) as unknown as PMNode;
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const tips = (into: HTMLElement) => [...into.querySelectorAll('[data-tip]')].map((el) => el.getAttribute('data-tip'));
const releases: Array<() => void> = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
});

function mount(renderChart: NonNullable<ViewEnvironment['renderChart']>, doc: Doc, n = node('sales'), attach = true) {
  const into = document.createElement('div');
  if (attach) document.body.append(into);
  const shown = displayedDocument(doc);
  const release = renderChart(into, n, { artifactId: 'dash1', host: {} as never, renderDiagram: async () => '', displayed: shown });
  releases.push(release);
  return { into, shown, release };
}

describe('the chart view', () => {
  it('draws the descriptor\'s snapshot with its caption and source label, and opens the source on the label', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into } = mount(w.renderChart, doc);
    await settle();
    expect(into.querySelector('.dash-caption')?.textContent).toBe('Sales by region');
    expect(into.querySelector('svg')?.getAttribute('aria-label')).toBe('Sales by region');
    expect(tips(into)).toEqual(['서울 · sales: 12', '부산 · sales: 7', '제주 · sales: 3']);
    const label = into.querySelector<HTMLButtonElement>('button.dash-source-label')!;
    expect(label.textContent).toBe('지역별 매출 · from sales.csv · updated 2026-10-16 08:30 UTC by Claude');
    label.click();
    expect(w.opened).toEqual([{ datasetId: 'sales', descriptor: descriptor('assets/sales.csv'), view: { spec: { view: 'bar', x: 'region', y: 'sales', title: 'Sales by region' }, caption: 'Sales by region' } }]);
    expect(w.readDataset).toHaveBeenCalledWith('dash1', 'assets/sales.csv', { format: 'csv' });
  });

  it('reads its dataset id from the fence body as history and the exports do: trimmed, blank lines included; else none (E2 panel)', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into } = mount(w.renderChart, doc, node('\n  sales  \n\n'));
    await settle();
    expect(tips(into)).toEqual(['서울 · sales: 12', '부산 · sales: 7', '제주 · sales: 3']);
    into.querySelector<HTMLButtonElement>('button.dash-source-label')!.click();
    expect(w.opened[0]?.datasetId).toBe('sales');
    const odd = mount(w.renderChart, doc, node(42 as unknown as string, { view: 'bar', x: 'region', y: 'sales' })).into;
    await settle();
    expect(odd.querySelector('.dash-caption')?.textContent).toBe('Bar chart of ');
    expect(odd.querySelector('.dash-source')?.textContent).toBe('no dataset ""');
  });

  it('times each drawing as a `dash:view` User Timing entry naming its dataset and caption, and keeps none in the timeline (E2 M6)', async () => {
    const measure = vi.spyOn(performance, 'measure');
    const cleared = vi.spyOn(performance, 'clearMeasures');
    try {
      const doc = newDoc();
      setDataset(doc, 'sales', descriptor('assets/sales.csv'));
      mount(world().renderChart, doc);
      await settle();
      const calls = measure.mock.calls.filter(([name]) => name === 'dash:view');
      expect(calls).toHaveLength(1);
      const options = calls[0]![1] as PerformanceMeasureOptions;
      expect(options.detail).toEqual({ dataset: 'sales', caption: 'Sales by region' });
      expect(options.end! - (options.start as number)).toBeGreaterThanOrEqual(0);
      expect(cleared).toHaveBeenCalledWith('dash:view');
      expect(performance.getEntriesByName('dash:view')).toEqual([]);
    } finally {
      measure.mockRestore();
      cleared.mockRestore();
    }
  });

  it('keeps the browser’s own caret out of a press on the view, leaving the editor’s block selection alone; its controls keep theirs (E2 M6)', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const { into, release } = mount(world().renderChart, doc);
    await settle();
    // the editor's own listener sits on an ancestor: it must see the press unrefused, or ProseMirror ignores it
    const seenByEditor: boolean[] = [];
    into.addEventListener('mousedown', (event) => seenByEditor.push(event.defaultPrevented));
    const press = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(into.querySelector('.dash-caption')!)).toBe(true);
    expect(press(into.querySelector('.dash-figure svg')!)).toBe(true);
    expect(press(into.querySelector('button.dash-source-label')!)).toBe(false);
    expect(seenByEditor).toEqual([false, false, false]);
    release();
    expect(press(into.querySelector('.dash-caption')!)).toBe(false);
  });

  it('takes the keyboard for the editor on a press on the view when the editor does not hold it, the block selection kept; its controls keep theirs (E2 landing)', async () => {
    const data = newDoc();
    setDataset(data, 'sales', descriptor('assets/sales.csv'));
    const renderChart = world().renderChart;
    const e = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      coreExtensionOptions,
      extensions: editorExtensions({ collaboration: null, env: { artifactId: 'dash1', host: memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }), renderChart, displayed: displayedDocument(data) } }),
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Sales rose in every region.' }] }, { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } }] },
    });
    releases.push(() => e.destroy());
    await settle();
    const at = e.state.doc.child(0).nodeSize;
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, at)));
    // the keyboard left the editor for a control that is then gone (a drawer's Close): the page's body holds it
    const parked = document.body.appendChild(document.createElement('button'));
    parked.focus();
    parked.remove();
    expect(e.view.dom.contains(document.activeElement)).toBe(false);
    const press = (target: Element) => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    press(e.view.dom.querySelector('.dash-source-label')!);
    expect(e.view.dom.contains(document.activeElement)).toBe(false); // the source label's press is its own
    press(e.view.dom.querySelector('.dash-caption')!);
    expect(e.view.dom.contains(document.activeElement)).toBe(true);
    expect(e.view.hasFocus()).toBe(true);
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect(e.state.selection.from).toBe(at);
  });

  it('redraws on a replacement, never letting an earlier snapshot\'s late read paint over it', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world({ hold: true });
    const { into } = mount(w.renderChart, doc);
    await settle();
    setDataset(doc, 'sales', descriptor('assets/sales-2.csv', { updated: { at: AT + 60_000, by: { kind: 'human' } } }));
    await settle();
    expect(w.pending.map((p) => p.ref)).toEqual(['assets/sales.csv', 'assets/sales-2.csv']);
    w.pending[1].resolve();
    await settle();
    expect(tips(into)).toEqual(['서울 · sales: 20', '부산 · sales: 9', '제주 · sales: 4']);
    w.pending[0].resolve(); // the earlier read answers last
    await settle();
    expect(tips(into)).toEqual(['서울 · sales: 20', '부산 · sales: 9', '제주 · sales: 4']);
    expect(into.querySelector('.dash-source-label')?.textContent).toContain('updated 2026-10-16 08:31 UTC by You');
  });

  it('keeps the earlier figure, dimmed, while a replacement\'s rows are read', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world({ hold: true });
    const { into } = mount(w.renderChart, doc);
    await settle();
    w.pending[0].resolve();
    await settle();
    setDataset(doc, 'sales', descriptor('assets/sales-2.csv'));
    await settle();
    expect(into.querySelector('.dash-view')?.getAttribute('aria-busy')).toBe('true');
    expect(tips(into)).toEqual(['서울 · sales: 12', '부산 · sales: 7', '제주 · sales: 3']);
    w.pending[1].resolve();
    await settle();
    expect(into.querySelector('.dash-view')?.getAttribute('aria-busy')).toBeNull();
  });

  it('draws the named states in place: no dataset, removal, an unreadable snapshot, a missing column; notes mismatches', async () => {
    const doc = newDoc();
    const w = world();
    const { into } = mount(w.renderChart, doc);
    await settle();
    expect(into.querySelector('svg')?.textContent).toContain('no dataset "sales"');
    expect(into.querySelector('.dash-caption')?.textContent).toBe('Sales by region');
    expect(into.querySelector('.dash-source-label')?.tagName).not.toBe('BUTTON');
    setDataset(doc, 'sales', descriptor('assets/gone.csv'));
    await settle();
    expect(into.querySelector('svg')?.textContent).toContain('the file of "sales" could not be read');
    setDataset(doc, 'sales', descriptor('assets/sales.csv', { columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number', mismatches: 1 }] }));
    await settle();
    expect(into.querySelector('.dash-notes')?.textContent).toContain('1 of 3 values in sales are not number');
    removeDataset(doc, 'sales');
    await settle();
    expect(into.querySelector('svg')?.textContent).toContain('no dataset "sales"');
    const other = mount(w.renderChart, doc, node('sales', { view: 'bar', x: 'region', y: 'revenue' }));
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    await settle();
    expect(other.into.querySelector('svg')?.textContent).toContain('dataset "sales" has no column "revenue"');
  });

  it('follows the displayed document when it moves (a preview put on another version)', async () => {
    const live = newDoc();
    setDataset(live, 'sales', descriptor('assets/sales-2.csv'));
    const version = newDoc();
    setDataset(version, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into, shown } = mount(w.renderChart, live);
    await settle();
    expect(tips(into)[0]).toBe('서울 · sales: 20');
    shown.set(version, 4);
    await settle();
    expect(tips(into)[0]).toBe('서울 · sales: 12');
    setDataset(live, 'sales', descriptor('assets/gone.csv')); // the live doc is no longer the one shown
    await settle();
    expect(tips(into)[0]).toBe('서울 · sales: 12');
  });

  it('waits to draw until it is in the page, and draws nothing once released', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into, release } = mount(w.renderChart, doc, node('sales'), false);
    await settle();
    expect(into.querySelector('svg')).toBeNull();
    document.body.append(into);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle();
    expect(into.querySelector('svg')).not.toBeNull();
    release();
    const reads = w.readDataset.mock.calls.length;
    setDataset(doc, 'sales', descriptor('assets/sales-2.csv'));
    await settle();
    expect(w.readDataset.mock.calls.length).toBe(reads);
    expect(tips(into)[0]).toBe('서울 · sales: 12');
  });
});

describe('a table view', () => {
  it('is a native table in the page, its numbers marked, no figure', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into } = mount(w.renderChart, doc, node('sales', { view: 'table', sort: { by: 'sales', dir: 'desc' }, title: 'All regions' }));
    await settle();
    expect(into.querySelector('svg')).toBeNull();
    const table = into.querySelector('.dash-figure > table.dash-table')!;
    expect([...table.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual(['서울12', '부산7', '제주3']);
    expect(table.querySelector('th.dash-num')?.textContent).toBe('sales');
    expect(into.querySelector('.dash-caption')?.textContent).toBe('All regions');
  });
});

describe('the theme', () => {
  const pollFor = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  it('redraws from its cached rows when the document\'s overrides change what the page resolves, no dataset change needed', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const w = world();
    const { into } = mount(w.renderChart, doc);
    into.style.setProperty('--ds-color-text', '#123456');
    await settle();
    await pollFor(() => into.querySelector('svg')?.getAttribute('fill') === '#123456');
    expect(into.querySelector('svg')?.getAttribute('fill')).toBe('#123456');
    const reads = w.readDataset.mock.calls.length;
    into.style.setProperty('--ds-color-text', '#654321');
    doc.get('meta').setAttr('dsOverrides', { '--ds-color-text': '#654321' });
    await pollFor(() => into.querySelector('svg')?.getAttribute('fill') === '#654321');
    expect(into.querySelector('svg')?.getAttribute('fill')).toBe('#654321');
    expect(w.readDataset.mock.calls.length).toBe(reads); // the rows came from the reader's cache
  });

  it('redraws when D\'s scope style is rewritten in place (the governing system changed), and not once released', async () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor('assets/sales.csv'));
    const style = document.head.appendChild(document.createElement('style'));
    style.setAttribute('data-ds-scope-style', '');
    style.textContent = '.scope-a { --ds-color-text: #111111; }';
    const host = document.body.appendChild(document.createElement('div'));
    host.className = 'scope-a';
    const w = world();
    const into = host.appendChild(document.createElement('div'));
    into.className = 'scope-a'; // (happy-dom resolves a stylesheet's custom property on the matched element itself)
    const release = w.renderChart(into, node('sales'), { artifactId: 'dash1', host: {} as never, renderDiagram: async () => '', displayed: displayedDocument(doc) });
    try {
      await settle();
      await pollFor(() => into.querySelector('svg')?.getAttribute('fill') === '#111111');
      expect(into.querySelector('svg')?.getAttribute('fill')).toBe('#111111');
      style.textContent = '.scope-a { --ds-color-text: #222222; }';
      await pollFor(() => into.querySelector('svg')?.getAttribute('fill') === '#222222');
      expect(into.querySelector('svg')?.getAttribute('fill')).toBe('#222222');
      release();
      style.textContent = '.scope-a { --ds-color-text: #333333; }';
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(into.querySelector('svg')?.getAttribute('fill')).toBe('#222222');
    } finally {
      style.remove();
    }
  });
});

describe('hover', () => {
  const points = (n: number): DatasetPage => ({ columns: [{ name: 'step', type: 'number' }, { name: 'level', type: 'number' }], rows: Array.from({ length: n }, (_, i) => [i, (i % 7) - 3]), total: n, truncated: false });

  it('shows the value of the point nearest the pointer, the last of 3,000 included', async () => {
    const doc = newDoc();
    setDataset(doc, 'walk', descriptor('assets/walk.csv', { columns: points(1).columns, rows: 3_000 }));
    SNAPSHOTS['assets/walk.csv'] = points(3_000);
    const w = world();
    const { into } = mount(w.renderChart, doc, node('walk', { view: 'line', x: 'step', y: 'level' }));
    await settle();
    const svg = into.querySelector('svg')!;
    const layer = svg.querySelector('[data-hover="nearest"]')!;
    const [x, y] = layer.getAttribute('data-xy')!.split(' ').at(-1)!.split(',').map(Number);
    // the figure drawn at its own size: one SVG unit per CSS pixel
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 2, clientY: y - 1 }));
    const tip = into.querySelector<HTMLElement>('.dash-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe(`2999 · level: ${(2999 % 7) - 3}`);
    svg.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
    expect(tip.hidden).toBe(true);
  });

  it('reaches a point in the last of many panels (small multiples, parent Decision Log 27), its tip naming the series', async () => {
    const columns = [{ name: 'step', type: 'number' as const }, { name: 'level', type: 'number' as const }, { name: 'site', type: 'string' as const }];
    const rows = Array.from({ length: 9 * 40 }, (_, k) => [k % 40, Math.floor(k / 40) + (k % 40) / 10, `관측소 ${Math.floor(k / 40) + 1}`]);
    SNAPSHOTS['assets/sites.csv'] = { columns, rows, total: rows.length, truncated: false };
    const doc = newDoc();
    setDataset(doc, 'sites', descriptor('assets/sites.csv', { columns, rows: rows.length }));
    const w = world();
    const { into } = mount(w.renderChart, doc, node('sites', { view: 'line', x: 'step', y: 'level', series: 'site' }));
    await settle();
    const svg = into.querySelector('svg')!;
    expect([...svg.querySelectorAll('g[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(Array.from({ length: 9 }, (_, i) => `관측소 ${i + 1}`));
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const layer = svg.querySelector('[data-hover="nearest"]')!;
    const [x, y] = layer.getAttribute('data-xy')!.split(' ').at(-1)!.split(',').map(Number);
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x - 1, clientY: y + 1 }));
    expect(into.querySelector('.dash-tip')?.textContent).toBe('39 · 관측소 9 · level: 11.9');
  });

  it('shows a hatched bar\'s own value: the hatching never takes the pointer', async () => {
    const doc = newDoc();
    const columns = [{ name: 'region', type: 'string' as const }, { name: 'kind', type: 'string' as const }, { name: 'sales', type: 'number' as const }];
    SNAPSHOTS['assets/kinds.csv'] = { columns, rows: [['서울', 'a', 1], ['서울', 'b', 2], ['서울', 'c', 3]], total: 3, truncated: false };
    setDataset(doc, 'kinds', descriptor('assets/kinds.csv', { columns }));
    const w = world();
    const { into } = mount(w.renderChart, doc, node('kinds', { view: 'bar', x: 'region', y: 'sales', series: 'kind' }));
    await settle();
    const hatched = [...into.querySelectorAll('path[pointer-events="none"]')];
    expect(hatched.length).toBeGreaterThan(0);
    const bar = hatched.map((h) => h.previousElementSibling!).find((el) => el.hasAttribute('data-tip'))!; // the legend's keys come first
    bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(into.querySelector('.dash-tip')?.textContent).toBe('서울 · c · sales: 3');
  });
});
