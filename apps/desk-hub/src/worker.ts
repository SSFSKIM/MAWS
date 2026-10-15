// The hub's Worker: verifies Access's assertion on every request, asks the org's Registry who it names, and routes to
// the object that serves the path. Nothing behind it trusts a header it did not set. The one path that takes no
// assertion is enrollment's redemption (`/machine/enroll`), which Access does not guard either: its one-time token
// does. Every path it answers is under `/api/*` or `/machine/*`, the routes wrangler.jsonc runs it first for; the web
// app's assets answer the rest.
import { hubConfig, MACHINE_HEADER, MEMBER_HEADER, ORG_HEADER, PROJECT_HEADER, type Env } from './env';
import { AccessError, certsKeySource, verifyAccessAssertion, type KeySource } from './identity/access';
import type { Principal, Registry, Result } from './objects/registry';
import { PUSH_KEY_PATH, PUSH_SUBSCRIPTIONS_PATH, REDEEM_PATH } from './protocol/identity';
import { POST_LIMIT } from './protocol/machine';

export { Machine } from './objects/machine';
export { Project } from './objects/project';
export { Registry } from './objects/registry';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROJECT_SOCKET = new RegExp(`^/api/projects/(${UUID})/socket$`);
const PROJECT_ARCHIVE = new RegExp(`^/api/projects/(${UUID})/archive$`);
const MACHINE_PATH = /^\/api\/machines\/([^/]+)$/;
/** A JSON body of an endpoint other than the machine's POST is small. */
const BODY_LIMIT = 64 * 1024;

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
  result.ok ? json(status, result.value) : json(result.status, { error: result.error, ...(result.message ? { message: result.message } : {}) });

/** A small JSON body; undefined when it is missing, too large, or not JSON (the callee answers `bad-shape`). */
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get('Content-Length') ?? 0) > BODY_LIMIT) return undefined;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > BODY_LIMIT) return undefined;
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
  for (const header of [MEMBER_HEADER, PROJECT_HEADER, ORG_HEADER, MACHINE_HEADER]) forwarded.headers.delete(header);
  for (const [header, value] of Object.entries(identity)) forwarded.headers.set(header, value);
  return forwarded;
}

export default {
  async fetch(request, env): Promise<Response> {
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
    return principal.kind === 'member' ? member(request, url, env, registry, principal) : machine(request, url, env, principal);
  },
} satisfies ExportedHandler<Env>;

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
  if (pathname === PUSH_KEY_PATH && method === 'GET') return json(200, await registry.pushKey());
  if (pathname === PUSH_SUBSCRIPTIONS_PATH) {
    if (method === 'GET') return json(200, await registry.pushSubscriptions(you));
    if (method === 'PUT') return answer(await registry.keepPushSubscription(you, await body(request)));
    if (method === 'DELETE') return answer(await registry.deletePushSubscription(you, await body(request)));
  }
  if (pathname === '/api/registry/socket' && method === 'GET') {
    return registry.fetch(forward(request, 'https://registry/grid', { [MEMBER_HEADER]: you.id, [ORG_HEADER]: principal.org.id }));
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

async function machine(request: Request, url: URL, env: Env, principal: Extract<Principal, { kind: 'machine' }>): Promise<Response> {
  const stub = env.MACHINE.get(env.MACHINE.idFromName(`${principal.org.id}:${principal.machine.name}`));
  const identity = { [ORG_HEADER]: principal.org.id, [MACHINE_HEADER]: principal.machine.name };
  if (url.pathname === '/machine/stream' && request.method === 'GET') return stub.fetch(forward(request, 'https://machine/stream', identity));
  if (url.pathname === '/machine/frames' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') ?? 0) > POST_LIMIT) return json(413, { error: 'too-large' });
    return stub.fetch(forward(request, 'https://machine/frames', identity));
  }
  return json(404, { error: 'not-found' });
}
