// The one-time adoption of route D's format 1 grants, bound to the machine (P5 O4 M2, docs/doperpowers/plans/
// 2026-10-31-p5-o4-services.md, U7: Interfaces §B; D3, D23, D32): main opens each record sealed under Electron's
// safeStorage (./legacy-custody.ts) and hands it to the machine's `connectors.adoptGrant` through main's own route, under
// main's own client (`mawsd`'s on the daemon shape, the embedded root's in process), which re-seals it under the
// machine's key and replaces the file only while it is still the format 1 one nobody forgot. A record the machine
// declines, or cannot be asked to take, is left under the reason it gave. The adoption asks nothing of the sealer or the
// machine when no format 1 file is there (`adoptLegacy` lists first).
//
// P5 O4 (whole-branch review): the pass says whether it is worth running again (`retry`), when the machine could not take
// a record yet: an older `mawsd` with no `connectors.adoptGrant` (`unknown_command`, the updated app's first streaming
// before the build check restarts it), a machine host not running or restarting (`host_unavailable`), one that did not
// answer (`timeout`), or a machine whose connectors or custody are not up (its `unavailable`). Every other outcome settles
// the record for the launch; a pass the sealer stopped asked the machine nothing and never asks for a retry, so the
// Keychain is not asked again. The caller (./index.ts) runs it again at the machine host's next streaming: it lists first,
// so a record adopted meanwhile is no longer format 1 and is not handed over again.
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

export interface LegacyGrantsAdoption extends LegacyAdoption {
  retry: boolean; // a record was left because the machine could not take it yet
}

const NOT_YET_CODES: ReadonlySet<string> = new Set(['unknown_command', 'host_unavailable', 'timeout']);

export async function adoptLegacyGrants({ directory, sealer, invoke, log }: LegacyGrantsDeps): Promise<LegacyGrantsAdoption> {
  let retry = false;
  const result = await adoptLegacy({
    directory,
    sealer,
    adopt: async (connectionId, record) => {
      const answer = await invoke('connectors.adoptGrant', { connectionId, record }, { client: mainClient });
      if (answer.ok ? !answer.value.adopted && answer.value.reason === 'unavailable' : NOT_YET_CODES.has(answer.error.code)) retry = true;
      return answer.ok ? answer.value : { adopted: false, reason: answer.error.code };
    },
    log,
  });
  return { ...result, retry };
}
