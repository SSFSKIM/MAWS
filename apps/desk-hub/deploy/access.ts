// The Access setup in front of the deployed hub (the DC3 plan, M5; the composite's DX7, Access): created and kept by
// script with the owner's setup token, so it can be reproduced.
//
// - One self-hosted application on the Worker's whole workers.dev host. A hostname-level application, not the
//   Worker-level Access toggle, which refuses WebSocket upgrades. Its policies admit the owner by email and any
//   service token of the account: the hub's own token may mint service tokens but not edit policies, so the Registry,
//   not Access, refuses a client id it never enrolled.
// - One path-level application, more specific and so taking precedence, that bypasses Access for enrollment's
//   redemption (`POST /machine/enroll`, guarded by its one-time token) and for the web app's manifest and icons, which
//   iOS fetches for a home-screen app without the Access cookie and which carry nothing of the org.
//
// Policies are the account's reusable ones, each found by name; applications are found by name too, so a second run
// updates in place.
import { REDEEM_PATH } from '../src/protocol/identity';

export type AccessConfig = {
  /** The Worker's name, which names the applications and policies. */
  name: string;
  /** `<worker>.<subdomain>.workers.dev`. */
  host: string;
  /** The owner's identity at the team's identity provider. */
  ownerEmail: string;
  /** How long a person's Access session lasts, as Cloudflare spells it (`24h`). */
  sessionDuration: string;
};

type Rule = Record<string, Record<string, string>>;
export type PolicySpec = { name: string; decision: 'allow' | 'non_identity' | 'bypass'; include: Rule[] };
export type AppSpec = {
  name: string;
  type: 'self_hosted';
  domain: string;
  destinations: Array<{ type: 'public'; uri: string }>;
  session_duration: string;
  app_launcher_visible: boolean;
  service_auth_401_redirect: boolean;
  /** The policies in precedence order, by name; reconciliation turns them into ids. */
  policies: Array<{ name: string }>;
};
export type AccessPlan = { policies: PolicySpec[]; apps: AppSpec[] };

/** The paths Access lets through unauthenticated: the redeem path, the manifest, the icons. */
export const PUBLIC_PATHS = [REDEEM_PATH, '/manifest.webmanifest', '/icons/*'];

export function accessPlan(config: AccessConfig): AccessPlan {
  const owner: PolicySpec = { name: `${config.name} owner`, decision: 'allow', include: [{ email: { email: config.ownerEmail } }] };
  const machines: PolicySpec = { name: `${config.name} machines`, decision: 'non_identity', include: [{ any_valid_service_token: {} }] };
  const open: PolicySpec = { name: `${config.name} public paths`, decision: 'bypass', include: [{ everyone: {} }] };
  const app = (name: string, uris: string[], policies: PolicySpec[]): AppSpec => ({
    name,
    type: 'self_hosted',
    domain: uris[0],
    destinations: uris.map((uri) => ({ type: 'public', uri })),
    session_duration: config.sessionDuration,
    app_launcher_visible: false,
    // A machine whose token fails is answered 401, not redirected to a sign-in page it cannot follow.
    service_auth_401_redirect: true,
    policies: policies.map(({ name }) => ({ name })),
  });
  return {
    policies: [owner, machines, open],
    apps: [
      app(config.name, [config.host], [owner, machines]),
      app(
        `${config.name} public paths`,
        PUBLIC_PATHS.map((path) => `${config.host}${path}`),
        [open],
      ),
    ],
  };
}

/** Cloudflare's API under one account (`/accounts/<id>`), answering a call's `result`. */
export interface CfApi {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export function cfApi(token: string, account: string, fetcher: typeof fetch = fetch, base = 'https://api.cloudflare.com/client/v4'): CfApi {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await fetcher(`${base}/accounts/${account}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = (await response.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> };
      if (!response.ok || !parsed.success) {
        throw new Error(`${method} ${path}: ${response.status} ${(parsed.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
      }
      return parsed.result as T;
    },
  };
}

type Named = { id: string; name: string };

/** Creates or updates, by name, the record `body` describes in the collection at `path`; its id. */
async function upsert(api: CfApi, path: string, existing: Named[], body: { name: string }): Promise<Named & Record<string, unknown>> {
  const found = existing.find((record) => record.name === body.name);
  return found ? api.request('PUT', `${path}/${found.id}`, body) : api.request('POST', path, body);
}

export type AccessState = { aud: string; apps: Record<string, string>; policies: Record<string, string> };

/** Brings the account's Access policies and applications to the plan; the main application's AUD and every id. */
export async function reconcileAccess(api: CfApi, plan: AccessPlan): Promise<AccessState> {
  const policyIds: Record<string, string> = {};
  const policies = await api.request<Named[]>('GET', '/access/policies');
  for (const spec of plan.policies) policyIds[spec.name] = (await upsert(api, '/access/policies', policies, spec)).id;
  const appIds: Record<string, string> = {};
  let aud = '';
  const apps = await api.request<Named[]>('GET', '/access/apps');
  for (const spec of plan.apps) {
    const body = { ...spec, policies: spec.policies.map(({ name }, i) => ({ id: policyIds[name], precedence: i + 1 })) };
    const app = await upsert(api, '/access/apps', apps, body);
    appIds[spec.name] = app.id;
    if (spec === plan.apps[0]) aud = String(app.aud);
  }
  return { aud, apps: appIds, policies: policyIds };
}
