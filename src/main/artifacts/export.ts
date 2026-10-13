// The export service (X31; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M7): one service in main, reached by the
// agent's `artifact_export` (the engine host asks over `maws.artifact.export` and is answered through
// `maws.artifact.exported`, as `artifact_screenshot`'s capture is) and by the library's Export (`artifacts.export`).
// An `ExporterRegistry` keyed by kind and format says what can be exported: this milestone registers an `html`
// artifact's PDF and PNG (`registerHtmlExporters`); P3-B and P3-C register their kinds' exporters from outside A
// (`ExporterRegistry.register`, B through its `registerDocumentExporters`). An exporter runs over an `ExportRequest`
// and the service's `ExportContext` (the artifact's title, its state at the revision, its assets, the PDF printer, an
// atomic file writer) and writes the file where the request names: the host's path for the tool, under the store's
// directory (`<userData>/artifacts/<id>/exports/<revision>-<format>.<ext>`) for the library. Main never opens the
// store: what an export needs of it comes through the host's commands.
//
// At most EXPORT_CONCURRENCY exports run at once; each has EXPORT_GUARD_MS, and one still waiting for a slot after
// EXPORT_QUEUE_MS is answered busy, so every answer leaves main inside the host's EXPORT_ANSWER_MS.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { artifactUrl } from '@shared/artifacts/scheme';
import { mimeOf } from '@shared/files/mime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { artifactExportName, type ArtifactExportFormat, type ArtifactExportPageSize } from '@shared/maws/tools';
import { CAPTURE_PARTITION, loadSettled, openCaptureWindow, settled, slots } from '../deliverables/capture';
import type { SeamEnv } from '../deliverables/policies';
import { CommandFailure } from '../ipc/router';
import type { ContentLookup } from './protocol';

export const EXPORT_GUARD_MS = 30_000;
export const EXPORT_QUEUE_MS = 25_000; // with the guard, 55 s: inside the host's 60
const EXPORT_CONCURRENCY = 2;
export const PNG_DEFAULT_WIDTH = 1280;
const PNG_FIRST_HEIGHT = 800; // the window's height before a whole-page PNG measures the page
const PNG_MAX_SIDE = 8_192; // EXPORT_SIZE_MAX: what an offscreen window renders

// What one export renders and where it goes: an artifact's revision (the live one, or a version's) in a format,
// written to `path`. `pageSize`: the paper when asked (omitted, the exporter's own default: an html page's CSS, else A4;
// a document's design-system page token, else Letter). `width` and `height`: a picture's size in CSS px when asked.
export interface ExportRequest {
  artifactId: string;
  kind: ArtifactKind;
  format: ArtifactExportFormat;
  revision: number;
  versionId?: number;
  path: string;
  pageSize?: ArtifactExportPageSize;
  width?: number;
  height?: number;
}

// What the service gives an exporter (A's side of P3-B's `DocumentExportContext`).
export interface ExportContext {
  title: string;
  // The artifact's V2 state: the version's when the request names one, else the live doc's (a Y kind's).
  state(): Promise<Uint8Array>;
  // An asset's bytes by its ref (`assets/<name>`); null when the artifact has no such asset.
  readAsset(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  // A standalone page printed in the capture partition's hidden window, JavaScript off, on its own `@page` size.
  printToPdf(html: string): Promise<Uint8Array>;
  // Writes through a temporary file renamed into place, so no reader sees half an export.
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
}

export interface Exporter {
  kind: ArtifactKind;
  format: ArtifactExportFormat;
  run(request: ExportRequest, context: ExportContext): Promise<void>;
}

export class ExporterRegistry {
  private readonly table = new Map<string, Exporter>();

  // P3-B's and P3-C's registration point (and A's own): the last registration for a kind and format wins; the answer
  // undoes this one.
  register(exporter: Exporter): () => void {
    const key = `${exporter.kind}/${exporter.format}`;
    this.table.set(key, exporter);
    return () => {
      if (this.table.get(key) === exporter) this.table.delete(key);
    };
  }

  get(kind: ArtifactKind, format: ArtifactExportFormat): Exporter | undefined {
    return this.table.get(`${kind}/${format}`);
  }
}

const unavailableMessage = (kind: ArtifactKind, format: ArtifactExportFormat) => `MAWS cannot export a ${kind} artifact as ${format} yet`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// One export, start to finish. Never rejects: every failure is an answer with its reason.
export async function runExport(registry: ExporterRegistry, request: ExportRequest, context: ExportContext, guardMs = EXPORT_GUARD_MS): Promise<MawsArtifactExportAnswer> {
  const exporter = registry.get(request.kind, request.format);
  if (!exporter) return { ok: false, unavailable: true, error: unavailableMessage(request.kind, request.format) };
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error(`the export did not finish within ${guardMs / 1000} s`)), guardMs);
    });
    await Promise.race([exporter.run(request, context), timedOut]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  } finally {
    clearTimeout(guard);
  }
}

// Writes `data` to `path` through a temporary file beside it, renamed into place.
export async function writeAtomically(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export interface ExportServiceDeps {
  registry: ExporterRegistry;
  root: string; // `<userData>/artifacts`, the store's directory (the host's own path rule)
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  onEvent(name: 'maws.artifact.export', listener: (request: MawsArtifactExport) => void): () => void;
  answer(input: CommandInput<'maws.artifact.exported'>): Promise<unknown>;
  printToPdf?: (html: string) => Promise<Uint8Array>; // printHtmlToPdf in the app; a test's stand-in
}

const refusal = (reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}) =>
  new CommandFailure(ipcError('invalid_input', message, { reason, data } satisfies ArtifactRefusal));

// Main's side of the export bridge and the library's command over one queue. Answers the library's export and `stop`.
export function startExportService({ registry, root, call, onEvent, answer, printToPdf = printHtmlToPdf }: ExportServiceDeps): {
  exportForLibrary(input: CommandInput<'artifacts.export'>): Promise<CommandOutput<'artifacts.export'>>;
  stop(): void;
} {
  const slot = slots(EXPORT_CONCURRENCY, EXPORT_QUEUE_MS);
  const busy = (): MawsArtifactExportAnswer => ({ ok: false, error: `MAWS was busy with other exports for ${EXPORT_QUEUE_MS / 1000} s; try again` });

  const required = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await call(name, input);
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  };
  // The context of one request, read from the host as the exporter asks.
  const contextOf = (request: ExportRequest, title: string): ExportContext => ({
    title,
    state: async () =>
      request.versionId !== undefined
        ? (await required('artifacts.versionState', { artifactId: request.artifactId, versionId: request.versionId })).bytes
        : (await required('artifacts.state', { artifactId: request.artifactId })).bytes,
    readAsset: async (ref) => {
      const found = await call('artifacts.content', { artifactId: request.artifactId, path: ref });
      if (!found.ok || !ref.startsWith('assets/')) return null;
      return { bytes: new Uint8Array(await readFile(found.value.path)), mime: mimeOf(found.value.name) };
    },
    printToPdf,
    writeFile: writeAtomically,
  });
  // A request run in its turn (a kind and format no exporter serves is answered at once); the title read when it
  // starts. Never rejects.
  const queued = async (request: ExportRequest, title?: string): Promise<MawsArtifactExportAnswer> => {
    if (!registry.get(request.kind, request.format)) return runExport(registry, request, contextOf(request, ''));
    return slot(async () => {
      let named = title;
      if (named === undefined) {
        const found = await call('artifacts.get', { artifactId: request.artifactId });
        if (!found.ok || !found.value.artifact) return { ok: false, error: `no artifact ${request.artifactId}` } satisfies MawsArtifactExportAnswer;
        named = found.value.artifact.title;
      }
      return runExport(registry, request, contextOf(request, named));
    }, busy);
  };

  const stop = onEvent('maws.artifact.export', (request) => {
    const { appSessionId, requestId, ...job } = request;
    void queued(job)
      .then((result) => answer({ appSessionId, requestId, answer: result }))
      .catch((error: unknown) => console.error('[artifacts] could not answer an export', error));
  });

  return {
    async exportForLibrary({ artifactId, format, versionId, pageSize, width, height }) {
      const { artifact } = await required('artifacts.get', { artifactId });
      if (!artifact) throw refusal('notFound', `no artifact ${artifactId}`);
      let revision = artifact.revision;
      if (versionId !== undefined) {
        const version = (await required('artifacts.versions', { artifactId })).versions.find((candidate) => candidate.id === versionId);
        if (!version) throw refusal('notFound', `no version ${versionId} of ${artifactId}`, { versionId });
        revision = version.seq;
      }
      const path = join(root, artifactId, 'exports', artifactExportName(revision, format));
      const request: ExportRequest = { artifactId, kind: artifact.kind, format, revision, path, ...(versionId !== undefined && { versionId }), ...(pageSize !== undefined && { pageSize }), ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
      const result = await queued(request, artifact.title);
      if (!result.ok) throw result.unavailable ? refusal('exportUnavailable', result.error, { kind: artifact.kind, format }) : new CommandFailure(ipcError('internal', result.error));
      return { path, revision };
    },
    stop,
  };
}

// A standalone page (an exporter's HTML: P3-B's document export) printed to PDF in a hidden window on the capture
// partition: JavaScript off (the page needs none and loads nothing from outside), no new windows, no navigation, the
// page loaded from a file of its own in the OS's temporary directory (Chromium caps a `data:` URL at 2 MB) and removed
// after; `preferCSSPageSize` makes the page's `@page` rule the paper and the margins; headings become the outline.
export async function printHtmlToPdf(html: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'maws-print-'));
  const win = new BrowserWindow({
    show: false,
    width: 816, // a Letter page at 96 px per inch, so a layout read before printing is the page's
    height: 1056,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: CAPTURE_PARTITION, backgroundThrottling: false, disableDialogs: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    const page = join(dir, 'page.html');
    await writeFile(page, html, 'utf8');
    await win.loadFile(page);
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// An `html` artifact's PDF and PNG: its page at the revision, rendered in the capture window (offscreen, sandboxed, the
// `maws-capture` partition, `backgroundThrottling: false`, no navigation and no new windows: Decision Log 17) from
// `maws-artifact://<id>/<revision>/<name>`, its scripts running as in the viewer. The PDF prints on the page's own CSS
// page size, else the asked paper, else A4 portrait, with backgrounds; the PNG is `width` (1280) wide and `height` high,
// or the page's whole height (at most PNG_MAX_SIDE).
export function registerHtmlExporters(registry: ExporterRegistry, { content, env }: { content: ContentLookup; env: SeamEnv }): () => void {
  const render = async <T>(request: ExportRequest, width: number, height: number, use: (win: BrowserWindow) => Promise<T>): Promise<T> => {
    const found = await content({ artifactId: request.artifactId, revision: request.revision });
    if (!found.ok) throw new Error(`the artifact has no page at revision ${request.revision}: ${found.error.message}`);
    const win = openCaptureWindow(width, height, env);
    try {
      await loadSettled(win, artifactUrl(request.artifactId, request.revision, found.value.name));
      return await use(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };
  const pdf: Exporter = {
    kind: 'html',
    format: 'pdf',
    run: async (request, context) => {
      const bytes = await render(request, PNG_DEFAULT_WIDTH, PNG_FIRST_HEIGHT, (win) =>
        win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: request.pageSize === 'letter' ? 'Letter' : 'A4' }),
      );
      await context.writeFile(request.path, bytes);
    },
  };
  const png: Exporter = {
    kind: 'html',
    format: 'png',
    run: async (request, context) => {
      const width = request.width ?? PNG_DEFAULT_WIDTH;
      const bytes = await render(request, width, request.height ?? PNG_FIRST_HEIGHT, async (win) => {
        if (request.height === undefined) {
          const whole = Number(await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'));
          const height = Math.min(PNG_MAX_SIDE, Math.max(16, Number.isFinite(whole) ? Math.ceil(whole) : PNG_FIRST_HEIGHT));
          if (height !== PNG_FIRST_HEIGHT) {
            win.setContentSize(width, height);
            await settled(win);
          }
        }
        return (await win.webContents.capturePage()).toPNG();
      });
      await context.writeFile(request.path, bytes);
    },
  };
  const undo = [registry.register(pdf), registry.register(png)];
  return () => undo.forEach((off) => off());
}
