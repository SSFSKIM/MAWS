// The design system's `claude` exporter in A's export registry (P3-D M7; D12, Decision Log 28): run through A's
// `runExport` over a system's state and its assets as the export service hands them over, it writes one zip of Claude's
// design-system files where the request says.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateClaudeTokens } from '@artifacts/design-system/claude-grammar';
import { writeSystem } from '@artifacts/design-system/model';
import { DEFAULT_SYSTEMS } from '@artifacts/types/design_system/defaults';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { artifactExportName } from '@shared/maws/tools';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { ExporterRegistry, runExport, type ExportRequest, type ExportSources } from '../artifacts/export';
import { registerDesignSystemExporters } from './export';
import { readZip } from './read-zip.test-support';

const ID = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const official = DEFAULT_SYSTEMS.find((system) => system.key === 'official')!;
const bytes = (text: string) => new TextEncoder().encode(text);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-ds-export-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function systemState(files: Record<string, string>): Uint8Array {
  const doc = newDoc();
  writeSystem(doc, files, { route: 'default', key: official.key, at: 0 });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}
const request = (): ExportRequest => ({ artifactId: ID, kind: 'design_system', format: 'claude', revision: 7, path: join(root, ID, 'exports', artifactExportName(7, 'claude')) });

describe('the claude exporter', () => {
  it('registers for design_system as claude, and its answer withdraws it', () => {
    const registry = new ExporterRegistry();
    const off = registerDesignSystemExporters(registry);
    expect(registry.get('design_system', 'claude')).toMatchObject({ kind: 'design_system', format: 'claude' });
    off();
    expect(registry.get('design_system', 'claude')).toBeUndefined();
  });

  it('writes the system as one zip of Claude’s files: tokens.json, README.md from the law, its faces under fonts/ and the assets its files name', async () => {
    const registry = new ExporterRegistry();
    registerDesignSystemExporters(registry);
    const held: Record<string, string> = {
      'assets/NotoSerifKR-Regular-full.woff2': 'regular face',
      'assets/NotoSerifKR-Bold-full.woff2': 'bold face',
      'assets/OFL.txt': 'SIL OPEN FONT LICENSE Version 1.1',
    };
    const asked: string[] = [];
    const sources: ExportSources = {
      title: 'Official',
      state: async () => systemState(official.files),
      readAsset: async (ref) => {
        asked.push(ref);
        return ref in held ? { bytes: bytes(held[ref]!), mime: 'application/octet-stream' } : null;
      },
      print: async () => new Uint8Array(),
    };
    const answer = await runExport(registry, request(), sources);
    expect(answer).toEqual({ ok: true, revision: 7, path: request().path });
    expect(request().path.endsWith('7-claude.zip')).toBe(true);

    const entries = readZip(new Uint8Array(await readFile(request().path)));
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, new TextDecoder().decode(entry.data)]));
    expect(Object.keys(byName).sort()).toEqual(['README.md', 'assets/OFL.txt', 'fonts/NotoSerifKR-Bold-full.woff2', 'fonts/NotoSerifKR-Regular-full.woff2', 'tokens.json']);
    expect(byName['README.md']).toBe(official.files['DESIGN.md']);
    expect(byName['fonts/NotoSerifKR-Regular-full.woff2']).toBe('regular face');
    expect(byName['assets/OFL.txt']).toBe(held['assets/OFL.txt']);
    const tokens = JSON.parse(byName['tokens.json']!) as { name: string; type: { fonts: unknown[] } };
    expect(validateClaudeTokens(tokens)).toEqual([]);
    expect(tokens.type.fonts).toEqual([
      { family: 'Noto Serif KR', file: 'NotoSerifKR-Regular-full.woff2', weight: '400', style: 'normal' },
      { family: 'Noto Serif KR', file: 'NotoSerifKR-Bold-full.woff2', weight: '700', style: 'normal' },
    ]);
    // it read what the system's files name, and nothing else
    expect(asked.sort()).toEqual(Object.keys(held).sort());
  });

  it('answers the converter’s refusal when the document holds no system, and writes nothing', async () => {
    const registry = new ExporterRegistry();
    registerDesignSystemExporters(registry);
    const empty = newDoc();
    const answer = await runExport(registry, request(), { title: 'Blank', state: async () => stateV2(empty), readAsset: async () => null, print: async () => new Uint8Array() });
    expect(answer).toEqual({ ok: false, error: 'the document holds no design system yet' });
    await expect(readFile(request().path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
