// The window's one ArtifactHost (X24; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4), made on first use over the
// validated IPC client and the preload's document ports; what B, C, D and E's editors open documents through.
import type { MachineRef } from '@shared/machine/ref';
import type { ArtifactHost } from '@artifacts/host';
import { ipc } from '../ipc/client';
import { e2eRequested } from './e2e-seam';
import { holdableDocPorts } from './held-frames'; // UX wave U10b fix wave 1: the e2e window's hold on outgoing frames
import { createArtifactHost } from './host';
import { windowDocPorts } from './window-ports';

const hosts = new Map<MachineRef, ArtifactHost>();
let ports: ReturnType<typeof holdableDocPorts> | undefined;

export function artifactHost(machine: MachineRef = ipc.localMachine): ArtifactHost {
  const existing = hosts.get(machine);
  if (existing) return existing;
  // Channel ids are global to the window; keep one receiver even though the hosts are machine-scoped.
  ports ??= holdableDocPorts(windowDocPorts(window), window, e2eRequested(location.search));
  const host = createArtifactHost({ ipc, machine, ports });
  hosts.set(machine, host);
  return host;
}
