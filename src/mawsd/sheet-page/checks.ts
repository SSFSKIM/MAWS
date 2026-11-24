// The three checks, request by request (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §L; §8.2's
// rules 1 and 2, T7). Pure: a request's method, target and raw headers in, a refusal or a route out. The order is fixed
// and each check runs only if the one before passed: the count of headers (§J), then Host, then the route and its
// method, then Origin, then the credential. (The body's bound is the handler's, as the body arrives.)
//
// Every check reads `rawHeaders`, which keeps each header as it came: Node's parsed `headers` keeps one of a repeated
// Host or Authorization and drops the rest. The parser is told one header more than HEADERS_MAX (serve.ts), so a list
// longer than the bound is refused whole and a list these checks read is never one the parser cut.
//
// Rule 2, read for a browser: a browser sends an Origin on every POST and every WebSocket handshake, so the writes and
// the live connection require exactly the page's; it sends none on a same-origin GET, so a read cannot require one (the
// sheet's reads, M3, refuse only another's), and a navigation carries none: the shell stands on the Host alone.
import { HEADERS_MAX, pageOrigin, refusal, SHEET_HOST, type Refusal } from './headers';

export { HEADERS_MAX, pageOrigin, type Refusal };

export type Route = { kind: 'shell' } | { kind: 'file'; path: string } | { kind: 'pair' } | { kind: 'unpair' } | { kind: 'live' };

export interface Asked {
  method: string;
  target: string;
  rawHeaders: readonly string[];
  upgrade: boolean; // the request arrived as an upgrade (Node's 'upgrade' event)
}

export interface Admitted {
  route: Route;
  credential: string | null; // the Bearer credential, for a route that requires one; the handler checks it is known
}

// Each value of the header `name` (case folded), in arrival order.
function valuesOf(rawHeaders: readonly string[], name: string): string[] {
  const found: string[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) if (rawHeaders[i]!.toLowerCase() === name) found.push(rawHeaders[i + 1]!);
  return found;
}

// Exactly one Host header, equal to `sheet.localhost:<port>`, case folded; nothing else.
export function hostPasses(rawHeaders: readonly string[], port: number): boolean {
  const hosts = valuesOf(rawHeaders, 'host');
  return hosts.length === 1 && hosts[0]!.toLowerCase() === `${SHEET_HOST}:${port}`;
}

// 'null' and a repeated header are 'other'.
export function originOf(rawHeaders: readonly string[], port: number): 'absent' | 'page' | 'other' {
  const origins = valuesOf(rawHeaders, 'origin');
  if (origins.length === 0) return 'absent';
  return origins.length === 1 && origins[0]!.toLowerCase() === pageOrigin(port) ? 'page' : 'other';
}

const BEARER = /^bearer ([A-Za-z0-9_-]{43})$/i; // the credential: 32 bytes in base64url, unpadded (T9)

// The one Authorization header, scheme Bearer; two are none; never a cookie, never the target.
export function bearerOf(rawHeaders: readonly string[]): string | null {
  const values = valuesOf(rawHeaders, 'authorization');
  if (values.length !== 1) return null;
  return BEARER.exec(values[0]!)?.[1] ?? null;
}

// A target that is not origin-form (it does not start with '/') is refused. The query is dropped: the page reads its
// path and nothing else (T20).
export function routeOf(method: string, target: string): Route | Refusal {
  if (!target.startsWith('/')) return refusal(400);
  const path = target.split('?', 1)[0]!;
  const only = (allowed: string, route: Route): Route | Refusal => (method === allowed ? route : refusal(405));
  if (method !== 'GET' && method !== 'POST') return refusal(405); // OPTIONS among them: no preflight is ever allowed
  if (path === '/' || path.startsWith('/s/')) return only('GET', { kind: 'shell' });
  if (path === '/api/pair') return only('POST', { kind: 'pair' });
  if (path === '/api/unpair') return only('POST', { kind: 'unpair' });
  if (path === '/live') return only('GET', { kind: 'live' });
  if (path.startsWith('/api/')) return refusal(404);
  return only('GET', { kind: 'file', path });
}

const ORIGIN_REQUIRED: ReadonlySet<Route['kind']> = new Set(['pair', 'unpair', 'live']);
const CREDENTIAL_REQUIRED: ReadonlySet<Route['kind']> = new Set(['unpair']);

export function admit(asked: Asked, port: number): Admitted | Refusal {
  if (asked.rawHeaders.length / 2 > HEADERS_MAX) return refusal(431);
  if (!hostPasses(asked.rawHeaders, port)) return refusal(421);
  const route = routeOf(asked.method, asked.target);
  if ('status' in route) return route;
  if (asked.upgrade !== (route.kind === 'live')) return refusal(asked.upgrade ? 404 : 400);
  if (ORIGIN_REQUIRED.has(route.kind) && originOf(asked.rawHeaders, port) !== 'page') return refusal(403);
  if (!CREDENTIAL_REQUIRED.has(route.kind)) return { route, credential: null };
  const credential = bearerOf(asked.rawHeaders);
  return credential === null ? refusal(401) : { route, credential };
}
