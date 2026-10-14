// The export service (X31; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M7): one service in main, reached by the
// agent's `artifact_export` (the engine host asks over `maws.artifact.export` and is answered through
// `maws.artifact.exported`, as `artifact_screenshot`'s capture is) and by the library's Export (`artifacts.export`).
// An `ExporterRegistry` keyed by kind and format says what can be exported: this milestone registers an `html`
// artifact's PDF and PNG (`registerHtmlExporters`); P3-B and P3-C register their kinds' exporters from outside A
// (`ExporterRegistry.register`, B through its `registerDocumentExporters`). An exporter runs over an `ExportRequest`
// and the service's `ExportContext` (the artifact's title, its state, its assets, the PDF printer, a file writer, a
// cancellation signal) and writes the file the request names: under the directory the host named for the tool, under
// the store's (`<userData>/artifacts/<id>/exports/<revision>-<format>.<ext>`) for the library. Main never opens the
// store: what an export needs of it comes through the host's commands.
//
// Fix wave 1 (Decision Log 44b; the task review's findings): an export works from one snapshot, taken when it starts:
// a document's live state and the revision it is at, read together (`artifacts.state`), name the file and answer the
// revision, so the answer describes what was exported even when the doc moved since the request. The service owns the
// export's end: an exporter's writes are staged and committed (renamed into place) only when it finished in time; at
// its deadline the export is cancelled, its windows destroyed and its staged files removed, and a write it attempts
// after that is refused. The PDF printer's window reaches only its own page, `maws-artifact:`, `data:`, `blob:` and
// `about:`; every other request is cancelled and counted into the answer (`blockedRequests`), so an exporter learns its
// HTML named a remote resource.
//
// Fix wave 2: one budget covers a whole export, from the moment main takes the request to the last file put in place
// (EXPORT_BUDGET_MS, an `ExportBudget`): the wait for a slot, the snapshot's host reads, the exporter's run and the
// publication all end at its deadline, after which nothing is written and the answer is the timeout. It is shorter than
// the host's EXPORT_ANSWER_MS by a margin, so an export the bridge gave up on never later lands. At most
// EXPORT_CONCURRENCY exports run at once, and one still waiting for a slot after EXPORT_QUEUE_MS is answered busy.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';
import { isDocKind, type ArtifactKind } from '@shared/artifacts/entity';
import { artifactUrl } from '@shared/artifacts/scheme';
import { mimeOf } from '@shared/files/mime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { artifactExportName, type ArtifactExportFormat, type ArtifactExportPageSize } from '@shared/maws/tools';
import { CAPTURE_PARTITION, loadSettled, openCaptureWindow, settled, slots } from './capture';
import { restrictRequests, type SeamEnv } from './policies';
import { CommandFailure } from '../ipc/router';
import type { ContentLookup } from './protocol';

export const EXPORT_BUDGET_MS = 55_000; // from main's receipt: inside the host's 60 s (EXPORT_ANSWER_MS) with 5 s to spare
export const EXPORT_QUEUE_MS = 25_000; // the longest wait for a slot (inside the budget, leaving 30 s to run)
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
  // A document kind's V2 state at the request's revision: the version's when the request names one, else the live
  // doc's as the export's snapshot took it. A byte kind has none (it rejects).
  state(): Promise<Uint8Array>;
  // An asset's bytes by its ref (`assets/<name>`); null when the artifact has no such asset (any other failure rejects).
  readAsset(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  // Every asset of the artifact, by ref, so an exporter can carry those its content does not name (P3-D's request,
  // Decision Log 45e); empty when the artifact is gone (any other failure rejects).
  assets: { list(): Promise<ExportAsset[]> };
  // A standalone page printed in the capture partition's hidden window, JavaScript off, on its own `@page` size; what it
  // names outside its own page, `maws-artifact:`, `data:`, `blob:` and `about:` is not loaded.
  printToPdf(html: string): Promise<Uint8Array>;
  // Stages the file; the service puts it in place when the export finished in time, and refuses it after the deadline.
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  // Aborted at the export's deadline: an exporter that opens windows of its own destroys them on it.
  signal: AbortSignal;
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

export interface ExportAsset {
  ref: string;
  name: string;
  mime: string;
  size: number;
}

// What an export reads from the store and prints with, for `runExport` to put in an exporter's context.
export interface ExportSources {
  title: string;
  state(): Promise<Uint8Array>;
  readAsset(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  listAssets(): Promise<ExportAsset[]>;
  print: PdfPrinter;
}
// A page printed to PDF: `signal` ends it (its window destroyed), `blocked` hears each request its filter cancelled.
export type PdfPrinter = (html: string, job: { signal: AbortSignal; blocked(url: string): void }) => Promise<Uint8Array>;

// One export's time (fix wave 2): `ms` from its creation, which the service makes when main takes the request. `signal`
// aborts at the deadline, and when the job ends (`end`), so nothing started under it writes afterwards; `within` races
// a step (a host read, the exporter's run) against the deadline.
export class ExportBudget {
  private readonly controller = new AbortController();
  private timer!: ReturnType<typeof setTimeout>;
  private readonly expiry: Promise<never>;
  private timedOut = false;

  constructor(readonly ms: number) {
    this.expiry = new Promise<never>((_, reject) => {
      this.timer = setTimeout(() => {
        this.timedOut = true;
        this.controller.abort();
        reject(new Error(`the export did not finish within ${ms / 1000} s`));
      }, ms);
    });
    this.expiry.catch(() => {}); // observed by `within`
    (this.timer as { unref?: () => void }).unref?.();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  // Whether the deadline has passed.
  get expired(): boolean {
    return this.timedOut;
  }

  // `step`'s outcome, unless the deadline comes first (then the deadline's error; the step's own outcome is dropped).
  within<T>(step: Promise<T>): Promise<T> {
    if (this.timedOut) {
      step.catch(() => {});
      return this.expiry;
    }
    return Promise.race([step, this.expiry]);
  }

  // The job is over: its signal aborts (late writes refused, windows destroyed) and the timer stops.
  end(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}

const cancelled = () => new Error('the export was cancelled; nothing more is written');

// One export, start to finish, within `budget` (a number: a budget of that many ms from now): the exporter runs with a
// context whose writes are staged; when it finishes in time they are put in place, each only while the deadline has not
// passed, and the answer names the request's revision and path; otherwise (a failure, the deadline) nothing it wrote,
// or writes later, lands. Ends the budget. Never rejects.
export async function runExport(registry: ExporterRegistry, request: ExportRequest, sources: ExportSources, budget: ExportBudget | number = EXPORT_BUDGET_MS): Promise<MawsArtifactExportAnswer> {
  const time = typeof budget === 'number' ? new ExportBudget(budget) : budget;
  const exporter = registry.get(request.kind, request.format);
  if (!exporter) {
    time.end();
    return { ok: false, unavailable: true, error: unavailableMessage(request.kind, request.format) };
  }
  const { signal } = time;
  const staged = new Map<string, string>(); // path → its staged temporary file
  const temps = new Set<string>(); // every temporary file made, tracked before it is written
  let blocked = 0;
  const context: ExportContext = {
    title: sources.title,
    state: () => sources.state(),
    readAsset: (ref) => sources.readAsset(ref),
    assets: { list: () => sources.listAssets() },
    printToPdf: (html) => sources.print(html, { signal, blocked: () => void (blocked += 1) }),
    writeFile: async (path, data) => {
      if (signal.aborted) throw cancelled();
      await mkdir(dirname(path), { recursive: true });
      const temp = join(dirname(path), `.${randomUUID()}.tmp`);
      temps.add(temp);
      try {
        await writeFile(temp, data);
        if (signal.aborted) throw cancelled();
      } catch (error) {
        temps.delete(temp);
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      const earlier = staged.get(path);
      staged.set(path, temp);
      if (earlier) {
        temps.delete(earlier);
        await rm(earlier, { force: true });
      }
    },
    signal,
  };
  try {
    await time.within(exporter.run(request, context));
    if (!staged.has(request.path)) throw new Error('the exporter wrote no file');
    // publication: each file put in place only while the deadline has not passed
    for (const [path, temp] of staged) {
      if (time.expired) throw new Error(`the export did not finish within ${time.ms / 1000} s`);
      await rename(temp, path);
      temps.delete(temp);
    }
    return { ok: true, revision: request.revision, path: request.path, ...(blocked > 0 && { blockedRequests: blocked }) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  } finally {
    time.end(); // the exporter is done or abandoned: anything it still writes is refused
    for (const temp of temps) await rm(temp, { force: true }).catch(() => {});
  }
}

export interface ExportServiceDeps {
  registry: ExporterRegistry;
  root: string; // `<userData>/artifacts`, the store's directory (the host's own path rule)
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  onEvent(name: 'maws.artifact.export', listener: (request: MawsArtifactExport) => void): () => void;
  answer(input: CommandInput<'maws.artifact.exported'>): Promise<unknown>;
  print?: PdfPrinter; // printHtmlToPdf in the app; a test's stand-in
}

const refusal = (reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}) =>
  new CommandFailure(ipcError('invalid_input', message, { reason, data } satisfies ArtifactRefusal));

// Main's side of the export bridge and the library's command over one queue. Answers the library's export and `stop`.
export function startExportService({ registry, root, call, onEvent, answer, print = printHtmlToPdf }: ExportServiceDeps): {
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
  // The export's snapshot, taken as it starts: its title, and a document's state with the revision it is at (the
  // version's, else the live doc's read with its revision), which then names the file. A byte kind's content at the
  // request's revision is immutable, so its request stands as it was asked.
  const snapshot = async (request: ExportRequest, time: ExportBudget): Promise<{ request: ExportRequest; sources: ExportSources }> => {
    const { artifact } = await time.within(required('artifacts.get', { artifactId: request.artifactId }));
    if (!artifact) throw new Error(`no artifact ${request.artifactId}`);
    let state: Uint8Array | null = null;
    let taken = request;
    if (isDocKind(request.kind)) {
      if (request.versionId !== undefined) {
        state = (await time.within(required('artifacts.versionState', { artifactId: request.artifactId, versionId: request.versionId }))).bytes;
      } else {
        const live = await time.within(required('artifacts.state', { artifactId: request.artifactId }));
        state = live.bytes;
        taken = { ...request, revision: live.revision, path: join(dirname(request.path), artifactExportName(live.revision, request.format)) };
      }
    }
    return {
      request: taken,
      sources: {
        title: artifact.title,
        state: async () => {
          if (!state) throw new Error(`a ${request.kind} artifact has no document state`);
          return state;
        },
        readAsset: async (ref) => {
          if (!ref.startsWith('assets/')) return null; // the content file is not an asset
          const found = await time.within(call('artifacts.content', { artifactId: request.artifactId, path: ref }));
          if (!found.ok) {
            if ((found.error.issues as ArtifactRefusal | undefined)?.reason === 'notFound') return null;
            throw new Error(`the asset ${ref} could not be read: ${found.error.message}`);
          }
          return { bytes: new Uint8Array(await time.within(readFile(found.value.path))), mime: mimeOf(found.value.name) };
        },
        listAssets: async () => {
          const found = await time.within(call('artifacts.assets', { artifactId: request.artifactId }));
          if (!found.ok) {
            if ((found.error.issues as ArtifactRefusal | undefined)?.reason === 'notFound') return [];
            throw new Error(`the assets of ${request.artifactId} could not be listed: ${found.error.message}`);
          }
          return found.value.assets;
        },
        print,
      },
    };
  };
  // A request run in its turn within `time`, the budget its receipt started (a kind and format no exporter serves is
  // answered at once). Never rejects; ends the budget.
  const queued = async (request: ExportRequest, time: ExportBudget): Promise<MawsArtifactExportAnswer> => {
    if (!registry.get(request.kind, request.format)) {
      time.end();
      return { ok: false, unavailable: true, error: unavailableMessage(request.kind, request.format) };
    }
    const answered = await slot(async () => {
      let taken: Awaited<ReturnType<typeof snapshot>>;
      try {
        taken = await snapshot(request, time);
      } catch (error) {
        return { ok: false, error: messageOf(error) } satisfies MawsArtifactExportAnswer;
      }
      return runExport(registry, taken.request, taken.sources, time);
    }, busy);
    time.end();
    return answered;
  };

  const stop = onEvent('maws.artifact.export', (request) => {
    const { appSessionId, requestId, ...job } = request;
    void queued(job, new ExportBudget(EXPORT_BUDGET_MS))
      .then((result) => answer({ appSessionId, requestId, answer: result }))
      .catch((error: unknown) => console.error('[artifacts] could not answer an export', error));
  });

  return {
    async exportForLibrary({ artifactId, format, versionId, pageSize, width, height }) {
      const time = new ExportBudget(EXPORT_BUDGET_MS);
      let artifact: CommandOutput<'artifacts.get'>['artifact'];
      try {
        ({ artifact } = await time.within(required('artifacts.get', { artifactId })));
      } catch (error) {
        time.end();
        throw error;
      }
      if (!artifact) {
        time.end();
        throw refusal('notFound', `no artifact ${artifactId}`);
      }
      if (!artifact) throw refusal('notFound', `no artifact ${artifactId}`);
      let revision = artifact.revision;
      if (versionId !== undefined) {
        const versions = await time.within(required('artifacts.versions', { artifactId })).catch((error: unknown) => {
          time.end();
          throw error;
        });
        const version = versions.versions.find((candidate) => candidate.id === versionId);
        if (!version) {
          time.end();
          throw refusal('notFound', `no version ${versionId} of ${artifactId}`, { versionId });
        }
        revision = version.seq;
      }
      const path = join(root, artifactId, 'exports', artifactExportName(revision, format));
      const request: ExportRequest = { artifactId, kind: artifact.kind, format, revision, path, ...(versionId !== undefined && { versionId }), ...(pageSize !== undefined && { pageSize }), ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
      const result = await queued(request, time);
      if (!result.ok) throw result.unavailable ? refusal('exportUnavailable', result.error, { kind: artifact.kind, format }) : new CommandFailure(ipcError('internal', result.error));
      return { path: result.path, revision: result.revision, ...(result.blockedRequests !== undefined && { blockedRequests: result.blockedRequests }) };
    },
    stop,
  };
}

// Whether the PDF printer's window may load `url`: its own page (exactly), the artifact scheme, and what never leaves
// the process (`data:`, `blob:`, `about:`). Everything else (http, https, other files) is cancelled.
export function printRequestAllowed(url: string, page: string): boolean {
  return url === page || ['maws-artifact:', 'data:', 'blob:', 'about:'].some((scheme) => url.startsWith(scheme));
}

// A standalone page (an exporter's HTML: P3-B's document export) printed to PDF in a hidden window on the capture
// partition: JavaScript off (the page needs none), no new windows, no navigation, the page loaded from a file of its own
// in the OS's temporary directory (Chromium caps a `data:` URL at 2 MB) and removed after; its requests limited to
// `printRequestAllowed`'s, each other one cancelled and told to `blocked` (Decision Log 44b); `preferCSSPageSize` makes
// the page's `@page` rule the paper and the margins; headings become the outline. `signal` destroys the window.
// Fix wave 2: the page is prepared (its directory, its file) before the window exists, cancellation is checked after each
// of those steps, and the window is made and its destruction tied to `signal` in one synchronous step, so a cancellation
// during the preparation never leaves a window behind.
export const printHtmlToPdf: PdfPrinter = async (html, { signal, blocked }) => {
  if (signal.aborted) throw cancelled();
  const dir = await mkdtemp(join(tmpdir(), 'maws-print-'));
  const page = join(dir, 'page.html');
  const pageUrl = pathToFileURL(page).href;
  try {
    if (signal.aborted) throw cancelled();
    await writeFile(page, html, 'utf8');
    if (signal.aborted) throw cancelled();
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const win = new BrowserWindow({
    show: false,
    width: 816, // a Letter page at 96 px per inch, so a layout read before printing is the page's
    height: 1056,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: CAPTURE_PARTITION, backgroundThrottling: false, disableDialogs: true, spellcheck: false },
  });
  const unrestrict = restrictRequests(win.webContents.id, (url) => {
    if (printRequestAllowed(url, pageUrl)) return false;
    blocked(url);
    return true;
  });
  const destroy = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) destroy(); // tied to a signal already aborted: at once
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    if (signal.aborted) throw cancelled();
    await win.loadURL(pageUrl);
    if (signal.aborted) throw cancelled();
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    signal.removeEventListener('abort', destroy);
    unrestrict();
    destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

// An `html` artifact's PDF and PNG: its page at the revision, rendered in the capture window (offscreen, sandboxed, the
// `maws-capture` partition, `backgroundThrottling: false`, no navigation and no new windows: Decision Log 17) from
// `maws-artifact://<id>/<revision>/<name>`, its scripts running as in the viewer. The PDF prints on the page's own CSS
// page size, else the asked paper, else A4 portrait, with backgrounds; the PNG is `width` (1280) wide and `height` high,
// or the page's whole height (at most PNG_MAX_SIDE).
export function registerHtmlExporters(registry: ExporterRegistry, { content, env }: { content: ContentLookup; env: SeamEnv }): () => void {
  // The page in a capture window, destroyed when the export ends or is cancelled.
  const render = async <T>(request: ExportRequest, signal: AbortSignal, width: number, height: number, use: (win: BrowserWindow) => Promise<T>): Promise<T> => {
    const found = await content({ artifactId: request.artifactId, revision: request.revision });
    if (!found.ok) throw new Error(`the artifact has no page at revision ${request.revision}: ${found.error.message}`);
    if (signal.aborted) throw new Error('the export was cancelled');
    const win = openCaptureWindow(width, height, env);
    const destroy = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    signal.addEventListener('abort', destroy, { once: true });
    try {
      await loadSettled(win, artifactUrl(request.artifactId, request.revision, found.value.name));
      return await use(win);
    } finally {
      signal.removeEventListener('abort', destroy);
      destroy();
    }
  };
  const pdf: Exporter = {
    kind: 'html',
    format: 'pdf',
    run: async (request, context) => {
      const bytes = await render(request, context.signal, PNG_DEFAULT_WIDTH, PNG_FIRST_HEIGHT, (win) =>
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
      const bytes = await render(request, context.signal, width, request.height ?? PNG_FIRST_HEIGHT, async (win) => {
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
