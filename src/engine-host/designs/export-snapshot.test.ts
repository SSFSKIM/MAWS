// P3-E1 M2 fix wave (the parent's Decision Log 22): a retained version's export does not touch the live document. Main's
// export service, over the engine host's real `artifacts.*` handlers and store, exports a valid retained version of a
// design whose live state is malformed legacy content: the export reads the version and succeeds, and no migration row
// is written; the live export is still prepared (and here refused by name). The design exporter is a stand-in that
// records the state it was given (the real capture is M5's).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_PATH } from '@artifacts/design/canvas';
import { publishFiles, readFiles } from '@artifacts/files';
import { applyV2, newDoc } from '@artifacts/yjs';
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';
import { registerDesigns, type Designs } from '.';
import { LEGACY_FILES, logRows, makeLegacyDesign } from './legacy.fixture';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
const { ExporterRegistry, startExportService } = await import('../../main/artifacts/export');

let userData: string;
let documents: Documents;
let designs: Designs;
let surface: { close(): void };
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-export-'));
});
afterEach(() => {
  surface.close();
  designs.close();
  documents.close();
  rmSync(userData, { recursive: true, force: true });
});

/** Main's `call` over the host's handlers, as the router answers it. */
const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
  try {
    return { ok: true, value: await handlers.get(name)!(input) } as CommandResult<CommandName>;
  } catch (error) {
    if (error instanceof HostCommandError) return { ok: false, error: error.ipcError } as CommandResult<CommandName>;
    throw error;
  }
};

describe('a retained version’s export of a design whose live state cannot migrate (Decision Log 22)', () => {
  it('exports the version as it was and writes no migration row; the live export is still prepared and refused by name', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    documents = openDocuments(userData, () => {})!;
    designs = registerDesigns({ documents, chain: null, refresh: () => {} });
    handlers = new Map();
    const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
    surface = registerArtifacts(on, () => true, { onDocPort: () => {} }, { documents, env: {} });
    // an earlier build broke the live manifest after the version was kept
    await documents.service.writeAs(id, { kind: 'human' }, (doc) => void publishFiles(doc, readFiles(doc), { [CANVAS_PATH]: '{"v":' }, false));
    const rows = logRows(userData, id);

    const seen: Record<string, string>[] = [];
    const registry = new ExporterRegistry();
    registry.register({
      kind: 'design',
      format: 'pdf',
      run: async (request, context) => {
        const doc = newDoc();
        applyV2(doc, await context.state());
        seen.push(readFiles(doc));
        await context.writeFile(request.path, new Uint8Array([37, 80, 68, 70]));
      },
    });
    const service = startExportService({ registry, root: join(userData, 'artifacts'), call: call as never, onEvent: () => () => {}, answer: async () => ({ ok: true, value: { outcome: 'delivered' } }) });
    try {
      const exported = await service.exportForLibrary({ artifactId: id, format: 'pdf', versionId: versionId! });
      expect(exported.path).toMatch(/-pdf-[0-9a-f-]{36}\.pdf$/); // M5 (Decision Log 33): a design export's own file
      expect(seen).toEqual([LEGACY_FILES]);
      expect(logRows(userData, id)).toEqual(rows);

      await expect(service.exportForLibrary({ artifactId: id, format: 'pdf' })).rejects.toThrow(/cannot be opened.*canvas\.json is not JSON/);
      expect(logRows(userData, id)).toEqual(rows);
    } finally {
      service.stop();
    }
  });
});
