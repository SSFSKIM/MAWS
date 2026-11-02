// The live bench app's sign-in (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The live
// bench"; e2e/remote-latency-live.spec.ts calls it over the bench app's page). The bench app's scratch profile is kept
// between runs, so it is one of three:
//   - signed in and connected: nothing to do;
//   - registered, its session signed out or its hub access lapsed: `org.signIn` (the owner's browser step), then the
//     connection waited for; still connecting or signing in, only waited for; removed or denied, refused, since no
//     sign-in restores it;
//   - unregistered: registered from the pairing code read from its file, the owner comparing the fingerprint and
//     approving at their terminal.
// The pairing file is removed on every path, read only in the last (a registered profile never takes a code). The code
// crosses only into org.register's input; nothing here says it, and an error that could carry it is replaced by one that
// cannot.
import type { OrgStatus } from '../../src/shared/ipc/schema/org';

type Attempt = { ok: boolean; reason?: { code?: string } };

export interface SignInDeps {
  status(): Promise<OrgStatus>;
  register(code: string): Promise<Attempt>;
  signIn(): Promise<Attempt>;
  /** The pairing file's code, the file removed whatever happens; null when the config names none or it is gone. */
  takePairing(): string | null;
  /** The pairing file removed unread, when there is one. */
  removePairing(): void;
  say(line: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

type Registered = Extract<OrgStatus, { state: 'registered' }>;
const signedIn = (s: Registered): boolean => s.session === 'signed-in' && s.hubAccess === 'connected';
const lineOf = (s: OrgStatus) =>
  s.state === 'registering' ? `registering: ${s.step}${s.fingerprint === null ? '' : `; the fingerprint to compare: ${s.fingerprint}`}` : s.state === 'registered' ? `registered: ${s.session}, hub ${s.hubAccess}` : s.state;

/** The bench app signed in, as its profile stands; its member's id. */
export async function benchSignIn(deps: SignInDeps, withinMs: number): Promise<string> {
  const now = await deps.status();
  if (now.state === 'registered') {
    deps.removePairing(); // a registered profile never takes a code
    if (signedIn(now)) {
      deps.say(`[bench] app: already signed in to ${now.org}; the unused pairing file is removed`);
      return now.member.id;
    }
    if (now.session === 'removed' || now.hubAccess === 'denied') throw new Error(`the bench app is registered to ${now.org} but ${now.session === 'removed' ? 'removed' : 'denied'}: no sign-in restores it (the owner pairs a fresh profile)`);
    if (now.session === 'signed-out' || now.hubAccess === 'expired') {
      const attempt = await deps.signIn();
      if (!attempt.ok) throw new Error(`org.signIn refused: ${attempt.reason?.code ?? 'no reason'}`);
      deps.say(`[bench] app: registered to ${now.org} with its session ${now.session} and hub access ${now.hubAccess}: the owner signs in again in the browser; the unused pairing file is removed`);
    }
  } else if (now.state === 'none') {
    let attempt: Attempt;
    const code = deps.takePairing();
    if (code === null) throw new Error(`the bench app is not registered (${now.state}) and the config names no pairing file that exists`);
    try {
      attempt = await deps.register(code);
    } catch {
      throw new Error('org.register did not answer (its error is not shown, since it could carry the code)');
    }
    if (!attempt.ok) throw new Error(`org.register refused the pairing code: ${attempt.reason?.code ?? 'no reason'}`);
    deps.say('[bench] app: the pairing file is removed; the owner signs in in the browser, then compares the fingerprint below with `admin pair`’s and approves');
  } else if (now.state === 'development') {
    deps.removePairing();
    throw new Error('the bench app runs a development org, not the hub’s');
  }
  let last = '';
  for (const deadline = deps.now() + withinMs; ; ) {
    const s = await deps.status();
    if (s.state === 'registered' && signedIn(s)) {
      deps.say(`[bench] app: signed in to ${s.org}`);
      return s.member.id;
    }
    const line = lineOf(s);
    if (line !== last) deps.say(`[bench] app: ${(last = line)}`);
    if (deps.now() > deadline) throw new Error(`the bench app did not sign in within ${withinMs / 60_000} minutes (${line})`);
    await deps.sleep(2_000);
  }
}
