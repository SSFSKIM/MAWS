// What main says it is to a supervisor (E10 execution document, §Design 6): the build id of the engine-host bundle this
// app would start and the wire fingerprint, presented in the transport's `hello` and reported in `host.status`. Under
// the e2e harness MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE stand in for them, so a supervisor left by an earlier run reads
// as another build (the update banner) or another wire (the incompatible one). A supervisor this app run starts itself
// is of this build by construction, so once it starts one the seams end: the app then reads as what it is, and the
// supervisor it started is served rather than replaced again and again. A utility host is never a supervisor and never
// compared: the seams apply only to the detached mode, or a utility run that set them would misreport host.status.
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf } from '../../engine-host/supervisor-files';
import type { HostMode } from './mode';

export interface AppIdentity {
  buildId(): string;
  wire(): string;
  startedOwn(): void; // this app run started a supervisor of its own
}

export function appIdentity(modulePath: string, env: NodeJS.ProcessEnv, mode: HostMode = 'detached'): AppIdentity {
  const e2e = mode === 'detached' && env.MAWS_E2E === '1';
  let buildId = (e2e && env.MAWS_E2E_BUILD_ID) || null;
  let wire = (e2e && env.MAWS_E2E_WIRE) || null;
  if (buildId) console.log(`[hosts] MAWS_E2E_BUILD_ID: the app reads as build ${buildId} until it starts a supervisor of its own`);
  if (wire) console.log(`[hosts] MAWS_E2E_WIRE: the app reads as wire ${wire} until it starts a supervisor of its own`);
  return {
    buildId: () => buildId ?? buildIdOf(modulePath),
    wire: () => wire ?? wireFingerprint(),
    startedOwn() {
      buildId = null;
      wire = null;
    },
  };
}
