// The page's requests (§P). The exchange of a code carries no credential and is not gated. Every request that carries
// the credential asks the live connection first, at that moment, which pairing it proved (T28), and sends that pairing's
// credential and no other: where none is proven, the request is not made and the caller is told so, as it is told of a
// network failure. The credential goes in an
// `Authorization: Bearer` header, never a cookie (`credentials: 'omit'`) and never in the address. The sheet's reads and
// writes join in M4.
import { isPairing, type StoredPairing } from './credential';

export type PairAnswer =
  | { ok: true; id: string; credential: string }
  | { ok: false; why: 'wrong'; left: number }
  | { ok: false; why: 'expired' | 'none' | 'busy' | 'not-saved' | 'failed' };

export type Done = { ok: true } | { ok: false; why: 'unproven' | 'not-saved' | 'failed' };

export interface Api {
  pair(code: string): Promise<PairAnswer>;
  unpair(): Promise<Done>;
}

export interface ApiDeps {
  proven(): StoredPairing | null; // the pairing the live connection proved, read at each request
  fetch?: typeof fetch;
}

const REFUSED_CODE = new Set(['expired', 'none']);

export function createApi(deps: ApiDeps): Api {
  const send = (url: string, init: RequestInit) => (deps.fetch ?? fetch)(url, { ...init, credentials: 'omit', cache: 'no-store' });
  const read = async (response: Response): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = await response.json();
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  // A request that carries the credential, made only on a proven connection
  async function authorized(url: string, init: RequestInit): Promise<Response | 'unproven'> {
    const pairing = deps.proven();
    if (pairing === null) return 'unproven';
    return send(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${pairing.credential}` } });
  }

  return {
    async pair(code) {
      let response: Response;
      try {
        response = await send('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      } catch {
        return { ok: false, why: 'failed' };
      }
      const body = await read(response);
      if (response.status === 200) return isPairing(body) ? { ok: true, id: body.id, credential: body.credential } : { ok: false, why: 'failed' };
      if (response.status === 403 && body.why === 'wrong' && typeof body.left === 'number') return { ok: false, why: 'wrong', left: body.left };
      if (response.status === 403 && REFUSED_CODE.has(body.why as string)) return { ok: false, why: body.why as 'expired' | 'none' };
      if (response.status === 429 && body.why === 'busy') return { ok: false, why: 'busy' };
      if (response.status === 503 && body.why === 'not-saved') return { ok: false, why: 'not-saved' };
      return { ok: false, why: 'failed' };
    },

    async unpair() {
      let response: Response | 'unproven';
      try {
        response = await authorized('/api/unpair', { method: 'POST' });
      } catch {
        return { ok: false, why: 'failed' };
      }
      if (response === 'unproven') return { ok: false, why: 'unproven' };
      if (response.status === 204) return { ok: true };
      if (response.status === 500 && (await read(response)).why === 'not-saved') return { ok: false, why: 'not-saved' };
      return { ok: false, why: 'failed' };
    },
  };
}
