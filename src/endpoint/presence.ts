// What `mawsd` may know of the endpoint without loading it (P5 O10 M10, the architect's lever (a) on acceptance 14): the
// module, `ws` and org-protocol stay off an unenrolled daemon's resident set, loaded at the daemon's start only when an
// enrollment is on disk, else at the first endpoint command. So this file is the module's second entry (eslint.config.js),
// importing nothing but Node's `fs` and `path`, and read by `mawsd` before the module is.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { EndpointStatus } from './status';

/**
 * The state files that hold, or are the start of, an enrollment (state/store.ts's names): the machine key, the grant
 * ledger, the enrollment and the org state; a delegation, a pending provisioning and a retirement (O14). Any of them, a
 * symlink or a file, is the module's to judge at its start (to serve, to finish a provisioning, to move aside a key
 * without its ledger, or to refuse). What an unenrolled endpoint keeps besides (its policy, its own actions' ledger, a
 * `stale-<time>/`) asks nothing of a running module.
 */
export const ENROLLMENT_FILES = ['machine-key.json', 'grants.json', 'enrollment.json', 'org.json', 'delegation.json', 'provisioning.json', 'retirement.json'] as const;

/** Whether `stateDir` holds any of ENROLLMENT_FILES: a few `lstat`s, nothing read. */
export function enrollmentOnDisk(stateDir: string): boolean {
  return ENROLLMENT_FILES.some((name) => lstatSync(join(stateDir, name), { throwIfNoEntry: false }) !== undefined);
}

/** `status()` of an endpoint with no enrollment, as the module itself reports one: `daemon.status`'s until it loads. */
export const UNENROLLED_STATUS: EndpointStatus = {
  enrollment: 'none',
  hub: { connected: false },
  channels: { relayed: 0, direct: 0 },
  rl10: { connected: false },
  listener: { bound: false },
  legacyKey: false,
  legacyRetired: false,
  delegated: false,
};
