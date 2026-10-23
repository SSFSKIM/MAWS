// The presentation's exporters in A's export registry (P3-C M9; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md
// D12; X31): the five formats registered; the design system a deck exports in (D's `designSystems.governing`: a version's
// pin, else the host's chain, else the floor; Decision Log 27 (2)) with D's export helpers bound to it; the `claude` zip through A's `runExport`; the `embedded` PPTX variant refused with its reason.
// The window's formats (html, pdf, png, pptx) run in `e2e/presentations-export.spec.ts` on the product build.
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSystem } from '@artifacts/design-system/model';
import { officeThemeXml } from '@artifacts/design-system/office';
import { resolveDsVars } from '@artifacts/design-system/resolve-vars';
import { exportDeckOf } from '@artifacts/slides/export/standalone';
import { loadSlide } from '@artifacts/slides/parse';
import { FIXTURE_FILES, fixtureDoc, MEASURED } from '@artifacts/slides/export/deck.test-support';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { newDoc, stateV2 } from '@artifacts/yjs';
import type { CommandName } from '@shared/ipc/schema';
import { artifactExportName } from '@shared/maws/tools';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
// the deck window's case: the window a stand-in, the load helpers and the request filter A's own (the filter's entries
// followed through its answer)
const filters = vi.hoisted(() => ({ live: new Set<number>() }));
vi.mock('../artifacts/capture', async (actual) => ({ ...(await actual<typeof import('../artifacts/capture')>()), openCaptureWindow: vi.fn() }));
vi.mock('../artifacts/policies', async (actual) => {
  const real = await actual<typeof import('../artifacts/policies')>();
  return {
    ...real,
    restrictRequests: (id: number, cancel: (url: string) => boolean) => {
      const off = real.restrictRequests(id, cancel);
      filters.live.add(id);
      return () => {
        off();
        filters.live.delete(id);
      };
    },
  };
});

import { openCaptureWindow } from '../artifacts/capture';
import { ExporterRegistry, runExport, type ExportRequest, type ExportSources } from '../artifacts/export';
import { readZip } from '../design-systems/read-zip.test-support';
import { deckSystem, renderAllSlidePngs, registerPresentationExporters, STAGE, systemFacesCss, withDeckWindow, type PresentationExportDeps } from './export';

const DECK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OWN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const HOUSE = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';

function systemState(key: string, name: string): Uint8Array {
  const source = DEFAULT_SYSTEMS.find((system) => system.key === key)!;
  const doc = newDoc();
  writeSystem(doc, source.files, { route: 'default', key, at: 0 }, { name });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}

interface World {
  rows: Record<string, { kind: string; createdAt: number; designSystemId?: string; spaceId?: string }>;
  states: Record<string, Uint8Array>;
  /** What the host's `designSystems.governing` answers, per version id (`live` for none). */
  governing?: Record<string, { id: string; versionSeq?: number } | { builtin: 'maws' }>;
}

function depsOf(world: World): PresentationExportDeps & { asked: [string, unknown][] } {
  const asked: [string, unknown][] = [];
  const ok = (value: unknown) => ({ ok: true as const, value });
  const call = async (name: CommandName, input: unknown): Promise<never> => {
    asked.push([name, input]);
    const { artifactId, seq, versionId } = input as { artifactId: string; seq?: number; versionId?: number };
    const row = (id: string) => (world.rows[id] ? { id, title: id, revision: 1, ...world.rows[id] } : null);
    if (name === 'designSystems.governing') return ok({ system: world.governing?.[versionId === undefined ? 'live' : String(versionId)] ?? { builtin: 'maws' } }) as never;
    if (name === 'artifacts.get') return ok({ artifact: row(artifactId) }) as never;
    if (name === 'artifacts.state') return ok({ revision: 1, bytes: world.states[artifactId] }) as never;
    if (name === 'artifacts.versionState') return ok({ bytes: world.states[`${artifactId}@${seq}`] }) as never;
    return { ok: false, error: { code: 'not_found', message: `no ${name}` } } as never;
  };
  return { call, env: {}, asked };
}

const deckRow = (extra: Partial<World['rows'][string]> = {}) => ({ [DECK]: { kind: 'presentation', createdAt: 5, ...extra } });

describe('the presentation’s exporters', () => {
  it('register presentation as html, pdf, png, pptx and claude; the answer withdraws them', () => {
    const registry = new ExporterRegistry();
    const off = registerPresentationExporters(registry, depsOf({ rows: {}, states: {} }));
    for (const format of ['html', 'pdf', 'png', 'pptx', 'claude'] as const) expect(registry.get('presentation', format), format).toMatchObject({ kind: 'presentation', format });
    expect(registry.get('presentation', 'docx')).toBeUndefined();
    off();
    expect(registry.get('presentation', 'pptx')).toBeUndefined();
  });
});

it('exports every slide, including hidden ones, as distinct numbered PNGs in deck order', async () => {
  const doc = fixtureDoc();
  try {
    const deck = exportDeckOf(doc, 'Quarterly');
    const captured: string[] = [];
    const win = { load: async () => {}, measure: async () => MEASURED, capture: async (job: { slideId: string }) => { captured.push(job.slideId); return Buffer.from(`PNG:${job.slideId}`); } };
    const files = await renderAllSlidePngs(win, { deck, page: { resolveVar: () => undefined, asset: () => null, facesCss: '' } });
    expect(captured).toEqual(['cover', 'body', 'gone']);
    expect(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes).toString()]))).toEqual({ 'slide-01.png': 'PNG:cover', 'slide-02.png': 'PNG:body', 'slide-03.png': 'PNG:gone' });
  } finally { doc.destroy(); }
});

// fix wave 1: the window's staging script is sent as text; each of its forms parses
describe('the staging script for a picture', () => {
  it('parses for every mode, with any id', () => {
    for (const mode of ['slide', 'background', 'self', 'tree', 'drawn'] as const) expect(() => new Function(`return ${STAGE('c"1', mode === 'slide' ? null : `e'2`, mode)}`), mode).not.toThrow();
  });
});

// exports-capture scalpel-4#2: an export's deadline that lands while a page loads destroys the window; Electron reports no
// load failure for the navigation that aborts, so the deck window's page and request filter go with the cancellation
describe('the deck window', () => {
  /** A capture window as Electron's behaves: its page never finishes loading; destroyed, its contents emit `destroyed`
   * (aborting the load) and the window answers nothing but `isDestroyed`. */
  function hangingWindow() {
    const contents = Object.assign(new EventEmitter(), {
      id: 4242,
      loading: null as string | null,
      loadURL(url: string) {
        contents.loading = url;
        return new Promise<void>((_, reject) => contents.once('destroyed', () => reject(new Error('ERR_ABORTED (-3)'))));
      },
    });
    let destroyed = false;
    const live = () => {
      if (destroyed) throw new TypeError('Object has been destroyed');
    };
    const win = {
      get webContents() {
        live();
        return contents;
      },
      setBackgroundColor: () => live(),
      isDestroyed: () => destroyed,
      destroy() {
        live();
        destroyed = true;
        contents.emit('destroyed');
      },
    };
    return { win, contents };
  }

  it('removes its page and its request filter when the export is cancelled during a load that never ends', async () => {
    const { win, contents } = hangingWindow();
    vi.mocked(openCaptureWindow).mockReturnValueOnce(win as never);
    const controller = new AbortController();
    const used = withDeckWindow({}, controller.signal, (deck) => deck.load('<!doctype html><p>a slide</p>'));
    used.catch(() => {});
    await vi.waitFor(() => expect(contents.loading).not.toBeNull());
    const dir = dirname(fileURLToPath(contents.loading!));
    expect(existsSync(join(dir, 'deck.html'))).toBe(true);
    expect(filters.live.has(4242)).toBe(true);
    controller.abort();
    await vi.waitFor(() => expect(existsSync(dir), 'the deck page’s directory').toBe(false));
    expect(filters.live.has(4242)).toBe(false);
    await expect(used).rejects.toThrow();
  });

  // P4 (the skewed-element row's re-review): a `drawn` picture is taken where the slide draws the element, its region (in
  // slide px) moved by where the slide sits in its frame (a section the dialect lets translate)
  it('captures a drawn job at its region moved by the slide’s offset in the frame', async () => {
    const captured: unknown[] = [];
    const contents = Object.assign(new EventEmitter(), {
      id: 4343,
      executeJavaScript: async () => ({ x: 300, y: 0, w: 1920, h: 1080 }),
      capturePage: async (rect: unknown) => {
        captured.push(rect);
        return { toPNG: () => Buffer.from('png') };
      },
    });
    const win = { webContents: contents, setBackgroundColor: () => {}, isDestroyed: () => false, destroy: () => {} };
    vi.mocked(openCaptureWindow).mockReturnValueOnce(win as never);
    await withDeckWindow({}, new AbortController().signal, (deck) => deck.capture({ slideId: 's1', elementId: 'lean', mode: 'drawn', box: { x: 171.13, y: 200, w: 257.74, h: 100 } }));
    expect(captured).toEqual([{ x: 471, y: 200, width: 258, height: 100 }]);
  });
});

describe('the system a deck exports in', () => {
  const house = systemState('maws', 'House');
  const official = systemState('official', 'Official');

  it('is the system the host names as governing the live deck, read at its live state, with D’s export helpers bound', async () => {
    const deps = depsOf({ rows: {}, states: { [OWN]: official }, governing: { live: { id: OWN } } });
    const system = await deckSystem({ artifactId: DECK }, deps);
    expect([system.id, system.name]).toEqual([OWN, 'Official']);
    expect(system.tokens.tokens.size).toBeGreaterThan(0);
    expect([system.resolveDsVars, system.officeThemeXml]).toEqual([resolveDsVars, officeThemeXml]);
    // main resolves no chain of its own: one governing read and the system's state
    expect(deps.asked).toEqual([['designSystems.governing', { artifactId: DECK }], ['artifacts.state', { artifactId: OWN }]]);
  });

  it('is a version’s pin when the export names a version, read at the pinned state', async () => {
    const deps = depsOf({ rows: {}, states: { [OWN]: house, [`${OWN}@3`]: official }, governing: { live: { id: OWN }, 9: { id: OWN, versionSeq: 3 } } });
    const system = await deckSystem({ artifactId: DECK, versionId: 9 }, deps);
    expect(system.name).toBe('Official');
    expect(deps.asked).toEqual([['designSystems.governing', { artifactId: DECK, versionId: 9 }], ['artifacts.versionState', { artifactId: OWN, seq: 3 }]]);
  });

  // the final review's A15: a version's system may be deleted since; its faces are served only at a named revision
  it('reads a version’s system faces at the pinned revision, so a system deleted since still lends them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-deck-faces-'));
    try {
      const font = join(dir, 'face.woff2');
      await writeFile(font, 'font bytes');
      const deps = depsOf({ rows: {}, states: { [`${OWN}@3`]: official }, governing: { 9: { id: OWN, versionSeq: 3 } } });
      const call = deps.call;
      const content: unknown[] = [];
      deps.call = (async (name: CommandName, input: unknown) => {
        if (name !== 'artifacts.content') return call(name as never, input as never);
        content.push(input);
        // deleted since: its files answer only for a named revision
        return (input as { revision?: number }).revision === 3 ? { ok: true, value: { path: font, name: 'face.woff2' } } : { ok: false, error: { code: 'not_found', message: 'deleted' } };
      }) as typeof deps.call;
      const system = await deckSystem({ artifactId: DECK, versionId: 9 }, deps);
      const css = await systemFacesCss(system, deps);
      expect(content.length).toBeGreaterThan(0);
      expect(content.every((input) => (input as { revision?: number }).revision === 3)).toBe(true);
      expect(css).toContain(`base64,${Buffer.from('font bytes').toString('base64')}`); // the CSS escapes the url's `:` and `;`
      expect(css).not.toContain('data:,');
      // the live system's faces: no revision named
      const live = depsOf({ rows: {}, states: { [OWN]: official }, governing: { live: { id: OWN } } });
      const asked: unknown[] = [];
      const liveCall = live.call;
      live.call = (async (name: CommandName, input: unknown) => (name === 'artifacts.content' ? (asked.push(input), { ok: true, value: { path: font, name: 'face.woff2' } }) : liveCall(name as never, input as never))) as typeof live.call;
      await systemFacesCss(await deckSystem({ artifactId: DECK }, live), live);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((input) => !Object.hasOwn(input as object, 'revision'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is the bundled floor when the host names it, or when the named system holds no system yet', async () => {
    const floor = await deckSystem({ artifactId: DECK }, depsOf({ rows: {}, states: {} }));
    expect(floor.id).toBeNull();
    expect(floor.tokens.tokens.size).toBeGreaterThan(0);
    const empty = newDoc();
    const unseeded = stateV2(empty);
    empty.destroy();
    const cut = await deckSystem({ artifactId: DECK }, depsOf({ rows: {}, states: { [HOUSE]: unseeded }, governing: { live: { id: HOUSE } } }));
    expect([cut.id, cut.name]).toEqual([null, floor.name]);
  });
});

describe('the exports that need no window', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'maws-deck-export-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const sources = (held: Record<string, string>): ExportSources => {
    const doc = fixtureDoc(FIXTURE_FILES);
    const state = stateV2(doc);
    doc.destroy();
    return {
      title: 'Quarterly',
      state: async () => state,
      listAssets: async () => [],
      readAsset: async (ref) => (ref in held ? { bytes: new TextEncoder().encode(held[ref]!), mime: ref.endsWith('.png') ? 'image/png' : 'font/woff2' } : null),
      print: async () => new Uint8Array(),
    };
  };
  const request = (format: ExportRequest['format'], extra: Partial<ExportRequest> = {}): ExportRequest => ({ artifactId: DECK, kind: 'presentation', format, revision: 3, path: join(root, artifactExportName(3, format)), ...extra });

  it('writes For Claude as one zip: the index without overrides, literal slides the loader reads back, the assets moved', async () => {
    const registry = new ExporterRegistry();
    registerPresentationExporters(registry, depsOf({ rows: deckRow(), states: {} }));
    const answer = await runExport(registry, request('claude'), sources({ 'assets/logo.png': 'png bytes', 'assets/brand.woff2': 'font bytes' }));
    expect(answer).toEqual({ ok: true, revision: 3, path: request('claude').path });
    const entries = Object.fromEntries(readZip(new Uint8Array(await readFile(request('claude').path))).map((e) => [e.name, new TextDecoder().decode(e.data)]));
    expect(Object.keys(entries).sort()).toEqual(['project/deck.json', 'project/ds/maws/brand.woff2', 'project/ds/maws/logo.png', 'project/slides/body.html', 'project/slides/cover.html', 'project/slides/gone.html']);
    expect(JSON.parse(entries['project/deck.json']!)).not.toHaveProperty('dsOverrides');
    expect(entries['project/ds/maws/logo.png']).toBe('png bytes');
    for (const [name, text] of Object.entries(entries)) {
      if (!name.startsWith('project/slides/')) continue;
      expect(text).not.toContain('var(');
      expect(loadSlide(text).ok, name).toBe(true);
    }
  });

  it('refuses the embedded PPTX variant with its reason and writes nothing', async () => {
    const registry = new ExporterRegistry();
    registerPresentationExporters(registry, depsOf({ rows: deckRow(), states: {} }));
    const answer = await runExport(registry, request('pptx', { fonts: 'embedded' }), sources({}));
    expect(answer).toEqual({ ok: false, error: expect.stringContaining('embedding uploaded fonts in a PPTX is not available yet') });
    await expect(readFile(request('pptx').path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
