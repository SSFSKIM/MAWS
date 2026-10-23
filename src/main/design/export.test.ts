// The design's exporters (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5; XE9 and the parent's Decision
// Log 26) through A's `runExport`, with C's capture window stood in by a recording one: what each pass loads, what is
// captured and at what size, what is printed, and the refusals that open no window and write nothing, their structured
// `ArtifactRefusal` kept on the answer. The window's pixels and the printer's pages run in `e2e/design-export.spec.ts`.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_CSS } from '@artifacts/design/board-css';
import { boardPath, CANVAS_PATH } from '@artifacts/design/canvas';
import { design } from '@artifacts/design/fixtures/support';
import { designTokenValues } from '@artifacts/design/mirror';
import { publishCanvas } from '@artifacts/design/publish';
import { writeSystem, readSystem } from '@artifacts/design-system/model';
import { publishFiles } from '@artifacts/files';
import type { MeasuredDeck } from '@artifacts/slides/export/measure';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { newDoc, stateV2, type Doc } from '@artifacts/yjs';
import type { CommandName } from '@shared/ipc/schema';
import { MawsArtifactExportAnswerSchema } from '@shared/ipc/schema/maws';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { ExporterRegistry, runExport, startExportService, type ExportRequest, type ExportSources } from '../artifacts/export';
import type { DeckWindow } from '../presentations/export';
import { registerDesignExporters, type DesignExportDeps } from './export';

const ID = '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a';
const SYSTEM = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-design-export-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Recorder {
  opened: number;
  loads: string[];
  captures: { job: Parameters<DeckWindow['capture']>[0]; size?: { width?: number; height?: number } }[];
  printed: string[];
  asked: [string, unknown][];
}

/** A recording stand-in for C's capture window, and the host's commands (the governing system, its state). */
function world(options: { measured?: MeasuredDeck; governing?: Record<string, unknown>; states?: Record<string, Uint8Array> } = {}): { deps: DesignExportDeps; seen: Recorder } {
  const seen: Recorder = { opened: 0, loads: [], captures: [], printed: [], asked: [] };
  const win: DeckWindow = {
    load: async (html) => void seen.loads.push(html),
    measure: async () => options.measured ?? { slides: [] },
    capture: async (job, size) => {
      seen.captures.push({ job, ...(size && { size }) });
      return Buffer.from(`png:${job.slideId}`);
    },
  };
  const ok = (value: unknown) => ({ ok: true as const, value });
  const call = async (name: CommandName, input: unknown): Promise<never> => {
    seen.asked.push([name, input]);
    const { versionId, artifactId } = input as { versionId?: number; artifactId: string };
    if (name === 'designSystems.governing') return ok({ system: options.governing?.[versionId === undefined ? 'live' : String(versionId)] ?? { builtin: 'maws' } }) as never;
    if (name === 'artifacts.state' || name === 'artifacts.versionState') return ok({ revision: 1, bytes: options.states?.[artifactId] }) as never;
    return { ok: false, error: { code: 'not_found', message: `no ${name}` } } as never;
  };
  return {
    seen,
    deps: {
      call,
      env: {},
      window: async (_env, signal, use) => {
        seen.opened += 1;
        if (signal.aborted) throw new Error('cancelled');
        return use(win);
      },
    },
  };
}

const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({ artifactId: ID, kind: 'design', format: 'png', revision: 3, path: join(root, ID, 'exports', '3-png.png'), ...over });
const sources = (doc: Doc, seen?: Recorder, over: Partial<ExportSources> = {}): ExportSources => ({
  title: 'Screens',
  state: async () => stateV2(doc),
  readAsset: async (ref) => (ref === 'assets/dot.png' ? { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } : null),
  listAssets: async () => [],
  print: async (html) => {
    seen?.printed.push(html);
    return new TextEncoder().encode('%PDF-');
  },
  ...over,
});
async function exported(doc: Doc, req: Partial<ExportRequest>, w = world()) {
  const registry = new ExporterRegistry();
  registerDesignExporters(registry, w.deps);
  const answer = await runExport(registry, request(req), sources(doc, w.seen));
  expect(MawsArtifactExportAnswerSchema.safeParse(answer).success).toBe(true); // what the bridge carries
  return { answer, seen: w.seen };
}
const poster = () => design([{ id: 'phone', at: { x: 0, y: 0, w: 390, h: 844 } }, { id: 'poster', at: { x: 500, y: 0, w: 1080, h: 9000 } }]);

describe('the design’s exporters', () => {
  it('register design as png and pdf; the answer withdraws them', () => {
    const registry = new ExporterRegistry();
    const off = registerDesignExporters(registry, world().deps);
    expect([registry.get('design', 'png')?.format, registry.get('design', 'pdf')?.format, registry.get('design', 'html')]).toEqual(['png', 'pdf', undefined]);
    off();
    expect(registry.get('design', 'png')).toBeUndefined();
  });
});

describe('a PNG', () => {
  it('measures and draws the one board at native size in the design’s type defaults, captured whole as drawn', async () => {
    const { answer, seen } = await exported(poster(), { board: 'phone' });
    expect(answer).toEqual({ ok: true, revision: 3, path: join(root, ID, 'exports', '3-png.png') });
    expect(await readFile(join(root, ID, 'exports', '3-png.png'), 'utf8')).toBe('png:phone');
    expect(seen.loads).toHaveLength(2);
    for (const html of seen.loads) {
      expect(html).toContain('data-frame="phone" data-size="390x844"');
      expect(html).not.toContain('data-frame="poster"');
      expect(html).toContain('data-board=""');
      expect(html).toContain(BOARD_CSS);
      expect(html).not.toContain('zoom:');
    }
    expect(seen.captures).toEqual([{ job: { slideId: 'phone', elementId: null, mode: 'slide', box: { x: 0, y: 0, w: 390, h: 844 } } }]);
  });

  it('at a scale draws the board zoomed after a native measure, brought to the exact output size', async () => {
    const { answer, seen } = await exported(poster(), { board: 'poster', scale: 0.9102 });
    expect(answer.ok).toBe(true);
    expect(seen.loads[0]).not.toContain('zoom:');
    expect(seen.loads[1]).toContain('.maws-frame[data-frame="poster"] { zoom: 0.9102; }');
    expect(seen.captures).toEqual([{ job: expect.objectContaining({ slideId: 'poster' }), size: { width: 983, height: 8192 } }]);
  });

  it('over the picture cap refuses before any window opens, its refusal on the answer, nothing written', async () => {
    const { answer, seen } = await exported(poster(), { board: 'poster' });
    expect(answer).toEqual({ ok: false, error: expect.stringContaining('scale 0.9102'), refusal: { reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 } } });
    expect(seen.opened).toBe(0);
    expect(seen.asked).toEqual([]); // not even the system is read
    await expect(readFile(join(root, ID, 'exports', '3-png.png'))).rejects.toThrow();
  });

  it('refuses an unknown board and a held board by name', async () => {
    expect((await exported(poster(), { board: 'tablet' })).answer).toMatchObject({ ok: false, refusal: { reason: 'notFound', data: { board: 'tablet' } } });
    const doc = newDoc();
    publishCanvas(doc, {}, { [CANVAS_PATH]: JSON.stringify({ v: 1, boards: { bad: { x: 0, y: 0, w: 200, h: 100 } }, order: ['bad'] }), [boardPath('bad')]: '<section id="bad"><blink>x</blink></section>' }, false);
    expect((await exported(doc, {})).answer).toMatchObject({ ok: false, refusal: { reason: 'invalid', data: { board: 'bad', held: [expect.any(String)] } } });
  });
});

describe('a PDF', () => {
  it('prints the boards named, in their order, each on a page of its own size, the type defaults after C’s page', async () => {
    const w = world();
    const { answer, seen } = await exported(poster(), { format: 'pdf', path: join(root, ID, 'exports', '3-pdf.pdf'), boards: ['poster', 'phone'] }, w);
    expect(answer.ok).toBe(true);
    expect(seen.printed).toHaveLength(1);
    const html = seen.printed[0]!;
    expect(html.indexOf('data-frame="poster"')).toBeLessThan(html.indexOf('data-frame="phone"'));
    expect(html).toContain('@page board-1080x9000 { size: 1080px 9000px; margin: 0; }');
    expect(html).toContain('@page board-390x844 { size: 390px 844px; margin: 0; }');
    expect(html).toContain(BOARD_CSS);
    expect(html).not.toContain('@page design-');
    expect(seen.captures).toEqual([]); // no embed, no picture
  });

  it('at a scale zooms each board and pages it at its scaled size; an embed is the picture the window took at native size', async () => {
    const doc = design([{ id: 'live', at: { x: 0, y: 0, w: 800, h: 600 }, body: '<x-embed id="e" style="position:absolute; left:10px; top:20px; width:200px; height:100px"><p>hi</p></x-embed>' }]);
    const measured: MeasuredDeck = { slides: [{ id: 'live', background: { fill: null, image: false }, elements: [{ id: 'e', tag: 'x-embed', box: { x: 10, y: 20, w: 200, h: 100 } } as never] }] };
    const { answer, seen } = await exported(doc, { format: 'pdf', path: join(root, ID, 'exports', '3-pdf.pdf'), scale: 0.5 }, world({ measured }));
    expect(answer.ok).toBe(true);
    expect(seen.captures).toEqual([{ job: { slideId: 'live', elementId: 'e', mode: 'tree', box: { x: 10, y: 20, w: 200, h: 100 } } }]);
    expect(seen.loads[1]).not.toContain('zoom:');
    const html = seen.printed[0]!;
    expect(html).toContain('<img alt="" src="data:image/png;base64,');
    expect(html).toContain('.maws-frame[data-frame="live"] { zoom: 0.5; page: design-0; }');
    expect(html).toContain('@page design-0 { size: 400px 300px; margin: 0; }');
  });

  it('a page over the PDF limit at the scale refuses with the scale that fits; a paper size refuses', async () => {
    const big = design([{ id: 'wide', at: { x: 0, y: 0, w: 16_384, h: 100 } }]);
    expect((await exported(big, { format: 'pdf', scale: 2 })).answer).toMatchObject({ ok: false, refusal: { reason: 'exportTooLarge', data: { board: 'wide', w: 16_384, h: 100, maxScale: 1.1718 } } });
    expect((await exported(big, { format: 'pdf', pageSize: 'letter' })).answer).toMatchObject({ ok: false, refusal: { reason: 'invalid', data: { pageSize: 'letter' } } });
  });
});

describe('what a version draws in', () => {
  it('a retained version is drawn in the system pinned at it, its tokens in the document medium, with the assets it names', async () => {
    const source = DEFAULT_SYSTEMS.find((s) => s.key === 'official')!;
    const systemDoc = newDoc();
    writeSystem(systemDoc, source.files, { route: 'default', key: 'official', at: 0 }, { name: 'Official' });
    const tokens = readSystem(systemDoc).tokens;
    const doc = design([{ id: 'b', at: { x: 0, y: 0, w: 300, h: 200 }, body: '<p id="p" style="color:var(--ds-color-accent, #ff00ff)">Hi</p><img id="i" src="assets/dot.png" alt="" style="width:10px; height:10px">' }]);
    const w = world({ governing: { '7': { id: SYSTEM, versionSeq: 5 } }, states: { [SYSTEM]: stateV2(systemDoc) } });
    const { answer, seen } = await exported(doc, { versionId: 7 }, w);
    expect(answer.ok).toBe(true);
    expect(seen.asked).toContainEqual(['designSystems.governing', { artifactId: ID, versionId: 7 }]);
    expect(seen.asked).toContainEqual(['artifacts.versionState', { artifactId: SYSTEM, seq: 5 }]);
    const accent = designTokenValues(tokens)('--ds-color-accent')!;
    expect(accent).toBeTruthy();
    expect(seen.loads[0]).toContain(`color:${accent}`);
    expect(seen.loads[0]).toContain('src="data:image/png;base64,AQID"');
  });

  it('a retained legacy file state is drawn through its projection, the state itself left as it was', async () => {
    const legacy = newDoc();
    publishFiles(legacy, {}, { [CANVAS_PATH]: JSON.stringify({ v: 1, boards: { a: { x: 0, y: 0, w: 640, h: 480 } }, order: ['a'] }), [boardPath('a')]: '<section id="a"><p id="p">Old</p></section>' }, false);
    const { answer, seen } = await exported(legacy, { versionId: 2 });
    expect(answer.ok).toBe(true);
    expect(seen.captures).toEqual([{ job: expect.objectContaining({ slideId: 'a', box: { x: 0, y: 0, w: 640, h: 480 } }) }]);
  });
});

describe('managed export names (Decision Log 33)', () => {
  it('a design export gets an id of its own in its file’s name, in the directory asked; every other kind keeps its name', async () => {
    const doc = design();
    const registry = new ExporterRegistry();
    registerDesignExporters(registry, world().deps);
    registry.register({ kind: 'presentation', format: 'png', run: async (req, context) => context.writeFile(req.path, 'deck') });
    const answered: { answer: { ok: boolean; path?: string; exportId?: string } }[] = [];
    let listener: ((request: never) => void) | null = null;
    const ok = (value: unknown) => ({ ok: true as const, value });
    const call = async (name: CommandName, input: unknown): Promise<never> => {
      const { artifactId } = input as { artifactId: string };
      if (name === 'artifacts.get') return ok({ artifact: { id: artifactId, title: 'T', kind: artifactId === ID ? 'design' : 'presentation', revision: 3 } }) as never;
      if (name === 'artifacts.state') return ok({ revision: 3, bytes: stateV2(doc) }) as never;
      if (name === 'designSystems.governing') return ok({ system: { builtin: 'maws' } }) as never;
      return { ok: false, error: { code: 'not_found', message: `no ${name}` } } as never;
    };
    const service = startExportService({ registry, root, call: call as never, onEvent: (_n, l) => ((listener = l as never), () => {}), answer: async (input) => { answered.push(input as never); return { ok: true, value: { outcome: 'delivered' } }; } });
    try {
      const a = await service.exportForLibrary({ artifactId: ID, format: 'png' });
      const b = await service.exportForLibrary({ artifactId: ID, format: 'png' });
      expect(a.exportId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect([a.path, b.path]).toEqual([join(root, ID, 'exports', `3-png-${a.exportId}.png`), join(root, ID, 'exports', `3-png-${b.exportId}.png`)]);
      expect(a.exportId).not.toBe(b.exportId);
      const deck = await service.exportForLibrary({ artifactId: SYSTEM, format: 'png' });
      expect(deck).toEqual({ path: join(root, SYSTEM, 'exports', '3-png.png'), revision: 3 });
      // the agent's route: the host names the directory, main the file in it
      const asked = join(root, ID, 'exports', '3-png.png');
      listener!({ appSessionId: 'App-A', requestId: 'r1', artifactId: ID, kind: 'design', format: 'png', revision: 3, path: asked } as never);
      await vi.waitFor(() => expect(answered).toHaveLength(1));
      const answer = answered[0]!.answer;
      expect(answer).toMatchObject({ ok: true, exportId: expect.any(String) });
      expect(answer.path).toBe(join(root, ID, 'exports', `3-png-${answer.exportId}.png`));
      expect(MawsArtifactExportAnswerSchema.safeParse(answer).success).toBe(true);
    } finally {
      service.stop();
    }
  });
});

