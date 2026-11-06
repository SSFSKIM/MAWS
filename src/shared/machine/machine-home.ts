// The machine's home as a remote member's reach and a home spawn read it (2026-11-06, the New chat's machine first).
// `machineHome` is `os.homedir()`'s realpath, read once: Node reads `$HOME` first, then the passwd entry, so it is the home
// this process works in, which the setup policy, the folder list and a `session.spawn` of `~` (HOME_CHECKOUT) all read
// (one home: a chat started in `~` is where its trust card read). The home-root rule drops a session root that is a home
// or an ancestor of one (`/`, `/Users`) from what a remote member reaches: git's bounds (src/endpoint/targets.ts'
// CheckoutBounds), the files service's roots for a remote caller (src/services/files/allowlist.ts) and scm's checkout;
// its homes are that one and, when `$HOME` names another, the passwd entry's home (`machineHomes`), so a process whose
// `$HOME` differs from its account's still keeps the account's home out of reach.
import { realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { sep } from 'node:path';

let real: string | null = null;
let homes: readonly string[] | null = null;

// The native realpath (APFS's case and macOS's `/private` links resolved); a home that does not resolve, as named.
const realOf = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

/** `os.homedir()`'s realpath, read at the first call: where a `~` spawn starts. */
export function machineHome(): string {
  real ??= realOf(homedir());
  return real;
}

/** The homes the home-root rule keeps out of a remote member's reach: `machineHome`, and the passwd entry's home when it differs. */
export function machineHomes(): readonly string[] {
  if (homes === null) {
    let account: string | null;
    try {
      account = userInfo().homedir;
    } catch {
      account = null; // no passwd entry for this uid: `os.homedir()` is the only home there is
    }
    homes = [...new Set([machineHome(), ...(account === null || account === '' ? [] : [realOf(account)])])];
  }
  return homes;
}

/** Whether `root` (a realpath) is one of the homes or an ancestor of one: a root that reaches a whole home tree. */
export function coversHome(root: string, home: string | readonly string[] = machineHomes()): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return (typeof home === 'string' ? [home] : home).some((h) => root === h || h.startsWith(prefix));
}
