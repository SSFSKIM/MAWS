// The hub's Worker: verifies Access's assertion on every request, asks the org's Registry who it names, and routes to
// the object that serves the path. Nothing behind it trusts a header it did not set.
import { hubConfig, MACHINE_HEADER, MEMBER_HEADER, ORG_HEADER, PROJECT_HEADER, type Env } from './env';
import { AccessError, certsKeySource, verifyAccessAssertion, type KeySource } from './identity/access';
import type { Principal } from './objects/registry';

export { Machine } from './objects/machine';
export { Project } from './objects/project';
export { Registry } from './objects/registry';

const PROJECT_SOCKET = /^\/api\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/socket$/;

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
    let principal: Principal | null;
    try {
      const identity = await verifyAccessAssertion(request.headers.get('Cf-Access-Jwt-Assertion'), {
        issuer: config.issuer,
        audience: config.audience,
        keys: keysAt(config.certsUrl),
      });
      principal = await env.REGISTRY.get(env.REGISTRY.idFromName(config.org.id)).resolve(config.org, identity);
      if (!principal) return json(403, { error: identity.kind === 'human' ? 'not-a-member' : 'not-enrolled' });
    } catch (error) {
      if (error instanceof AccessError) return json(error.reason === 'missing' ? 401 : 403, { error: error.reason });
      throw error;
    }
    return principal.kind === 'member' ? member(request, env, principal) : machine(request, env, principal);
  },
} satisfies ExportedHandler<Env>;

async function member(request: Request, env: Env, principal: Extract<Principal, { kind: 'member' }>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/me' && request.method === 'GET') return json(200, { org: principal.org, member: principal.member });
  const socket = PROJECT_SOCKET.exec(url.pathname);
  if (socket && request.method === 'GET') {
    const project = socket[1];
    const stub = env.PROJECT.get(env.PROJECT.idFromName(`${principal.org.id}:${project}`));
    return stub.fetch(forward(request, 'https://project/socket', { [MEMBER_HEADER]: principal.member.id, [PROJECT_HEADER]: project }));
  }
  return json(404, { error: 'not-found' });
}

async function machine(request: Request, env: Env, principal: Extract<Principal, { kind: 'machine' }>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/machine/stream' && request.method === 'GET') {
    const stub = env.MACHINE.get(env.MACHINE.idFromName(`${principal.org.id}:${principal.machine.name}`));
    return stub.fetch(forward(request, 'https://machine/stream', { [ORG_HEADER]: principal.org.id, [MACHINE_HEADER]: principal.machine.name }));
  }
  return json(404, { error: 'not-found' });
}
