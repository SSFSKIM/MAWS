// The hub on workerd for a suite: the bundled Worker in Miniflare, configured from wrangler.jsonc (its objects and
// compatibility), with the deploy variables a suite gives and Access's certificate endpoint answered by a stub that
// serves the suite's test key. Requests carry assertions signed with that key, as Access would add them.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { convertV4MiniflareOptions, Miniflare, Response as MiniflareResponse, type V4WorkerOptions } from 'miniflare';
import { inject } from 'vitest';
import { generateVapidKey } from '../../src/push/web-push';
import { accessKeyPair, signAssertion, type TestKey } from './assertions';

const require = createRequire(import.meta.url);
const { unstable_getMiniflareWorkerOptions } = require('wrangler') as typeof import('wrangler');

export const ISSUER = 'https://desk-team.cloudflareaccess.com';
export const AUDIENCE = 'aud-desk-hub-test';
export const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`;
export const ORG = 'org-test';
export const ADMIN = 'owner@example.com';

export const DEPLOY_VARS = {
  ORG_ID: ORG,
  ORG_NAME: 'Test org',
  ORG_ADMIN_EMAIL: ADMIN,
  ACCESS_ISSUER: ISSUER,
  ACCESS_AUD: AUDIENCE,
  ACCESS_CERTS_URL: CERTS_URL,
  CF_API_URL: 'https://api.cloudflare.test/client/v4',
  CF_ACCOUNT_ID: 'acct-test',
  CF_API_TOKEN: 'api-token-test',
};

export type Hub = Awaited<ReturnType<typeof startHub>>;

export async function startHub(given: Partial<Record<keyof typeof DEPLOY_VARS | 'VAPID_KEY', string>> = DEPLOY_VARS) {
  // The VAPID key is generated for the run, never committed.
  const vars = { VAPID_KEY: await generateVapidKey(), ...given };
  const key: TestKey = await accessKeyPair('test-k1');
  const workerOptions = unstable_getMiniflareWorkerOptions(resolve(import.meta.dirname, '../../wrangler.jsonc')).workerOptions as Pick<
    V4WorkerOptions,
    'durableObjects' | 'compatibilityDate' | 'compatibilityFlags' | 'bindings'
  >;
  // Wrangler hands over Miniflare 4's option shape; Miniflare 5 converts it.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
      {
        name: 'desk-hub',
        durableObjects: workerOptions.durableObjects,
        compatibilityDate: workerOptions.compatibilityDate,
        compatibilityFlags: workerOptions.compatibilityFlags,
        modules: true,
        scriptPath: inject('hubScript'),
        // Modules are named relative to this root; one outside the bundle's directory names it `../…`, which workerd
        // refuses at startup with an opaque "internal error".
        modulesRoot: dirname(inject('hubScript')),
        bindings: { ...workerOptions.bindings, ...vars },
        outboundService: (request) =>
          request.url === CERTS_URL ? MiniflareResponse.json({ keys: [key.jwk] }) : new MiniflareResponse('no outbound fetch in the suite', { status: 502 }),
      },
      ],
    }),
  );
  await mf.ready;

  const now = () => Math.floor(Date.now() / 1000);
  const assertion = (claims: Record<string, unknown>) =>
    signAssertion(key, { aud: [AUDIENCE], iss: ISSUER, iat: now(), nbf: now(), exp: now() + 600, type: 'app', ...claims });

  return {
    mf,
    /** An assertion for a person, as Access signs it after their sign-in. */
    human: (email: string) => assertion({ email, sub: `sub-${email}`, identity_nonce: 'n', country: 'KR' }),
    /** An assertion for a service token, whose client id Access puts in `common_name`. */
    service: (clientId: string) => assertion({ common_name: clientId, sub: '' }),
    assertion,
    fetch: (path: string, init: { assertion?: string; headers?: Record<string, string>; method?: string } = {}) =>
      mf.dispatchFetch(`https://hub.test${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.assertion ? { 'Cf-Access-Jwt-Assertion': init.assertion } : {}), ...init.headers },
      }),
    close: () => mf.dispose(),
  };
}
