// The live bench app's sign-in (test/support/bench-sign-in.ts; P5 O7 M7, the milestone review's fix 6): a registered
// profile whose session or hub access lapsed signs in again and never asks for a pairing code; only an unregistered one
// reads the pairing file, which every path removes, its code crossing into org.register alone.
import { describe, expect, it } from 'vitest';
import type { OrgStatus } from '../../src/shared/ipc/schema/org';
import { benchSignIn, type SignInDeps } from './bench-sign-in';

const CODE = 'pair-v1.SECRET-0123456789';

const registered = (session: 'signed-in' | 'signed-out' | 'removed', hubAccess: Extract<OrgStatus, { state: 'registered' }>['hubAccess']): OrgStatus => ({
  state: 'registered', org: 'org-1', hub: 'https://hub', member: { id: 'member-1', email: 'o@x' }, device: 'dev-1', session, hubAccess, head: null, problem: null, signer: null, pairing: null, enrolling: null, hubRowsLeft: [], delegations: { creating: false, rev: 0 },
});

/** The app's org status read in turn from `statuses` (the last one repeated), and every call recorded. */
function deps(statuses: OrgStatus[], options: { pairing?: string | null; attempt?: { ok: boolean; reason?: { code?: string } } } = {}) {
  const calls: string[] = [];
  const said: string[] = [];
  let reads = 0;
  let pairing = options.pairing === undefined ? CODE : options.pairing;
  let clock = 0;
  const d: SignInDeps = {
    status: async () => statuses[Math.min(reads++, statuses.length - 1)]!,
    register: async (code) => {
      calls.push(code === CODE ? 'register(the code)' : 'register(?)');
      return options.attempt ?? { ok: true };
    },
    signIn: async () => {
      calls.push('signIn');
      return options.attempt ?? { ok: true };
    },
    takePairing: () => {
      calls.push('takePairing');
      const code = pairing;
      pairing = null;
      return code;
    },
    removePairing: () => {
      calls.push('removePairing');
      pairing = null;
    },
    say: (line) => void said.push(line),
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
  };
  return { d, calls, said, left: () => pairing };
}

describe('the live bench app’s sign-in (P5 O7 M7)', () => {
  it('already signed in: the member, the unused pairing file removed unread', async () => {
    const { d, calls, left } = deps([registered('signed-in', 'connected')]);
    await expect(benchSignIn(d, 60_000)).resolves.toBe('member-1');
    expect(calls).toEqual(['removePairing']);
    expect(left()).toBeNull();
  });

  for (const [session, hubAccess] of [['signed-out', 'expired'], ['signed-in', 'expired'], ['signed-out', 'connecting']] as const) {
    it(`registered, ${session} with hub access ${hubAccess}: signs in again and waits for the connection, never asking for a pairing code`, async () => {
      const { d, calls, said, left } = deps([registered(session, hubAccess), registered('signed-in', 'signing-in'), registered('signed-in', 'connecting'), registered('signed-in', 'connected')]);
      await expect(benchSignIn(d, 60_000)).resolves.toBe('member-1');
      expect(calls).toEqual(['removePairing', 'signIn']);
      expect(left()).toBeNull();
      expect(said.some((line) => /signs in again in the browser/.test(line))).toBe(true);
    });
  }

  it('registered and only connecting: waits for the connection, asking nothing', async () => {
    const { d, calls } = deps([registered('signed-in', 'connecting'), registered('signed-in', 'connected')]);
    await expect(benchSignIn(d, 60_000)).resolves.toBe('member-1');
    expect(calls).toEqual(['removePairing']);
  });

  it('registered but removed or denied: refused, since no sign-in restores it, and nothing is asked', async () => {
    for (const status of [registered('removed', 'denied'), registered('signed-in', 'denied')]) {
      const { d, calls } = deps([status]);
      await expect(benchSignIn(d, 60_000)).rejects.toThrow(/registered to org-1 but (removed|denied): no sign-in restores it/);
      expect(calls).toEqual(['removePairing']);
    }
  });

  it('a sign-in that is refused, or does not connect in time, fails', async () => {
    const refused = deps([registered('signed-out', 'expired')], { attempt: { ok: false, reason: { code: 'unreachable' } } });
    await expect(benchSignIn(refused.d, 60_000)).rejects.toThrow(/org.signIn refused: unreachable/);
    const late = deps([registered('signed-out', 'expired'), registered('signed-in', 'signing-in')]);
    await expect(benchSignIn(late.d, 60_000)).rejects.toThrow(/did not sign in within 1 minutes \(registered: signed-in, hub signing-in\)/);
  });

  it('unregistered: registers from the pairing file, which is taken once, its code in org.register alone and in no line said', async () => {
    const fingerprinted: OrgStatus = { state: 'registering', step: 'approval', org: 'org-1', hub: 'https://hub', fingerprint: 'FP-1234', expires: null };
    const { d, calls, said, left } = deps([{ state: 'none' }, fingerprinted, registered('signed-in', 'connected')]);
    await expect(benchSignIn(d, 60_000)).resolves.toBe('member-1');
    expect(calls).toEqual(['takePairing', 'register(the code)']);
    expect(left()).toBeNull();
    expect(said.some((line) => line.includes('FP-1234'))).toBe(true);
    expect(said.filter((line) => line.includes('SECRET'))).toEqual([]);
    const none = deps([{ state: 'none' }], { pairing: null });
    await expect(benchSignIn(none.d, 60_000)).rejects.toThrow(/not registered \(none\) and the config names no pairing file that exists/);
    const refused = deps([{ state: 'none' }], { attempt: { ok: false, reason: { code: 'expired' } } });
    await expect(benchSignIn(refused.d, 60_000)).rejects.toThrow(/org.register refused the pairing code: expired/);
  });
});
