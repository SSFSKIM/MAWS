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
