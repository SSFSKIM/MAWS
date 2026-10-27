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
// Policies are the account's reusable ones, each found by name among every page of them; applications are found by name
// too, so a second run updates in place. The one exception is the people policy (`<worker> owner`): a deploy creates it
// with the owner alone and never rewrites it after, since its include list is `deployment access-sync`'s, reconciled to
// the org state's member emails (O11 M3), and a deploy that reset it would shut out every member the state admitted.
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
/** `createOnly`: created when absent, never updated (it is not sent; the policy's own fields are). */
export type PolicySpec = { name: string; decision: 'allow' | 'non_identity' | 'bypass'; include: Rule[]; createOnly?: boolean };
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

/** The policy admitting people by email: `<worker> owner`, the owner alone until access-sync lists the org state's. */
export function peoplePolicy(worker: string, emails: string[]): PolicySpec {
  return { name: `${worker} owner`, decision: 'allow', include: emails.map((email) => ({ email: { email } })) };
}

export function accessPlan(config: AccessConfig): AccessPlan {
  const owner: PolicySpec = { ...peoplePolicy(config.name, [config.ownerEmail]), createOnly: true };
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

/** Rows a list call asks for at once: under every Access list's maximum, so a page holding fewer is the last. */
const PER_PAGE = 50;

/** Every record of the collection at `path`, page by page: a list call that names no page answers the first alone, and
 * a lookup by name that read only it would miss a record further on (and create a second of that name). */
export async function listAll<T>(api: CfApi, path: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const rows = await api.request<T[]>('GET', `${path}?page=${page}&per_page=${PER_PAGE}`);
    all.push(...rows);
    if (rows.length < PER_PAGE) return all;
  }
}

/** Creates or updates, by name, the record `body` describes in the collection at `path`; its id. */
export async function upsert(api: CfApi, path: string, existing: Named[], body: { name: string }): Promise<Named & Record<string, unknown>> {
  const found = existing.find((record) => record.name === body.name);
  return found ? api.request('PUT', `${path}/${found.id}`, body) : api.request('POST', path, body);
}

export type AccessState = { aud: string; apps: Record<string, string>; policies: Record<string, string> };

/** Brings the account's Access policies and applications to the plan; the main application's AUD and every id. */
export async function reconcileAccess(api: CfApi, plan: AccessPlan): Promise<AccessState> {
  const policyIds: Record<string, string> = {};
  const policies = await listAll<Named>(api, '/access/policies');
  for (const { createOnly, ...spec } of plan.policies) {
    const found = createOnly ? policies.find((p) => p.name === spec.name) : undefined;
    policyIds[spec.name] = (found ?? (await upsert(api, '/access/policies', policies, spec))).id;
  }
  const appIds: Record<string, string> = {};
  let aud = '';
  const apps = await listAll<Named>(api, '/access/apps');
  for (const spec of plan.apps) {
    const body = { ...spec, policies: spec.policies.map(({ name }, i) => ({ id: policyIds[name], precedence: i + 1 })) };
    const app = await upsert(api, '/access/apps', apps, body);
    appIds[spec.name] = app.id;
    if (spec === plan.apps[0]) aud = String(app.aud);
  }
  return { aud, apps: appIds, policies: policyIds };
}
