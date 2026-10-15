import type { Machine } from './objects/machine';
import type { Project } from './objects/project';
import type { Registry } from './objects/registry';

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
}

export type OrgConfig = { id: string; name: string; adminEmail: string };

/** The deploy configuration, or null when any of it is missing (the Worker then refuses everything). */
export function hubConfig(env: Env): { org: OrgConfig; issuer: string; audience: string; certsUrl: string } | null {
  const values = [env.ORG_ID, env.ORG_NAME, env.ORG_ADMIN_EMAIL, env.ACCESS_ISSUER, env.ACCESS_AUD, env.ACCESS_CERTS_URL];
  if (values.some((value) => typeof value !== 'string' || value === '')) return null;
  return {
    org: { id: env.ORG_ID, name: env.ORG_NAME, adminEmail: env.ORG_ADMIN_EMAIL },
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUD,
    certsUrl: env.ACCESS_CERTS_URL,
  };
}

/** Headers the Worker sets on the requests it makes to its objects, after verifying who is asking; objects are
 * reachable only through the Worker, which drops any copy a client sent. */
export const MEMBER_HEADER = 'X-Desk-Member';
export const PROJECT_HEADER = 'X-Desk-Project';
export const ORG_HEADER = 'X-Desk-Org';
export const MACHINE_HEADER = 'X-Desk-Machine';
