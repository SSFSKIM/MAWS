// The artifact store's side of main (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4): `artifacts.open`, which
// hands a window a document's port (open.ts), and the relay of the design-system defaults main owns in settings
// (defaults.ts). Main never opens `store.sqlite`; every other `artifacts.*` and `spaces.*` command is the engine host's
// and reaches it through the router. Under MAWS_E2E=1 the e2e's seam `globalThis.__maws_documents` opens a further app
// window (the store's e2e syncs one document across two windows).
//
// P3-A M5: in detached mode main relays the document ports (hosts/doc-relay.ts), ending a window's channels when it
// closes or navigates; and each time the engine host's connection starts streaming (either mode), main announces
// `artifacts.resync`, since the store's events of a span with no ready client are not replayed.
import { MessageChannelMain, type BrowserWindow } from 'electron';
import type { CommandResult, EventName, EventPayload, HostState, Settings } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { startArtifactDefaults } from './defaults';
import { openDocument } from './open';

export interface ArtifactsDeps {
  hosts: Pick<HostSupervisor, 'dispatch' | 'postDocPort' | 'closeDocPorts' | 'snapshot' | 'onState' | 'onStreaming'>;
  register: typeof registerMainHandler;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // P3-A M5: to the renderer
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void;
  env: Record<string, string | undefined>;
  openWindow(): BrowserWindow; // the e2e seam's second window
}

export function startArtifacts({ hosts, register, emit, settings, onSettingsChanged, env, openWindow }: ArtifactsDeps): { stop(): void } {
  const deps = { dispatch: hosts.dispatch, postDocPort: hosts.postDocPort, closeDocPorts: hosts.closeDocPorts, channel: () => new MessageChannelMain() };
  register('artifacts.open', ({ artifactId }, { sender }) => openDocument(deps, artifactId, sender));
  const stopDefaults = startArtifactDefaults({
    settings,
    onSettingsChanged,
    hostState: (): HostState => hosts.snapshot('engine-host'),
    onHostState: (listener) => hosts.onState('engine-host', listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'artifacts.setDefaults', input) as Promise<CommandResult<'artifacts.setDefaults'>>,
  });
  const stopResync = hosts.onStreaming('engine-host', () => void emit('artifacts.resync', {})); // P3-A M5
  const seam = globalThis as { __maws_documents?: { openWindow(): number } };
  if (env.MAWS_E2E === '1') seam.__maws_documents = { openWindow: () => openWindow().id };
  return {
    stop: () => {
      stopDefaults();
      stopResync();
      delete seam.__maws_documents;
    },
  };
}
