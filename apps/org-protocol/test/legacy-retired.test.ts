// The org key's retirement in the signed state (O14 M5a, Interfaces §E): `legacyRetired {version, at}`, optional,
// added by the state that retires the key (its own version), kept unchanged after, and dropped by a successor (the
// rehearsal's undo; the hub alone refuses that once it has purged its copies).
import { describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, type SigningKey } from '../src/keys.ts';
import { signOrgState, stateHash, verifyGenesis, verifySuccessor } from '../src/org-state.ts';
import { isOrgState } from '../src/shapes.ts';
import type { OrgState, SignedOrgState } from '../src/types.ts';

const ORG = 'org-legacy';
const MEMBER = 'b'.repeat(32);

async function genesis(stepUp: SigningKey, recovery: SigningKey): Promise<OrgState> {
  const channel = await generateSigningKey();
  return {
    org: ORG,
    version: 1,
    prev: null,
    issued: '2026-10-28T10:00:00.000Z',
    root: { keys: [await keyId(stepUp.pub)], recoveryPub: recovery.pub },
    members: [{ id: MEMBER, email: 'owner@example.com', role: 'admin', devices: [{ id: 'a1', class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub }] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
}

async function setup() {
  const stepUp = await generateSigningKey();
  const recovery = await generateSigningKey();
  const sign = (state: OrgState) => signOrgState(state, [stepUp]);
  const next = async (head: SignedOrgState, edit: (s: OrgState) => void = () => {}, hour = 11): Promise<SignedOrgState> => {
    const s = structuredClone(head.state);
    s.version += 1;
    s.prev = await stateHash(head.state);
    s.issued = `2026-10-28T${String(hour).padStart(2, '0')}:00:00.000Z`;
    edit(s);
    return sign(s);
  };
  const g = await sign(await genesis(stepUp, recovery));
  return { sign, next, g };
}

const retire = (s: OrgState) => void (s.legacyRetired = { version: s.version, at: s.issued });

describe('legacyRetired in the signed state', () => {
  it('is taken by a successor that adds it at its own version, keeps it, or drops it', async () => {
    const { next, g } = await setup();
    const v2 = await next(g, retire);
    expect(await verifySuccessor(g, v2, [])).toEqual({ ok: true });
    const v3 = await next(v2, (s) => s.projects.push({ id: 'p1', name: 'one' }), 12);
    expect(v3.state.legacyRetired).toEqual(v2.state.legacyRetired);
    expect(await verifySuccessor(v2, v3, [])).toEqual({ ok: true });
    const v4 = await next(v3, (s) => delete s.legacyRetired, 13);
    expect(await verifySuccessor(v3, v4, [])).toEqual({ ok: true });
    // Retired again after an undo: a new retirement, at the version that makes it.
    const v5 = await next(v4, retire, 14);
    expect(await verifySuccessor(v4, v5, [])).toEqual({ ok: true });
  });

  it('is refused when added at another version than its own, or changed once held', async () => {
    const { next, g } = await setup();
    const early = await next(g, (s) => void (s.legacyRetired = { version: 1, at: s.issued }));
    expect(await verifySuccessor(g, early, [])).toEqual({ ok: false, code: 'malformed' });
    const v2 = await next(g, retire);
    const moved = await next(v2, (s) => void (s.legacyRetired = { version: 2, at: '2026-10-28T12:30:00.000Z' }), 12);
    expect(await verifySuccessor(v2, moved, [])).toEqual({ ok: false, code: 'malformed' });
    const renumbered = await next(v2, (s) => void (s.legacyRetired = { version: 3, at: s.issued }), 12);
    expect(await verifySuccessor(v2, renumbered, [])).toEqual({ ok: false, code: 'malformed' });
  });

  it('is shaped exactly: {version, at}, a version from 1 and an ISO time with milliseconds', async () => {
    const { next, g } = await setup();
    for (const bad of [{ version: 2, at: '2026-10-28T11:00:00.000Z', by: 'x' }, { version: 0, at: '2026-10-28T11:00:00.000Z' }, { version: 2, at: '2026-10-28' }, { version: 2 }, null]) {
      const s = await next(g, (state) => void Object.assign(state, { legacyRetired: bad }));
      expect(isOrgState(s.state), JSON.stringify(bad)).toBe(false);
      expect(await verifySuccessor(g, s, [])).toEqual({ ok: false, code: 'malformed' });
    }
  });

  it('may stand in a genesis, at version 1', async () => {
    const { sign, g } = await setup();
    const retired = await sign({ ...structuredClone(g.state), legacyRetired: { version: 1, at: g.state.issued } });
    expect(await verifyGenesis(retired)).toEqual({ ok: true });
    const wrong = await sign({ ...structuredClone(g.state), legacyRetired: { version: 2, at: g.state.issued } });
    expect(await verifyGenesis(wrong)).toEqual({ ok: false, code: 'malformed' });
  });

  it('is an unknown field to a package that predates it, which refuses the whole state (why B4 step 0 exists)', async () => {
    // The exact-field rule (shapes.ts) refuses any top-level key it does not know; to the package before M5a,
    // `legacyRetired` was such a key. The same rule, met by a field this package does not know, stands in for it.
    const { next, g } = await setup();
    const v2 = await next(g, retire);
    expect(isOrgState(v2.state)).toBe(true);
    const { legacyRetired, ...rest } = v2.state;
    expect(isOrgState({ ...rest, legacyRetiredNext: legacyRetired })).toBe(false);
    // And this package takes a state without the field, as the one before it did.
    expect(await verifySuccessor(g, await next(g), [])).toEqual({ ok: true });
  });
});
