// `machine.identity`'s answer, built from shared types alone (P5 O6 M1 and M5; moved here by P5 O3-D M2,
// docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D16): the machine's display name, its enrollment and its own
// project. `mawsd`'s services front answers `machine.identity` cold through these, with no spine loaded, and the spine's
// own `startMachineIdentity` (src/services/machine/identity.ts) calls the same ones; the bundle guard keeps
// src/services/ off `mawsd`'s run path, which is why they live here and not beside the org derivation that reads git.
import type { MachineProject } from '../ipc/schema/machine';
import { machineKey } from './org-key';
import { machineProjectId } from './project-ids';
import type { MachineRef } from './ref';

// A display attribute, never an identity: `MAWS_MACHINE_NAME` when set (the e2e names each profile, since two profiles
// on one Mac share a hostname), else the short hostname. Once the machine is enrolled the org state names it (O8, O11).
export function machineName(env: NodeJS.ProcessEnv, hostname: string): string {
  return env.MAWS_MACHINE_NAME || hostname.split('.')[0];
}

// The org this machine is enrolled in and its name there: sminos's `{org, machine}`, the one input to the project rule
// beyond the filesystem (src/services/index/org-project.ts). Null until O10, which replaces this with the endpoint's
// enrollment (RL §2.1); MAWS never reads sminos's private `daemon/hub.json`. Until then a terminal session's sminos
// project and MAWS's key agree by the rule, not by id (a flag for O9).
export interface Enrollment {
  org: string;
  machine: string;
}
export function machineEnrollment(): Enrollment | null {
  return null;
}

// `machine.identity`'s project: the machine's own, named after it.
export function machineProject(machine: MachineRef, name: string, enrollment: Enrollment | null): MachineProject {
  return { key: machineKey(machine), name, smnsId: enrollment ? machineProjectId(enrollment.org, enrollment.machine) : null };
}
