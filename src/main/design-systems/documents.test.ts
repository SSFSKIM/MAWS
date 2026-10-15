// B's document exporters handed the governing design system (the P3 spec's Decision Log 61, part 2): main asks the host
// which system governs the export (`designSystems.governing`), reads that system's state (the live one, or the pinned
// state a version names), and gives the exporter D's export helpers bound to it, so a Word file's theme and an HTML
// file's literals are the system's the editor draws, not the bundled house's.
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { setToken, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
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

