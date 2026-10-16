// The deployment's configuration (deploy/config.json): where the hub runs and for whom. The Worker's variables are set
// from it at each deploy (`wrangler deploy --var`), never from wrangler.jsonc, whose variables stay empty so that a
// deploy made any other way answers 503 to everything rather than run half-configured.
import { readFileSync } from 'node:fs';

export type DeployConfig = {
  /** The Cloudflare account the hub, its Access applications, and the machines' service tokens live in. */
  account: string;
  /** The Worker's name, as wrangler.jsonc has it. */
  worker: string;
  /** `<worker>.<subdomain>.workers.dev`, the host Access fronts. */
  host: string;
  /** The owner: the org's admin and the one person Access admits. */
  ownerEmail: string;
  /** A person's Access session. */
  sessionDuration: string;
  /** The org the Registry makes from configuration on first use. Its id is written into each project's `.smns`. */
  org: { id: string; name: string };
};

export const CF_API_URL = 'https://api.cloudflare.com/client/v4';

export function readDeployConfig(path: string): DeployConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as DeployConfig;
}

/** The Worker's variables (its two secrets, CF_API_TOKEN and VAPID_KEY, are put apart from these). */
export function deployVars(config: DeployConfig, access: { issuer: string; aud: string }): Record<string, string> {
  return {
    ORG_ID: config.org.id,
    ORG_NAME: config.org.name,
    ORG_ADMIN_EMAIL: config.ownerEmail,
    ACCESS_ISSUER: access.issuer,
    ACCESS_AUD: access.aud,
    ACCESS_CERTS_URL: `${access.issuer}/cdn-cgi/access/certs`,
    CF_API_URL,
    CF_ACCOUNT_ID: config.account,
  };
}
