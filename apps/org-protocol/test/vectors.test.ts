import { describe, expect, it } from 'vitest';
import { generateSigningKey, importSigningKey, keyId } from '../src/keys.ts';
import { buildScenario, type Keys } from '../vectors/scenario.ts';
import { KEY_NAMES, replayVectors, VECTOR_KEYS, VECTORS } from '../vectors/index.ts';

describe('the committed vectors', () => {
  it('replay with no failure', async () => {
    expect(await replayVectors(VECTORS)).toEqual([]);
  });

  it('carry the cases M1 proves', () => {
    const names = new Set(VECTORS.cases.map((c) => c.name));
    for (const name of [
      "a member's second device, endorsed by their first and countersigned by an admin",
      'a second device whose channel key changed after its endorsement',
      "a machine's event replayed into another project",
      'a dual-coded machine event',
      "a successor signed by a removed admin's key",
      'a rollback after a transition',
      'a fork at the head: another state of the head version',
      'an older version than the head',
      "an event judged against another org's state",
      'a successor taking the second of two held transitions, the second listed first',
      'a successor taking the second of two held transitions, the first listed first',
      'genesis pinning a recovery key off the curve',
      'a successor whose root set is a key off the curve',
      'genesis with a lone surrogate',
      'a listing with a lone surrogate',
      'a successor with two machines of one ref',
      "a successor changing a machine's ref under its key",
      'then the old name given to a new machine',
      'then the machine renamed back to its old name',
      "a machine's event under its renamed machine's old name",
      "a machine's event under a name the record gives another ref",
      'a listing of a contested ref',
      'a machine certificate for a ref a state entry holds',
      "a retired machine key's event stamped before its notAfter",
      "a retired machine key's event stamped after its notAfter",
      "a retired device key's words, created before its notAfter though the hub stamped them after",
      "a revoked machine key's event",
      "a recreated VM's listing under its predecessor's retired name",
      "a revoked certificate's event",
      "a certificate's retirement signed by its delegation key",
      "a certificate's revocation signed by its delegation key",
      'then the retirement moved later',
      'then a revoked key retired after all',
      'then the dropped retirement added back',
      'a revoked device key made current again, the revoked set passed',
      'a revoked device key made current again, no revoked set passed',
      'the keys a device removal revokes',
      'the keys a dropped retirement revokes',
      'the keys a plain retirement revokes: none',
      'a device key dropped two steps before, retired now',
      "a successor retiring a member's device",
      "a successor rotating a machine's key and retiring the old one",
      'then the retired key made current again, its retirement dropped in the same step',
      'then a retired device key made current again, its retirement dropped in the same step',
      "a retired device key's words after its member left",
      'a retirement by another delegation, through a certificate-shaped object',
      "a VM's listing beside another delegation's retirement, through a certificate-shaped object",
      "a VM's listing beside another delegation's retirement of its own certificate of the key",
      "a listed machine's listing while a live certificate claims its ref",
      "a listed machine's event while a live certificate claims its ref",
      "a listed machine's keys while a live certificate claims its ref",
      "contested refs: a forged certificate on an entry's ref",
      "contested refs: a retired certificate on an entry's ref",
      "a VM's event after its certificate expired, under its renewal",
      "a retired certificate's event, with vm-1 enrolled under another ref",
      "a retired certificate's event, with vm-1 enrolled under its ref",
    ]) {
      expect(names, name).toContain(name);
    }
    expect(VECTORS.dual.length).toBeGreaterThan(0);
  });

  it("name each key by its point's kid, and each private JWK signs as its point", async () => {
    for (const name of KEY_NAMES) {
      const key = VECTOR_KEYS[name];
      expect(await keyId(key.pub)).toBe(key.kid);
      expect((await importSigningKey(key.jwk)).pub).toBe(key.pub);
    }
  });
});

describe('the scenario', () => {
  it('holds for keys other than the committed ones', async () => {
    const keys = {} as Keys;
    for (const name of KEY_NAMES) keys[name] = await generateSigningKey();
    const set = await buildScenario(keys);
    expect(set.cases.length).toBe(VECTORS.cases.length);
    expect(await replayVectors(set)).toEqual([]);
  });
});
