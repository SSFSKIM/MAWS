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

/** Production, by name: what no command that writes org state for a test may act on, whatever a configuration says. */
export const PRODUCTION_WORKER = 'desk-hub';
export const PRODUCTION_HOST = 'desk-hub.opencognita-platform.workers.dev';
/** Staging, by name: the one Worker and host a command that writes org state for a test may act on. Exact names, not a
 * pattern: wrangler names a version's preview alias `<alias>-<worker>.<subdomain>.workers.dev`, so a name merely
 * starting with `desk-hub-staging` can be one of production's (`desk-hub-staging-desk-hub.…`). */
export const STAGING_WORKER = 'desk-hub-staging';
export const STAGING_HOST = 'desk-hub-staging.opencognita-platform.workers.dev';
/** The suites' local hubs. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether a host is production's: its host, its Worker on any workers.dev subdomain, or a preview alias of either. */
function isProduction(hostname: string): boolean {
  const label = hostname.split('.')[0];
  return hostname === PRODUCTION_HOST || (hostname.endsWith('.workers.dev') && (label === PRODUCTION_WORKER || label.endsWith(`-${PRODUCTION_WORKER}`)));
}

/**
 * Throws unless `hub` (an origin, `https://<host>`) is one a test command may write org state to: staging's host over
 * https (STAGING_HOST, exactly), or a local hub on loopback (the suites'). Production's host, Worker and preview aliases
 * are refused by name first, so nothing a configuration says — its org, its pinned genesis, a `--test-org` — can lead
 * such a command there.
 */
export function checkTestHub(hub: string, refusing: string): void {
  const url = new URL(hub);
  if (isProduction(url.hostname)) throw new Error(`${url.origin} is production (the Worker ${PRODUCTION_WORKER}): refusing to ${refusing}`);
  if (LOOPBACK.has(url.hostname)) return;
  if (url.protocol !== 'https:' || url.hostname !== STAGING_HOST) throw new Error(`${url.origin} is not the staging hub (https://${STAGING_HOST}): refusing to ${refusing}`);
}

/** `checkTestHub` for a configuration, whose Worker must also be staging's (STAGING_WORKER, exactly) and the one its
 * host names. */
export function checkTestTarget(config: DeployConfig, refusing: string): void {
  if (config.worker === PRODUCTION_WORKER) throw new Error(`the config names production's Worker ${PRODUCTION_WORKER}: refusing to ${refusing}`);
  checkTestHub(`https://${config.host}`, refusing);
  if (config.worker !== STAGING_WORKER) throw new Error(`the config names the Worker ${config.worker}, not the staging Worker ${STAGING_WORKER}: refusing to ${refusing}`);
  checkTarget(config, refusing);
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
