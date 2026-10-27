// RL9's owner attestation (attest.ts), the recovery rewind (org-state.ts `verifyRewind`), grants for certified machines
// (records.ts), the step-up and WebAuthn verdicts: each case's expected verdict is written here, so a scenario that
// drifted would fail before its vectors replay (vectors.test.ts replays them against the code).
import { describe, expect, it } from 'vitest';
import { verifyAttestation, type Attest } from '../src/attest.ts';
import { NO_CERTIFICATES } from '../src/records.ts';
import type { LogEventV2, OrgState, SignedOrgState } from '../src/types.ts';
import { VECTOR_KEYS, VECTORS } from '../vectors/index.ts';

const ok = (extra: Record<string, unknown> = {}) => ({ ok: true, ...extra });
const no = (code: string) => ({ ok: false, code });

const EXPECTED: Record<string, { call: string; expect: unknown }> = {
  // Attestations of a session's owners, on events of `mini` (owned by Alice) and of the VM `vm-1` (its delegation owned
  // by Bob), against the remote org's states.
  'an attested owner who owns the sending machine': { call: 'verifyAttestation', expect: ok({ owners: ['A'] }) },
  'an attested owner proven by their spawn': { call: 'verifyAttestation', expect: ok({ owners: ['B'] }) },
  'an attested owner proven by a spawn from a device retired after its created': { call: 'verifyAttestation', expect: ok({ owners: ['B'] }) },
  'an attested owner with no proof': { call: 'verifyAttestation', expect: no('not-owner') },
  'an attested owner whose proof names another machine': { call: 'verifyAttestation', expect: no('other-machine') },
  'an attested owner whose proof is from a revoked device': { call: 'verifyAttestation', expect: no('revoked') },
  "an attested owner whose proof's step-up signature fails": { call: 'verifyAttestation', expect: no('bad-signature') },
  'an attested owner proven by another member\'s spawn': { call: 'verifyAttestation', expect: no('not-owner') },
  'owners added in a chain: Alice adds Bob, Bob adds Carol': { call: 'verifyAttestation', expect: ok({ owners: ['A', 'B', 'C'] }) },
  'an owner added by a member who is no owner': { call: 'verifyAttestation', expect: no('not-owner') },
  'an attested owner of a certified VM, by its delegation': { call: 'verifyAttestation', expect: ok({ owners: ['B'] }) },
  'an attestation on an event of no machine writer': { call: 'verifyAttestation', expect: no('malformed') },
  // The recovery rewind: a machine that accepted a forged chain takes a recovery transition from below its head.
  'a rewind from a forged head by the pinned recovery key': { call: 'verifyRewind', expect: ok() },
  'a rewind by a transition older than one accepted': { call: 'verifyRewind', expect: no('rollback') },
  'a rewind replaying an accepted transition': { call: 'verifyRewind', expect: no('rollback') },
  'a rewind signed by an admin key': { call: 'verifyRewind', expect: no('unknown-signer') },
  'a rewind from beyond the head': { call: 'verifyRewind', expect: no('not-head') },
  // Grants for a machine under a delegation (O11 left grants to enrolled machines).
  'a grant for a certified VM, signed by an admin of its org-owned delegation': { call: 'verifyGrant', expect: ok() },
  'a grant for a certified VM, signed by a member who owns no part of it': { call: 'verifyGrant', expect: no('unknown-signer') },
  "a grant for a certified VM's other key": { call: 'verifyGrant', expect: no('not-listed') },
  'a grant for a certified VM without its certificate': { call: 'verifyGrant', expect: no('not-listed') },
  // Step-up and the web-cards assertion.
  "an action's step-up by its device's step-up key": { call: 'verifyStepUp', expect: ok() },
  "an action's step-up checked against another device's key": { call: 'verifyStepUp', expect: no('bad-signature') },
  'a web-cards answer with its assertion': { call: 'verifyWebAuthn', expect: ok({ counter: 5 }) },
  'a web-cards assertion over another challenge': { call: 'verifyWebAuthn', expect: no('challenge') },
  'a web-cards assertion from another origin': { call: 'verifyWebAuthn', expect: no('origin') },
  "a web-cards assertion naming another rpId's hash": { call: 'verifyWebAuthn', expect: no('rp-id') },
  'a web-cards assertion with UV cleared': { call: 'verifyWebAuthn', expect: no('user-verification') },
  'a web-cards assertion whose counter did not rise': { call: 'verifyWebAuthn', expect: no('counter') },
  "a counterless authenticator's first assertion": { call: 'verifyWebAuthn', expect: ok({ counter: 0 }) },
  "a counterless authenticator's second assertion": { call: 'verifyWebAuthn', expect: ok({ counter: 0 }) },
  'an action whose opCreated is more than 60 s after its created': { call: 'isAction', expect: { valid: false } },
  'an action whose opCreated is 60 s after its created': { call: 'isAction', expect: { valid: true } },
};

describe('the remote cases', () => {
  const members = VECTORS.fixtures['remote members'] as Record<'A' | 'B' | 'C', string>;
  const resolveMembers = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null || !('owners' in value)) return value;
    return { ...value, owners: (value as { owners: Array<'A' | 'B' | 'C'> }).owners.map((m) => members[m]) };
  };

  for (const [name, { call, expect: expected }] of Object.entries(EXPECTED)) {
    it(name, () => {
      const found = VECTORS.cases.find((c) => c.name === name);
      expect(found, name).toBeDefined();
      expect(found?.call).toBe(call);
      expect(found?.expect).toEqual(resolveMembers(expected));
    });
  }

  it("keeps a retired step-up key its own member's: a new member enrolled under a retired device id is not proven by the old key's spawn", async () => {
    const { state: r4 } = VECTORS.fixtures['remote r4'] as SignedOrgState;
    const DAVE = '4d1b2c3d4e5f60718293a4b5c6d7e8f9';
    const r5: OrgState = structuredClone(r4);
    r5.version = 5;
    r5.members.push({ id: DAVE, email: 'dave@example.com', role: 'member', devices: [{ id: 'dev-b1', class: 'native-mac', keyStorage: 'software', channelPub: VECTOR_KEYS.stranger.pub, stepUpPub: VECTOR_KEYS.a4StepUp.pub }] });
    const proven = VECTORS.fixtures['an attested owner proven by their spawn'] as LogEventV2 & { attest: Attest };
    expect(await verifyAttestation(r5, NO_CERTIFICATES, { ...proven, attest: { ...proven.attest, owners: [DAVE] } })).toEqual(no('not-owner'));
    expect(await verifyAttestation(r5, NO_CERTIFICATES, proven)).toEqual(ok({ owners: [members.B] }));
  });

  it('refuses an attestation that is no attestation, and an event without one', async () => {
    const { state } = VECTORS.fixtures['remote r3'] as SignedOrgState;
    const event = { writer: 'mini/67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', created: '2026-10-27T04:00:00.000Z', sig: { kid: 'A'.repeat(22), value: 'A'.repeat(86) } };
    expect(await verifyAttestation(state, NO_CERTIFICATES, event)).toEqual(no('malformed'));
    expect(await verifyAttestation(state, NO_CERTIFICATES, { ...event, attest: { owners: [], ownersProof: [], origin: { kind: 'local' }, stateVersion: 0 } })).toEqual(no('malformed'));
  });
});
