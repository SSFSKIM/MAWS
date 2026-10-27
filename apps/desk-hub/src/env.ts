import type { Machine } from './objects/machine';
import type { Project } from './objects/project';
import type { Registry } from './objects/registry';
import { HEARTBEAT_MS } from './protocol/machine';

export interface Env {
  PROJECT: DurableObjectNamespace<Project>;
  MACHINE: DurableObjectNamespace<Machine>;
  REGISTRY: DurableObjectNamespace<Registry>;
  /** The org, created from this configuration on first use with ORG_ADMIN_EMAIL as its admin (never by a first sign-in). */
  ORG_ID: string;
  ORG_NAME: string;
  ORG_ADMIN_EMAIL: string;
  /** Access: the team's issuer (`https://<team>.cloudflareaccess.com`), the application's AUD tag, and the URL of the
   * team's signing keys (`<issuer>/cdn-cgi/access/certs`; locally, the stand-in's). */
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  ACCESS_CERTS_URL: string;
  /** Cloudflare's API (`https://api.cloudflare.com/client/v4`; locally, the stand-in's), the account whose Access
   * service tokens are machines' credentials, and a token scoped to service tokens alone (a secret). */
  CF_API_URL: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  /** The hub's VAPID key for Web Push (a secret): a P-256 private key as JWK JSON. Pushes name `mailto:<admin>`. */
  VAPID_KEY: string;
  /** The machine stream's heartbeat in ms (optional; DX2's 15 000 when unset). The local command shortens it: there a
   * client's close reaches the object only at the next write to its stream (test/stream-close.test.ts). */
  HEARTBEAT_MS?: string;
}

export type OrgConfig = { id: string; name: string; adminEmail: string };

export type ApiConfig = { url: string; account: string; token: string };

export type HubConfig = { org: OrgConfig; issuer: string; audience: string; certsUrl: string; api: ApiConfig; vapidKey: string };

/** The deploy configuration, or null when any of it is missing (the Worker then refuses everything). */
export function hubConfig(env: Env): HubConfig | null {
  const values = [
    env.ORG_ID,
    env.ORG_NAME,
    env.ORG_ADMIN_EMAIL,
    env.ACCESS_ISSUER,
    env.ACCESS_AUD,
    env.ACCESS_CERTS_URL,
    env.CF_API_URL,
    env.CF_ACCOUNT_ID,
    env.CF_API_TOKEN,
    env.VAPID_KEY,
  ];
  if (values.some((value) => typeof value !== 'string' || value === '')) return null;
  return {
    org: { id: env.ORG_ID, name: env.ORG_NAME, adminEmail: env.ORG_ADMIN_EMAIL },
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUD,
    certsUrl: env.ACCESS_CERTS_URL,
    api: { url: env.CF_API_URL, account: env.CF_ACCOUNT_ID, token: env.CF_API_TOKEN },
    vapidKey: env.VAPID_KEY,
  };
}

/** The heartbeat a `Machine` object beats its stream at: HEARTBEAT_MS when it is a whole number of ms from 100 to
 * 60 000, DX2's default otherwise. */
export function heartbeatMs(env: Env): number {
  const configured = /^\d+$/.test(env.HEARTBEAT_MS ?? '') ? Number(env.HEARTBEAT_MS) : NaN;
  return configured >= 100 && configured <= 60_000 ? configured : HEARTBEAT_MS;
}

/** Headers the Worker sets on the requests it makes to its objects, after verifying who is asking; objects are
 * reachable only through the Worker, which drops any copy a client sent. */
export const MEMBER_HEADER = 'X-Desk-Member';
export const PROJECT_HEADER = 'X-Desk-Project';
export const ORG_HEADER = 'X-Desk-Org';
export const MACHINE_HEADER = 'X-Desk-Machine';
/** The service token's client id the Worker resolved a machine's request from: its `Machine` object refuses one whose
 * credential was revoked, though the Worker admitted the request before the revocation. */
export const CLIENT_HEADER = 'X-Desk-Client';
/** The machine's ref (RL DL 19) the Worker resolved for an RL1 socket or an app's socket to the machine (O11 M6): the
 * ref-addressed `Machine` object keeps it as its own. */
export const REF_HEADER = 'X-Desk-Machine-Ref';
