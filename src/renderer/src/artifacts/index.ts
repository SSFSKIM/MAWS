// Window-wide document ports with one ArtifactHost per explicitly named machine (X24). Bare-id consumers such as
// the shared design-system provider retain a separate host that uses route hints.
import type { MachineRef } from '@shared/machine/ref';
import type { ArtifactHost } from '@artifacts/host';
import { ipc } from '../ipc/client';
import { e2eRequested } from './e2e-seam';
import { holdableDocPorts } from './held-frames'; // UX wave U10b fix wave 1: the e2e window's hold on outgoing frames
import { createArtifactHost } from './host';
import { windowDocPorts } from './window-ports';

const hosts = new Map<MachineRef | undefined, ArtifactHost>();
let ports: ReturnType<typeof holdableDocPorts> | undefined;

export function artifactHost(machine?: MachineRef): ArtifactHost {
  const existing = hosts.get(machine);
  if (existing) return existing;
  // Channel ids are global to the window; keep one receiver even though the hosts are machine-scoped.
  ports ??= holdableDocPorts(windowDocPorts(window), window, e2eRequested(location.search));
  const host = createArtifactHost({ ipc, ...(machine !== undefined && { machine }), ports });
  hosts.set(machine, host);
  return host;
}
