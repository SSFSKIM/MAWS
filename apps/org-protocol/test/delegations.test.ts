// A delegation's pre-mint judges, moved here from the hub's `deploy/admin.ts` (P5 O8 M4c, "The move") so the app's
// create transaction refuses what `deployment admin delegation create` refuses, in its words: a prefix the state holds,
// nests or names a machine under, and a mint answer that differs from what the owner approved. The provisioning key's
// bounds move with them, since the app imports nothing from the hub.
import { describe, expect, it } from 'vitest';
import {
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_PROVISIONING_KEY_TTL_S,
  mintDisagrees,
  NEVER_OFFLINE,
  NO_USE_CAP,
  prefixProblem,
  type MintAnswer,
} from '../src/delegations.ts';
import * as index from '../src/index.ts';
import { printable } from '../src/printable.ts';
import type { OrgState, SignedOrgState } from '../src/types.ts';
import { VECTORS } from '../vectors/index.ts';

const fixture = (name: string) => structuredClone((VECTORS.fixtures[name] as SignedOrgState).state);
/** v3: the delegation `0d1e…` with the prefix `vm-`, the machines `mini` and `builder`. */
const v3 = () => fixture('v3');
/** v2 with that delegation dropped: its id and prefix revoked, reserved for the life of the org. */
const dropped = () => fixture('v2 without the delegation');
const DLG = '0d1e2a3b4c5d6e7f8091a2b3c4d5e6f7';

describe('prefixProblem', () => {
  it('takes a prefix that meets no delegation, live or dropped, and no machine name', () => {
    expect(prefixProblem(v3(), 'dc-')).toBeNull();
    expect(prefixProblem(dropped(), 'dc-')).toBeNull();
  });

  it("names a live delegation's equal prefix, raw and case-folded", () => {
    expect(prefixProblem(v3(), 'vm-')).toBe(`the prefix vm- is delegation ${DLG}'s`);
    expect(prefixProblem(v3(), 'VM-')).toBe(`the prefix VM- is delegation ${DLG}'s`);
  });

  it('names a prefix nesting with a live one, either way', () => {
    expect(prefixProblem(v3(), 'vm-a')).toBe(`the prefix vm-a nests with delegation ${DLG}'s vm-`);
    expect(prefixProblem(v3(), 'v')).toBe(`the prefix v nests with delegation ${DLG}'s vm-`);
    expect(prefixProblem(v3(), 'V')).toBe(`the prefix V nests with delegation ${DLG}'s vm-`);
  });

  it("names a dropped delegation's prefix as reserved for the life of the org", () => {
    expect(prefixProblem(dropped(), 'vm-')).toBe(`the prefix vm- is the dropped delegation ${DLG}'s, reserved for the life of the org`);
    expect(prefixProblem(dropped(), 'vm-x')).toBe(`the prefix vm-x nests with the dropped delegation ${DLG}'s vm-, reserved for the life of the org`);
  });

  it('names a machine named under the prefix, an entry or a name the record keeps', () => {
    expect(prefixProblem(v3(), 'm')).toBe('the machine mini is named under the prefix m');
    expect(prefixProblem(v3(), 'BUI')).toBe('the machine builder is named under the prefix BUI');
    const renamed: OrgState = v3();
    renamed.machines = renamed.machines.filter((m) => m.name !== 'builder');
    expect(prefixProblem(renamed, 'bu')).toBe('the machine builder is named under the prefix bu');
  });
});

describe('mintDisagrees', () => {
  const before = Date.parse('2026-11-08T10:00:00.000Z');
  const after = before + 2_000;
  const ttl = 3600;
  const approved = { prefix: 'dc-', ttl, maxUses: 1 as number | null, before, after };
  const answer = (key: Record<string, unknown> = {}, token: unknown = 'tok'): MintAnswer => ({
    key: { id: 'a'.repeat(32), prefix: 'dc-', expires: new Date(before + 1_000 + ttl * 1000).toISOString(), max_uses: 1, ...key },
    token,
  });

  it('finds nothing in an answer that is what the owner approved, the expiry within the skew of the request', () => {
    expect(mintDisagrees(answer(), approved)).toEqual([]);
    expect(mintDisagrees(answer({ expires: new Date(before + ttl * 1000 - 60_000).toISOString() }), approved)).toEqual([]);
    expect(mintDisagrees(answer({ expires: new Date(after + ttl * 1000 + 60_000).toISOString() }), approved)).toEqual([]);
    expect(mintDisagrees(answer({ max_uses: null }), { ...approved, maxUses: null })).toEqual([]);
  });

  it('names an answer with no key', () => {
    for (const issued of [null, {}, { key: null }, { key: 'k' }] as unknown as MintAnswer[]) expect(mintDisagrees(issued, approved)).toEqual(['no key in it']);
  });

  it('names each field that differs, in its words', () => {
    expect(mintDisagrees(answer({ id: 'not-an-id' }), approved)).toEqual(['its id not-an-id is not 32 hex']);
    expect(mintDisagrees(answer({ id: 7 }), approved)).toEqual(['its id 7 is not 32 hex']);
    expect(mintDisagrees(answer({ prefix: 'd' }), approved)).toEqual(['its prefix d, not the dc- you approved']);
    expect(mintDisagrees(answer({ expires: '2099-01-01T00:00:00.000Z' }), approved)).toEqual([
      `it expires at 2099-01-01T00:00:00.000Z, not within 60 s of ${new Date(before + ttl * 1000).toISOString()}`,
    ]);
    expect(mintDisagrees(answer({ expires: new Date(before + ttl * 1000 - 60_001).toISOString() }), approved)).toHaveLength(1);
    expect(mintDisagrees(answer({ expires: new Date(after + ttl * 1000 + 60_001).toISOString() }), approved)).toHaveLength(1);
    expect(mintDisagrees(answer({ expires: 12 }), approved)).toEqual([`it expires at 12, not within 60 s of ${new Date(before + ttl * 1000).toISOString()}`]);
    expect(mintDisagrees(answer({ max_uses: null }), approved)).toEqual(['no use limit, not the 1 you approved']);
    expect(mintDisagrees(answer({ max_uses: 5 }), { ...approved, maxUses: null })).toEqual(['a limit of 5 uses, not the no limit you approved']);
    expect(mintDisagrees(answer({}, ''), approved)).toEqual(['no token']);
    expect(mintDisagrees(answer({}, null), approved)).toEqual(['no token']);
  });

  it('names every difference at once, in the order the fields are read', () => {
    expect(mintDisagrees(answer({ id: 'x', prefix: 'd', expires: 'later', max_uses: 2 }, 0), approved)).toEqual([
      'its id x is not 32 hex',
      'its prefix d, not the dc- you approved',
      `it expires at later, not within 60 s of ${new Date(before + ttl * 1000).toISOString()}`,
      'a limit of 2 uses, not the 1 you approved',
      'no token',
    ]);
  });

  it("escapes what the hub sent as admin's printable does, so no answer forges or hides a line", () => {
    const forged = 'dc-\x1b[2K\nok\\ ';
    expect(mintDisagrees(answer({ id: forged, prefix: forged, expires: forged, max_uses: forged }), approved)).toEqual([
      `its id ${printable(forged)} is not 32 hex`,
      `its prefix ${printable(forged)}, not the dc- you approved`,
      `it expires at ${printable(forged)}, not within 60 s of ${new Date(before + ttl * 1000).toISOString()}`,
      `a limit of ${printable(forged)} uses, not the 1 you approved`,
    ]);
    expect(printable(forged)).toBe('dc-\\u001b[2K\\u000aok\\u005c\\u2028');
  });
});

describe("the provisioning key's bounds", () => {
  it('hold the values the hub enforces, exported from the package', () => {
    expect([MIN_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_USES, NO_USE_CAP, NEVER_OFFLINE]).toEqual([3600, 31_536_000, 10_000, Number.MAX_SAFE_INTEGER, 0]);
    expect(index).toMatchObject({ prefixProblem, mintDisagrees, printable, MIN_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_USES, NO_USE_CAP, NEVER_OFFLINE });
  });
});
