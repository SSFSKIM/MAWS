// The dashboard's four exporters in main (P3-E2 M5; E's Decision Logs 15, 32 and 35; ledger X31): B's md, html, docx and
// pdf run for `dashboard`, governed by D as B's are, each handed the views of the state the export captured. The rows
// are read page by page through the host's `artifacts.readDataset` at the captured descriptor's ref, the export's signal
// checked before and after every page, so a replacement landing while an export reads its first page changes nothing in
// any of the four files; a snapshot that cannot be read, a cancelled export and a held legacy dashboard each fail the
// export with nothing written; and Word alone takes pictures, one per chart, none of a table.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {} }));
import { exportTheme } from '@artifacts/dashboard/export';
import { BOUND_AT, descriptor, exportDashboard, NEW_REF, OLD_REF, OWNER, REPLACED_AT, SNAPSHOTS } from '@artifacts/dashboard/fixtures/export';
import { setDataset } from '@artifacts/dashboard/datasets';
import { renderView } from '@artifacts/dashboard/render';
import { writeSystem } from '@artifacts/design-system/model';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { DocumentExportContext, DocumentExporter, DocumentExportFormat, DocumentExportRequest } from '../artifacts/export-document';
import { registerDashboardExporters, type DashboardExportDeps, type OpenPictures } from './export';

const ID = '00000000-0000-4000-8000-0000000000d1';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const PDF = new TextEncoder().encode('%PDF-1.7 printed');
const PAGE = 2; // rows per page the fake host answers, whatever the limit: the reader continues at the rows answered

/** The engine host as main reaches it: the house system governs; `sales`'s snapshots answer by ref, two rows a page. */
function host(over: { readDataset?: (input: CommandInput<'artifacts.readDataset'>) => Promise<CommandResult<'artifacts.readDataset'>> } = {}) {
  const pages: CommandInput<'artifacts.readDataset'>[] = [];
  const page = async (input: CommandInput<'artifacts.readDataset'>): Promise<CommandResult<'artifacts.readDataset'>> => {
    const table = SNAPSHOTS[input.ref];
    if (input.artifactId !== ID || !table) return { ok: false, error: ipcError('invalid_input', `no asset ${input.ref}`, { reason: 'notFound', data: {} }) };
    const offset = input.offset ?? 0;
    const rows = table.rows.slice(offset, offset + PAGE) as (string | number)[][];
    return { ok: true, value: { columns: [...table.columns], rows, total: table.rows.length, truncated: offset + rows.length < table.rows.length } };
  };
  const call = vi.fn(async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    if (name === 'designSystems.governing') return { ok: true, value: { system: { builtin: true } } } as never;
    if (name === 'artifacts.readDataset') {
      pages.push(input as CommandInput<'artifacts.readDataset'>);
      return (await (over.readDataset ?? page)(input as CommandInput<'artifacts.readDataset'>)) as never;
    }
    throw new Error(`unexpected ${name}`);
  });
  return { call, pages, page };
}

function exporters(call: ReturnType<typeof host>['call'], pictures?: OpenPictures, sessionTitle?: DashboardExportDeps['sessionTitle'], humanAuthorName?: () => string): Map<DocumentExportFormat, DocumentExporter> {
  const out = new Map<DocumentExportFormat, DocumentExporter>();
  registerDashboardExporters(
    (exporter) => {
      out.set(exporter.format, exporter);
      return () => out.delete(exporter.format);
    },
    { call: call as never, env: {}, ...(pictures && { pictures }), ...(sessionTitle && { sessionTitle }), ...(humanAuthorName && { humanAuthorName }) },
  );
  return out;
}

function context(state: Uint8Array, signal = new AbortController().signal) {
  const written = new Map<string, Uint8Array | string>();
  const printed: string[] = [];
  const ctx: DocumentExportContext = {
    title: 'Board',
    state: vi.fn(async () => state),
    readAsset: vi.fn(async () => null),
    printToPdf: vi.fn(async (html: string) => (printed.push(html), PDF)),
    writeFile: vi.fn(async (path: string, data: Uint8Array | string) => void written.set(path, data)),
    signal,
    assets: { list: async () => [] },
  };
  return { ctx, written, printed };
}
const request = (format: DocumentExportFormat): DocumentExportRequest => ({ artifactId: ID, kind: 'dashboard', format, revision: 9, path: `/exports/9-${format}` });
const captured = () => stateV2(exportDashboard().doc);
const fakePictures = (): OpenPictures & { taken: string[]; closed: number } => {
  const open = vi.fn(() => ({
    take: async (svg: string) => (open.taken.push(svg), PNG),
    close: () => void (open.closed += 1),
  })) as unknown as OpenPictures & { taken: string[]; closed: number };
  open.taken = [];
  open.closed = 0;
  return open;
};

async function docxText(bytes: Uint8Array): Promise<{ document: string; media: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  return { document: await zip.file('word/document.xml')!.async('string'), media: Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir) };
}
/** What each format's file says of `sales`: its values and its label's time. */
async function fileText(format: DocumentExportFormat, written: Map<string, Uint8Array | string>, printed: string[]): Promise<string> {
  const data = written.get(`/exports/9-${format}`);
  if (format === 'pdf') return printed.join('');
  if (format === 'docx') return (await docxText(data as Uint8Array)).document;
  return String(data);
}

describe('registerDashboardExporters', () => {
  it('registers dashboard × md, html, docx and pdf, governed by D (the system asked for each run), and removes them', async () => {
    const { call } = host();
    const registered: string[] = [];
    const off = registerDashboardExporters(
      (exporter) => {
        registered.push(`${exporter.kind}:${exporter.format}`);
        return () => registered.splice(registered.indexOf(`${exporter.kind}:${exporter.format}`), 1);
      },
      { call: call as never, env: {} },
    );
    expect(registered).toEqual(['dashboard:md', 'dashboard:html', 'dashboard:docx', 'dashboard:pdf']);
    off();
    expect(registered).toEqual([]);
  });

  for (const format of ['md', 'html', 'docx', 'pdf'] as const) {
    it(`${format}: a replacement landing during the first read leaves the export on the captured snapshot and its time`, async () => {
      // the live dashboard moves `sales` to the new snapshot while the export reads its first page; the export reads on
      const live = exportDashboard().doc;
      const { call, pages, page } = host({
        readDataset: async (input) => {
          if ((input.offset ?? 0) === 0) setDataset(live, 'sales', descriptor(NEW_REF, REPLACED_AT));
          return page(input);
        },
      });
      const pictures = fakePictures();
      const { ctx, written, printed } = context(captured());
      await exporters(call, pictures).get(format)!.run(request(format), ctx);
      expect(pages.map((p) => [p.ref, p.format, p.offset ?? 0])).toEqual([
        [OLD_REF, 'csv', 0],
        [OLD_REF, 'csv', PAGE],
      ]);
      const text = await fileText(format, written, printed);
      expect(text).toContain('updated 2026-10-01 09:00 UTC by Claude');
      expect(text).not.toContain('2026-10-02');
      for (const value of ['North', '10', '20', '30']) expect(text).toContain(value);
      for (const value of ['70', '80', '90']) expect(text).not.toMatch(new RegExp(`>${value}<|\\| ${value} \\|`));
      // Word alone takes pictures: one per distinct chart, the window closed after
      if (format === 'docx') {
        expect(pictures.taken.length).toBeGreaterThan(0);
        expect(pictures.taken).toContain(renderView({ view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }, SNAPSHOTS[OLD_REF], exportTheme(), 'sales').svg);
        expect(pictures.taken.every((svg) => svg.startsWith('<svg'))).toBe(true);
        expect(pictures.closed).toBe(1);
        expect((await docxText(written.get('/exports/9-docx') as Uint8Array)).media.some((name) => name.endsWith('.svg'))).toBe(true);
      } else expect(pictures).not.toHaveBeenCalled();
    });
  }

  it('html and pdf draw the editor’s figure bytes for the governing system, and its views’ CSS resolved', async () => {
    const { call } = host();
    for (const format of ['html', 'pdf'] as const) {
      const { ctx, written, printed } = context(captured());
      await exporters(call).get(format)!.run(request(format), ctx);
      const html = format === 'html' ? String(written.get('/exports/9-html')) : printed[0];
      expect(html).toContain(renderView({ view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }, SNAPSHOTS[OLD_REF], exportTheme(), 'sales').svg);
      expect(html).toContain('<table class="dash-table">');
      expect(html).toContain('.ds-doc .dash-table .dash-num');
      expect(html).not.toContain('var(--ds-');
    }
  });

  it('fails the whole export when a bound snapshot cannot be read: nothing written, no placeholder', async () => {
    const { call } = host({ readDataset: async () => ({ ok: false, error: ipcError('internal', 'disk gone') }) });
    for (const format of ['md', 'html', 'docx', 'pdf'] as const) {
      const { ctx, written, printed } = context(captured());
      await expect(exporters(call).get(format)!.run(request(format), ctx)).rejects.toThrow(`the snapshot ${OLD_REF} could not be read: disk gone`);
      expect(written.size).toBe(0);
      expect(printed).toEqual([]);
    }
  });

  it('checks the export’s signal before and after every page: a cancellation stops the reads and the export', async () => {
    const controller = new AbortController();
    const { call, pages, page } = host({
      readDataset: async (input) => {
        controller.abort(); // the deadline passes while the first page is read
        return page(input);
      },
    });
    const { ctx, written } = context(captured(), controller.signal);
    await expect(exporters(call).get('md')!.run(request('md'), ctx)).rejects.toThrow('the export was cancelled');
    expect(pages).toHaveLength(1);
    expect(written.size).toBe(0);
    const before = context(captured(), AbortSignal.abort());
    const quiet = host();
    await expect(exporters(quiet.call).get('html')!.run(request('html'), before.ctx)).rejects.toThrow('the export was cancelled');
    expect(quiet.pages).toHaveLength(0);
  });

  it('refuses a held legacy dashboard with its files and the way forward, never a blank file', async () => {
    const legacy = newDoc();
    legacy.get('files').setAttr('index.html', '<h1>Old</h1>');
    const { call } = host();
    for (const format of ['md', 'docx'] as const) {
      const { ctx, written } = context(stateV2(legacy));
      await expect(exporters(call).get(format)!.run(request(format), ctx)).rejects.toThrow(/made before dashboards were documents and holds files \(index\.html\)/);
      expect(written.size).toBe(0);
    }
  });

  it('credits data and comments to the named session and the configured human export author', async () => {
    const { call } = host();
    const titles: Record<string, string> = { 'session-a': 'Quarterly review' };
    const titled = exporters(call, fakePictures(), (appSessionId) => titles[appSessionId], () => 'Kim Min');
    const md = context(captured());
    await titled.get('md')!.run(request('md'), md.ctx);
    expect(String(md.written.get('/exports/9-md'))).toContain('updated 2026-10-01 09:00 UTC by Quarterly review');
    expect(String(md.written.get('/exports/9-md'))).not.toContain('by Claude');
    // Word's comments on the chart name the same session and the explicit export author.
    const docx = context(captured());
    await titled.get('docx')!.run(request('docx'), docx.ctx);
    const comments = await (await JSZip.loadAsync(docx.written.get('/exports/9-docx') as Uint8Array)).file('word/comments.xml')!.async('string');
    expect([...comments.matchAll(/w:author="([^"]*)"/g)].map((m) => m[1])).toEqual(['Kim Min', 'Quarterly review']);
    // a session without a title (unknown to the index, or titled blank) is "Claude"
    for (const none of [{}, { 'session-a': '  ' }]) {
      const out = context(captured());
      await exporters(call, undefined, (appSessionId) => (none as Record<string, string>)[appSessionId]).get('md')!.run(request('md'), out.ctx);
      expect(String(out.written.get('/exports/9-md'))).toContain('updated 2026-10-01 09:00 UTC by Claude');
    }
    // The human who bound the data uses the same explicit name, never "You".
    const owned = exportDashboard().doc;
    setDataset(owned, 'sales', descriptor(OLD_REF, BOUND_AT, OWNER));
    const out = context(stateV2(owned));
    await titled.get('md')!.run(request('md'), out.ctx);
    expect(String(out.written.get('/exports/9-md'))).toContain('updated 2026-10-01 09:00 UTC by Kim Min');
  });

  it('a view with no dataset and one that cannot be read export their named states; a dashboard with no view reads nothing', async () => {
    const { call, pages } = host();
    const { ctx, written } = context(captured());
    await exporters(call).get('md')!.run(request('md'), ctx);
    const md = String(written.get('/exports/9-md'));
    expect(md).toContain('**Unbound view**\n\nno dataset "refunds"');
    expect(md).toContain('**Flows**\n\nunknown view "sankey"');
    expect(pages.length).toBeGreaterThan(0);
    const bare = host();
    const plain = newDoc();
    const { ctx: none, written: out } = context(stateV2(plain));
    await exporters(bare.call).get('md')!.run(request('md'), none);
    expect(bare.pages).toHaveLength(0);
    expect(out.size).toBe(1);
  });
});

// P3-E Decision Log 37: a dashboard governed by a system with uploaded faces (the bundled Official's Noto Serif KR). The
// figure names the authored family, as the editor's figure does; HTML and PDF carry the system's faces under that name,
// their files inlined, so the page draws the figure's text in the face the editor draws it in; Word's picture window is
// handed the same faces; Markdown reads none.
describe('a dashboard governed by a system with uploaded faces', () => {
  const SYSTEM = '00000000-0000-4000-8000-0000000000e5';
  const FACE = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]); // a stand-in woff2's bytes
  let dir = '';
  function governed() {
    const source = DEFAULT_SYSTEMS.find((system) => system.key === 'official')!;
    const doc = newDoc();
    writeSystem(doc, source.files, { route: 'default', key: 'official', at: 0 }, { name: 'Official' });
    const systemState = stateV2(doc);
    doc.destroy();
    const { call: base } = host();
    return vi.fn(async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
      if (name === 'designSystems.governing') return { ok: true, value: { system: { id: SYSTEM } } } as never;
      if (name === 'artifacts.state') return { ok: true, value: { bytes: systemState, revision: 3 } } as never;
      if (name === 'artifacts.content') {
        const path = (input as CommandInput<'artifacts.content'>).path ?? '';
        dir ||= mkdtempSync(join(tmpdir(), 'maws-dashboard-faces-'));
        const file = join(dir, path.replace(/\//g, '_'));
        writeFileSync(file, FACE);
        return { ok: true, value: { revision: 3, kind: 'design_system', name: path.split('/').at(-1)!, size: FACE.length, sha256: 'f', path: file } } as never;
      }
      return (await base(name, input)) as never;
    });
  }
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('html and pdf: the figure names the authored family and the page declares it, its face inlined', async () => {
    const call = governed();
    for (const format of ['html', 'pdf'] as const) {
      const { ctx, written, printed } = context(captured());
      await exporters(call).get(format)!.run(request(format), ctx);
      const html = format === 'html' ? String(written.get('/exports/9-html')) : printed[0]!;
      expect(html).toMatch(/<svg [^>]* font-family="[^"]*&quot;Noto Serif KR&quot;/);
      expect(html).not.toContain('ds-face-');
      // the face's file inlined as D writes a source URL (its `:` and `;` as CSS escapes, which a page reads back)
      expect(html).toMatch(/@font-face \{\s*font-family: "Noto Serif KR";[^}]*src: url\("data\\3a font\/woff2\\3b base64,d09GMgECAw=="\)/);
    }
  });

  it('Word’s picture window is handed the same faces; Markdown reads none', async () => {
    const call = governed();
    const faces: string[] = [];
    const pictures = vi.fn(({ facesCss }: { facesCss(): Promise<string> }) => ({ take: async () => (faces.push(await facesCss()), PNG), close: () => {} })) as unknown as OpenPictures;
    await exporters(call, pictures).get('docx')!.run(request('docx'), context(captured()).ctx);
    expect(faces[0]).toMatch(/@font-face \{\s*font-family: "Noto Serif KR";/);
    const before = call.mock.calls.length;
    await exporters(call).get('md')!.run(request('md'), context(captured()).ctx);
    expect(call.mock.calls.slice(before).map(([name]) => name)).not.toContain('artifacts.content');
  });
});
