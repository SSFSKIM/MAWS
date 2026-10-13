import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { AppSessionId, RequestId } from '@shared/graph/ids';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { EXPORT_QUEUE_MS, ExporterRegistry, runExport, startExportService, type ExportJob, type ExportServiceDeps } from './export';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const DOC = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const bytes = (text: string) => new TextEncoder().encode(text);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-export-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const job = (over: Partial<ExportJob> = {}): ExportJob => ({ artifactId: ID, kind: 'html', format: 'pdf', revision: 4, ...over });

describe('the exporter registry (X31)', () => {
  it('finds an exporter by kind and format, the last registration winning, and forgets one when its registration is undone', () => {
    const registry = new ExporterRegistry();
    const first = async () => bytes('1');
    const second = async () => bytes('2');
    registry.register('presentation', 'pptx', first);
    const undo = registry.register('presentation', 'pptx', second);
    expect(registry.get('presentation', 'pptx')).toBe(second);
    expect(registry.get('presentation', 'pdf')).toBeUndefined();
    expect(registry.get('document', 'pptx')).toBeUndefined();
    undo();
    expect(registry.get('presentation', 'pptx')).toBeUndefined();
  });
});

describe('runExport', () => {
  it('writes the exporter’s bytes to the path, creating its directory, and leaves no temporary file', async () => {
    const registry = new ExporterRegistry();
    const seen: ExportJob[] = [];
    registry.register('html', 'pdf', async (j) => {
      seen.push(j);
      return bytes('%PDF-1.7');
    });
    const path = join(root, ID, 'exports', '4-pdf.pdf');
    expect(await runExport(registry, job(), path)).toEqual({ ok: true });
    expect(await readFile(path, 'utf8')).toBe('%PDF-1.7');
    expect(await readdir(join(root, ID, 'exports'))).toEqual(['4-pdf.pdf']);
    expect(seen).toEqual([job()]);
  });

  it('answers unavailable for a kind and format no exporter serves, naming both', async () => {
    expect(await runExport(new ExporterRegistry(), job({ kind: 'document', format: 'docx' }), join(root, 'x.docx'))).toEqual({
      ok: false,
      unavailable: true,
      error: 'MAWS cannot export a document artifact as docx yet',
    });
  });

  it('answers an exporter’s failure and its timeout as errors, writing nothing', async () => {
    const registry = new ExporterRegistry();
    registry.register('html', 'pdf', async () => {
      throw new Error('the page did not load');
    });
    registry.register('html', 'png', () => new Promise<Uint8Array>(() => {}));
    expect(await runExport(registry, job(), join(root, 'a.pdf'))).toEqual({ ok: false, error: 'the page did not load' });
    expect(await runExport(registry, job({ format: 'png' }), join(root, 'a.png'), 20)).toEqual({ ok: false, error: 'the export did not finish within 0.02 s' });
    expect(await readdir(root)).toEqual([]);
  });
});

// A host that holds one html artifact at revisions 2 and 4 (version 9 at revision 2) and one document.
function fakeHost() {
  const calls: { name: CommandName; input: unknown }[] = [];
  const answered: CommandInput<'maws.artifact.exported'>[] = [];
  const listeners: ((request: MawsArtifactExport) => void)[] = [];
  const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    calls.push({ name, input });
    const { artifactId } = input as { artifactId: string };
    const row = artifactId === ID ? { id: ID, kind: 'html', revision: 4 } : artifactId === DOC ? { id: DOC, kind: 'document', revision: 7 } : null;
    if (name === 'artifacts.get') return { ok: true, value: { artifact: row } } as CommandResult<CommandName>;
    if (name === 'artifacts.versions') return { ok: true, value: { versions: row ? [{ id: 9, seq: 2 }] : [] } } as CommandResult<CommandName>;
    throw new Error(`unexpected ${name}`);
  };
  return {
    calls,
    answered,
    emit: (request: MawsArtifactExport) => listeners.forEach((listener) => listener(request)),
    deps: (registry: ExporterRegistry) => ({
      registry,
      root,
      call: call as ExportServiceDeps['call'],
      onEvent: (name: 'maws.artifact.export', listener: (request: MawsArtifactExport) => void) => {
        expect(name).toBe('maws.artifact.export');
        listeners.push(listener);
        return () => void listeners.splice(listeners.indexOf(listener), 1);
      },
      answer: async (input: CommandInput<'maws.artifact.exported'>) => void answered.push(input),
    }),
  };
}
const request = (over: Partial<MawsArtifactExport> = {}): MawsArtifactExport => ({
  appSessionId: 'App-A' as AppSessionId,
  requestId: 'r1' as RequestId,
  artifactId: ID,
  kind: 'html',
  format: 'pdf',
  revision: 4,
  path: join(root, ID, 'exports', '4-pdf.pdf'),
  ...over,
});
const until = async (test: () => boolean) => {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};

describe('the export service', () => {
  it('answers the host’s export request through maws.artifact.exported, the file written where the host named', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register('html', 'pdf', async (j) => bytes(`%PDF ${j.revision}`));
    const service = startExportService(host.deps(registry));
    host.emit(request());
    host.emit(request({ requestId: 'r2' as RequestId, kind: 'document', format: 'docx', revision: 7, artifactId: DOC, path: join(root, DOC, 'exports', '7-docx.docx') }));
    await until(() => host.answered.length === 2);
    expect(host.answered).toEqual(
      expect.arrayContaining([
        { appSessionId: 'App-A', requestId: 'r1', answer: { ok: true } },
        { appSessionId: 'App-A', requestId: 'r2', answer: { ok: false, unavailable: true, error: 'MAWS cannot export a document artifact as docx yet' } },
      ]),
    );
    expect(await readFile(join(root, ID, 'exports', '4-pdf.pdf'), 'utf8')).toBe('%PDF 4');
    service.stop();
    host.emit(request({ requestId: 'r3' as RequestId }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.answered).toHaveLength(2); // stopped: no longer listening
  });

  it('runs at most two exports at once and answers one that waited EXPORT_QUEUE_MS for a slot as busy', async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    registry.register('html', 'pdf', async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running--;
      return bytes('%PDF');
    });
    startExportService(host.deps(registry));
    for (const id of ['r1', 'r2', 'r3']) host.emit(request({ requestId: id as RequestId }));
    await vi.advanceTimersByTimeAsync(EXPORT_QUEUE_MS + 1);
    expect(peak).toBe(2);
    expect(host.answered).toEqual([{ appSessionId: 'App-A', requestId: 'r3', answer: { ok: false, error: `MAWS was busy with other exports for ${EXPORT_QUEUE_MS / 1000} s; try again` } }]);
    releases.forEach((release) => release());
    vi.useRealTimers(); // the two exports write their files
    await until(() => host.answered.length === 3);
    expect(host.answered.map((a) => a.requestId).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('serves the library’s artifacts.export: the live revision or a version’s, a PNG’s size handed on, the path under the store', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    const jobs: ExportJob[] = [];
    registry.register('html', 'png', async (j) => {
      jobs.push(j);
      return bytes('PNG');
    });
    registry.register('html', 'pdf', async () => bytes('%PDF'));
    const service = startExportService(host.deps(registry));
    expect(await service.exportForLibrary({ artifactId: ID, format: 'png', width: 640, height: 480 })).toEqual({ path: join(root, ID, 'exports', '4-png.png'), revision: 4 });
    expect(jobs).toEqual([{ artifactId: ID, kind: 'html', format: 'png', revision: 4, width: 640, height: 480 }]);
    expect(await service.exportForLibrary({ artifactId: ID, format: 'pdf', versionId: 9 })).toEqual({ path: join(root, ID, 'exports', '2-pdf.pdf'), revision: 2 });
    expect(await readFile(join(root, ID, 'exports', '2-pdf.pdf'), 'utf8')).toBe('%PDF');
  });

  it('refuses the library’s export of an unknown artifact or version (notFound) and of a kind no exporter serves (exportUnavailable)', async () => {
    const host = fakeHost();
    const service = startExportService(host.deps(new ExporterRegistry()));
    const refusal = (input: CommandInput<'artifacts.export'>) => service.exportForLibrary(input).then(() => null, (error: { error?: unknown }) => error.error);
    expect(await refusal({ artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', format: 'pdf' })).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
    expect(await refusal({ artifactId: ID, format: 'pdf', versionId: 3 })).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
    expect(await refusal({ artifactId: DOC, format: 'docx' })).toMatchObject({
      code: 'invalid_input',
      message: 'MAWS cannot export a document artifact as docx yet',
      issues: { reason: 'exportUnavailable', data: { kind: 'document', format: 'docx' } },
    });
  });
});
