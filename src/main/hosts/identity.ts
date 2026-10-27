// What main says it is to a supervisor (E10 execution document, §Design 6): the build id of the engine-host bundle this
// app would start, and (P5 O1 M6, OX1) the wire's major, minor and capabilities, presented in the transport's `hello`;
// the wire fingerprint, presented only through the protocol-2 window and reported in `host.status` as `appWire`. Under
// the e2e harness MAWS_E2E_BUILD_ID and MAWS_E2E_WIRE_MAJOR stand in, so a supervisor left by an earlier run reads as
// another build (the update banner) or another major (the incompatible one). A supervisor this app run starts itself is
// of this build by construction, so once it starts one the seams end: the app then reads as what it is, and the
// supervisor it started is served rather than replaced again and again. A utility host is never a supervisor and never
// compared: the seams apply only to the detached mode, or a utility run that set them would misreport host.status.
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { WIRE_CAPABILITIES, WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf } from '../../engine-host/supervisor-files';
import type { HostMode } from './mode';

export interface AppIdentity {
  buildId(): string;
  wire(): string; // the wire fingerprint: the protocol-2 window's match, and host.status's appWire
  major(): number; // P5 O1 M6: the hello's `protocol`
  minor(): number;
  capabilities(): readonly string[];
  startedOwn(): void; // this app run started a supervisor of its own
}

export function appIdentity(modulePath: string, env: NodeJS.ProcessEnv, mode: HostMode = 'detached'): AppIdentity {
  const e2e = mode === 'detached' && env.MAWS_E2E === '1';
  let buildId = (e2e && env.MAWS_E2E_BUILD_ID) || null;
  let major = (e2e && Number.parseInt(env.MAWS_E2E_WIRE_MAJOR ?? '', 10)) || null;
  if (buildId) console.log(`[hosts] MAWS_E2E_BUILD_ID: the app reads as build ${buildId} until it starts a supervisor of its own`);
  if (major) console.log(`[hosts] MAWS_E2E_WIRE_MAJOR: the app's hello presents wire major ${major} until it starts a supervisor of its own`);
  return {
    buildId: () => buildId ?? buildIdOf(modulePath),
    wire: () => wireFingerprint(),
    major: () => major ?? SOCKET_PROTOCOL,
    minor: () => WIRE_MINOR,
    capabilities: () => WIRE_CAPABILITIES,
    startedOwn() {
      buildId = null;
      major = null;
    },
  };
}
