// P3-E1 M5 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5, acceptance 5; the parent's Decision Log
// 26): a design's export through every hop the agent's and the library's routes take, over A's real store and the
// engine host's real `artifacts.*` handlers: the agent's `artifact_export` (its input schema), the host's bridge request
// checked against the `maws.artifact.export` event's schema, main's export service and the design's exporter (C's
// capture window stood in by a recording one), main's answer checked against `maws.artifact.exported`'s, and the tool's
// answer; the library's `artifacts.export` input schema into `exportForLibrary`. The design's `board`, `boards` and
// `scale` reach the exporter on both routes; a picture over the cap is refused `exportTooLarge {board, w, h, maxScale}`
// on both, and the stated scale then exports.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { commands as libraryCommands } from '@shared/ipc/schema/library';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
const { ExporterRegistry, startExportService } = await import('../../main/artifacts/export');
const { registerDesignExporters } = await import('../../main/design/export');
const { CommandFailure } = await import('../../main/ipc/router');
const { createLibraryFiles } = await import('../../main/library/files');

const SELF = 'app-self' as AppSessionId;

let userData: string;
let documents: Documents;
let designs: Designs;
let surface: { close(): void };
let service: ReturnType<typeof startExportService>;
let hostCall: (name: CommandName, input: unknown) => Promise<CommandResult<CommandName>>;
const asked: [string, unknown][] = [];
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
    asked.push([name, input]);
    if (name === 'designSystems.governing') return { ok: true, value: { system: { builtin: 'maws' } } } as CommandResult<CommandName>;
    try {
      return { ok: true, value: await handlers.get(name)!(input) } as CommandResult<CommandName>;
    } catch (error) {
      if (error instanceof HostCommandError) return { ok: false, error: error.ipcError } as CommandResult<CommandName>;
      throw error;
    }
  };
  hostCall = call;
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
      return { ok: true, value: { outcome: 'delivered' } };
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
  asked.length = 0;
});

/**
 * L's `library.saveAs` over the same host and the store's export directory, its Save dialog answered when `answer`
 * settles (held open while other exports run) at a path under the test's directory.
 */
function libraryFiles(dialog: () => Promise<string>) {
  return createLibraryFiles({
    call: hostCall as never,
    exporters: { get: () => undefined },
    root: join(userData, 'artifacts'),
    downloads: () => userData,
    port: {
      save: async () => ({ path: await dialog() }),
      confirm: async () => ({ confirmed: false }),
      openExternal: async () => ({ opened: true }),
      reveal: async () => ({ revealed: true }),
    },
    readFile: async () => {
      throw new Error('not read here');
    },
    env: {},
  });
}
const MANAGED = /\/exports\/\d+-png-[0-9a-f-]{36}\.png$/;

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
    expect(phone.path).toMatch(MANAGED); // Decision Log 33: its own file, in the directory the host named
    expect(captured).toEqual([{ slideId: 'phone' }]);

    const refused = await tool.call({ artifact: id, format: 'png', board: 'poster' }, ctx());
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^artifact_export: board poster is 1080×9000 px.*scale 0\.9102/);
    expect(artifactRefusalOf(textOf(refused))).toEqual({ reason: 'exportTooLarge', board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 });
    expect(captured).toHaveLength(1); // no window for the refusal

    const fitted = exported(await tool.call({ artifact: id, format: 'png', board: 'poster', scale: 0.9102 }, ctx()));
    expect(readFileSync(fitted.path, 'utf8')).toBe('png:poster');
    expect(fitted.path).not.toBe(phone.path); // the same revision and format, two files
    expect(readFileSync(phone.path, 'utf8')).toBe('png:phone');
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
    // Decision Log 33: L's Save As reads the row without preparing the live design, and copies the version's bytes
    const row = async () => ((await hostCall('artifacts.get', { artifactId: id, prepare: false })) as { ok: true; value: { artifact: { revision: number } } }).value.artifact.revision;
    const revision = await row();
    asked.length = 0;
    const to = join(userData, 'saved-version.png');
    const saved = await libraryFiles(async () => to).saveAs({ artifactId: id, source: { export: { revision: exported.revision, format: 'png', exportId: exported.exportId! } } }, null);
    expect(saved).toEqual({ saved: true, path: to });
    expect(readFileSync(to, 'utf8')).toBe('png:phone');
    expect(asked).toEqual([['artifacts.get', { artifactId: id, prepare: false }]]);
    await expect(service.exportForLibrary({ artifactId: id, format: 'png' })).rejects.toThrow(/canvas\.json is not JSON/);
    expect(logRows(userData, id)).toEqual(rows);
    expect(await row()).toBe(revision); // the malformed live state as it was: no migration, no write
  });
});

describe('managed export files (Decision Log 33)', () => {
  it('two same-revision exports keep their own files: the first Save As, its dialog held while the second completes, copies the first', async () => {
    const id = await created();
    const first = await service.exportForLibrary({ artifactId: id, format: 'png', board: 'phone' });
    expect(first.exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.path).toMatch(MANAGED);
    expect(first.path).toContain(first.exportId!);
    let release!: (path: string) => void;
    const held = new Promise<string>((resolve) => (release = resolve));
    const files = libraryFiles(() => held);
    const saving = files.saveAs({ artifactId: id, source: { export: { revision: first.revision, format: 'png', exportId: first.exportId! } } }, null);
    await vi.waitFor(() => expect(asked.some(([name]) => name === 'artifacts.get')).toBe(true));
    const second = await service.exportForLibrary({ artifactId: id, format: 'png', board: 'poster', scale: 0.9102 });
    expect(second.revision).toBe(first.revision);
    expect(second.exportId).not.toBe(first.exportId);
    const firstTo = join(userData, 'first.png');
    release(firstTo);
    expect(await saving).toEqual({ saved: true, path: firstTo });
    expect(readFileSync(firstTo, 'utf8')).toBe('png:phone');
    const secondTo = join(userData, 'second.png');
    await libraryFiles(async () => secondTo).saveAs({ artifactId: id, source: { export: { revision: second.revision, format: 'png', exportId: second.exportId! } } }, null);
    expect(readFileSync(secondTo, 'utf8')).toBe('png:poster');
    expect([existsSync(first.path), existsSync(second.path)]).toEqual([false, false]); // P4 (W1, L302): each save removed its own file
  });

  it('P3-H’s ownFile with a design’s selectors (P3 Decision Log 91): one id, minted once, the board and scale reaching the exporter, Save As copying it', async () => {
    const id = await created();
    const input = artifactCommands['artifacts.export'].input.parse({ artifactId: id, format: 'png', board: 'poster', scale: 0.9102, ownFile: true });
    expect(input).toEqual({ artifactId: id, format: 'png', board: 'poster', scale: 0.9102, ownFile: true });
    const sent = await service.exportForLibrary(input);
    expect(sent.path).toMatch(MANAGED);
    expect(sent.path.split(sent.exportId!)).toHaveLength(2); // the one id, once in the name
    expect(readFileSync(sent.path, 'utf8')).toBe('png:poster');
    expect(captured.at(-1)).toEqual({ slideId: 'poster', size: { width: 983, height: 8192 } });
    const other = await service.exportForLibrary({ artifactId: id, format: 'png', board: 'phone', ownFile: true });
    expect(other.exportId).not.toBe(sent.exportId);
    expect([readFileSync(sent.path, 'utf8'), readFileSync(other.path, 'utf8')]).toEqual(['png:poster', 'png:phone']);
    // its refusal is still the design's, named
    const refused = await service.exportForLibrary({ artifactId: id, format: 'png', board: 'poster', ownFile: true }).catch((error: unknown) => error);
    expect((refused as InstanceType<typeof CommandFailure>).error.issues).toMatchObject({ reason: 'exportTooLarge', data: { board: 'poster', maxScale: 0.9102 } });
    const to = join(userData, 'sent.png');
    await libraryFiles(async () => to).saveAs({ artifactId: id, source: { export: { revision: sent.revision, format: 'png', exportId: sent.exportId! } } }, null);
    expect(readFileSync(to, 'utf8')).toBe('png:poster');
  });

  it('Save As takes an export id only as an id: a path is refused by the schema, an id with no file by name', async () => {
    const id = await created();
    const exported = await service.exportForLibrary({ artifactId: id, format: 'png', board: 'phone' });
    const input = libraryCommands['library.saveAs'].input;
    for (const exportId of ['../../store.sqlite', `${exported.exportId}/../x`, 'not-an-id']) expect(input.safeParse({ artifactId: id, source: { export: { revision: exported.revision, format: 'png', exportId } } }).success).toBe(false);
    expect(input.safeParse({ artifactId: id, source: { export: { revision: exported.revision, format: 'png', exportId: exported.exportId } } }).success).toBe(true);
    const unknown = '00000000-0000-4000-8000-00000000abcd';
    await expect(libraryFiles(async () => join(userData, 'x.png')).saveAs({ artifactId: id, source: { export: { revision: exported.revision, format: 'png', exportId: unknown } } }, null)).rejects.toThrow(/no export/);
    // without its id the shared name is not the design's file
    await expect(libraryFiles(async () => join(userData, 'y.png')).saveAs({ artifactId: id, source: { export: { revision: exported.revision, format: 'png' } } }, null)).rejects.toThrow(/no export/);
  });
});
