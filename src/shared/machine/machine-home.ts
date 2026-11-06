// The machine's home as a remote member's reach and a home spawn read it (2026-11-06, the New chat's machine first):
// `os.homedir()`'s realpath, read once, so one decision names it. A `session.spawn` of `~` (HOME_CHECKOUT) starts in it,
// and the home-root rule drops a session root that is it or an ancestor of it (`/`, `/Users`) from what a remote member
// reaches: git's bounds (src/endpoint/targets.ts' CheckoutBounds) and the files service's roots for a remote caller
// (src/services/files/allowlist.ts). Not `$HOME`, which launchd may set otherwise: a spawned session's directory must be
// exactly the root the rule drops.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { sep } from 'node:path';

let real: string | null = null;

/** The home's realpath (the native one, so APFS's case and macOS's `/private` links are resolved), read at the first call. */
export function machineHome(): string {
  if (real === null) {
    const home = homedir();
    try {
      real = realpathSync.native(home);
    } catch {
      real = home; // a home that does not resolve: as named, so nothing below it is taken for elsewhere
    }
  }
  return real;
}

/** Whether `root` (a realpath) is the home or an ancestor of it: a root that reaches the whole home tree. */
export function coversHome(root: string, home: string = machineHome()): boolean {
  return root === home || home.startsWith(root.endsWith(sep) ? root : root + sep);
}
