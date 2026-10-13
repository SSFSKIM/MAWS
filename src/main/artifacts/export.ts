// The export service (X31; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M7): one service in main, reached by the
// agent's `artifact_export` (the engine host asks over `maws.artifact.export` and is answered through
// `maws.artifact.exported`, as `artifact_screenshot`'s capture is) and by the library's Export (`artifacts.export`).
// An `ExporterRegistry` keyed by kind and format says what can be exported: this milestone registers an `html`
// artifact's PDF and PNG (`registerHtmlExporters`); P3-B and P3-C register DOCX and PPTX (and their kinds' PDF) at
// their own registration. An exporter answers the file's bytes; the service writes them where the host named (the
// tool's path) or under the store's directory (`<userData>/artifacts/<id>/exports/<revision>-<format>.<ext>`, the
// library's), through a temporary file renamed into place so no reader sees half an export. Main never opens the
// store: what an export needs of it comes through the host's commands.
//
// At most EXPORT_CONCURRENCY exports run at once; each has EXPORT_GUARD_MS, and one still waiting for a slot after
// EXPORT_QUEUE_MS is answered busy, so every answer leaves main inside the host's EXPORT_ANSWER_MS.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { artifactUrl } from '@shared/artifacts/scheme';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { loadSettled, openCaptureWindow, settled, slots } from '../deliverables/capture';
import type { SeamEnv } from '../deliverables/policies';
import { CommandFailure } from '../ipc/router';
import type { ContentLookup } from './protocol';

export const EXPORT_GUARD_MS = 30_000;
export const EXPORT_QUEUE_MS = 25_000; // with the guard, 55 s: inside the host's 60
const EXPORT_CONCURRENCY = 2;
export const PNG_DEFAULT_WIDTH = 1280;
const PNG_FIRST_HEIGHT = 800; // the window's height before a whole-page PNG measures the page
const PNG_MAX_SIDE = 8_192; // EXPORT_SIZE_MAX: what an offscreen window renders

// What one export renders: an artifact's revision (the live one, or a version's) in a format. A picture's size in CSS px
// when the library asked for one.
export interface ExportJob {
  artifactId: string;
  kind: ArtifactKind;
  format: ArtifactExportFormat;
  revision: number;
  versionId?: number;
  width?: number;
  height?: number;
}
// The exported file's bytes; a throw is the export's failure, its message the answer's error.
export type Exporter = (job: ExportJob) => Promise<Uint8Array>;

export class ExporterRegistry {
  private readonly table = new Map<string, Exporter>();

  // The last registration for a kind and format wins; the answer undoes this one.
  register(kind: ArtifactKind, format: ArtifactExportFormat, exporter: Exporter): () => void {
    const key = `${kind}/${format}`;
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

// One export, start to finish, written to `path`. Never rejects: every failure is an answer with its reason.
export async function runExport(registry: ExporterRegistry, job: ExportJob, path: string, guardMs = EXPORT_GUARD_MS): Promise<MawsArtifactExportAnswer> {
  const exporter = registry.get(job.kind, job.format);
  if (!exporter) return { ok: false, unavailable: true, error: unavailableMessage(job.kind, job.format) };
  let guard: ReturnType<typeof setTimeout> | undefined;
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const timedOut = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error(`the export did not finish within ${guardMs / 1000} s`)), guardMs);
    });
    const bytes = await Promise.race([exporter(job), timedOut]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, bytes);
    await rename(temp, path);
    return { ok: true };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    return { ok: false, error: messageOf(error) };
  } finally {
    clearTimeout(guard);
  }
}

export interface ExportServiceDeps {
  registry: ExporterRegistry;
  root: string; // `<userData>/artifacts`, the store's directory (the host's own path rule)
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  onEvent(name: 'maws.artifact.export', listener: (request: MawsArtifactExport) => void): () => void;
  answer(input: CommandInput<'maws.artifact.exported'>): Promise<unknown>;
}

const refusal = (reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}) =>
  new CommandFailure(ipcError('invalid_input', message, { reason, data } satisfies ArtifactRefusal));

// Main's side of the export bridge and the library's command over one queue. Answers the library's export and `stop`.
export function startExportService({ registry, root, call, onEvent, answer }: ExportServiceDeps): {
  exportForLibrary(input: CommandInput<'artifacts.export'>): Promise<CommandOutput<'artifacts.export'>>;
  stop(): void;
} {
  const slot = slots(EXPORT_CONCURRENCY, EXPORT_QUEUE_MS);
  const busy = (): MawsArtifactExportAnswer => ({ ok: false, error: `MAWS was busy with other exports for ${EXPORT_QUEUE_MS / 1000} s; try again` });
  const queued = (job: ExportJob, path: string) => slot(() => runExport(registry, job, path), busy);

  const stop = onEvent('maws.artifact.export', (request) => {
    const { appSessionId, requestId, path, artifactId, kind, format, revision, versionId } = request;
    void queued({ artifactId, kind, format, revision, ...(versionId !== undefined && { versionId }) }, path)
      .then((result) => answer({ appSessionId, requestId, answer: result }))
      .catch((error: unknown) => console.error('[artifacts] could not answer an export', error));
  });

  const required = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await call(name, input);
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  };

  return {
    async exportForLibrary({ artifactId, format, versionId, width, height }) {
      const { artifact } = await required('artifacts.get', { artifactId });
      if (!artifact) throw refusal('notFound', `no artifact ${artifactId}`);
      let revision = artifact.revision;
      if (versionId !== undefined) {
        const version = (await required('artifacts.versions', { artifactId })).versions.find((candidate) => candidate.id === versionId);
        if (!version) throw refusal('notFound', `no version ${versionId} of ${artifactId}`, { versionId });
        revision = version.seq;
      }
      const path = join(root, artifactId, 'exports', artifactExportName(revision, format));
      const job: ExportJob = { artifactId, kind: artifact.kind, format, revision, ...(versionId !== undefined && { versionId }), ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
      const result = await queued(job, path);
      if (!result.ok) throw result.unavailable ? refusal('exportUnavailable', result.error, { kind: artifact.kind, format }) : new CommandFailure(ipcError('internal', result.error));
      return { path, revision };
    },
    stop,
  };
}

// An `html` artifact's PDF and PNG: its page at the revision, rendered in the capture window (offscreen, sandboxed, the
// `maws-capture` partition, `backgroundThrottling: false`, no navigation and no new windows: Decision Log 17) from
// `maws-artifact://<id>/<revision>/<name>`. The PDF prints on the page's own CSS page size, else A4 portrait, with
// backgrounds; the PNG is `width` (1280) wide and `height` high, or the page's whole height (at most PNG_MAX_SIDE).
export function registerHtmlExporters(registry: ExporterRegistry, { content, env }: { content: ContentLookup; env: SeamEnv }): () => void {
  const render = async <T>(job: ExportJob, width: number, height: number, use: (win: BrowserWindow) => Promise<T>): Promise<T> => {
    const found = await content({ artifactId: job.artifactId, revision: job.revision });
    if (!found.ok) throw new Error(`the artifact has no page at revision ${job.revision}: ${found.error.message}`);
    const win = openCaptureWindow(width, height, env);
    try {
      await loadSettled(win, artifactUrl(job.artifactId, job.revision, found.value.name));
      return await use(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };
  const pdf: Exporter = (job) =>
    render(job, PNG_DEFAULT_WIDTH, PNG_FIRST_HEIGHT, (win) => win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' }));
  const png: Exporter = (job) => {
    const width = job.width ?? PNG_DEFAULT_WIDTH;
    return render(job, width, job.height ?? PNG_FIRST_HEIGHT, async (win) => {
      if (job.height === undefined) {
        const whole = Number(await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'));
        const height = Math.min(PNG_MAX_SIDE, Math.max(16, Number.isFinite(whole) ? Math.ceil(whole) : PNG_FIRST_HEIGHT));
        if (height !== PNG_FIRST_HEIGHT) {
          win.setContentSize(width, height);
          await settled(win);
        }
      }
      return (await win.webContents.capturePage()).toPNG();
    });
  };
  const undo = [registry.register('html', 'pdf', pdf), registry.register('html', 'png', png)];
  return () => undo.forEach((off) => off());
}
