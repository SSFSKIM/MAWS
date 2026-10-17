// A dashboard's views as its exports draw them (P3-E2 M5; E's Decision Logs 15, 24, 32 and 35): every chart block of the
// captured state drawn once, before the export runs, over the descriptor that state names and the snapshot its ref
// names; the same SVG and table bytes the editor draws for the same theme; the named state for a view with no dataset or
// a spec that cannot be read; a snapshot that cannot be read failing the whole export; a held legacy dashboard refused;
// and the Markdown of a view: caption, the bounded preview as escaped GFM, its notes, its warnings and its label.
import { describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { generateTokensCss } from '../design-system/css';
import { officeThemeXml } from '../design-system/office';
import { resolveDsVars } from '../design-system/resolve-vars';
import { builtinView, snapshotCss, type SystemSnapshot } from '../design-system/view';
import { parseTokens } from '../design-system/tokens';
import { defaultSystem } from '../types/design_system/defaults';
import { substituteVars, type DesignSystemExport } from '../document/export/design-system';
import { exportSource, defaultAuthorName, type ExportView } from '../document/export/source';
import { newDoc } from '../yjs';
import { schemaFor } from '../document/schema';
import { createDocument } from '../document/tabs';
import { setDataset } from './datasets';
import { exportTheme, exportView, prepareViews, viewKey } from './export';
import { BAR, BOUND_AT, descriptor, exportDashboard, OLD_REF, SNAPSHOTS, TABLE, MISSING, UNREADABLE } from './fixtures/export';
import { renderFailure, renderView, THEME_PROPERTIES, themeFrom, type ViewTable } from './render';
import type { SnapshotRef } from './snapshots';

const theme = exportTheme();
const reader = (tables: Record<string, ViewTable> = SNAPSHOTS) => vi.fn(async ({ ref }: SnapshotRef) => {
  const table = tables[ref];
  if (!table) throw new Error(`no snapshot ${ref}`);
  return table;
});
const chartNodes = (doc: ReturnType<typeof exportDashboard>['doc']): Map<string, PMNode> => {
  const out = new Map<string, PMNode>();
  for (const tab of exportSource(doc, 'Board').tabs)
    tab.body.descendants((node) => {
      if (node.type.name === 'chart') out.set(String(node.attrs.id), node);
      return true;
    });
  return out;
};

describe('prepareViews', () => {
  it('draws each chart block over the captured descriptor and its snapshot, the bytes the editor draws', async () => {
    const { doc } = exportDashboard();
    const read = reader();
    const views = await prepareViews(doc, { read, theme, authorName: defaultAuthorName });
    const nodes = chartNodes(doc);
    const bar = views(nodes.get('c1')!)!;
    expect(bar.svg).toBe(renderView(BAR, SNAPSHOTS[OLD_REF], theme, 'sales').svg);
    expect([bar.width, bar.height]).toEqual([theme.width, Number(/height="([\d.]+)"/.exec(bar.svg!)![1])]);
    expect(bar.caption).toBe('Sales by region');
    expect(bar.sourceLabel).toBe('Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Claude');
    const table = views(nodes.get('c2')!)!;
    const drawn = renderView(TABLE, SNAPSHOTS[OLD_REF], theme, 'sales');
    expect(table.html).toBe(drawn.html);
    expect(table.table).toEqual(drawn.table);
    // one read per snapshot, whatever the number of views over it
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ ref: OLD_REF, format: 'csv' });
  });

  it('draws the named state for a view with no dataset and one whose spec cannot be read', async () => {
    const { doc } = exportDashboard();
    const views = await prepareViews(doc, { read: reader(), theme, authorName: defaultAuthorName });
    const nodes = chartNodes(doc);
    const missing = views(nodes.get('c4')!)!;
    expect(missing.svg).toBe(renderView(MISSING, null, theme, 'refunds').svg);
    expect(missing.svg).toContain('no dataset &quot;refunds&quot;');
    expect(missing.sourceLabel).toBe('no dataset "refunds"');
    expect(missing.markdown).toContain('no dataset "refunds"');
    const unreadable = views(nodes.get('c5')!)!;
    expect(unreadable.svg).toBe(renderView(UNREADABLE, SNAPSHOTS[OLD_REF], theme, 'sales').svg);
    expect(unreadable.svg).toContain('unknown view');
  });

  it('fails the whole export when a bound snapshot cannot be read, never a placeholder', async () => {
    const { doc } = exportDashboard();
    await expect(prepareViews(doc, { read: reader({}), theme, authorName: defaultAuthorName })).rejects.toThrow(`no snapshot ${OLD_REF}`);
  });

  it('refuses a held legacy dashboard with its files and the way forward, never a blank export', async () => {
    const doc = newDoc();
    doc.get('files').setAttr('index.html', '<h1>Old</h1>');
    doc.get('files').setAttr('data.csv', 'a\n1\n');
    await expect(prepareViews(doc, { read: reader(), theme, authorName: defaultAuthorName })).rejects.toThrow(/made before dashboards were documents and holds files \(data\.csv, index\.html\)/);
  });

  it('takes a picture of each distinct chart for Word, none of a table', async () => {
    const { doc } = exportDashboard();
    const picture = vi.fn(async (svg: string) => new TextEncoder().encode(`png:${svg.length}`));
    const views = await prepareViews(doc, { read: reader(), theme, authorName: defaultAuthorName, picture });
    const nodes = chartNodes(doc);
    expect(views(nodes.get('c1')!)!.png).toEqual(new TextEncoder().encode(`png:${views(nodes.get('c1')!)!.svg!.length}`));
    expect(views(nodes.get('c2')!)!.png).toBeUndefined();
    const svgs = new Set([...nodes.values()].map((node) => views(node)!.svg).filter(Boolean));
    expect(picture).toHaveBeenCalledTimes(svgs.size);
    expect(picture).toHaveBeenCalledWith(views(nodes.get('c1')!)!.svg, { width: views(nodes.get('c1')!)!.width, height: views(nodes.get('c1')!)!.height });
  });

  it('reads a block’s dataset id from its fence body as the editor does: an imported padded body draws the bound view (E2 panel)', async () => {
    const doc = newDoc();
    createDocument(doc, { title: 'Imported', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'chart', attrs: { id: 'c9', source: '\n  sales  \n\n', spec: BAR } }] }) });
    setDataset(doc, 'sales', descriptor(OLD_REF, BOUND_AT));
    const views = await prepareViews(doc, { read: reader(), theme, authorName: defaultAuthorName });
    const node = exportSource(doc, 'Board').tabs[0]!.body.firstChild!;
    expect(views(node)!.svg).toBe(renderView(BAR, SNAPSHOTS[OLD_REF], theme, 'sales').svg);
    expect(views(node)!.sourceLabel).toBe('Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Claude');
    // the same view as a block naming `sales` exactly: one key
    expect(viewKey(node)).toBe(viewKey({ attrs: { source: 'sales', spec: BAR } }));
  });

  it('answers undefined for a node that is not one of the state’s charts', async () => {
    const { doc } = exportDashboard();
    const views = await prepareViews(doc, { read: reader(), theme, authorName: defaultAuthorName });
    const other = chartNodes(exportDashboard().doc).get('c1')!.type.create({ id: 'zz', source: 'sales', spec: { view: 'pie', x: 'region' } });
    expect(views(other)).toBeUndefined();
    expect(viewKey(other)).not.toBe(viewKey(chartNodes(doc).get('c1')!));
  });
});

describe('exportView', () => {
  const many: ViewTable = { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: Array.from({ length: 40 }, (_, i) => [`k${i}`, i]) };
  const sales = descriptor(OLD_REF, BOUND_AT);

  it('writes a chart’s Markdown as its bounded data preview under its caption, with the notes and the label', () => {
    const view = exportView({ spec: { view: 'line', x: 'k', y: 'v', title: 'Trend' }, datasetId: 'sales', descriptor: sales, table: many, theme, by: 'Owner' });
    const lines = view.markdown.split('\n');
    expect(lines[0]).toBe('**Trend**');
    expect(lines).toContain('| k | v |');
    expect(lines).toContain('| --- | ---: |');
    expect(lines.filter((line) => line.startsWith('| k'))).toHaveLength(26); // the header and 25 rows
    expect(view.markdown).toContain('*first 25 of 40 rows');
    // the label, then (E2 M6) what the view could not show below it, as the other formats place it
    expect(lines.slice(-3)).toEqual(['*Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Owner*', '', '*some category labels are shortened; the source table has them whole*']);
  });

  it('takes an explicit limit up to 100 rows in Markdown, as the table view does', () => {
    const view = exportView({ spec: { view: 'bar', x: 'k', y: 'v', limit: 30 }, datasetId: 'sales', descriptor: sales, table: many, theme, by: 'Owner' });
    expect(view.markdown.split('\n').filter((line) => /^\| k\d/.test(line))).toHaveLength(30);
    expect(view.markdown).not.toContain('first 30');
  });

  it('escapes what would read as markup in a cell, the caption and the label', () => {
    const hostile: ViewTable = { columns: [{ name: 'na|me', type: 'string' }, { name: 'v', type: 'number' }], rows: [['a|b *c* <script> `d` [e](f) \\ _g_\nh', 1]] };
    const view = exportView({ spec: { view: 'table', title: '# *Not* a heading' }, datasetId: 'sales', descriptor: { ...sales, title: '<b>Sales</b>' }, table: hostile, theme, by: 'Owner' });
    expect(view.markdown).toContain('**\\# \\*Not\\* a heading**');
    expect(view.markdown).toContain('| na\\|me | v |');
    expect(view.markdown).toContain('| a\\|b \\*c\\* \\<script\\> \\`d\\` \\[e\\](f) \\\\ \\_g\\_<br>h | 1 |');
    expect(view.markdown).toContain('*\\<b\\>Sales\\</b\\> · from sales.csv');
  });

  it('carries the descriptor’s validation notes and what the view could not show as warnings', () => {
    const mixed = { ...sales, columns: [{ name: 'k', type: 'string' as const }, { name: 'v', type: 'number' as const, mismatches: 2 }] };
    const gaps: ViewTable = { columns: many.columns, rows: [['a', 1], ['b', null], ['c', 3]] };
    const view = exportView({ spec: { view: 'line', x: 'k', y: 'v', colour: 'red' }, datasetId: 'sales', descriptor: mixed, table: gaps, theme, by: 'Owner' });
    expect(view.warnings).toEqual(['2 of 3 values in v are not number', 'unknown key "colour" ignored', '1 row has no v; not drawn']);
    for (const warning of view.warnings!) expect(view.markdown).toContain(warning.replace(/"/g, '"'));
  });

  it('writes the warnings below the label in Markdown as the other formats place them, the preview’s notes above it, each once (E2 M6)', () => {
    const mixed = { ...sales, columns: [{ name: 'k', type: 'string' as const }, { name: 'v', type: 'number' as const, mismatches: 2 }] };
    const view = exportView({ spec: { view: 'line', x: 'k', y: 'v', colour: 'red' }, datasetId: 'sales', descriptor: mixed, table: many, theme, by: 'Owner' });
    const blocks = view.markdown.split('\n\n');
    const label = blocks.indexOf('*Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Owner*');
    expect(label).toBeGreaterThan(0);
    expect(blocks.slice(0, label).some((block) => block.includes('first 25 of 40 rows'))).toBe(true);
    expect(blocks.slice(label + 1)).toEqual([`*${view.warnings!.join(' · ').replace(/"/g, '"')}*`]);
    for (const warning of view.warnings!) expect(view.markdown.split(warning).length - 1, warning).toBe(1);
  });

  it('a state drawn in place is not repeated as a warning', () => {
    const view = exportView({ spec: { view: 'bar', x: 'k', y: 'nope' }, datasetId: 'sales', descriptor: sales, table: many, theme, by: 'Owner' });
    expect(view.svg).toBe(renderFailure({ view: 'bar', x: 'k', y: 'nope' }, theme, 'sales', 'dataset "sales" has no column "nope"').svg);
    expect(view.warnings).toBeUndefined();
    expect(view.markdown).toContain('dataset "sales" has no column "nope"');
  });

  it('is a pure function: equal inputs, equal views', () => {
    const one = exportView({ spec: BAR, datasetId: 'sales', descriptor: sales, table: SNAPSHOTS[OLD_REF], theme, by: 'Owner' });
    const two = exportView({ spec: structuredClone(BAR), datasetId: 'sales', descriptor: structuredClone(sales), table: structuredClone(SNAPSHOTS[OLD_REF]), theme, by: 'Owner' });
    expect(two).toEqual(one satisfies ExportView);
  });
});

describe('exportTheme', () => {
  // the values a scope's stylesheet sets, as the editor's computed style reads them: the declarations in order, the
  // last one winning, every var() substituted
  const scopeProps = (css: string): Record<string, string> => {
    const declared = new Map<string, string>();
    for (const [, name, value] of css.matchAll(/(--ds-[\w-]+):\s*([^;]+);/g)) declared.set(name, value.trim());
    const resolve = (value: string, depth = 0): string => (depth > 8 ? value : substituteVars(value, (name) => (declared.has(name) ? resolve(declared.get(name)!, depth + 1) : undefined), 'take'));
    return Object.fromEntries(THEME_PROPERTIES.map((name) => [name, declared.has(name) ? resolve(declared.get(name)!) : '']));
  };

  it('is the house theme without a system', () => {
    expect(exportTheme()).toEqual(themeFrom({}).theme);
  });

  it('is the theme the editor reads from the governing system’s scope, overrides included: the same figure bytes', () => {
    const view = builtinView();
    const system: DesignSystemExport = { name: view.name, tokens: view.tokens, resolveDsVars: resolveDsVars as DesignSystemExport['resolveDsVars'], officeThemeXml: officeThemeXml as DesignSystemExport['officeThemeXml'] };
    const overrides = { '--ds-color-text': '#203040', '--ds-type-caption-size': '14px' };
    const scope = `${generateTokensCss(view.tokens, { scope: '.s', medium: 'document' })}\n.s {\n  --ds-color-text: #203040;\n  --ds-type-caption-size: 14px;\n}\n`;
    const editor = themeFrom(scopeProps(scope)).theme;
    const exported = exportTheme(system, overrides);
    expect(exported).toEqual(editor);
    expect(exported.ink).toBe('#203040');
    expect(renderView(BAR, SNAPSHOTS[OLD_REF], exported, 'sales').svg).toBe(renderView(BAR, SNAPSHOTS[OLD_REF], editor, 'sales').svg);
  });

  // P3-E Decision Log 37: a system with uploaded faces (the bundled Official's Noto Serif KR). The editor's scope is D's
  // own stylesheet (`snapshotCss`), its faces under private names placed before their authored ones; the export resolves
  // the authored stack. The figure is one figure: the editor's bytes are the export's, naming the authored families.
  describe('a system with uploaded faces', () => {
    const source = defaultSystem('official')!;
    const tokens = parseTokens(source.files['tokens.tokens.json']!).tokens!;
    const snapshot: SystemSnapshot = { tokens, law: '', name: source.name, files: source.files, origin: null };
    const system: DesignSystemExport = { name: source.name, tokens, resolveDsVars: resolveDsVars as DesignSystemExport['resolveDsVars'], officeThemeXml: officeThemeXml as DesignSystemExport['officeThemeXml'] };
    const editorTheme = (overrides?: Record<string, string>) => themeFrom(scopeProps(snapshotCss(snapshot, (ref) => `maws-artifact://sys/3/${ref}`, '.s', 'document', overrides))).theme;

    for (const [name, overrides] of [
      ['the system’s own stack', undefined],
      ['a single-quoted override naming the face', { '--ds-font-body': "'Noto Serif KR', serif" }],
    ] as const) {
      it(`${name}: the editor’s figure bytes are the export’s, naming the authored family`, () => {
        const scope = snapshotCss(snapshot, (ref) => `maws-artifact://sys/3/${ref}`, '.s', 'document', overrides);
        expect(scopeProps(scope)['--ds-font-body']).toMatch(/ds-face-[0-9a-z]+, "Noto Serif KR"/); // the editor's own face, aliased
        const editor = renderView(BAR, SNAPSHOTS[OLD_REF], editorTheme(overrides), 'sales').svg!;
        const exported = renderView(BAR, SNAPSHOTS[OLD_REF], exportTheme(system, overrides ?? {}), 'sales').svg!;
        expect(editor).toBe(exported);
        expect(exported).toMatch(/^<svg [^>]* font-family="[^"]*&quot;Noto Serif KR&quot;/);
        expect(exported).not.toContain('ds-face-');
      });
    }
  });
});
