// The window's one ArtifactHost (X24; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4), made on first use over the
// validated IPC client and the preload's document ports; what B, C, D and E's editors open documents through.
import type { ArtifactHost } from '@artifacts/host';
import { ipc } from '../ipc/client';
import { createArtifactHost } from './host';
import { windowDocPorts } from './window-ports';

let host: ArtifactHost | null = null;

export function artifactHost(): ArtifactHost {
  host ??= createArtifactHost({ ipc, ports: windowDocPorts(window) });
  return host;
}
