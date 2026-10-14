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
// P3-A M7: the `maws-artifact:` scheme on the window's default session and the capture partition (protocol.ts; the
// frame and permission policies on both are the deliverables' side's, `startDeliverables`, which covers both schemes),
// and the export service (export.ts) behind `artifacts.export` and `artifact_export`, its registry answered as
// `exporters` for P3-B's and P3-C's exporters.
import { MessageChannelMain, session, type BrowserWindow } from 'electron';
import type { CommandInput, CommandName, CommandResult, EventName, EventPayload, HostState, Settings } from '@shared/ipc/schema';
import { CAPTURE_PARTITION } from '../deliverables/capture';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { startArtifactDefaults } from './defaults';
import { ExporterRegistry, printHtmlToPdf, registerHtmlExporters, startExportService } from './export';
import { openDocument } from './open';
import { serveArtifacts, type ContentLookup } from './protocol';

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

export function startArtifacts({ hosts, register, emit, settings, onSettingsChanged, env, openWindow, root }: ArtifactsDeps): { stop(): void; exporters: ExporterRegistry } {
  const deps = { dispatch: hosts.dispatch, postDocPort: hosts.postDocPort, closeDocPorts: hosts.closeDocPorts, channel: () => new MessageChannelMain() };
  register('artifacts.open', ({ artifactId, doc }, { sender }) => openDocument(deps, artifactId, sender, doc));
  // P3-A M7: the scheme and the export service
  const call = <N extends CommandName>(name: N, input: CommandInput<N>) => hosts.dispatch('engine-host', name, input) as Promise<CommandResult<N>>;
  const content: ContentLookup = (input) => call('artifacts.content', input);
  for (const target of [session.defaultSession, session.fromPartition(CAPTURE_PARTITION)]) serveArtifacts(target, content);
  const exporters = new ExporterRegistry();
  const stopHtml = registerHtmlExporters(exporters, { content, env });
  const exports = startExportService({
    registry: exporters,
    root,
    call,
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    answer: (input) => call('maws.artifact.exported', input),
  });
  register('artifacts.export', (input) => exports.exportForLibrary(input));
  const stopDefaults = startArtifactDefaults({
    settings,
    onSettingsChanged,
    hostState: (): HostState => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'artifacts.setDefaults', input) as Promise<CommandResult<'artifacts.setDefaults'>>,
  });
  const stopResync = hosts.onStreaming('engine-host', () => void emit('artifacts.resync', {})); // P3-A M5
  const seam = globalThis as { __maws_documents?: { openWindow(): number }; __maws_exports?: { print(html: string): Promise<{ head: string; blocked: string[] }> } };
  if (env.MAWS_E2E === '1') {
    seam.__maws_documents = { openWindow: () => openWindow().id };
    // M7 fix wave 1: the PDF printer alone, as an exporter's context calls it (the e2e proves its request filter)
    seam.__maws_exports = {
      print: async (html) => {
        const blocked: string[] = [];
        const pdf = await printHtmlToPdf(html, { signal: new AbortController().signal, blocked: (url) => blocked.push(url) });
        return { head: Buffer.from(pdf.subarray(0, 5)).toString('latin1'), blocked };
      },
    };
  }
  return {
    exporters,
    stop: () => {
      stopDefaults();
      stopResync();
      exports.stop();
      stopHtml();
      delete seam.__maws_documents;
      delete seam.__maws_exports;
    },
  };
}
