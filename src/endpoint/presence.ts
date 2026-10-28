// What `mawsd` may know of the endpoint without loading it (P5 O10 M10, the architect's lever (a) on acceptance 14): the
// module, `ws` and org-protocol stay off an unenrolled daemon's resident set, loaded at the daemon's start only when an
// enrollment is on disk, else at the first endpoint command that needs it; a read-only command over a state directory
// that holds nothing is answered here, as the module would answer it. So this file is the module's second entry
// (eslint.config.js), read by `mawsd` before the module is, and imports nothing at run time but Node's `fs` and `path`,
// the private-path check the store makes, and the pure renderers the module answers with (answers.ts, status.ts).
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertPrivateDirectory } from '@shared/host/private-path';
import type { MachineRef } from '@shared/machine/ref';
import { DEFAULT_POLICY, keysAnswer, policyAnswer, statusAnswer } from './answers';
import { endpointStatus, NO_LINKS, type EndpointStatus } from './status';

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
export const UNENROLLED_STATUS: EndpointStatus = endpointStatus(null, null, NO_LINKS);

/**
 * The read-only commands, each as the module answers it started on a state directory that holds nothing: no
 * enrollment, no pending provisioning, no delegation, no policy (and so none from sminos, which only an enrolled
 * endpoint hears), nothing refused.
 */
const UNLOADED: Record<string, (ref: MachineRef, json: boolean) => string> = {
  status: (_ref, json) => statusAnswer(UNENROLLED_STATUS, json),
  keys: (ref, json) => keysAnswer({ ref, enrollment: null, pending: null, delegation: null, key: null, refusing: null }, json),
  policy: (_ref, json) => policyAnswer({ ...DEFAULT_POLICY, source: 'default' }, json),
};

/**
 * The module's answer to `command`, when it is known without loading the module, else null (the module is loaded and
 * answers). Known for `status`, `keys` and `policy`, bare or `--json` alone, while the state directory holds nothing
 * at all: then the module, started now, would read nothing there (every file it reads at its start is at the top) and
 * judge nothing but the directory's own mode, owner and kind, which are checked here as the store checks them. Any other
 * arguments are the module's to parse or refuse. A directory that holds anything, a policy or a `stale-<time>/` alone
 * included, is the module's to judge: what it says of a file's shape is its own.
 */
export function unloadedAnswer(machine: { ref: MachineRef; stateDir: string }, command: string, args: readonly string[]): { code: 0; out: string } | null {
  const answer = Object.hasOwn(UNLOADED, command) ? UNLOADED[command] : undefined;
  const json = args.length === 0 ? false : args.length === 1 && args[0] === '--json' ? true : null;
  if (answer === undefined || json === null || !holdsNothing(machine.stateDir)) return null;
  return { code: 0, out: answer(machine.ref, json) };
}

function holdsNothing(stateDir: string): boolean {
  try {
    assertPrivateDirectory(stateDir);
    return readdirSync(stateDir).length === 0;
  } catch {
    return false; // absent, refused or unreadable: the module's to say
  }
}
