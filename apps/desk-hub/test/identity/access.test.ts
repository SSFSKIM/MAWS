import { beforeAll, describe, expect, it } from 'vitest';
import { AccessError, certsKeySource, verifyAccessAssertion, type AccessVerifierConfig } from '../../src/identity/access';
import { accessKeyPair, signAssertion, type TestKey } from '../support/assertions';

const ISSUER = 'https://desk-team.cloudflareaccess.com';
const AUDIENCE = 'aud-desk-hub-0123456789abcdef';
const NOW = 1_792_000_000_000;

let known: TestKey;
let stranger: TestKey;
let config: AccessVerifierConfig;
let fetches = 0;

beforeAll(async () => {
  known = await accessKeyPair('k1');
  stranger = await accessKeyPair('k2');
  const keys = certsKeySource(async () => {
    fetches++;
    return { keys: [known.jwk], public_cert: { kid: 'k1', cert: '…' } };
  });
  config = { issuer: ISSUER, audience: AUDIENCE, keys, now: () => NOW };
});

const human = { email: 'owner@example.com', sub: '7335d417-61da-459d-899c-0a01c76a2f94', type: 'app', identity_nonce: 'n', country: 'KR' };
const claims = (extra: Record<string, unknown> = {}) => ({
  aud: [AUDIENCE],
  iss: ISSUER,
  iat: NOW / 1000 - 10,
  nbf: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
  ...extra,
});
const reason = async (token: string | null) => {
  try {
    await verifyAccessAssertion(token, config);
  } catch (e) {
    if (e instanceof AccessError) return e.reason;
    throw e;
  }
  return 'accepted';
};

describe("verifying Access's assertion (Cf-Access-Jwt-Assertion)", () => {
  it('admits a person, by email', async () => {
    const token = await signAssertion(known, claims(human));
    expect(await verifyAccessAssertion(token, config)).toEqual({ kind: 'human', email: 'owner@example.com', sub: human.sub });
  });

  it("admits a service token as its client id, the assertion's common_name", async () => {
    const token = await signAssertion(known, claims({ common_name: '5f2a1e0c.access', sub: '', type: 'app' }));
    expect(await verifyAccessAssertion(token, config)).toEqual({ kind: 'service', clientId: '5f2a1e0c.access' });
  });

  it('refuses a request without an assertion', async () => {
    expect(await reason(null)).toBe('missing');
    expect(await reason('')).toBe('missing');
  });

  it('refuses another application’s audience', async () => {
    expect(await reason(await signAssertion(known, claims({ ...human, aud: ['aud-of-another-app'] })))).toBe('audience');
  });

  it('refuses an expired assertion, and one not yet valid', async () => {
    expect(await reason(await signAssertion(known, claims({ ...human, exp: NOW / 1000 - 1 })))).toBe('expired');
    expect(await reason(await signAssertion(known, claims({ ...human, nbf: NOW / 1000 + 60 })))).toBe('not-yet-valid');
  });

  it('refuses a key the team’s certificates do not hold, after looking for a rotated one once', async () => {
    const before = fetches;
    expect(await reason(await signAssertion(stranger, claims(human)))).toBe('unknown-key');
    expect(fetches - before).toBeLessThanOrEqual(1);
  });

  it('refuses a key id it knows under a signature that key did not make', async () => {
    expect(await reason(await signAssertion({ ...stranger, kid: 'k1' }, claims(human)))).toBe('signature');
  });

  it('refuses another issuer', async () => {
    expect(await reason(await signAssertion(known, claims({ ...human, iss: 'https://other-team.cloudflareaccess.com' })))).toBe('issuer');
  });

  it('refuses any algorithm but RS256', async () => {
    const token = await signAssertion(known, claims(human));
    const [, payload] = token.split('.');
    const none = `${btoa(JSON.stringify({ alg: 'none', kid: 'k1' })).replace(/=+$/, '')}.${payload}.`;
    expect(await reason(none)).toBe('algorithm');
  });

  it('refuses an assertion that names no one', async () => {
    expect(await reason(await signAssertion(known, claims({ sub: '' })))).toBe('identity');
  });

  it('refuses what is not a JWT', async () => {
    expect(await reason('a.b')).toBe('malformed');
    expect(await reason('!!.??.**')).toBe('malformed');
  });
});

describe('the certificate source', () => {
  it('finds a key added after its last fetch (a rotation), and asks again at most once in its refresh window', async () => {
    let served = [known.jwk];
    let calls = 0;
    let clock = NOW;
    const keys = certsKeySource(
      async () => {
        calls++;
        return { keys: served };
      },
      { now: () => clock },
    );
    expect(await keys.key('k1')).toBeDefined();
    served = [known.jwk, stranger.jwk];
    clock += 31_000;
    expect(await keys.key('k2')).toBeDefined();
    expect(calls).toBe(2);
    expect(await keys.key('k3')).toBeUndefined();
    expect(await keys.key('k4')).toBeUndefined();
    expect(calls).toBe(2);
  });
});
