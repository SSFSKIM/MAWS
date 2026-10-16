// P3-E1 M5 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5, acceptance 5; the parent's Decision Log
// 26): a design's export through every hop the agent's and the library's routes take, over A's real store and the
// engine host's real `artifacts.*` handlers: the agent's `artifact_export` (its input schema), the host's bridge request
// checked against the `maws.artifact.export` event's schema, main's export service and the design's exporter (C's
// capture window stood in by a recording one), main's answer checked against `maws.artifact.exported`'s, and the tool's
// answer; the library's `artifacts.export` input schema into `exportForLibrary`. The design's `board`, `boards` and
// `scale` reach the exporter on both routes; a picture over the cap is refused `exportTooLarge {board, w, h, maxScale}`
// on both, and the stated scale then exports.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardPath, CANVAS_PATH } from '@artifacts/design/canvas';
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { commands as artifactCommands } from '@shared/ipc/schema/artifacts';
import { MawsArtifactExportSchema, commands as mawsCommands } from '@shared/ipc/schema/maws';
import { artifactRefusalOf, type ArtifactExportResult } from '@shared/maws/tools';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';
import { ArtifactSession, type ArtifactToolDeps } from '../tool-server/artifact-context';
import { artifactExportTool, type ExportBridge } from '../tool-server/artifact-export';
import { artifactCreateTool } from '../tool-server/artifact-tools';
import type { McpToolContext, McpToolResult } from '../tool-server/server';
import { publishFiles, readFiles } from '@artifacts/files';
import { registerDesigns, type Designs } from '.';
import { logRows, makeLegacyDesign } from './legacy.fixture';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
const { ExporterRegistry, startExportService } = await import('../../main/artifacts/export');
const { registerDesignExporters } = await import('../../main/design/export');
const { CommandFailure } = await import('../../main/ipc/router');

const SELF = 'app-self' as AppSessionId;

let userData: string;
let documents: Documents;
let designs: Designs;
let surface: { close(): void };
let service: ReturnType<typeof startExportService>;
let calls = 0;
const captured: { slideId: string; size?: { width?: number; height?: number } }[] = [];
const loaded: string[] = [];
const printed: string[] = [];
const bridged: unknown[] = [];

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-export-route-'));
});
/** The host's store and handlers, main's export service with the design's exporters, and the bridge between them. */
function start(): void {
  documents = openDocuments(userData, () => {})!;
  designs = registerDesigns({ documents, chain: null, refresh: () => {} });
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  surface = registerArtifacts(on, () => true, { onDocPort: () => {} }, { documents, env: {} });
  // main's `call` over the host's handlers as the router answers it; the governing system is the bundled floor here
  const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    if (name === 'designSystems.governing') return { ok: true, value: { system: { builtin: 'maws' } } } as CommandResult<CommandName>;
    try {
      return { ok: true, value: await handlers.get(name)!(input) } as CommandResult<CommandName>;
    } catch (error) {
      if (error instanceof HostCommandError) return { ok: false, error: error.ipcError } as CommandResult<CommandName>;
      throw error;
    }
  };
  const registry = new ExporterRegistry();
  registerDesignExporters(registry, {
    call: call as never,
    env: {},
    window: async (_env, _signal, use) =>
      use({
        load: async (html) => void loaded.push(html),
        measure: async () => ({ slides: [] }),
        capture: async (job, size) => {
          captured.push({ slideId: job.slideId, ...(size && { size }) });
          return Buffer.from(`png:${job.slideId}`);
        },
      }),
  });
  // the bridge: the host's request is main's `maws.artifact.export` event; main's answer comes back as the host command
  let listener: ((request: never) => void) | null = null;
  const pending = new Map<string, (answer: unknown) => void>();
  service = startExportService({
    registry,
    root: join(userData, 'artifacts'),
    call: call as never,
    onEvent: (_name, l) => ((listener = l as never), () => {}),
    answer: async (input) => {
      expect(mawsCommands['maws.artifact.exported'].input.parse(input)).toEqual(input); // the answer's schema keeps it whole
      pending.get(input.requestId)!(input.answer);
    },
    print: async (html) => (printed.push(html), new TextEncoder().encode('%PDF-')),
  });
  exporter = {
    request: (request: unknown) =>
      new Promise((resolve) => {
        bridged.push(request);
        const event = MawsArtifactExportSchema.parse(request); // the event's schema keeps the design's fields
        pending.set(event.requestId, (answer) => resolve({ kind: 'answered', answer }));
        listener!(event as never);
      }),
  } as unknown as ExportBridge;
}
afterEach(() => {
  service?.stop();
  surface?.close();
  designs?.close();
  documents?.close();
  rmSync(userData, { recursive: true, force: true });
  captured.length = 0;
  loaded.length = 0;
  printed.length = 0;
  bridged.length = 0;
});

let exporter: ExportBridge;
const deps = (): ArtifactToolDeps & { exporter: ExportBridge } => ({ artifacts: () => documents.store, session: new ArtifactSession(), log: () => {}, exporter });
const ctx = (): McpToolContext => ({ appSessionId: SELF, cwd: userData, toolUseId: `toolu_e${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const textOf = (result: McpToolResult): string => (result.content[0] as { text: string }).text;
const exported = (result: McpToolResult): ArtifactExportResult => {
  if (result.isError) throw new Error(`a refusal: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as ArtifactExportResult;
};

const FILES = {
  [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Launch', boards: { phone: { x: 0, y: 0, w: 390, h: 844 }, poster: { x: 500, y: 0, w: 1080, h: 9000 } }, order: ['phone', 'poster'] }),
  [boardPath('phone')]: '<section id="phone" style="background:#ffffff"><h1 id="t">Sign in</h1></section>',
  [boardPath('poster')]: '<section id="poster" style="background:#000000"><h1 id="t" style="color:#ffffff">Poster</h1></section>',
};
async function created(): Promise<string> {
  start();
  const result = await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FILES }, ctx());
  return (JSON.parse(textOf(result)) as { artifactId: string }).artifactId;
}

describe('the agent’s route: artifact_export to main’s design exporter and back', () => {
  it('carries board and scale to the exporter; an over-cap picture is refused with the fitting scale, which then exports', async () => {
    const id = await created();
    const tool = artifactExportTool(deps());

    const phone = exported(await tool.call({ artifact: id, format: 'png', board: 'phone' }, ctx()));
    expect(readFileSync(phone.path, 'utf8')).toBe('png:phone');
    expect(captured).toEqual([{ slideId: 'phone' }]);

    const refused = await tool.call({ artifact: id, format: 'png', board: 'poster' }, ctx());
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^artifact_export: board poster is 1080×9000 px.*scale 0\.9102/);
    expect(artifactRefusalOf(textOf(refused))).toEqual({ reason: 'exportTooLarge', board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 });
    expect(captured).toHaveLength(1); // no window for the refusal

    const fitted = exported(await tool.call({ artifact: id, format: 'png', board: 'poster', scale: 0.9102 }, ctx()));
    expect(readFileSync(fitted.path, 'utf8')).toBe('png:poster');
    expect(captured.at(-1)).toEqual({ slideId: 'poster', size: { width: 983, height: 8192 } });
    expect(bridged.at(-1)).toMatchObject({ artifactId: id, kind: 'design', format: 'png', board: 'poster', scale: 0.9102 });
  });

  it('carries boards to the PDF; an unknown board is refused by name', async () => {
    const id = await created();
    const tool = artifactExportTool(deps());
    exported(await tool.call({ artifact: id, format: 'pdf', boards: ['poster', 'phone'], scale: 0.5 }, ctx()));
    expect(bridged.at(-1)).toMatchObject({ format: 'pdf', boards: ['poster', 'phone'], scale: 0.5 });
    expect(printed[0]!.indexOf('data-frame="poster"')).toBeLessThan(printed[0]!.indexOf('data-frame="phone"'));
    expect(printed[0]).toContain('@page design-0 { size: 540px 4500px; margin: 0; }');
    const unknown = await tool.call({ artifact: id, format: 'pdf', boards: ['tablet'] }, ctx());
    expect(artifactRefusalOf(textOf(unknown))).toEqual({ reason: 'notFound', board: 'tablet' });
  });
});

describe('the library’s route: artifacts.export to main’s design exporter', () => {
  it('keeps board, boards and scale through its input schema; the refusal is rethrown as named, and the stated scale exports', async () => {
    const id = await created();
    const input = artifactCommands['artifacts.export'].input.parse({ artifactId: id, format: 'png', board: 'poster' });
    expect(input).toEqual({ artifactId: id, format: 'png', board: 'poster' });
    const failure = await service.exportForLibrary(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CommandFailure);
    expect((failure as InstanceType<typeof CommandFailure>).error).toMatchObject({ code: 'invalid_input', issues: { reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 } } });

    const scaled = await service.exportForLibrary(artifactCommands['artifacts.export'].input.parse({ artifactId: id, format: 'png', board: 'poster', scale: 0.9102 }));
    expect(readFileSync(scaled.path, 'utf8')).toBe('png:poster');
    const pdf = artifactCommands['artifacts.export'].input.parse({ artifactId: id, format: 'pdf', boards: ['phone'] });
    expect(pdf.boards).toEqual(['phone']);
    await service.exportForLibrary(pdf);
    expect(printed.at(-1)).not.toContain('data-frame="poster"');
  });
});

describe('a retained version of a design whose live legacy state cannot migrate (Decision Log 22)', () => {
  it('exports through the real design exporter from the version’s projection, writing no migration row', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    // an earlier build broke the live manifest after the version was kept
    await documents.service.writeAs(id, { kind: 'human' }, (doc) => void publishFiles(doc, readFiles(doc), { [CANVAS_PATH]: '{"v":' }, false));
    const rows = logRows(userData, id);
    const exported = await service.exportForLibrary({ artifactId: id, format: 'png', versionId: versionId!, board: 'phone' });
    expect(readFileSync(exported.path, 'utf8')).toBe('png:phone');
    expect(loaded[0]).toContain('data-frame="phone" data-size="390x844"');
    expect(logRows(userData, id)).toEqual(rows);
    const tooLarge = await service.exportForLibrary({ artifactId: id, format: 'png', versionId: versionId!, board: 'poster' }).catch((error: unknown) => error);
    expect((tooLarge as InstanceType<typeof CommandFailure>).error.issues).toEqual({ reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 10_000, maxScale: 0.8192 } });
    await expect(service.exportForLibrary({ artifactId: id, format: 'png' })).rejects.toThrow(/canvas\.json is not JSON/);
    expect(logRows(userData, id)).toEqual(rows);
  });
});
