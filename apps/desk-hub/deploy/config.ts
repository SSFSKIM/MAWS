// A deployment's configuration: where the hub runs and for whom. deploy/config.json is production's (`desk-hub`, the
// default of every command), deploy/staging.json staging's (`desk-hub-staging`, O11's live tests); a command takes
// another with `--config`. The Worker's variables are set from it at each deploy (`wrangler deploy --var`), never from
// wrangler.jsonc, whose variables stay empty so that a deploy made any other way answers 503 to everything rather than
// run half-configured.
import { readFileSync } from 'node:fs';

export type DeployConfig = {
  /** The Cloudflare account the hub, its Access applications, and the machines' service tokens live in. */
  account: string;
  /** The Worker's name. Every wrangler call names it (`--name`, deploy.ts's `workerWrangler`); wrangler.jsonc's own
   * `name` is production's, and is never relied on. */
  worker: string;
  /** `<worker>.<subdomain>.workers.dev`, the host Access fronts. */
  host: string;
  /** The owner: the org's admin and the one person Access admits. */
  ownerEmail: string;
  /** A person's Access session. */
  sessionDuration: string;
  /** The org the Registry makes from configuration on first use. Its id is written into each project's `.smns`. */
  org: { id: string; name: string };
  /**
   * The org's genesis, once the org is set up: `stateHash` of the genesis OrgState (base64url SHA-256 of its canonical
   * form, the `prev` its version 2 carries), as the admin's device that signed it holds it. `access-sync` trusts no
   * chain whose genesis is another (deploy/access-sync.ts).
   */
  orgGenesis?: string;
};

export const CF_API_URL = 'https://api.cloudflare.com/client/v4';

/** Throws unless the config's host is its Worker's (`<worker>.<subdomain>.workers.dev`): a config that names one
 * Worker's host and another's name would act on the other Worker, or on its Access objects. */
export function checkTarget(config: DeployConfig, refusing: string): void {
  if (config.host.split('.')[0] !== config.worker) throw new Error(`the config's host ${config.host} is not the Worker ${config.worker}'s: refusing to ${refusing}`);
}

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
