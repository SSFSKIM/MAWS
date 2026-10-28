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
      "a certificate's retirement record signed by an admin device",
      'then the retirement moved later',
      'then a revoked key retired after all',
      'then the revoked key retired again',
      'a revoked device key made current again',
      'a revoked device key made current again, its revocation dropped',
      'a device key dropped two steps before, retired now',
      "a successor retiring a member's device",
      "a successor rotating a machine's key and retiring the old one",
      'then the retired key made current again, its retirement dropped in the same step',
      'then a retired device key made current again, its retirement dropped in the same step',
      "a retired device key's words after its member left",
      'a retirement by another delegation, through a certificate-shaped object',
      "a VM's listing beside another delegation's retirement, through a certificate-shaped object",
      "a VM's listing beside another delegation's retirement of its own certificate of the key",
      "an enrolled machine's listing while a live certificate claims its ref",
      "an enrolled machine's event while a live certificate claims its ref",
      "an enrolled machine's keys while a live certificate claims its ref",
      "contested refs: a forged certificate on an entry's ref",
      "contested refs: a retired certificate on an entry's ref",
      "a VM's event after its certificate expired, under its renewal",
      "a retired certificate's event, its ref enrolled since",
      // O14 M5a: the legacy key's retirement in the state.
      'a successor retiring the legacy key',
      'a successor retiring the legacy key at another version',
      'then the legacy retirement kept',
      'then the legacy retirement dropped',
      'then the legacy retirement moved',
      'a successor whose legacy retirement carries another field',
      // Wave 5: revocations in the state (RL DL 24), name namespaces and certificate refs (RL DL 25), grants' keys.
      "a successor rotating a machine's key, the old one neither retired nor revoked",
      'a successor dropping a device, its keys neither retired nor revoked',
      'then the retirement dropped, its key not revoked',
      'then the retired key revoked',
      'then a revocation dropped',
      'then the retired key revoked and made current again',
      'a rotation K1 to K2 to K1, the retirement kept',
      'a rotation K1 to K2 to K1 after an intermediate state',
      'a successor a transition authorizes, dropping a revocation of the head',
      'a successor dropping a delegation, its key not revoked',
      'a successor dropping a delegation, its key revoked',
      "then a delegation taking the revoked one's prefix",
      "a successor changing a delegation's prefix",
      'a successor renewing a live delegation',
      'a successor renewing an expired delegation',
      'a successor enrolling DC-mini beside the prefix dc-',
      "a successor naming a machine under a delegation's prefix",
      "a successor adding a delegation whose prefix covers a machine's name",
      "a successor adding a delegation with another's prefix",
      "a successor adding a delegation whose prefix nests in another's",
      'a machine certificate under an enrolled name',
      "a machine certificate whose ref is not its delegation's",
      "a certificate claiming another delegation's ref",
      "a successor revoking a certificate's key",
      "a successor retiring a certificate's key",
      "a revoked certificate's event",
      "an admin-retired certificate's event stamped after its notAfter",
      "a VM's event after its delegation is revoked",
      "a revoked machine key's event",
      "a grant for a machine's key it has rotated away from",
      // Wave 6: events judged by their signed `created`; revoked delegations' ids and prefixes reserved (RL DL 26).
      "a retired machine key's event created before its notAfter, its ts after",
      "a retired machine key's event created after its notAfter, its ts before",
      "a machine's event without created",
      "then a delegation taking the revoked one's prefix",
      "then a delegation taking the revoked one's id",
      'then a machine named under the revoked prefix',
      "then a machine enrolled under a ref of the revoked delegation's shape",
      "a successor enrolling a machine under a ref of a live delegation's shape",
      "then its delegation revoked, the certificate's key left retired",
      "then its delegation revoked, the certificate's key revoked with it",
      "then a delegation reissuing the old VM's key under the revoked prefix",
      // Wave 7: one holder per key; a key leaving its holder is recorded even if it reappears under another.
      "a successor dropping a delegation, its key now a machine's, not revoked",
      "a successor dropping a delegation, its key revoked and now a machine's",
      "a successor giving a machine a delegation's key",
      'a successor giving two machines one key',
      "a successor giving a machine a device's channel key",
      'genesis with a device whose step-up key is its channel key',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(VECTORS.dual.length).toBeGreaterThan(0);
  });

  it("carry the channel's transcripts, handshakes and frames O10 M1 proves", () => {
    const runs = new Map(VECTORS.channel.runs.map((r) => [r.name, r]));
    const expectations: Array<[string, unknown[]]> = [
      ["a handshake at one head, the device's end", [{ ok: true }]],
      ["a handshake at one head, the endpoint's end", [{ ok: true }]],
      ["a handshake carrying successors in h2, the device's end", [{ ok: true }]],
      ["a handshake carrying successors in h3, the endpoint's end", [{ ok: true }]],
      ["a catch-up over two pages, the endpoint's end", [{ ok: false, reason: 'behind', stateVersion: 2 }, { ok: true }]],
      ["a catch-up over two pages, the device's end", [{ ok: false, reason: 'behind', stateVersion: 2 }, { ok: true }]],
      ["a device the state does not list, the endpoint's end", [{ ok: false, reason: 'unknown-device' }]],
      ["a device claiming another class, the endpoint's end", [{ ok: false, reason: 'class' }]],
      ["a revoked device, the endpoint's end", [{ ok: false, reason: 'revoked' }]],
      ["an h3 over the page limit, the endpoint's end", [{ ok: false, reason: 'too-large' }]],
      ['an h2 whose signature is over another exchange', [{ ok: false, reason: 'bad-signature' }]],
      ['an h2 whose MAC is wrong', [{ ok: false, reason: 'bad-mac' }]],
    ];
    for (const [name, outcomes] of expectations) {
      expect(runs.get(name)?.connections.map((c) => c.expect), name).toMatchObject(outcomes);
    }
    expect(runs.get("a handshake carrying successors in h2, the device's end")?.headAfter).toBe(3);
    expect(runs.get("a catch-up over two pages, the endpoint's end")?.headAfter).toBe(3);
    const receives = new Map(VECTORS.channel.receives.map((r) => [r.name, r.expect]));
    expect(Object.fromEntries(receives)).toEqual({
      'frames in sequence': { opened: 3 },
      'a sequence skipped': { opened: 1, reason: 'sequence' },
      'a sequence repeated': { opened: 1, reason: 'sequence' },
      'a sequence reordered': { opened: 0, reason: 'sequence' },
      'across a rekey at 2^20, the sequence continuing': { opened: 2 },
      "an epoch's last frame dropped before the next epoch's first": { opened: 1, reason: 'sequence' },
      'an epoch jump of two': { opened: 0, reason: 'epoch' },
      'a tag altered': { opened: 0, reason: 'tag' },
    });
    expect(VECTORS.channel.frames.map((f) => [f.epoch, f.seq])).toContainEqual([1, 2 ** 20]);
    expect(VECTORS.channel.transcripts).toHaveLength(1);
    expect(VECTORS.encodings.actions.map((a) => a.name)).toEqual(['a lane B answer', 'a lane A spawn']);
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
    // Extractable: the channel's handshake runs carry each end's private test key, as keys.json does.
    for (const name of KEY_NAMES) keys[name] = await generateSigningKey(true);
    const set = await buildScenario(keys);
    expect(set.cases.length).toBe(VECTORS.cases.length);
    expect(await replayVectors(set)).toEqual([]);
  });
});
