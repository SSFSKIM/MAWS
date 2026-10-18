// B's document exporters handed the governing design system (the P3 spec's Decision Log 61, part 2): main asks the host
// which system governs the export (`designSystems.governing`), reads that system's state (the live one, or the pinned
// state a version names), and gives the exporter D's export helpers bound to it, so a Word file's theme and an HTML
// file's literals are the system's the editor draws, not the bundled house's.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { setToken, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import { defaultSystem } from '@artifacts/types/design_system/defaults';
import { createDocument } from '@artifacts/document/tabs';
import { newDoc, stateV2 } from '@artifacts/yjs';
import type { CommandName } from '@shared/ipc/schema';
import { DOCUMENT_EXPORTERS, type DocumentExportContext, type DocumentExporter, type DocumentExportRequest } from '../artifacts/export-document';
import { governDocumentExporter, type HostCall } from './documents';

const DOC = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const SYSTEM = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
const LIVE_ACCENT = '#2f6b4f';
const PINNED_ACCENT = '#7a3fb0';

function systemState(accent: string): Uint8Array {
  const doc = newDoc();
  writeSystem(doc, { 'tokens.tokens.json': TOKENS }, { route: 'derived', at: 0 }, { name: 'Harbor' });
  setToken(doc, 'color.accent.$root', { $value: accent });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}
function documentState(): Uint8Array {
  const doc = newDoc();
  createDocument(doc, { title: 'Overview' });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}

type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
/** The engine host as main reaches it: `designSystems.governing` answers `governing`; a system's states by seq. */
function fakeHost(governing: Answer) {
  const asked: { name: string; input: unknown }[] = [];
  const call = vi.fn(async (name: CommandName, input: unknown) => {
    asked.push({ name, input });
    if (name === 'designSystems.governing') return governing;
    if (name === 'artifacts.state') return { ok: true, value: { revision: 9, bytes: systemState(LIVE_ACCENT) } };
    if (name === 'artifacts.versionState') return { ok: true, value: { bytes: systemState(PINNED_ACCENT) } };
    throw new Error(`unexpected ${name}`);
  }) as unknown as HostCall;
  return { call, asked };
}
const found = (system: unknown): Answer => ({ ok: true, value: { system } });

function context() {
  const written = new Map<string, Uint8Array | string>();
  const ctx: DocumentExportContext = {
    title: 'Launch plan',
    state: async () => documentState(),
    readAsset: async () => null,
    assets: { list: async () => [] },
    printToPdf: async () => new Uint8Array(),
    writeFile: async (path, data) => void written.set(path, data),
    signal: new AbortController().signal,
  };
  return { ctx, written };
}
const request = (extra: Partial<DocumentExportRequest> = {}): DocumentExportRequest => ({ artifactId: DOC, kind: 'document', format: 'docx', revision: 7, path: '/exports/7.docx', ...extra });

/** An exporter that records the system it was handed, with the accent its helpers resolve. */
function recorder(): { exporter: DocumentExporter; seen: { name: string; accent: string }[] } {
  const seen: { name: string; accent: string }[] = [];
  const exporter: DocumentExporter = {
    kind: 'document',
    format: 'html',
    run: async (_request, context) => {
      const system = context.system!;
      seen.push({ name: system.name, accent: system.resolveDsVars('var(--ds-color-accent)', system.tokens, 'document') });
    },
  };
  return { exporter, seen };
}

describe('B’s document exporters, handed the governing design system', () => {
  it('give B’s Word export the live governing system’s theme', async () => {
    const host = fakeHost(found({ id: SYSTEM }));
    const docx = governDocumentExporter(DOCUMENT_EXPORTERS.find((e) => e.format === 'docx')!, host.call);
    const { ctx, written } = context();
    await docx.run(request(), ctx);
    expect(host.asked.slice(0, 2)).toEqual([
      { name: 'designSystems.governing', input: { artifactId: DOC } },
      { name: 'artifacts.state', input: { artifactId: SYSTEM } },
    ]);
    const theme = await (await JSZip.loadAsync(written.get('/exports/7.docx') as Uint8Array)).file('word/theme/theme1.xml')!.async('string');
    expect(theme).toContain(`<a:accent1><a:srgbClr val="${LIVE_ACCENT.slice(1).toUpperCase()}"/></a:accent1>`);
    expect(theme).toContain('name="Harbor"');
  });

  it('give a version’s export the state its pin names, read at the pin’s seq', async () => {
    const host = fakeHost(found({ id: SYSTEM, versionSeq: 4 }));
    const { exporter, seen } = recorder();
    await governDocumentExporter(exporter, host.call).run(request({ versionId: 3 }), context().ctx);
    expect(host.asked).toEqual([
      { name: 'designSystems.governing', input: { artifactId: DOC, versionId: 3 } },
      { name: 'artifacts.versionState', input: { artifactId: SYSTEM, seq: 4 } },
    ]);
    expect(seen).toEqual([{ name: 'Harbor', accent: PINNED_ACCENT }]);
  });

  it('give the bundled floor when no system governs, reading no system', async () => {
    const host = fakeHost(found({ builtin: 'maws' }));
    const { exporter, seen } = recorder();
    await governDocumentExporter(exporter, host.call).run(request(), context().ctx);
    expect(host.asked.map((a) => a.name)).toEqual(['designSystems.governing']);
    const floor = builtinView();
    expect(seen).toEqual([{ name: floor.name, accent: /--ds-color-accent: ([^;]+);/.exec(floor.css(':root', 'document'))![1] }]);
  });

  it('fail the export, naming the refusal, when the host cannot say which system governs', async () => {
    const host = fakeHost({ ok: false, error: { code: 'invalid_input', message: `no artifact ${DOC}` } });
    const { exporter, seen } = recorder();
    await expect(governDocumentExporter(exporter, host.call).run(request(), context().ctx)).rejects.toThrow(`no artifact ${DOC}`);
    expect(seen).toEqual([]);
  });

  it('keep the exporter’s kind and format, so the registry files it where B registered it', () => {
    const host = fakeHost(found({ builtin: 'maws' }));
    for (const exporter of DOCUMENT_EXPORTERS) expect(governDocumentExporter(exporter, host.call)).toMatchObject({ kind: exporter.kind, format: exporter.format });
  });
});


// F's L182 (D's part-2 task review): an HTML or PDF document export declares the governing system's bundled faces, as
// D's `systemFaces` filter admits them from its `document.css` (allowlisted descriptors, every source the system's own
// asset), each source the face's bytes inlined, so the file is self-contained and `official`'s Noto Serif KR draws where
// it is not installed. Read at the system's revision (a version's pin) like its tokens; Markdown and Word read none.
describe('B’s HTML and PDF document exports, with the governing system’s faces', () => {
  const REGULAR = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);
  const BOLD = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 4, 5, 6]);
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maws-doc-faces-'));
    writeFileSync(join(dir, 'regular.woff2'), REGULAR);
    writeFileSync(join(dir, 'bold.woff2'), BOLD);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function officialState(): Uint8Array {
    const doc = newDoc();
    writeSystem(doc, defaultSystem('official')!.files, { route: 'default', key: 'official', at: 0 }, { name: 'Official' });
    const state = stateV2(doc);
    doc.destroy();
    return state;
  }
  function officialHost(governing: Answer) {
    const asked: { name: string; input: unknown }[] = [];
    const call = vi.fn(async (name: CommandName, input: unknown) => {
      asked.push({ name, input });
      if (name === 'designSystems.governing') return governing;
      if (name === 'artifacts.state' || name === 'artifacts.versionState') return { ok: true, value: { revision: 9, bytes: officialState() } };
      if (name === 'artifacts.content') {
        const { path } = input as { path: string };
        const file = path.endsWith('Regular-full.woff2') ? 'regular.woff2' : path.endsWith('Bold-full.woff2') ? 'bold.woff2' : null;
        return file ? { ok: true, value: { path: join(dir, file), name: path.slice('assets/'.length) } } : { ok: false, error: { code: 'not_found', message: path } };
      }
      throw new Error(`unexpected ${name}`);
    }) as unknown as HostCall;
    return { call, asked };
  }
  const governed = (format: DocumentExportRequest['format'], host: { call: HostCall }) => governDocumentExporter(DOCUMENT_EXPORTERS.find((e) => e.format === format)!, host.call);
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  const faceBlocks = (html: string) => html.match(/@font-face \{[^}]*\}/g) ?? [];
  const contentReads = (asked: { name: string; input: unknown }[]) => asked.filter((a) => a.name === 'artifacts.content').map((a) => a.input);

  it('declare each bundled face in an HTML file, its bytes inlined, under the family the page’s type resolves to', async () => {
    const host = officialHost(found({ id: SYSTEM }));
    const { ctx, written } = context();
    await governed('html', host).run(request({ format: 'html', path: '/exports/7.html' }), ctx);
    const html = written.get('/exports/7.html') as string;
    const faces = faceBlocks(html);
    expect(faces).toHaveLength(2);
    expect(faces[0]).toContain('font-family: "Noto Serif KR"');
    // a data URL as `cssString` writes it (`:` and `;` escaped), which the page reads back as `data:font/woff2;base64,…`
    expect(faces[0]).toContain(`src: url("data\\3a font/woff2\\3b base64,${b64(REGULAR)}")`);
    expect(faces[1]).toContain('font-weight: 700');
    expect(faces[1]).toContain(`src: url("data\\3a font/woff2\\3b base64,${b64(BOLD)}")`);
    expect(html).not.toMatch(/url\(\s*["']?assets\//); // nothing the file cannot load from itself
    expect(html).toMatch(/font-family: [^;{}]*"Noto Serif KR"/); // the page's body type resolves to the face's family
    expect(contentReads(host.asked)).toEqual([
      { artifactId: SYSTEM, path: 'assets/NotoSerifKR-Regular-full.woff2' },
      { artifactId: SYSTEM, path: 'assets/NotoSerifKR-Bold-full.woff2' },
    ]);
  });

  it('print a PDF from that page, a version’s faces read at its pin', async () => {
    const host = officialHost(found({ id: SYSTEM, versionSeq: 4 }));
    const { ctx } = context();
    const printed: string[] = [];
    ctx.printToPdf = async (html) => (printed.push(html), new Uint8Array());
    await governed('pdf', host).run(request({ format: 'pdf', path: '/exports/7.pdf', versionId: 3 }), ctx);
    expect(faceBlocks(printed[0]!)).toHaveLength(2);
    expect(contentReads(host.asked)).toEqual([
      { artifactId: SYSTEM, path: 'assets/NotoSerifKR-Regular-full.woff2', revision: 4 },
      { artifactId: SYSTEM, path: 'assets/NotoSerifKR-Bold-full.woff2', revision: 4 },
    ]);
  });

  it('read no face for Markdown or Word, and declare none under the floor', async () => {
    for (const format of ['md', 'docx'] as const) {
      const host = officialHost(found({ id: SYSTEM }));
      await governed(format, host).run(request({ format, path: `/exports/7.${format}` }), context().ctx);
      expect(host.asked.map((a) => a.name)).not.toContain('artifacts.content');
    }
    const { ctx, written } = context();
    await governed('html', officialHost(found({ builtin: 'maws' }))).run(request({ format: 'html', path: '/exports/7.html' }), ctx);
    expect(faceBlocks(written.get('/exports/7.html') as string)).toEqual([]);
  });
});
