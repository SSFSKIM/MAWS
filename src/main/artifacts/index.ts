// The artifact store's side of main (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4): `artifacts.open`, which
// hands a window a document's port (open.ts), and the relay of the design-system defaults main owns in settings
// (defaults.ts). Main never opens `store.sqlite`; every other `artifacts.*` and `spaces.*` command is the engine host's
// and reaches it through the router. Under MAWS_E2E=1 the e2e's seam `globalThis.__maws_documents` opens a further app
// window (the store's e2e syncs one document across two windows).
//
// P3-A M5: in detached mode main relays the document ports (hosts/doc-relay.ts), ending a window's channels when it
// closes or navigates; and each time the engine host's connection starts streaming (either mode), main announces
// `artifacts.resync`, since the store's events of a span with no ready client are not replayed.
//
// P3-A M7: the `maws-artifact:` scheme on the window's default session and the capture partition (protocol.ts), and
// the export service (export.ts) behind `artifacts.export` and `artifact_export`, its registry answered as `exporters`
// for P3-B's and P3-C's exporters.
//
// P3-L (M6b): what E2's deliverables side did for both store schemes is the artifact scheme's alone now: the frame and
// permission policies on both sessions (`installStorePolicies`, before the first window loads) and `artifact_screenshot`'s
// capture service (capture.ts), which renders an `html` artifact's revision through the same scheme. Under MAWS_E2E=1
// `globalThis.__maws_captures` runs a capture in main directly (no IPC command exists for it).
import { MessageChannelMain, session, type BrowserWindow } from 'electron';
import type { CommandInput, CommandName, CommandResult, EventName, EventPayload, HostState, Settings } from '@shared/ipc/schema';
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import { CAPTURE_PARTITION, captureArtifact, startCaptureService } from './capture';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { startArtifactDefaults } from './defaults';
import { ExporterRegistry, printHtmlToPdf, registerHtmlExporters, startExportService } from './export';
import { renderDocumentViewport } from './inspection';
import { openDocument } from './open';
import { appOriginOf, guardPermissions, installFramePolicies } from './policies';
import { serveArtifacts, type ContentLookup } from './protocol';
import { presentationEmbeds } from '../presentations/present-embeds'; // P3-C M6

export { registerStoreSchemes } from './protocol';
export type { ExportContext, Exporter, ExporterRegistry, ExportRequest } from './export';

export interface ArtifactsDeps {
  hosts: Pick<HostSupervisor, 'dispatch' | 'postDocPort' | 'closeDocPorts' | 'snapshot' | 'onState' | 'onStreaming' | 'onEvent'>;
  register: typeof registerMainHandler;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // P3-A M5: to the renderer
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void;
  env: Record<string, string | undefined>;
  openWindow(): BrowserWindow; // the e2e seam's second window
  root: string; // P3-A M7: `<userData>/artifacts`, where the library's exports are written
}

// The store frames' policies on the window's default session and on the capture partition (P3-L M6b; E2's, in
// `startDeliverables` until the cutover): installed once, before the app's first window loads. `appUrl`: the app page's
// URL (window.ts), whose origin the frame policies trust to reach every artifact (P3-A M7 fix wave 2).
export function installStorePolicies(env: NodeJS.ProcessEnv, appUrl: string): void {
  for (const target of [session.defaultSession, session.fromPartition(CAPTURE_PARTITION)]) installFramePolicies(target, env, appOriginOf(appUrl));
  guardPermissions(session.defaultSession, 'store-frames'); // a store frame's requests and checks denied
  guardPermissions(session.fromPartition(CAPTURE_PARTITION), 'all'); // the partition holds captures alone
}

// P4-B5: `exports`, the export service itself (X31), for main's delivery (Send to), which exports as the library does
export function startArtifacts({ hosts, register, emit, settings, onSettingsChanged, env, openWindow, root }: ArtifactsDeps): { stop(): void; exporters: ExporterRegistry; exports: Pick<ReturnType<typeof startExportService>, 'exportForLibrary'> } {
  const deps = { dispatch: hosts.dispatch, postDocPort: hosts.postDocPort, closeDocPorts: hosts.closeDocPorts, channel: () => new MessageChannelMain() };
  register('artifacts.open', ({ artifactId, doc }, { client }) => openDocument(deps, artifactId, client, doc));
  // P3-A M7: the scheme and the export service
  const call = <N extends CommandName>(name: N, input: CommandInput<N>) => hosts.dispatch('engine-host', name, input) as Promise<CommandResult<N>>;
  const content: ContentLookup = (input) => call('artifacts.content', input);
  const embeds = presentationEmbeds(call); // P3-C M6: the presenter's live embeds, under their own policy (Decision Log 18)
  for (const target of [session.defaultSession, session.fromPartition(CAPTURE_PARTITION)]) serveArtifacts(target, content, embeds);
  const exporters = new ExporterRegistry();
  const stopHtml = registerHtmlExporters(exporters, { content, env });
  // E3: the engine host's connection losses, counted for a dashboard export's one recapture across a restart
  let hostLosses = 0;
  const stopLosses = hosts.onState('engine-host', (state) => {
    if (state.state !== 'ready') hostLosses += 1;
  });
  const exports = startExportService({
    registry: exporters,
    root,
    call,
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    answer: (input) => call('maws.artifact.exported', input),
    hostGeneration: () => hostLosses,
  });
  register('artifacts.export', (input) => exports.exportForLibrary(input));
  // P3-L M6b: `artifact_screenshot`'s captures, answered to the requesting session
  const stopCaptures = startCaptureService({
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'maws.artifact.captured', input),
    content,
    env,
  });
  const stopDefaults = startArtifactDefaults({
    settings,
    onSettingsChanged,
    hostState: (): HostState => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'artifacts.setDefaults', input) as Promise<CommandResult<'artifacts.setDefaults'>>,
  });
  const stopResync = hosts.onStreaming('engine-host', () => void emit('artifacts.resync', {})); // P3-A M5
  const seam = globalThis as {
    __maws_documents?: { openWindow(): number };
    __maws_exports?: { print(html: string): Promise<{ head: string; blocked: string[] }>; inspect(html: string): Promise<string> };
    __maws_captures?: { capture(request: MawsArtifactCapture): ReturnType<typeof captureArtifact> }; // P3-L M6b
  };
  if (env.MAWS_E2E === '1') {
    seam.__maws_documents = { openWindow: () => openWindow().id };
    seam.__maws_captures = { capture: (request) => captureArtifact(request, { content, env }) };
    // M7 fix wave 1: the PDF printer alone, as an exporter's context calls it (the e2e proves its request filter)
    seam.__maws_exports = {
      // The real document viewport path, so the e2e can inject hostile HTML and prove CSP beside host layout reads.
      inspect: async (html) => (await renderDocumentViewport(html, { artifactId: 'e2e-inspection', kind: 'document', format: 'png', revision: 0, path: '', width: 640, height: 480 }, new AbortController().signal, env)).toString('base64'),
      print: async (html) => {
        const blocked: string[] = [];
        const pdf = await printHtmlToPdf(html, { signal: new AbortController().signal, blocked: (url) => blocked.push(url) });
        return { head: Buffer.from(pdf.subarray(0, 5)).toString('latin1'), blocked };
      },
    };
  }
  return {
    exporters,
    exports, // P4-B5
    stop: () => {
      stopDefaults();
      stopResync();
      stopLosses(); // E3
      stopCaptures();
      exports.stop();
      stopHtml();
      delete seam.__maws_documents;
      delete seam.__maws_exports;
      delete seam.__maws_captures;
    },
  };
}
