// The artifact store's side of main (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4): `artifacts.open`, which
// hands a window a document's port (open.ts). The relay of the design-system defaults (defaults.ts) is the spine's
// since P5 O3-C (D23), composed beside this by main's root. Main never opens `store.sqlite`; every other `artifacts.*`
// and `spaces.*` command is the engine host's and reaches it through the router. Under MAWS_E2E=1 the e2e's seam `globalThis.__maws_documents` opens a further app
// window (the store's e2e syncs one document across two windows).
//
// P3-A M5: in detached mode main relays the document ports (@shared/host/doc-relay.ts), ending a window's channels when it
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
//
// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §A, §D): the scheme's serving is the plain-Node
// library's (src/services/artifacts/scheme/) and its Electron half src/render/scheme.ts. On the daemon shape the two
// sessions' handler goes through the scheme proxy to `mawsd`'s artifact endpoint (`artifactsSocket`) for each request
// made while the daemon's welcome lists `machine.artifacts`, and serves the store's files in main otherwise (an older
// daemon, or none welcomed yet); the presenter's embeds answer first either way.
//
// P5 O5 M3 (Interfaces §A, M3's "One library, two roots"): the capture and export code is the render library
// (src/render/), which this, the embedded root, composes in-process (`composeRender`) as main always did, answering its
// engine host's `maws.artifact.capture` and `maws.artifact.export` and registering `artifacts.export` over it; the render
// host composes the same library in a windowless process. The frame and permission policies stay main's to apply to
// its own windows, imported from where the library keeps them.
import { MessageChannelMain, session, type BrowserWindow } from 'electron';
import type { CommandInput, CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { openDocument } from './open';
import { CAPTURE_PARTITION, answerCaptureRequests } from '../../render/capture';
import { composeRender } from '../../render/compose'; // P5 O5 M3
import { installRenderSeams } from '../../render/e2e-seams'; // P5 O5 M3
import { answerExportRequests, type ExporterRegistry, type ExportService } from '../../render/export';
import type { DocumentAuthorDeps } from '../../render/export-document';
import { appOriginOf, guardPermissions, installFramePolicies } from '../../render/policies';
import { serveArtifacts, type ContentLookup } from '../../render/scheme'; // P5 O5 M2
import { presentationEmbeds } from '../presentations/present-embeds'; // P3-C M6
import { MACHINE_ARTIFACTS_CAPABILITY } from '@shared/host/socket-protocol'; // P5 O5 M2

export type { ExportContext, Exporter, ExporterRegistry, ExportRequest } from '../../render/export';

export interface ArtifactsDeps {
  hosts: Pick<HostSupervisor, 'dispatch' | 'postDocPort' | 'closeDocPorts' | 'onState' | 'onStreaming' | 'onEvent' | 'peer'>;
  register: typeof registerMainHandler;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // P3-A M5: to the renderer
  env: Record<string, string | undefined>;
  openWindow(): BrowserWindow; // the e2e seam's second window
  root: string; // P3-A M7: `<userData>/artifacts`, where the library's exports are written
  artifactsSocket: string | null; // P5 O5 M2: the daemon shape's `mawsd` artifacts.sock, proxied to while its welcome lists machine.artifacts; null on the embedded shape
  authors?: DocumentAuthorDeps; // P5 O5 M3: a document's Word comment authors (WR 73), the root's to read
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
export function startArtifacts({ hosts, register, emit, env, openWindow, root, artifactsSocket, authors }: ArtifactsDeps): { stop(): void; exporters: ExporterRegistry; exports: Pick<ExportService, 'exportForLibrary'> } {
  const deps = { dispatch: hosts.dispatch, postDocPort: hosts.postDocPort, closeDocPorts: hosts.closeDocPorts, channel: () => new MessageChannelMain() };
  register('artifacts.open', ({ artifactId, doc }, { client }) => openDocument(deps, artifactId, client, doc));
  // P3-A M7: the scheme and the export service
  const call = <N extends CommandName>(name: N, input: CommandInput<N>) => hosts.dispatch('engine-host', name, input) as Promise<CommandResult<N>>;
  const content: ContentLookup = (input) => call('artifacts.content', input);
  const embeds = presentationEmbeds(call); // P3-C M6: the presenter's live embeds, under their own policy (Decision Log 18)
  // P5 O5 M2: read per request, so a daemon restarted into another build is followed (the build check's restart)
  const endpoint = artifactsSocket === null ? undefined : () => (hosts.peer('machine')?.capabilities.includes(MACHINE_ARTIFACTS_CAPABILITY) ? { socketPath: artifactsSocket } : null);
  for (const target of [session.defaultSession, session.fromPartition(CAPTURE_PARTITION)]) serveArtifacts(target, content, embeds, endpoint);
  // E3: the engine host's connection losses, counted for a dashboard export's one recapture across a restart
  let hostLosses = 0;
  const stopLosses = hosts.onState('engine-host', (state) => {
    if (state.state !== 'ready') hostLosses += 1;
  });
  // P5 O5 M3: the render library, composed in-process (P3-A M7's export service and P3-L M6b's captures, with every
  // kind's exporters)
  const render = composeRender({ call, content, root, env, ...(authors && { authors }), hostGeneration: () => hostLosses });
  const stopExports = answerExportRequests(render, {
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    answer: (input) => call('maws.artifact.exported', input),
  });
  register('artifacts.export', (input) => render.exportForLibrary(input));
  // P3-L M6b: `artifact_screenshot`'s captures, answered to the requesting session
  const stopCaptures = answerCaptureRequests(render.capture, {
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'maws.artifact.captured', input),
  });
  const stopResync = hosts.onStreaming('engine-host', () => void emit('artifacts.resync', {})); // P3-A M5
  const seam = globalThis as { __maws_documents?: { openWindow(): number } };
  if (env.MAWS_E2E === '1') seam.__maws_documents = { openWindow: () => openWindow().id };
  const stopSeams = installRenderSeams({ content, env }); // P5 O5 M3: the render library's own, as the render host installs them
  return {
    exporters: render.exporters,
    exports: render, // P4-B5
    stop: () => {
      stopResync();
      stopLosses(); // E3
      stopCaptures();
      stopExports();
      render.stop();
      stopSeams();
      delete seam.__maws_documents;
    },
  };
}
