// The presentation's exporters in A's export registry (P3-C M9; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md
// D12; X31): the five formats registered; the design system a deck exports in (a version's pin, else D's default chain
// over the live store); the `claude` zip through A's `runExport`; the `embedded` PPTX variant refused with its reason.
// The window's formats (html, pdf, png, pptx) run in `e2e/presentations-export.spec.ts` on the product build.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSystem } from '@artifacts/design-system/model';
import { loadSlide } from '@artifacts/slides/parse';
import { FIXTURE_FILES, fixtureDoc } from '@artifacts/slides/export/deck.test-support';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { newDoc, stateV2 } from '@artifacts/yjs';
import type { CommandName } from '@shared/ipc/schema';
import { artifactExportName } from '@shared/maws/tools';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { ExporterRegistry, runExport, type ExportRequest, type ExportSources } from '../artifacts/export';
import { readZip } from '../design-systems/read-zip.test-support';
import { deckSystem, registerPresentationExporters, type PresentationExportDeps } from './export';

const DECK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OWN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const HOUSE = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const SPACE_SYSTEM = '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80';
const SPACE = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81';
const OLDER = '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b92';

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
  versions?: { id: number; seq: number; designSystemRef?: { id: string; versionSeq: number } }[];
  owner?: string | null;
  spaces?: Record<string, string>;
}

function depsOf(world: World): PresentationExportDeps & { asked: string[] } {
  const asked: string[] = [];
  const ok = (value: unknown) => ({ ok: true as const, value });
  const call = async (name: CommandName, input: unknown): Promise<never> => {
    asked.push(name);
    const { artifactId, seq } = input as { artifactId: string; seq?: number };
    const row = (id: string) => (world.rows[id] ? { id, title: id, revision: 1, ...world.rows[id] } : null);
    if (name === 'artifacts.get') return ok({ artifact: row(artifactId) }) as never;
    if (name === 'artifacts.list') return ok({ artifacts: Object.keys(world.rows).filter((id) => world.rows[id]!.kind === 'design_system').map(row) }) as never;
    if (name === 'artifacts.state') return ok({ revision: 1, bytes: world.states[artifactId] }) as never;
    if (name === 'artifacts.versionState') return ok({ bytes: world.states[`${artifactId}@${seq}`] }) as never;
    if (name === 'artifacts.versions') return ok({ versions: world.versions ?? [] }) as never;
    return { ok: false, error: { code: 'not_found', message: `no ${name}` } } as never;
  };
  return { call, defaults: () => ({ owner: world.owner ?? null, spaces: world.spaces ?? {} }), env: {}, asked };
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

describe('the system a deck exports in', () => {
  const house = systemState('maws', 'House');
  const official = systemState('official', 'Official');

  it('is the deck’s own system when it is live', async () => {
    const system = await deckSystem({ artifactId: DECK }, depsOf({ rows: { ...deckRow({ designSystemId: OWN }), [OWN]: { kind: 'design_system', createdAt: 1 } }, states: { [OWN]: official } }));
    expect([system.id, system.name]).toEqual([OWN, 'Official']);
  });

  it('falls to the Space’s default, then the owner’s, past a deleted id', async () => {
    const rows = { ...deckRow({ designSystemId: 'deleted', spaceId: SPACE }), [SPACE_SYSTEM]: { kind: 'design_system', createdAt: 2 }, [OWN]: { kind: 'design_system', createdAt: 1 } };
    const states = { [SPACE_SYSTEM]: official, [OWN]: house };
    expect((await deckSystem({ artifactId: DECK }, depsOf({ rows, states, spaces: { [SPACE]: SPACE_SYSTEM }, owner: OWN }))).id).toBe(SPACE_SYSTEM);
    expect((await deckSystem({ artifactId: DECK }, depsOf({ rows, states, spaces: {}, owner: OWN }))).id).toBe(OWN);
  });

  it('is the house system (the earliest live system from `maws`) with no link set, else the bundled floor', async () => {
    const rows = { ...deckRow(), [OLDER]: { kind: 'design_system', createdAt: 1 }, [HOUSE]: { kind: 'design_system', createdAt: 2 } };
    expect((await deckSystem({ artifactId: DECK }, depsOf({ rows, states: { [OLDER]: official, [HOUSE]: house } }))).id).toBe(HOUSE);
    const floor = await deckSystem({ artifactId: DECK }, depsOf({ rows: deckRow(), states: {} }));
    expect(floor.id).toBeNull();
    expect(floor.tokens.tokens.size).toBeGreaterThan(0);
  });

  it('is a version’s pin when the export names a pinned version', async () => {
    const deps = depsOf({ rows: { ...deckRow({ designSystemId: OWN }), [OWN]: { kind: 'design_system', createdAt: 1 } }, states: { [OWN]: house, [`${OWN}@3`]: official }, versions: [{ id: 9, seq: 4, designSystemRef: { id: OWN, versionSeq: 3 } }] });
    const system = await deckSystem({ artifactId: DECK, versionId: 9 }, deps);
    expect(system.name).toBe('Official');
    expect(deps.asked).toContain('artifacts.versionState');
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
