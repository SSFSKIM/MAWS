import { existsSync } from 'node:fs';
import { HostBridge } from '../../engine-host/tool-server/bridge';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import type { AppSessionId, RequestId } from '@shared/graph/ids';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
// P4 (W1, tracker 2026-10-14 L131): one step awaited before a `rename` of a given path completes, so a publication
// issued before the deadline can be made to finish after it
const slowRename = vi.hoisted(() => ({ path: null as string | null, wait: null as (() => Promise<void>) | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const rename = (async (...args: Parameters<typeof actual.rename>) => {
    await actual.rename(...args);
    if (slowRename.path === null || String(args[1]) !== slowRename.path) return;
    const wait = slowRename.wait;
    slowRename.path = slowRename.wait = null;
    await wait?.();
  }) as typeof actual.rename;
  return { ...actual, default: { ...actual, rename }, rename };
});

import { EXPORT_BUDGET_MS, EXPORT_QUEUE_MS, ExportBudget, ExporterRegistry, printRequestAllowed, runExport, startExportService, type ExportContext, type Exporter, type ExportRequest, type ExportServiceDeps, type ExportSources } from './export';

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

const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({ artifactId: ID, kind: 'html', format: 'pdf', revision: 4, path: join(root, ID, 'exports', '4-pdf.pdf'), ...over });
// An exporter that writes `text` through the context, recording what it was asked.
const writing = (kind: Exporter['kind'], format: Exporter['format'], text: (request: ExportRequest, context: ExportContext) => Promise<string> | string, seen: ExportRequest[] = []): Exporter => ({
  kind,
  format,
  run: async (req, context) => {
    seen.push(req);
    await context.writeFile(req.path, await text(req, context));
  },
});
const sources = (over: Partial<ExportSources> = {}): ExportSources => ({
  title: 'T',
  state: async () => new Uint8Array(),
  readAsset: async () => null,
  listAssets: async () => [],
  print: async () => new Uint8Array(),
  ...over,
});

describe('the exporter registry (X31): registered from outside A by kind and format', () => {
  it('finds an exporter by kind and format, the last registration winning, and forgets one when its registration is undone', () => {
    const registry = new ExporterRegistry();
    const first = writing('presentation', 'pptx', () => '1');
    const second = writing('presentation', 'pptx', () => '2');
    registry.register(first);
    const undo = registry.register(second);
    expect(registry.get('presentation', 'pptx')).toBe(second);
    expect(registry.get('presentation', 'pdf')).toBeUndefined();
    expect(registry.get('document', 'pptx')).toBeUndefined();
    undo();
    expect(registry.get('presentation', 'pptx')).toBeUndefined();
  });
});

describe('runExport', () => {
  it('runs the exporter, whose write lands whole at the path (its directory created) with no temporary file left', async () => {
    const registry = new ExporterRegistry();
    const seen: ExportRequest[] = [];
    registry.register(writing('html', 'pdf', () => '%PDF-1.7', seen));
    expect(await runExport(registry, request({ pageSize: 'a4' }), sources())).toEqual({ ok: true, revision: 4, path: request().path });
    expect(await readFile(request().path, 'utf8')).toBe('%PDF-1.7');
    expect(await readdir(join(root, ID, 'exports'))).toEqual(['4-pdf.pdf']);
    expect(seen).toEqual([request({ pageSize: 'a4' })]);
  });

  it('answers unavailable for a kind and format no exporter serves, naming both', async () => {
    expect(await runExport(new ExporterRegistry(), request({ kind: 'document', format: 'docx' }), sources())).toEqual({
      ok: false,
      unavailable: true,
      error: 'MAWS cannot export a document artifact as docx yet',
    });
  });

  it('answers an exporter’s failure and its timeout as errors, writing nothing', async () => {
    const registry = new ExporterRegistry();
    registry.register({ kind: 'html', format: 'pdf', run: async () => Promise.reject(new Error('the page did not load')) });
    registry.register({ kind: 'html', format: 'png', run: () => new Promise<void>(() => {}) });
    expect(await runExport(registry, request(), sources())).toEqual({ ok: false, error: 'the page did not load' });
    expect(await runExport(registry, request({ format: 'png' }), sources(), 20)).toEqual({ ok: false, error: 'the export did not finish within 0.02 s' });
    expect(await readdir(root)).toEqual([]);
  });

  // fix wave 1, the review's finding 2: the deadline cancels the export; a late write lands nowhere
  it('cancels an export at its deadline: its printer is told, and a write it makes after the answer is refused and lands nowhere', async () => {
    const registry = new ExporterRegistry();
    let resume!: () => void;
    let late: Promise<unknown> | null = null;
    let printSignal: AbortSignal | null = null;
    registry.register({
      kind: 'document',
      format: 'pdf',
      run: async (req, ctx) => {
        const printing = ctx.printToPdf('<p>x</p>');
        await new Promise<void>((resolve) => (resume = resolve));
        await printing;
        late = ctx.writeFile(req.path, '%PDF late');
        await late;
      },
    });
    const print: ExportSources['print'] = (_html, job) => {
      printSignal = job.signal;
      return Promise.resolve(bytes('%PDF'));
    };
    const answer = await runExport(registry, request({ kind: 'document' }), sources({ print }), 20);
    expect(answer).toEqual({ ok: false, error: 'the export did not finish within 0.02 s' });
    expect(printSignal!.aborted).toBe(true); // the printer destroys its window on it
    resume();
    await until(() => late !== null);
    await expect(late).rejects.toThrow(/cancelled/);
    expect(await readdir(root)).toEqual([]);
  });

  // P4 (W1, L131; A's Decision Log 44's residual): a rename issued before the deadline that completes after it answers the
  // timeout, as the bridge already gave up on it, never a late success
  it('answers the timeout when the publication’s rename completes after the deadline', async () => {
    const registry = new ExporterRegistry();
    registry.register(writing('html', 'pdf', () => '%PDF-1.7'));
    const budget = new ExportBudget(500); // real mkdir and writeFile calls meet it under load, so the deadline falls after the publication starts
    slowRename.path = request().path;
    slowRename.wait = () => until(() => budget.expired);
    expect(await runExport(registry, request(), sources(), budget)).toEqual({ ok: false, error: 'the export did not finish within 0.5 s' });
    expect(slowRename.path).toBeNull(); // the rename ran
  });

  it('removes an inspection image whose publication completes after the export deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'png', () => 'inspection image'));
    const job = request({ kind: 'document', format: 'png', inspection: true });
    const budget = new ExportBudget(60_000);
    slowRename.path = job.path;
    slowRename.wait = async () => { await vi.advanceTimersByTimeAsync(60_001); };
    expect(await runExport(registry, job, sources(), budget)).toEqual({ ok: false, error: 'the export did not finish within 60 s' });
    expect(slowRename.path).toBeNull(); // the image really was published before the simulated completion delay
    expect(existsSync(job.path)).toBe(false);
  });

  it('puts nothing in place when the exporter fails after a write, and answers the blocked requests its printer counted', async () => {
    const registry = new ExporterRegistry();
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => {
      await ctx.writeFile(req.path, '%PDF half');
      throw new Error('the mapper broke');
    } });
    expect(await runExport(registry, request({ kind: 'document' }), sources())).toEqual({ ok: false, error: 'the mapper broke' });
    expect(await readdir(root)).toEqual([ID]);
    expect(await readdir(join(root, ID, 'exports'))).toEqual([]);
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => ctx.writeFile(req.path, await ctx.printToPdf('<img src="https://example.com/a.png">')) });
    const print: ExportSources['print'] = async (_html, job) => {
      job.blocked('https://example.com/a.png');
      job.blocked('https://example.com/b.css');
      return bytes('%PDF');
    };
    expect(await runExport(registry, request({ kind: 'document' }), sources({ print }))).toEqual({ ok: true, revision: 4, path: request().path, blockedRequests: 2 });
  });
});

describe('the PDF printer’s request filter (Decision Log 44b)', () => {
  it('lets its own page, the artifact scheme, data:, blob: and about: through, and nothing else', () => {
    const page = 'file:///tmp/maws-print-x/page.html';
    for (const url of [page, 'maws-artifact://0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/live/assets/a.png', 'data:image/png;base64,AA==', 'blob:file:///7c2a', 'about:blank']) {
      expect(printRequestAllowed(url, page), url).toBe(true);
    }
    for (const url of ['http://127.0.0.1:8080/a.png', 'https://example.com/font.woff2', 'file:///etc/hosts', 'file:///tmp/maws-print-x/other.html', `${page}x`, 'maws-deliverable://x/y/1', 'ws://example.com/']) {
      expect(printRequestAllowed(url, page), url).toBe(false);
    }
  });
});

// A host that holds one html artifact at revisions 2 and 4 (version 9 at revision 2, with an asset) and one document
// (live at 7, version 3 at 5).
function fakeHost() {
  let liveRevision = 7; // the document's live revision as `artifacts.state` reads it
  const answered: CommandInput<'maws.artifact.exported'>[] = [];
  const listeners: ((request: MawsArtifactExport) => void)[] = [];
  const asset = join(root, 'asset.png');
  const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    const { artifactId } = input as { artifactId: string };
    const row = artifactId === ID ? { id: ID, kind: 'html', title: 'Report', revision: 4 } : artifactId === DOC ? { id: DOC, kind: 'document', title: 'Notes', revision: 7 } : null;
    const answer = (value: unknown) => ({ ok: true, value }) as CommandResult<CommandName>;
    switch (name) {
      case 'artifacts.get':
        return answer({ artifact: row });
      case 'artifacts.versions':
        return answer({ versions: artifactId === ID ? [{ id: 9, seq: 2 }] : [{ id: 3, seq: 5 }] });
      case 'artifacts.versionState':
        return answer({ bytes: bytes(`version ${(input as { versionId: number }).versionId}`) });
      case 'artifacts.state':
        return answer({ revision: liveRevision, bytes: bytes(`live@${liveRevision}`) });
      case 'artifacts.assets': {
        // P4 (W1, L245): a version's listing is what it pinned (here, the image alone)
        const all = [{ ref: 'assets/a.png', name: 'a.png', mime: 'image/png', size: 3 }, { ref: 'assets/font.woff2', name: 'font.woff2', mime: 'font/woff2', size: 9 }];
        const pinned = (input as { versionId?: number }).versionId === undefined ? all : all.slice(0, 1);
        return row ? answer({ assets: pinned }) : { ok: false, error: { code: 'invalid_input', message: 'not found', issues: { reason: 'notFound', data: {} } } } as CommandResult<CommandName>;
      }
      case 'artifacts.content': {
        const path = (input as { path?: string }).path;
        if (path === 'assets/a.png') return answer({ revision: 4, kind: row!.kind, name: 'a.png', size: 3, sha256: 'x', path: asset });
        if (path === 'assets/down.png') return { ok: false, error: { code: 'host_unavailable', message: 'the engine host is restarting' } } as CommandResult<CommandName>;
        return { ok: false, error: { code: 'invalid_input', message: 'not found', issues: { reason: 'notFound', data: {} } } } as CommandResult<CommandName>;
      }
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
  return {
    answered,
    asset,
    moveTo: (revision: number) => void (liveRevision = revision),
    emit: (req: MawsArtifactExport) => listeners.forEach((listener) => listener(req)),
    deps: (registry: ExporterRegistry): ExportServiceDeps => ({
      registry,
      root,
      call: call as ExportServiceDeps['call'],
      onEvent: (name, listener) => {
        expect(name).toBe('maws.artifact.export');
        listeners.push(listener);
        return () => void listeners.splice(listeners.indexOf(listener), 1);
      },
      answer: async (input) => {
        answered.push(input);
        return { ok: true, value: { outcome: 'delivered' } };
      },
      print: async (html) => bytes(`%PDF ${html}`),
    }),
  };
}
const hostRequest = (over: Partial<MawsArtifactExport> = {}): MawsArtifactExport => ({
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
  it.each(['withdrawn', 'ended', 'timeout'] as const)('removes a late inspection image after the host request is %s', async (outcome) => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let finish!: () => void;
    registry.register(writing('document', 'png', async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return 'inspection image';
    }));
    const bridge = new HostBridge<MawsArtifactExport, MawsArtifactExportAnswer>({ send: host.emit, answerMs: 100 });
    const deps = host.deps(registry);
    const acknowledgments: string[] = [];
    const service = startExportService({ ...deps, answer: async (input) => {
      host.answered.push(input);
      const outcome = bridge.answer(input.requestId as RequestId, input.answer);
      acknowledgments.push(outcome);
      return { ok: true, value: { outcome } };
    } });
    const controller = new AbortController();
    const pending = bridge.request(hostRequest({ artifactId: DOC, kind: 'document', format: 'png', path: join(root, DOC, 'exports', 'inspect.png'), inspection: true }), controller.signal);
    await until(() => finish !== undefined);
    if (outcome === 'withdrawn') controller.abort();
    if (outcome === 'ended') bridge.processExited();
    expect(await pending).toEqual({ kind: outcome });
    finish();
    await until(() => host.answered.length === 1);
    expect(acknowledgments).toEqual(['not_pending']);
    const answer = host.answered[0]!.answer;
    expect(answer.ok).toBe(true);
    if (!answer.ok) throw new Error(answer.error);
    await until(() => !existsSync(answer.path));
    expect(await readdir(join(root, DOC, 'exports'))).toEqual([]);
    service.stop();
  });

  it.each([true, false])('retains a delivered inspection or an ordinary abandoned export (inspection=%s)', async (inspection) => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'png', () => 'export image'));
    const deps = host.deps(registry);
    const service = startExportService({ ...deps, answer: async (input) => {
      host.answered.push(input);
      return { ok: true, value: { outcome: inspection ? 'delivered' : 'not_pending' } };
    } });
    host.emit(hostRequest({ artifactId: DOC, kind: 'document', format: 'png', ...(inspection && { inspection: true }) }));
    await until(() => host.answered.length === 1);
    const answer = host.answered[0]!.answer;
    if (!answer.ok) throw new Error(answer.error);
    expect(await readFile(answer.path, 'utf8')).toBe('export image');
    service.stop();
  });

  it('answers the host’s export request through maws.artifact.exported, the file written where the host named, its page size handed on', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    const seen: ExportRequest[] = [];
    registry.register(writing('html', 'pdf', (req, ctx) => `%PDF ${ctx.title} ${req.revision}`, seen));
    const service = startExportService(host.deps(registry));
    host.emit(hostRequest({ pageSize: 'letter' }));
    host.emit(hostRequest({ requestId: 'r2' as RequestId, kind: 'document', format: 'docx', revision: 7, artifactId: DOC, path: join(root, DOC, 'exports', '7-docx.docx') }));
    await until(() => host.answered.length === 2);
    expect(host.answered).toEqual(
      expect.arrayContaining([
        { appSessionId: 'App-A', requestId: 'r1', answer: { ok: true, revision: 4, path: join(root, ID, 'exports', '4-pdf.pdf') } },
        { appSessionId: 'App-A', requestId: 'r2', answer: { ok: false, unavailable: true, error: 'MAWS cannot export a document artifact as docx yet' } },
      ]),
    );
    expect(await readFile(join(root, ID, 'exports', '4-pdf.pdf'), 'utf8')).toBe('%PDF Report 4');
    expect(seen).toEqual([{ artifactId: ID, kind: 'html', format: 'pdf', revision: 4, path: join(root, ID, 'exports', '4-pdf.pdf'), pageSize: 'letter' }]);
    service.stop();
    host.emit(hostRequest({ requestId: 'r3' as RequestId }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.answered).toHaveLength(2); // stopped: no longer listening
  });

  it('gives an exporter the artifact’s title, its state (the version’s, else the live doc’s), its assets and the PDF printer', async () => {
    const host = fakeHost();
    await writeFile(host.asset, new Uint8Array([1, 2, 3]));
    const registry = new ExporterRegistry();
    registry.register(
      writing('document', 'pdf', async (req, ctx) => {
        const state = new TextDecoder().decode(await ctx.state());
        const asset = await ctx.readAsset('assets/a.png');
        const missing = await ctx.readAsset('assets/none.png');
        const pdf = new TextDecoder().decode(await ctx.printToPdf(`<h1>${ctx.title}</h1>`));
        return JSON.stringify({ state, asset: asset && { bytes: [...asset.bytes], mime: asset.mime }, missing, pdf, pageSize: req.pageSize ?? null });
      }),
    );
    const service = startExportService(host.deps(registry));
    const live = await service.exportForLibrary({ artifactId: DOC, format: 'pdf', pageSize: 'a4' });
    expect(live).toEqual({ path: join(root, DOC, 'exports', '7-pdf.pdf'), revision: 7 });
    expect(JSON.parse(await readFile(live.path, 'utf8'))).toEqual({ state: 'live@7', asset: { bytes: [1, 2, 3], mime: 'image/png' }, missing: null, pdf: '%PDF <h1>Notes</h1>', pageSize: 'a4' });
    const version = await service.exportForLibrary({ artifactId: DOC, format: 'pdf', versionId: 3 });
    expect(version).toEqual({ path: join(root, DOC, 'exports', '5-pdf.pdf'), revision: 5 });
    expect(JSON.parse(await readFile(version.path, 'utf8'))).toMatchObject({ state: 'version 3', pageSize: null });
  });

  it('runs at most two exports at once and answers one that waited EXPORT_QUEUE_MS for a slot as busy', async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    registry.register(
      writing('html', 'pdf', async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running--;
        return '%PDF';
      }),
    );
    startExportService(host.deps(registry));
    for (const id of ['r1', 'r2', 'r3']) host.emit(hostRequest({ requestId: id as RequestId }));
    await vi.advanceTimersByTimeAsync(EXPORT_QUEUE_MS + 1);
    expect(peak).toBe(2);
    expect(host.answered).toEqual([{ appSessionId: 'App-A', requestId: 'r3', answer: { ok: false, error: `MAWS was busy with other exports for ${EXPORT_QUEUE_MS / 1000} s; try again` } }]);
    releases.forEach((release) => release());
    vi.useRealTimers(); // the two exports write their files
    await until(() => host.answered.length === 3);
    expect(host.answered.map((a) => a.requestId).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('carries the actual comment author through the library result, but omits it when no human comment was exported', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'docx', (_req, ctx) => {
      ctx.reportCommentAuthor?.('Kim Min');
      return 'DOCX';
    }));
    registry.register(writing('document', 'pdf', () => 'PDF'));
    const service = startExportService(host.deps(registry));
    expect(await service.exportForLibrary({ artifactId: DOC, format: 'docx' })).toMatchObject({ revision: 7, commentAuthorName: 'Kim Min' });
    expect(await service.exportForLibrary({ artifactId: DOC, format: 'pdf' })).not.toHaveProperty('commentAuthorName');
    service.stop();
  });

  it('serves the library’s artifacts.export: the live revision or a version’s, a PNG’s size handed on, the path under the store', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    const seen: ExportRequest[] = [];
    registry.register(writing('html', 'png', () => 'PNG', seen));
    registry.register(writing('html', 'pdf', () => '%PDF'));
    const service = startExportService(host.deps(registry));
    expect(await service.exportForLibrary({ artifactId: ID, format: 'png', width: 640, height: 480 })).toEqual({ path: join(root, ID, 'exports', '4-png.png'), revision: 4 });
    expect(seen).toEqual([{ artifactId: ID, kind: 'html', format: 'png', revision: 4, path: join(root, ID, 'exports', '4-png.png'), width: 640, height: 480 }]);
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

// fix wave 2, the re-review's finding 2: one budget from receipt to publication, inside the bridge's 60 s
describe('the export’s one budget (EXPORT_BUDGET_MS from main’s receipt)', { timeout: 30_000 }, () => {
  // Real I/O while setTimeout and Date are faked: setImmediate stays real, so the staged writes can finish. `io` waits
  // for the condition up to a liveness ceiling in real time (gate-offload Decision Log 35, P6), read from a clock taken
  // at load, which no fake reaches (vitest's default fake set includes `process.hrtime`); the cases' 30 s cover it.
  const IO_CEILING_NS = 10_000_000_000n;
  const realNs = process.hrtime.bigint;
  const io = async (test: () => boolean | Promise<boolean>) => {
    const deadline = realNs() + IO_CEILING_NS;
    while (!(await test()) && realNs() < deadline) await new Promise((resolve) => setImmediate(resolve));
    expect(await test()).toBe(true);
  };
  const slowHost = (host: ReturnType<typeof fakeHost>, ms: number) => {
    const deps = host.deps;
    return (registry: ExporterRegistry): ExportServiceDeps => {
      const made = deps(registry);
      return { ...made, call: ((name: CommandName, input: unknown) => new Promise((resolve) => setTimeout(resolve, ms)).then(() => made.call(name as never, input as never))) as ExportServiceDeps['call'] };
    };
  };

  it('answers the timeout at the deadline when slow snapshot reads and the run overrun it, and publishes nothing after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    expect(EXPORT_BUDGET_MS).toBeLessThan(60_000); // the bridge's EXPORT_ANSWER_MS
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let wrote: Promise<unknown> | null = null;
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      wrote = ctx.writeFile(req.path, '%PDF late');
      await wrote;
    } });
    startExportService(slowHost(host, 20_000)(registry)); // artifacts.get and artifacts.state take 20 s each
    host.emit(hostRequest({ artifactId: DOC, kind: 'document', revision: 7, path: join(root, DOC, 'exports', '7-pdf.pdf') }));
    await vi.advanceTimersByTimeAsync(EXPORT_BUDGET_MS - 1);
    expect(host.answered).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    await io(() => host.answered.length === 1);
    expect(host.answered[0]!.answer).toEqual({ ok: false, error: `the export did not finish within ${EXPORT_BUDGET_MS / 1000} s` });
    await vi.advanceTimersByTimeAsync(10_000); // the run's own 20 s end at 60 s
    await io(() => wrote !== null);
    await expect(wrote).rejects.toThrow(/cancelled/);
    expect(await readdir(root)).toEqual([]);
  });

  it('puts nothing in place when the exporter staged its file before the deadline but finished after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let staged = false;
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, EXPORT_BUDGET_MS - 5_000));
      await ctx.writeFile(req.path, '%PDF staged');
      staged = true;
      await new Promise((resolve) => setTimeout(resolve, 10_000)); // its publication would come after the deadline
    } });
    startExportService(host.deps(registry));
    host.emit(hostRequest({ artifactId: DOC, kind: 'document', revision: 7, path: join(root, DOC, 'exports', '7-pdf.pdf') }));
    await vi.advanceTimersByTimeAsync(EXPORT_BUDGET_MS - 5_000);
    await io(() => staged);
    await vi.advanceTimersByTimeAsync(5_001);
    await io(() => host.answered.length === 1);
    expect(host.answered[0]!.answer).toMatchObject({ ok: false, error: expect.stringContaining('did not finish') });
    await vi.advanceTimersByTimeAsync(10_000);
    await io(async () => (await readdir(join(root, DOC, 'exports'))).length === 0);
  });
});

describe('the export’s snapshot and its asset reads (fix wave 1, the review’s findings 3 and 4)', () => {
  it('exports a document that moved between the request and its turn as the revision its state was read at, naming the file by it', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    const seen: ExportRequest[] = [];
    registry.register(writing('document', 'pdf', async (_req, ctx) => new TextDecoder().decode(await ctx.state()), seen));
    const service = startExportService(host.deps(registry));
    host.moveTo(8); // the request below was made at 7
    host.emit(hostRequest({ artifactId: DOC, kind: 'document', revision: 7, path: join(root, DOC, 'exports', '7-pdf.pdf') }));
    await until(() => host.answered.length === 1);
    expect(host.answered[0]!.answer).toEqual({ ok: true, revision: 8, path: join(root, DOC, 'exports', '8-pdf.pdf') });
    expect(await readFile(join(root, DOC, 'exports', '8-pdf.pdf'), 'utf8')).toBe('live@8');
    expect(await readdir(join(root, DOC, 'exports'))).toEqual(['8-pdf.pdf']);
    expect(seen.map((r) => r.revision)).toEqual([8]);
    host.moveTo(9); // the library's own: admitted at 7 (artifacts.get), exported at 9
    expect(await service.exportForLibrary({ artifactId: DOC, format: 'pdf' })).toEqual({ path: join(root, DOC, 'exports', '9-pdf.pdf'), revision: 9 });
    expect(await readFile(join(root, DOC, 'exports', '9-pdf.pdf'), 'utf8')).toBe('live@9');
  });

  it('lists the artifact’s assets for an exporter, those its content does not name included (Decision Log 45e)', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'pdf', async (_req, ctx) => JSON.stringify(await ctx.assets.list())));
    const service = startExportService(host.deps(registry));
    const { path } = await service.exportForLibrary({ artifactId: DOC, format: 'pdf' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([
      { ref: 'assets/a.png', name: 'a.png', mime: 'image/png', size: 3 },
      { ref: 'assets/font.woff2', name: 'font.woff2', mime: 'font/woff2', size: 9 },
    ]);
  });

  // P4 (W1, tracker 2026-10-18 L245 and 2026-10-14 L160): a retained version's export lists that version's assets, from
  // the library and through the bridge alike, never the artifact's current ones
  it('lists a version’s own assets for an exporter of that version', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'pdf', async (_req, ctx) => JSON.stringify((await ctx.assets.list()).map((asset) => asset.ref))));
    const service = startExportService(host.deps(registry));
    const { path } = await service.exportForLibrary({ artifactId: DOC, format: 'pdf', versionId: 3 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(['assets/a.png']);
    const asked = join(root, 'tool', 'notes-v3.pdf'); // where the host names the tool's file
    host.emit(hostRequest({ artifactId: DOC, kind: 'document', revision: 5, versionId: 3, path: asked }));
    await until(() => host.answered.length === 1);
    expect(host.answered[0]!.answer).toMatchObject({ ok: true, path: asked });
    expect(JSON.parse(await readFile(asked, 'utf8'))).toEqual(['assets/a.png']);
  });

  it('answers a missing asset null, and fails the export on any other failure to read one', async () => {
    const host = fakeHost();
    await writeFile(host.asset, new Uint8Array([1]));
    const registry = new ExporterRegistry();
    let ref = 'assets/gone.png';
    registry.register(writing('document', 'pdf', async (_req, ctx) => JSON.stringify(await ctx.readAsset(ref))));
    const service = startExportService(host.deps(registry));
    expect(JSON.parse(await readFile((await service.exportForLibrary({ artifactId: DOC, format: 'pdf' })).path, 'utf8'))).toBeNull();
    ref = 'assets/down.png';
    await expect(service.exportForLibrary({ artifactId: DOC, format: 'pdf' })).rejects.toMatchObject({ error: { code: 'internal', message: expect.stringContaining('the engine host is restarting') } });
  });
});

// P3 Decision Log 91 (the interface ledger's X31 `ownFile` row, the input-side twin of E's Decision Log 33 `exportId`): an
// export that is a file of its own is named, before it renders, by an id main mints, so no later export of the same
// revision and format replaces what its caller (Send to) still waits to deliver; every other export keeps the
// revision-and-format cache path.
describe('an export of its own file (P3 Decision Log 91)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const own = (dir: string, revision: number, format: string, exportId: string) => join(root, dir, 'exports', `${revision}-${format}-${exportId}.${format}`);

  it('with ownFile, writes under a name minted before rendering and answers its exportId; two such exports never share a file', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    const seen: ExportRequest[] = [];
    let n = 0;
    registry.register(writing('html', 'pdf', () => `%PDF ${++n}`, seen));
    const service = startExportService(host.deps(registry));
    const first = await service.exportForLibrary({ artifactId: ID, format: 'pdf', ownFile: true });
    const second = await service.exportForLibrary({ artifactId: ID, format: 'pdf', ownFile: true });
    expect(first.exportId).toMatch(UUID);
    expect(first).toEqual({ path: own(ID, 4, 'pdf', first.exportId!), revision: 4, exportId: first.exportId });
    expect(second.exportId).toMatch(UUID);
    expect(second.exportId).not.toBe(first.exportId);
    expect(
      seen.map((r) => [r.path, r.exportId]),
      'the exporter was asked for the minted file itself, not the cache',
    ).toEqual([
      [first.path, first.exportId],
      [second.path, second.exportId],
    ]);
    expect(await readFile(first.path, 'utf8')).toBe('%PDF 1');
    expect(await readFile(second.path, 'utf8')).toBe('%PDF 2');
    expect((await readdir(join(root, ID, 'exports'))).sort(), 'no cache file, no temporary left').toEqual([`4-pdf-${first.exportId}.pdf`, `4-pdf-${second.exportId}.pdf`].sort());
  });

  it('carries its id through the live revision a moved document is exported at', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('document', 'pdf', async (_req, ctx) => new TextDecoder().decode(await ctx.state())));
    const service = startExportService(host.deps(registry));
    host.moveTo(9); // admitted at 7 (artifacts.get), exported at 9
    const answer = await service.exportForLibrary({ artifactId: DOC, format: 'pdf', ownFile: true });
    expect(answer).toEqual({ path: own(DOC, 9, 'pdf', answer.exportId!), revision: 9, exportId: expect.stringMatching(UUID) });
    expect(await readFile(answer.path, 'utf8')).toBe('live@9');
  });

  it('keeps its selected bytes and path while other exports of the same revision and format, with other options, run before and after it lands', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    let gate: Promise<void> | null = null;
    let rendering = false;
    registry.register(
      writing('html', 'pdf', async (req) => {
        const held = gate;
        if (held) {
          rendering = true;
          await held;
        }
        return `%PDF ${req.pageSize ?? 'own'}`;
      }),
    );
    const service = startExportService(host.deps(registry));
    // the Send's export is rendering when a normal export of the same revision and format (another paper) runs and lands
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    const sending = service.exportForLibrary({ artifactId: ID, format: 'pdf', ownFile: true });
    await until(() => rendering);
    gate = null;
    const letter = await service.exportForLibrary({ artifactId: ID, format: 'pdf', pageSize: 'letter' });
    expect(letter, 'a normal export keeps the cache path and answers no id').toEqual({ path: join(root, ID, 'exports', '4-pdf.pdf'), revision: 4 });
    release();
    const selected = await sending;
    expect(selected.path).not.toBe(letter.path);
    expect(await readFile(selected.path, 'utf8')).toBe('%PDF own');
    // then, while Send to waits for its session, another normal export of that revision and format replaces the cache
    const a4 = await service.exportForLibrary({ artifactId: ID, format: 'pdf', pageSize: 'a4' });
    expect(a4.path).toBe(letter.path);
    expect(await readFile(a4.path, 'utf8')).toBe('%PDF a4');
    expect(await readFile(selected.path, 'utf8'), 'the selected file is untouched').toBe('%PDF own');
  });

  it('mints an id for a design export through the bridge too (E’s Decision Log 33), in the directory the host named', async () => {
    const host = fakeHost();
    const registry = new ExporterRegistry();
    registry.register(writing('design', 'png', () => 'PNG'));
    startExportService(host.deps(registry));
    host.emit(hostRequest({ kind: 'design', format: 'png', revision: 7, path: join(root, ID, 'exports', '7-png.png') }));
    await until(() => host.answered.length === 1);
    const answer = host.answered[0]!.answer as { ok: true; path: string; revision: number; exportId?: string };
    expect(answer).toEqual({ ok: true, revision: 7, path: own(ID, 7, 'png', answer.exportId!), exportId: expect.stringMatching(UUID) });
    expect(await readFile(answer.path, 'utf8')).toBe('PNG');
  });
});
