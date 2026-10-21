// The stand-in's code helpers, for a machine-side developer with no web app: an enrollment code and a provisioning code
// built as the browser builds them, the hub asked for the token or the key as the admin through the stand-in, and the
// code made here around a fresh org key (or the `key` given), so the hub still never sees an org key. Served by the
// local command's proxy and by the suites' (test/support/local.ts). Node only, loaded by its type stripping.
import { randomBytes } from 'node:crypto';
import { enrollmentCode, IDENTITY_HEADER, provisioningCode, type AccessStandin } from './standin.ts';

export type HelperOptions = {
  /** The stand-in's own URL, which the helpers ask the hub through and which the codes name; read on every request. */
  origin: () => string;
  org: string;
  standin: AccessStandin;
  /** Whom the helpers ask the hub as, when the request names nobody and the stand-in signs nobody in by default. */
  admin: string;
};

const refused = (message: string) => Response.json({ error: 'bad-shape', message }, { status: 400 });

/** The proxy's `extra`: answers `POST /standin/enrollment-code` and `POST /standin/provisioning-code`; null otherwise. */
export function codeHelpers(options: HelperOptions): (request: Request) => Promise<Response | null> {
  const asHub = async (request: Request, path: string, body: unknown) => {
    const user = request.headers.get(IDENTITY_HEADER) ?? options.standin.defaultUser ?? options.admin;
    return fetch(`${options.origin()}${path}`, { method: 'POST', headers: { [IDENTITY_HEADER]: user, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };
  const passOn = async (response: Response) => new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });

  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST') return null;
    if (pathname === '/standin/enrollment-code') {
      const body = (await request.json().catch(() => ({}))) as { machine?: unknown; key?: string; ttl_s?: number };
      if (typeof body.machine !== 'string') return refused('the body is {machine, key?, ttl_s?}');
      const issued = await asHub(request, '/api/enrollments', body.ttl_s === undefined ? {} : { ttl_s: body.ttl_s });
      if (issued.status !== 201) return passOn(issued);
      const { token } = (await issued.json()) as { token: string };
      const key = body.key ?? randomBytes(32).toString('base64url');
      return Response.json({ code: enrollmentCode({ hub: options.origin(), org: options.org, token, machine: body.machine, key }), key, token });
    }
    if (pathname === '/standin/provisioning-code') {
      const body = (await request.json().catch(() => ({}))) as { prefix?: unknown; label?: string; ttl_s?: number; max_uses?: number | null; offline_revoke_s?: number | null; key?: string };
      if (typeof body.prefix !== 'string') return refused('the body is {prefix, label?, ttl_s?, max_uses?, offline_revoke_s?, key?}');
      const { key: given, label = `stand-in ${body.prefix}`, ...bounds } = body;
      const issued = await asHub(request, '/api/provisioning-keys', { ...bounds, label });
      if (issued.status !== 201) return passOn(issued);
      const { key: record, token } = (await issued.json()) as { key: { id: string; prefix: string }; token: string };
      const key = given ?? randomBytes(32).toString('base64url');
      return Response.json({ code: provisioningCode({ hub: options.origin(), org: options.org, token, prefix: record.prefix, key }), key, id: record.id });
    }
    return null;
  };
}
