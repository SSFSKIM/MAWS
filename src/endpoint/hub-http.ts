// The Registry's HTTP routes the endpoint calls (O10 Orientation): enrollment's redemption, key and certificate, and the
// org state, each as the machine (its Access service token) or, for the redemption, unauthenticated (the one-time
// token guards it). RL1, the socket, is M3's. Every request has a deadline over its headers and its body together, and
// every retry here its budget, which a request's deadline never passes; nothing logs a body, since a request or an
// answer may carry a token or a credential.
import { historyAttestationsPath, historyInventoryPath, historyLogPath, type HistoryAttestation, type HistoryAttestations, type HistoryInventory, type HistoryLogPage, type Signed } from 'org-protocol';
import { MACHINE_ORG_STATE_PATH, type OrgStateView } from 'desk-hub/protocol';

export type Credentials = { clientId: string; clientSecret: string };

/** What the endpoint's network and clock calls go through: real ones in `mawsd`, faults and fast clocks in the suites. */
export type HubDeps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number };

export class HubError extends Error {
  readonly status: number;
  readonly error: string;
  constructor(what: string, status: number, error: string) {
    super(status === 0 ? `${what}: ${error}` : `${what}: ${status} ${error}`);
    this.name = 'HubError';
    this.status = status;
    this.error = error;
  }
}

/** The most one request may take, its headers and its body together. */
export const REQUEST_MS = 30_000;
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * A request to the hub, as the machine when `credentials` are given, with a JSON body when `body` is; answered whole (the
 * body read) within `timeoutMs` (at most `REQUEST_MS`), else aborted and failed with `timeout`. It is a POST with a body,
 * a GET without, unless `method` says DELETE.
 */
export async function hubRequest(deps: HubDeps, hub: string, path: string, init: { credentials?: Credentials; body?: unknown; timeoutMs?: number; method?: 'DELETE' } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.credentials) Object.assign(headers, { 'CF-Access-Client-Id': init.credentials.clientId, 'CF-Access-Client-Secret': init.credentials.clientSecret });
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new HubError(`the hub did not answer ${path} in time`, 0, 'timeout');
      controller.abort(error);
      reject(error);
    }, Math.max(1, Math.min(init.timeoutMs ?? REQUEST_MS, REQUEST_MS)));
  });
  try {
    const request = deps.fetch(`${hub}${path}`, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual', signal: controller.signal });
    const response = await Promise.race([request, expired]);
    const body = await Promise.race([response.arrayBuffer(), expired]);
    return new Response(NULL_BODY.has(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
}

/** The refusal's code from a DX7 `{error}` body, or the status alone; the body is read and dropped. */
export async function refusalOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error;
    return typeof error === 'string' ? error : 'refused';
  } catch {
    return response.status === 401 ? 'access' : 'refused';
  }
}

/** The org state from `since` on (`GET /machine/org/state?since=`), one page, within `timeoutMs` when given. */
export async function fetchOrgState(deps: HubDeps, hub: string, credentials: Credentials, since: number, timeoutMs?: number): Promise<OrgStateView> {
  const response = await hubRequest(deps, hub, `${MACHINE_ORG_STATE_PATH}?since=${since}`, { credentials, timeoutMs });
  if (response.status !== 200) throw new HubError('the org state', response.status, await refusalOf(response));
  return (await response.json()) as OrgStateView;
}

/**
 * A request as the machine with a credential minted moments ago: Access refuses a fresh service token (401) at its edge
 * for up to about a minute (O11 M3, `ADMIT_MS`), so a 401 is tried again every 2 s for up to 90 s.
 */
export async function admittedRequest(deps: HubDeps, hub: string, path: string, credentials: Credentials, body: unknown): Promise<Response> {
  const deadline = deps.now() + ADMIT_MS;
  for (;;) {
    const response = await hubRequest(deps, hub, path, { credentials, body, timeoutMs: deadline - deps.now() });
    if (response.status !== 401 || deps.now() + 2000 > deadline) return response;
    await response.body?.cancel();
    await deps.sleep(2000);
  }
}

export const ADMIT_MS = 90_000;

// History re-attestation's reads and its one write (O14 M4, Interfaces §D), as the machine.

async function machineJson<T>(deps: HubDeps, hub: string, credentials: Credentials, path: string, what: string): Promise<T> {
  const response = await hubRequest(deps, hub, path, { credentials });
  if (response.status !== 200) throw new HubError(what, response.status, await refusalOf(response));
  return (await response.json()) as T;
}

/** Every project whose log holds a DX1 writer under `names`, with each writer's highest DX1 seq. */
export const fetchHistoryInventory = (deps: HubDeps, hub: string, credentials: Credentials, names: string[]) =>
  machineJson<HistoryInventory>(deps, hub, credentials, historyInventoryPath(names), 'the history inventory');

/** One page of a writer's stored events after `after`. */
export const fetchHistoryPage = (deps: HubDeps, hub: string, credentials: Credentials, project: string, writer: string, after: number) =>
  machineJson<HistoryLogPage>(deps, hub, credentials, historyLogPath(project, writer, after), `the log of ${writer}`);

/** The attestations a project keeps. */
export const fetchAttestations = (deps: HubDeps, hub: string, credentials: Credentials, project: string) =>
  machineJson<HistoryAttestations>(deps, hub, credentials, historyAttestationsPath(project), `the attestations of ${project}`);

/** Posts an attestation: `kept` (201) or `held` (200), else the hub's refusal as `<status> <error>`. */
export async function postAttestation(deps: HubDeps, hub: string, credentials: Credentials, record: Signed<HistoryAttestation>): Promise<{ ok: true } | { ok: false; refusal: string }> {
  const response = await hubRequest(deps, hub, historyAttestationsPath(record.body.project), { credentials, body: { record } });
  if (response.status === 200 || response.status === 201) {
    await response.body?.cancel();
    return { ok: true };
  }
  return { ok: false, refusal: `${response.status} ${await refusalOf(response)}` };
}
