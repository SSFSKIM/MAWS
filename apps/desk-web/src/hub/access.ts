// Whether the hub is out of reach or the owner's sign-in lapsed. Access stands in front of the whole origin: once its
// session expires, it answers every request — the page, `/api/*`, a socket's upgrade — with a 302 to its sign-in on
// another origin, before the Worker sees it. A WebSocket cannot follow a redirect, so to the page that is only a close,
// the same close a dead network gives. When a socket's connects keep failing, a same-origin `fetch` of `/api/me` tells
// the two apart, from the browser alone.
//
// The probe asks with `redirect: 'manual'`: Access's 302 comes back as an `opaqueredirect` (a request that says it is
// an XMLHttpRequest gets a 401 instead), a dead network throws. An engine that refuses the manual redirect outright,
// throwing as a dead network would, is asked once more in `no-cors` mode, which follows the redirect: an answer from
// Access's origin is `opaque`, one from the Worker is the hub's own, and only a dead network still throws.
import { create } from 'zustand';

export type Admission = 'admitted' | 'signed-out' | 'not-a-member' | 'unreachable';
/** Why the hub refuses this browser: a sign-in can mend either. */
export type Lapse = Extract<Admission, 'signed-out' | 'not-a-member'>;

const ME = '/api/me';

/** How long one probe request may take: a connection that is blackholed, not refused, never answers on its own. */
export const PROBE_TIMEOUT_MS = 8000;

/** What an answer from `/api/me` says of this browser's sign-in (a 403's body is read; any other is left unread). */
export async function admissionOf(response: Response): Promise<Admission> {
  // A redirect the engine exposes (outside a browser) says what an `opaqueredirect` does.
  if (response.type === 'opaqueredirect' || response.type === 'opaque' || response.status === 401 || (response.status >= 300 && response.status < 400)) return 'signed-out';
  if (response.status === 403) {
    // The Worker's own 403 names the member it does not hold; any other (an Access assertion it refused, Access's own
    // page) is a sign-in to renew.
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return body?.error === 'not-a-member' ? 'not-a-member' : 'signed-out';
  }
  return response.ok ? 'admitted' : 'unreachable';
}

export async function probeAdmission(fetcher: typeof fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<Admission> {
  // A request that outlives its bound would hold the one probe slot for good, so each is cut off, and a cut-off one reads
  // as a network that does not answer.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await admissionOf(await fetcher(ME, { credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal }));
  } catch {
    // A request that hung is no engine refusing the manual redirect, so the second ask would only hang as well.
    if (signal.aborted) return 'unreachable';
    try {
      return await admissionOf(await fetcher(ME, { credentials: 'same-origin', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }));
    } catch {
      return 'unreachable';
    }
  }
}

/** `lapsed`: the hub refuses this browser until it signs in again; null while it is reachable or merely out of reach. */
export const useAccess = create<{ lapsed: Lapse | null }>()(() => ({ lapsed: null }));

/** Consecutive failed connects of one socket before the probe runs: one alone is a blip a reconnect usually mends. */
export const FAILURES_BEFORE_PROBE = 2;

let probe: (() => Promise<Admission>) | null = null;
let probing = false;
/** Bumped by every open: a probe begun before it answers about a sign-in that has since been renewed. */
let generation = 0;

/** Probes on the sockets' behalf until the returned stop is called (the app's lifetime; a test's). */
export function watchAccess(run: () => Promise<Admission> = () => probeAdmission()): () => void {
  probe = run;
  return () => {
    if (probe === run) probe = null;
  };
}

/** A socket's connect closed without opening, the `failures`th in a row. One probe runs at a time. */
export function connectFailed(failures: number): void {
  const run = probe;
  if (!run || probing || failures < FAILURES_BEFORE_PROBE) return;
  probing = true;
  const at = generation;
  void run()
    .catch((): Admission => 'unreachable')
    .then((admission) => {
      if (at === generation) setLapsed(admission === 'signed-out' || admission === 'not-a-member' ? admission : null);
    })
    .finally(() => {
      probing = false;
    });
}

/** Which open the hub's sockets are on: an answer to a request begun under an earlier one speaks of a sign-in since renewed. */
export function admissionGeneration(): number {
  return generation;
}

/** A socket opened: whatever lapsed has been mended (a sign-in in another tab counts). */
export function connectOpened(): void {
  generation++;
  setLapsed(null);
}

/**
 * An answer from the hub's own origin redirected off it: Access has no session for this browser. `at` is the
 * `admissionGeneration()` read when the request began; if a socket has opened since, the redirect is of a sign-in that
 * has been renewed, and nothing would clear it while the sockets stay healthy.
 */
export function redirectedToSignIn(at: number): void {
  if (at === generation) setLapsed('signed-out');
}

function setLapsed(lapsed: Lapse | null): void {
  if (useAccess.getState().lapsed !== lapsed) useAccess.setState({ lapsed });
}

/**
 * Signs in again: the page loads afresh at the address it is on, which Access answers with its sign-in and, once it
 * admits the owner, sends them back to (its `redirect_url` keeps the path, and the path is the desk's route). A
 * same-window navigation is what keeps an installed app's sign-in its own: a window opened from a standalone app on a
 * phone may be the system browser, whose cookies the app does not share. A send the hub has not acknowledged lives only
 * in the page, so the owner is asked before it is lost.
 */
export function signInAgain(): void {
  if (holdsSends() && !confirm("A message you sent hasn't reached the hub yet and is lost when you sign in again. Sign in anyway?")) return;
  location.reload();
}

let holdsSends: () => boolean = () => false;

/** Names what says whether a send lives only in this page (the open projects, once their chunk has loaded). */
export function heldSends(check: () => boolean): void {
  holdsSends = check;
}
