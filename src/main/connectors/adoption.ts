// The one-time adoption of route D's format 1 grants, bound to the machine (P5 O4 M2, docs/doperpowers/plans/
// 2026-10-31-p5-o4-services.md, U7: Interfaces §B; D3, D23, D32): main opens each record sealed under Electron's
// safeStorage (./legacy-custody.ts) and hands it to the machine's `connectors.adoptGrant` through main's own route, under
// main's own client (`mawsd`'s on the daemon shape, the embedded root's in process), which re-seals it under the
// machine's key and replaces the file only while it is still the format 1 one nobody forgot. A record the machine
// declines, or cannot be asked to take, is left under the reason it gave. The adoption asks nothing of the sealer or the
// machine when no format 1 file is there (`adoptLegacy` lists first).
import type { ConnectorOAuthSealer } from '@shared/connectors/sealer';
import type { ServicesBus } from '@shared/spine/bus';
import { mainClient } from '../ipc/clients';
import { adoptLegacy, type LegacyAdoption } from './legacy-custody';

export interface LegacyGrantsDeps {
  directory: string; // <profile>/connectors/oauth
  sealer: ConnectorOAuthSealer; // legacySealer() in production
  invoke: ServicesBus['invoke']; // main's own route
  log(line: string): void;
}

export function adoptLegacyGrants({ directory, sealer, invoke, log }: LegacyGrantsDeps): Promise<LegacyAdoption> {
  return adoptLegacy({
    directory,
    sealer,
    adopt: async (connectionId, record) => {
      const answer = await invoke('connectors.adoptGrant', { connectionId, record }, { client: mainClient });
      return answer.ok ? answer.value : { adopted: false, reason: answer.error.code };
    },
    log,
  });
}
