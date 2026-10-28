// The hub's Worker: verifies Access's assertion on every request, asks the org's Registry who it names, and routes to
// the object that serves the path. Nothing behind it trusts a header it did not set. The one path that takes no
// assertion is enrollment's redemption (`/machine/enroll`), which Access does not guard either: its one-time token, or
// a provisioning key's secret, does. Every path it answers is under `/api/*` or `/machine/*`, the routes wrangler.jsonc runs it first for; the web
// app's assets answer the rest.
import {
  HISTORY_ATTESTATIONS_ROUTE,
  HISTORY_INVENTORY_PATH,
  HISTORY_LOG_ROUTE,
  HISTORY_NAMES_MAX,
  isMachineName,
  MEMBER_ATTESTATIONS_ROUTE,
  REGISTRY_APP_PARAM,
} from 'org-protocol';
import { drain, readLimited } from './drain';
import { CLIENT_HEADER, hubConfig, MACHINE_HEADER, MEMBER_HEADER, ORG_HEADER, PROJECT_HEADER, REF_HEADER, type Env } from './env';
import { AccessError, certsKeySource, verifyAccessAssertion, type KeySource } from './identity/access';
import type { Principal, Registry, Result } from './objects/registry';
import { relayObjectName } from './objects/relay';
import { lacksMethod } from './objects/retry';
import {
  CERT_RETIREMENTS_PATH,
  ENROLLMENT_KEY_PATH,
  LISTINGS_PATH,
  MACHINE_CERT_PATH,
  MACHINE_CERT_RETIREMENTS_PATH,
  MACHINE_ENDPOINT_PATH,
  MACHINE_KEY_PATH,
  MACHINE_ENROLLMENT_PATH,
  MACHINE_ORG_STATE_PATH,
  ORG_KEYS_PATH,
  ORG_KEYS_PURGE_PATH,
  ORG_STATE_PATH,
  ORG_TRANSITIONS_PATH,
  PENDING_DEVICES_PATH,
  PROVISIONING_KEYS_PATH,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  REDEEM_PATH,
  type MachineSelf,
  type PushSubscriptions,
} from './protocol/identity';
import { APP_SOCKET_PATH, MACHINE_SOCKET_PATH, POST_LIMIT } from './protocol/machine';
import { FRAME_LIMIT } from './protocol/parts';

export { Machine } from './objects/machine';
export { Project } from './objects/project';
export { Registry } from './objects/registry';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROJECT_SOCKET = new RegExp(`^/api/projects/(${UUID})/socket$`);
const PROJECT_ARCHIVE = new RegExp(`^/api/projects/(${UUID})/archive$`);
const MACHINE_PATH = /^\/api\/machines\/([^/]+)$/;
const ORG_KEY_PATH = /^\/api\/org\/keys\/([^/]+)$/;
const PROVISIONING_KEY_PATH = /^\/api\/provisioning-keys\/([^/]+)$/;
/** A JSON body of an endpoint other than the machine's POST is small. */
const BODY_LIMIT = 64 * 1024;
/** A signed org state grows with the org (members, devices, every machine name it ever held): it may take a frame. */
const STATE_LIMIT = FRAME_LIMIT;

// One key source per certificate URL for the isolate's life, so the team's keys are fetched once, not per request.
const keySources = new Map<string, KeySource>();
function keysAt(url: string): KeySource {
  let source = keySources.get(url);
  if (!source) {
    source = certsKeySource(async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Access certificates: ${response.status}`);
      return response.json();
    });
    keySources.set(url, source);
  }
  return source;
}

const json = (status: number, body: unknown) => Response.json(body, { status });
const answer = <T>(result: Result<T>, status = 200) =>
  result.ok
    ? json(status, result.value)
    : json(result.status, { error: result.error, ...(result.message ? { message: result.message } : {}), ...(result.conflicts ? { conflicts: result.conflicts } : {}) });
/** A record's keeping: `201` when it was kept, `200` when the same was held already. */
const kept = <T extends { stored: boolean } | { kept: boolean }>(result: Result<T>) =>
  answer(result, result.ok && ('stored' in result.value ? result.value.stored : result.value.kept) ? 201 : 200);

/** A small JSON body; undefined when it is missing, too large, or not JSON (the callee answers `bad-shape`). */
async function body(request: Request, limit = BODY_LIMIT): Promise<unknown> {
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) return undefined;
  const bytes = await readLimited(request.body, limit);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** The client's request, readdressed to an object, carrying the identity the Worker verified and no copy of it a
 * client sent; it keeps the client's signal, so the object sees the client go. */
function forward(request: Request, url: string, identity: Record<string, string>): Request {
  const forwarded = new Request(url, request);
  for (const header of [MEMBER_HEADER, PROJECT_HEADER, ORG_HEADER, MACHINE_HEADER, CLIENT_HEADER, REF_HEADER]) forwarded.headers.delete(header);
  for (const [header, value] of Object.entries(identity)) forwarded.headers.set(header, value);
  return forwarded;
}

/**
 * A ref the Registry resolved, or the answer when it could not: a Registry still on the code before RL1 (a deploy's
 * first minutes) lacks the method, and the client connects again.
 */
async function refFrom<T>(lookup: () => Promise<T>): Promise<T | Response> {
  try {
    return await lookup();
  } catch (error) {
    if (lacksMethod(error, 'machineRefOf') || lacksMethod(error, 'machineRefNamed')) return json(503, { error: 'hub-updating', message: 'connect again' });
    throw error;
  }
}

// The build, named by the deploy (`wrangler deploy --define DESK_BUILD:'"…"'`; deploy/deploy.ts names the hub's commit and
// the web app's), so a client can tell which code answered; `dev` for a bundle that named none (the suites, `local`).
declare const DESK_BUILD: string | undefined;
const BUILD = typeof DESK_BUILD === 'string' ? DESK_BUILD : 'dev';

/**
 * An exception out of an object call (Cloudflare's own when it resets or replaces an object, overloads it, or loses the
 * connection to it: "Durable Object reset because its code was updated", "Network connection lost", …), answered as
 * JSON rather than left to the runtime's bare 1101 page: 503 when the error says a retry may succeed, 500 otherwise. A
 * machine reconnects on either, as on any answer but 200; the line is the hub's record of it.
 */
function failure(error: unknown): Response {
  // A route this code added, reaching an object still on the code before it (a deploy reaches objects minutes after the
  // Worker): the client tries again once the object is updated.
  if (lacksMethod(error)) return json(503, { error: 'hub-updating', message: (error as Error).message });
  const e = error as { message?: unknown; retryable?: unknown; overloaded?: unknown } | null;
  const retryable = e?.retryable === true || e?.overloaded === true;
  const message = typeof e?.message === 'string' ? e.message : String(error);
  console.error(JSON.stringify({ desk: 'worker-exception', message, retryable, overloaded: e?.overloaded === true }));
  return json(retryable ? 503 : 500, { error: retryable ? 'hub-unavailable' : 'hub-error', message });
}

/** A Registry method this code added, or, from a Registry still on the code before it, what its older method answers. */
async function orOlder<T>(call: () => Promise<T>, method: string, older: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (lacksMethod(error, method)) return older();
    throw error;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      response = failure(error);
    }
    if (request.body && !request.bodyUsed) await drain(request.body);
    // A WebSocket's upgrade (its socket rides on the answer) and a machine's stream are passed on untouched, as before
    // the build was named: re-wrapping the stream's body would put a pipe of the Worker's between the client and the
    // Machine object, whose close detection M1's probe measured without one. Every other answer names the build.
    if (response.status === 101 || response.headers.get('Content-Type') === 'text/event-stream') return response;
    const named = new Response(response.body, response);
    named.headers.set('X-Desk-Build', BUILD);
    return named;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const config = hubConfig(env);
  if (!config) return json(503, { error: 'not-configured' });
  const registry = env.REGISTRY.get(env.REGISTRY.idFromName(config.org.id));
  const url = new URL(request.url);
  if (url.pathname === REDEEM_PATH) {
    return request.method === 'POST' ? answer(await registry.redeem(await body(request))) : json(405, { error: 'method-not-allowed' });
  }
  let principal: Principal | null;
  try {
    const identity = await verifyAccessAssertion(request.headers.get('Cf-Access-Jwt-Assertion'), {
      issuer: config.issuer,
      audience: config.audience,
      keys: keysAt(config.certsUrl),
    });
    principal = await registry.resolve(identity);
    if (!principal) return json(403, { error: identity.kind === 'human' ? 'not-a-member' : 'not-enrolled' });
  } catch (error) {
    if (error instanceof AccessError) return json(error.reason === 'missing' ? 401 : 403, { error: error.reason });
    throw error;
  }
  return principal.kind === 'member' ? member(request, url, env, registry, principal) : machine(request, url, env, registry, principal);
}

/** The Project object of a project the Registry holds, or the `404 unknown-project` to answer. */
async function projectStub(env: Env, registry: DurableObjectStub<Registry>, org: string, project: string) {
  if (!(await registry.project(project))) return json(404, { error: 'unknown-project' });
  return env.PROJECT.get(env.PROJECT.idFromName(`${org}:${project}`));
}

/** `?names=` of the history inventory: one to HISTORY_NAMES_MAX machine names, comma-separated; null otherwise. */
function historyNames(param: string | null): string[] | null {
  if (param === null) return null;
  const names = param.split(',');
  return names.length <= HISTORY_NAMES_MAX && names.every(isMachineName) ? names : null;
}

/** `?writer=&after=` of a writer's log page: a `<name>/<feed>` writer and a seq from 0 (0 when absent); null otherwise. */
function historyQuery(url: URL): { writer: string; after: number } | null {
  const writer = url.searchParams.get('writer');
  const after = url.searchParams.get('after') ?? '0';
  if (writer === null || writer.length > 256 || !/^[^/]+\/.+$/.test(writer) || !/^(0|[1-9][0-9]{0,15})$/.test(after) || !Number.isSafeInteger(Number(after))) return null;
  return { writer, after: Number(after) };
}

async function member(request: Request, url: URL, env: Env, registry: DurableObjectStub<Registry>, principal: Extract<Principal, { kind: 'member' }>): Promise<Response> {
  const { pathname } = url;
  const { method } = request;
  const you = principal.member;
  if (pathname === '/api/me' && method === 'GET') return json(200, { org: principal.org, member: you });
  if (pathname === '/api/enrollments' && method === 'POST') return answer(await registry.createEnrollment(you, await body(request)), 201);
  if (pathname === '/api/machines' && method === 'GET') return json(200, { machines: await registry.machines() });
  if (pathname === '/api/projects' && method === 'GET') return json(200, { projects: await registry.projects() });
  const revoke = MACHINE_PATH.exec(pathname);
  if (revoke && method === 'DELETE') return answer(await registry.revoke(you, decodeURIComponent(revoke[1])));
  const archive = PROJECT_ARCHIVE.exec(pathname);
  if (archive && method === 'PUT') return answer(await registry.designateArchive(you, archive[1], await body(request)));
  if (pathname === ORG_KEYS_PATH && method === 'GET') {
    const listed = await orOlder<Result<unknown>>(async () => await registry.wrappedOrgKeys(), 'wrappedOrgKeys', async () => ({ ok: true, value: await registry.orgKeys() }));
    return answer(listed);
  }
  if (pathname === ORG_KEYS_PURGE_PATH && method === 'POST') return answer(await registry.purgeOrgKeys(you));
  if (pathname === ORG_KEYS_PATH && method === 'POST') return answer(await registry.addOrgKey(you, await body(request)), 201);
  const orgKey = ORG_KEY_PATH.exec(pathname);
  if (orgKey && method === 'DELETE') return answer(await registry.removeOrgKey(you, orgKey[1], await body(request)));
  if (pathname === PROVISIONING_KEYS_PATH && method === 'GET') return json(200, { keys: await registry.provisioningKeys() });
  if (pathname === PROVISIONING_KEYS_PATH && method === 'POST') return answer(await registry.createProvisioningKey(you, await body(request)), 201);
  const provisioningKey = PROVISIONING_KEY_PATH.exec(pathname);
  if (provisioningKey && method === 'DELETE') return answer(await registry.revokeProvisioningKey(you, decodeURIComponent(provisioningKey[1])));
  if (pathname === ORG_STATE_PATH && method === 'GET') return answer(await registry.orgState(url.searchParams.get('since')));
  if (pathname === ORG_STATE_PATH && method === 'POST') return answer(await registry.submitState(you, await body(request, STATE_LIMIT)), 201);
  if (pathname === ORG_TRANSITIONS_PATH && method === 'POST') return answer(await registry.submitTransition(you, await body(request)), 201);
  const enrollmentKey = ENROLLMENT_KEY_PATH.exec(pathname);
  if (enrollmentKey && method === 'GET') return answer(await registry.enrollmentKey(you, enrollmentKey[1]));
  if (pathname === CERT_RETIREMENTS_PATH && method === 'POST') return kept(await registry.memberRetiresCert(you, await body(request)));
  if (pathname === LISTINGS_PATH && method === 'GET') return answer(await registry.listings(you, url.searchParams.get('project')));
  const endpoint = MACHINE_ENDPOINT_PATH.exec(pathname);
  if (endpoint && method === 'GET') return answer(await registry.machineEndpoint(you, decodeURIComponent(endpoint[1])));
  if (pathname === PENDING_DEVICES_PATH && method === 'GET') return answer(await registry.pendingDevices(you));
  if (pathname === PENDING_DEVICES_PATH && method === 'POST') return answer(await registry.keepPendingDevice(you, await body(request)), 201);
  if (pathname === PUSH_KEY_PATH && method === 'GET') return json(200, await registry.pushKey());
  if (pathname === PUSH_SUBSCRIPTIONS_PATH) {
    if (method === 'GET') {
      const listed = await orOlder<Result<PushSubscriptions>>(
        async () => await registry.memberPushSubscriptions(you),
        'memberPushSubscriptions',
        async () => ({ ok: true, value: await registry.pushSubscriptions(you) }),
      );
      return answer(listed);
    }
    if (method === 'PUT') return answer(await registry.keepPushSubscription(you, await body(request)));
    if (method === 'DELETE') return answer(await registry.deletePushSubscription(you, await body(request)));
  }
  if (pathname === '/api/registry/socket' && method === 'GET') {
    // An app's socket (`?app=1`, O11 M7) is told so: it gets the app's frames beside the grid.
    const app = url.searchParams.get(REGISTRY_APP_PARAM) === '1' ? `?${REGISTRY_APP_PARAM}=1` : '';
    return registry.fetch(forward(request, `https://registry/grid${app}`, { [MEMBER_HEADER]: you.id, [ORG_HEADER]: principal.org.id }));
  }
  // An app's socket to a machine (O11 M6): channels, relayed by the object its ref addresses.
  const appSocket = APP_SOCKET_PATH.exec(pathname);
  if (appSocket && method === 'GET') {
    const ref = await refFrom(() => registry.machineRefNamed(decodeURIComponent(appSocket[1])));
    if (ref instanceof Response) return ref;
    if (ref === null) return json(404, { error: 'unknown-machine' });
    const stub = env.MACHINE.get(env.MACHINE.idFromName(relayObjectName(principal.org.id, ref)));
    return stub.fetch(forward(request, 'https://machine/app', { [MEMBER_HEADER]: you.id, [ORG_HEADER]: principal.org.id, [REF_HEADER]: ref }));
  }
  // A project's history attestations (O14 M4), for the readers that draw migrated history.
  const attested = MEMBER_ATTESTATIONS_ROUTE.exec(pathname);
  if (attested && method === 'GET') {
    const stub = await projectStub(env, registry, principal.org.id, attested[1]);
    return stub instanceof Response ? stub : json(200, { records: await stub.attestations() });
  }
  const socket = PROJECT_SOCKET.exec(pathname);
  if (socket && method === 'GET') {
    const project = socket[1];
    if (!(await registry.project(project))) return json(404, { error: 'unknown-project' });
    const stub = env.PROJECT.get(env.PROJECT.idFromName(`${principal.org.id}:${project}`));
    return stub.fetch(
      forward(request, 'https://project/socket', { [MEMBER_HEADER]: you.id, [PROJECT_HEADER]: project, [ORG_HEADER]: principal.org.id }),
    );
  }
  return json(404, { error: 'not-found' });
}

async function machine(request: Request, url: URL, env: Env, registry: DurableObjectStub<Registry>, principal: Extract<Principal, { kind: 'machine' }>): Promise<Response> {
  // The machine's own enrollment: its record as resolved (resolving confirmed a pending one), or its own revocation,
  // bound to the enrollment resolved, not to the name.
  if (url.pathname === MACHINE_ENROLLMENT_PATH) {
    const { org, machine: self } = principal;
    if (request.method === 'GET') return json(200, { org: org.id, machine: self.name, state: self.state, confirmed: self.confirmed } satisfies MachineSelf);
    if (request.method === 'DELETE') return answer(await registry.leave(self));
  }
  // The org state, as members read it: RL1's `state {version}` notice sends an endpoint here.
  if (url.pathname === MACHINE_ORG_STATE_PATH && request.method === 'GET') return answer(await registry.orgState(url.searchParams.get('since')));
  // Hub v2's enrollment (O11 M4): the machine's own key, or a delegated machine's certificate, and a certificate's
  // retirement by its delegation's key.
  if (request.method === 'POST' && url.pathname === MACHINE_KEY_PATH) return kept(await registry.keepMachineKey(principal.machine, await body(request)));
  if (request.method === 'POST' && url.pathname === MACHINE_CERT_PATH) return kept(await registry.storeCert(principal.machine, await body(request)));
  if (request.method === 'POST' && url.pathname === MACHINE_CERT_RETIREMENTS_PATH) return kept(await registry.machineRetiresCert(principal.machine, await body(request)));
  // History re-attestation (O14 M4, Interfaces §D): the inventory of the machine's DX1 writers, a writer's stored events,
  // and the attestations each project keeps.
  if (url.pathname === HISTORY_INVENTORY_PATH && request.method === 'GET') {
    const names = historyNames(url.searchParams.get('names'));
    if (names === null) return json(400, { error: 'bad-shape', message: `?names= is one to ${HISTORY_NAMES_MAX} machine names, comma-separated` });
    return json(200, await registry.historyInventory(names));
  }
  const historyLog = HISTORY_LOG_ROUTE.exec(url.pathname);
  if (historyLog && request.method === 'GET') {
    const query = historyQuery(url);
    if (query === null) return json(400, { error: 'bad-shape', message: '?writer= is <machine>/<feed> and ?after= a seq from 0' });
    const stub = await projectStub(env, registry, principal.org.id, historyLog[1]);
    return stub instanceof Response ? stub : json(200, await stub.historyPage(query.writer, query.after));
  }
  const attestations = HISTORY_ATTESTATIONS_ROUTE.exec(url.pathname);
  if (attestations && (request.method === 'GET' || request.method === 'POST')) {
    const stub = await projectStub(env, registry, principal.org.id, attestations[1]);
    if (stub instanceof Response) return stub;
    if (request.method === 'GET') return json(200, { records: await stub.attestations() });
    const posted = (await body(request)) as { record?: unknown } | undefined;
    return kept(await stub.keepAttestation(principal.org.id, attestations[1], typeof posted === 'object' && posted !== null ? posted.record : undefined));
  }
  const identity = { [ORG_HEADER]: principal.org.id, [MACHINE_HEADER]: principal.machine.name, [CLIENT_HEADER]: principal.machine.client_id ?? '' };
  // RL1 (O11 M6): the endpoint's one socket, held by the object its ref addresses; its ref is the hub's own record of
  // this machine, never the client's word.
  if (url.pathname === MACHINE_SOCKET_PATH && request.method === 'GET') {
    const found = await refFrom(async () => {
      const resolved = await registry.machineRefOf(principal.machine);
      return 'error' in resolved ? { error: resolved.error } : { ref: resolved.ref };
    });
    if (found instanceof Response) return found;
    if ('error' in found) {
      return json(409, {
        error: found.error,
        message:
          found.error === 'no-ref'
            ? 'RL1 needs the machine’s ref: post its key (POST /machine/key) or its certificate (POST /machine/cert) first'
            : 'the org state lists no machine of this name: RL1 serves a machine once an admin lists its key',
      });
    }
    const relay = env.MACHINE.get(env.MACHINE.idFromName(relayObjectName(principal.org.id, found.ref)));
    return relay.fetch(forward(request, 'https://machine/socket', { ...identity, [REF_HEADER]: found.ref }));
  }
  // DX2 is the phase-1 transport: a credential its enrollment's key post marked v2 never opens it (O14 M5a), so the
  // credential a re-enrollment mints carries nothing but RL1 until its machine is listed.
  if (principal.v2 && ((url.pathname === '/machine/stream' && request.method === 'GET') || (url.pathname === '/machine/frames' && request.method === 'POST'))) {
    return json(403, { error: 'v2-credential', message: 'this credential belongs to a v2 enrollment (its machine key is posted): it connects over RL1 (/machine/socket), never DX2' });
  }
  const stub = env.MACHINE.get(env.MACHINE.idFromName(`${principal.org.id}:${principal.machine.name}`));
  if (url.pathname === '/machine/stream' && request.method === 'GET') return stub.fetch(forward(request, 'https://machine/stream', identity));
  if (url.pathname === '/machine/frames' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') ?? 0) > POST_LIMIT) return json(413, { error: 'too-large' });
    return stub.fetch(forward(request, 'https://machine/frames', identity));
  }
  return json(404, { error: 'not-found' });
}
