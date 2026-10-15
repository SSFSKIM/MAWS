// The Access setup that fronts the deployed hub (the DC3 plan, M5): a hostname-level self-hosted application on the
// Worker's workers.dev host, admitting the owner and any service token, and a path-level application that bypasses
// Access for enrollment's redemption and the web app's manifest and icons. Its plan is pinned here, and its
// reconciliation against Cloudflare's API is run against a fake of that API: created once, updated in place after.
import { describe, expect, it } from 'vitest';
import { accessPlan, reconcileAccess, type CfApi } from '../../deploy/access.ts';
import { readFileSync } from 'node:fs';
import { deployVars } from '../../deploy/config.ts';

const HOST = 'desk-hub.example.workers.dev';
const plan = accessPlan({ name: 'desk-hub', host: HOST, ownerEmail: 'owner@example.com', sessionDuration: '24h' });

/** A fake of the account's Access API: reusable policies and applications, each with an id; an app has an `aud`. */
function fakeApi() {
  const policies = new Map<string, Record<string, unknown>>();
  const apps = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  let next = 0;
  const api: CfApi = {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      calls.push(`${method} ${path}`);
      const table = path.startsWith('/access/policies') ? policies : path.startsWith('/access/apps') ? apps : undefined;
      if (!table) throw new Error(`unexpected ${method} ${path}`);
      const id = path.split('/')[3];
      if (method === 'GET' && !id) return [...table.values()] as T;
      if (method === 'POST' && !id) {
        const record = { ...(body as object), id: `id-${++next}`, ...(table === apps ? { aud: `aud-${next}` } : {}) };
        table.set(record.id, record);
        return record as T;
      }
      if (method === 'PUT' && id && table.has(id)) {
        const record = { ...table.get(id), ...(body as object), id };
        table.set(id, record);
        return record as T;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return { api, policies, apps, calls };
}

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
    const changed = accessPlan({ name: 'desk-hub', host: HOST, ownerEmail: 'other@example.com', sessionDuration: '24h' });
    const second = await reconcileAccess(api, changed);
    expect(second.aud).toBe(first.aud);
    expect(policies.size).toBe(3);
    expect(apps.size).toBe(2);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    expect([...policies.values()].find((p) => p.name === 'desk-hub owner')!.include).toEqual([{ email: { email: 'other@example.com' } }]);
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
