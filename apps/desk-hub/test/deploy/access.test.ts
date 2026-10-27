// The Access setup that fronts the deployed hub (the DC3 plan, M5): a hostname-level self-hosted application on the
// Worker's workers.dev host, admitting the owner and any service token, and a path-level application that bypasses
// Access for enrollment's redemption and the web app's manifest and icons. Its plan is pinned here, and its
// reconciliation against Cloudflare's API is run against a fake of that API: created once, updated in place after.
import { describe, expect, it } from 'vitest';
import { accessPlan, reconcileAccess } from '../../deploy/access.ts';
import { fakeAccessApi as fakeApi, pagedAccessApi } from '../support/access-api.ts';
import { readFileSync } from 'node:fs';
import { deployVars } from '../../deploy/config.ts';

const HOST = 'desk-hub.example.workers.dev';
const plan = accessPlan({ name: 'desk-hub', host: HOST, ownerEmail: 'owner@example.com', sessionDuration: '24h' });

describe('the Access plan', () => {
  const app = plan.apps.find((a) => a.name === 'desk-hub')!;
  const bypass = plan.apps.find((a) => a !== app)!;
  const policy = (name: string) => plan.policies.find((p) => p.name === name)!;

  it('guards the whole workers.dev host with one self-hosted application, not a path of it', () => {
    expect(app).toMatchObject({ type: 'self_hosted', domain: HOST, destinations: [{ type: 'public', uri: HOST }], session_duration: '24h' });
  });

  it('admits the owner by email and any service token, which the Registry then checks against what it enrolled', () => {
    expect(app.policies.map((p) => p.name)).toEqual(['desk-hub owner', 'desk-hub machines']);
    expect(policy('desk-hub owner')).toMatchObject({ decision: 'allow', include: [{ email: { email: 'owner@example.com' } }] });
    expect(policy('desk-hub machines')).toMatchObject({ decision: 'non_identity', include: [{ any_valid_service_token: {} }] });
    // A machine whose token fails gets a 401, not a redirect to a sign-in page it cannot follow.
    expect(app.service_auth_401_redirect).toBe(true);
  });

  it('bypasses Access for the redeem path, the manifest, and the icons, and nothing else', () => {
    expect(bypass.type).toBe('self_hosted');
    expect(bypass.destinations).toEqual([
      { type: 'public', uri: `${HOST}/machine/enroll` },
      { type: 'public', uri: `${HOST}/manifest.webmanifest` },
      { type: 'public', uri: `${HOST}/icons/*` },
    ]);
    expect(bypass.policies.map((p) => p.name)).toEqual(['desk-hub public paths']);
    expect(policy('desk-hub public paths')).toMatchObject({ decision: 'bypass', include: [{ everyone: {} }] });
  });
});

describe('reconciling the plan with the account', () => {
  it('creates the policies and applications once, the apps naming the policies by id, and returns the AUD', async () => {
    const { api, policies, apps } = fakeApi();
    const result = await reconcileAccess(api, plan);
    expect(policies.size).toBe(3);
    expect(apps.size).toBe(2);
    const main = [...apps.values()].find((a) => a.name === 'desk-hub')!;
    expect(result.aud).toBe(main.aud);
    const ids = (main.policies as Array<{ id: string; precedence: number }>).map((p) => [policies.get(p.id)!.name, p.precedence]);
    expect(ids).toEqual([
      ['desk-hub owner', 1],
      ['desk-hub machines', 2],
    ]);
  });

  it('updates in place on a second run: no duplicates, the same AUD', async () => {
    const { api, policies, apps, calls } = fakeApi();
    const first = await reconcileAccess(api, plan);
    calls.length = 0;
    const second = await reconcileAccess(api, plan);
    expect(second.aud).toBe(first.aud);
    expect(policies.size).toBe(3);
    expect(apps.size).toBe(2);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('creates the people policy with the owner alone, and never rewrites an existing one’s list (access-sync owns it)', async () => {
    const { api, policies, calls } = fakeApi();
    await reconcileAccess(api, plan);
    const people = () => [...policies.values()].find((p) => p.name === 'desk-hub owner')!;
    expect(people().include).toEqual([{ email: { email: 'owner@example.com' } }]);
    // access-sync admitted a second member; a deploy, even one naming another owner, leaves the list as it is.
    people().include = [{ email: { email: 'owner@example.com' } }, { email: { email: 'member@example.com' } }];
    calls.length = 0;
    await reconcileAccess(api, accessPlan({ name: 'desk-hub', host: HOST, ownerEmail: 'other@example.com', sessionDuration: '24h' }));
    expect(people().include).toEqual([{ email: { email: 'owner@example.com' } }, { email: { email: 'member@example.com' } }]);
    expect(calls).not.toContain(`PUT /access/policies/${String(people().id)}`);
  });
});

describe('finding the account’s records by name', () => {
  it('searches every page: policies and applications past the first page are kept or updated, never made twice', async () => {
    const others = Array.from({ length: 45 }, (_, i) => `other ${i}`);
    const access = pagedAccessApi([...others, ...plan.policies.map((p) => p.name)], [...others, ...plan.apps.map((a) => a.name)]);
    await reconcileAccess(access.api, plan);
    expect(access.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    expect(access.policies.find((p) => p.name === 'desk-hub owner')!.include).toEqual([{ email: { email: 'old@example.com' } }]);
    expect(access.calls.filter((c) => c.startsWith('PUT')).sort()).toEqual(['PUT /access/apps/apps-45', 'PUT /access/apps/apps-46', 'PUT /access/policies/policies-46', 'PUT /access/policies/policies-47']);
  });
});

describe('the deploy configuration', () => {
  it('sets every variable the Worker declares, so with its two secrets it is configured and not answering 503', () => {
    const vars = deployVars(
      { account: 'acct', worker: 'desk-hub', host: HOST, ownerEmail: 'owner@example.com', sessionDuration: '24h', org: { id: 'o', name: 'Org' } },
      { issuer: 'https://team.cloudflareaccess.com', aud: 'aud-tag' },
    );
    expect(vars).toMatchObject({
      ORG_ADMIN_EMAIL: 'owner@example.com',
      ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
      ACCESS_CERTS_URL: 'https://team.cloudflareaccess.com/cdn-cgi/access/certs',
      CF_API_URL: 'https://api.cloudflare.com/client/v4',
    });
    // Every variable the Worker declares (its secrets apart), each set: the Worker answers 503 while one is empty.
    const declared = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars as Record<string, string>;
    expect(Object.keys(vars).sort()).toEqual(Object.keys(declared).sort());
    expect(Object.values(vars).every((value) => value !== '')).toBe(true);
  });
});
