// The page's requests (§P). The exchange of a code carries no credential and is not gated. Every request that carries
// the credential asks the live connection first, at that moment, which pairing it proved (T28), and sends that pairing's
// credential and no other: where none is proven, the request is not made and the caller is told so, as it is told of a
// network failure. The credential goes in an
// `Authorization: Bearer` header, never a cookie (`credentials: 'omit'`) and never in the address. The sheet's own (§N):
// a session's model and the door's state, a Send's inbox lines, a body as text or an image's bytes, and a pasted
// image's bytes; each answer is held to its shape before the page uses it.
import { DoorStateSchema, type DoorState } from '@shared/ipc/schema/sheet';
import { SheetImageTypeSchema, SheetModelSchema, SheetPutResultSchema, type SheetBody, type SheetBodyRequest, type SheetImageType, type SheetLine, type SheetModel, type SheetPutResult } from '@shared/sheet/model';
import { isPairing, type StoredPairing } from './credential';
import { SEND } from './copy';

export type PairAnswer =
  | { ok: true; id: string; credential: string }
  | { ok: false; why: 'wrong'; left: number }
  | { ok: false; why: 'expired' | 'none' | 'busy' | 'not-saved' | 'failed' };

export type Done = { ok: true } | { ok: false; why: 'unproven' | 'not-saved' | 'failed' };

export type ReadAnswer = { ok: true; model: SheetModel | null; door: DoorState } | { ok: false; why: 'unproven' | 'unavailable' | 'failed' };
export type UploadAnswer = { ok: true; path: string } | { ok: false; why: string };

export interface Api {
  pair(code: string): Promise<PairAnswer>;
  unpair(expected?: StoredPairing): Promise<Done>; // `expected`: made only while the live proof is that pairing's
  read(session: string): Promise<ReadAnswer>;
  put(session: string, lines: SheetLine[]): Promise<SheetPutResult>; // not made, a failure, a 5xx or no answer in time: `failed`
  body(session: string, of: SheetBodyRequest): Promise<SheetBody>; // rejects where it could not be asked or read
  upload(session: string, image: { mediaType: SheetImageType; bytes: Uint8Array }): Promise<UploadAnswer>;
}

export const PUT_WAIT_MS = 30_000; // a Send with no answer by then failed, and is offered again under the same keys
export const UNPAIR_WAIT_MS = 10_000; // an Unpair with no answer by then is not confirmed (the pairing is forgotten already)
const sheetPath = (session: string) => `/api/sheets/${encodeURIComponent(session)}`;
const bodyQuery = (of: SheetBodyRequest) => ('ref' in of ? `ref=${of.ref}` : 'text' in of ? `text=${of.text}` : `upload=${encodeURIComponent(of.upload.slice('uploads/'.length))}`);
const failed = (message: string): SheetPutResult => ({ ok: false, why: 'failed', message });

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface ApiDeps {
  proven(): StoredPairing | null; // the pairing the live connection proved, read at each request
  leaving?(): boolean; // the page is going (a reload, a close): a Send cut off by it settles nothing
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

  // A request that carries the credential, made only on a proven connection, and, where `expected` is named, only while
  // that connection proved that very pairing
  async function authorized(url: string, init: RequestInit, expected?: StoredPairing): Promise<Response | 'unproven'> {
    const pairing = deps.proven();
    if (pairing === null || (expected !== undefined && (expected.id !== pairing.id || expected.credential !== pairing.credential))) return 'unproven';
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

    async unpair(expected) {
      // one deadline for the whole of it, the body of a refusal included
      const gave = new AbortController();
      const timer = setTimeout(() => gave.abort(), UNPAIR_WAIT_MS);
      try {
        let response: Response | 'unproven';
        try {
          response = await authorized('/api/unpair', { method: 'POST', signal: gave.signal }, expected);
        } catch {
          return { ok: false, why: 'failed' };
        }
        if (response === 'unproven') return { ok: false, why: 'unproven' };
        if (response.status === 204) return { ok: true };
        if (response.status === 500 && (await read(response)).why === 'not-saved') return { ok: false, why: 'not-saved' };
        return { ok: false, why: 'failed' };
      } finally {
        clearTimeout(timer);
      }
    },

    async read(session) {
      let response: Response | 'unproven';
      try {
        response = await authorized(sheetPath(session), { method: 'GET' });
      } catch {
        return { ok: false, why: 'failed' };
      }
      if (response === 'unproven') return { ok: false, why: 'unproven' };
      if (response.status === 503) return { ok: false, why: 'unavailable' };
      if (response.status !== 200) return { ok: false, why: 'failed' };
      const body = await read(response);
      const model = body.model === null ? { success: true as const, data: null } : SheetModelSchema.safeParse(body.model);
      const door = DoorStateSchema.safeParse(body.door);
      return model.success && door.success ? { ok: true, model: model.data, door: door.data } : { ok: false, why: 'failed' };
    },

    async put(session, lines) {
      let response: Response | 'unproven';
      try {
        response = await authorized(`${sheetPath(session)}/put`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }), signal: AbortSignal.timeout(PUT_WAIT_MS) });
      } catch {
        // A request the page's own going cut off is not a failure to record: its stored Send stays in flight, and the
        // next window offers it again past the door's limit (availability.ts), under the same keys
        if (deps.leaving?.()) return new Promise<SheetPutResult>(() => {});
        return failed(SEND.noAnswer);
      }
      if (response === 'unproven') return failed(SEND.notConnected);
      if (response.status !== 200) return failed(SEND.noAnswer);
      const result = SheetPutResultSchema.safeParse(await read(response));
      return result.success ? result.data : failed(SEND.noAnswer);
    },

    async body(session, of) {
      const response = await authorized(`${sheetPath(session)}/body?${bodyQuery(of)}`, { method: 'GET' });
      if (response === 'unproven') throw new Error('not connected');
      if (response.status === 404) return { kind: 'gone' };
      if (response.status !== 200) throw new Error(`answered ${response.status}`);
      const type = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
      if (type === 'text/plain') return { kind: 'text', text: await response.text() };
      const image = SheetImageTypeSchema.safeParse(type);
      if (!image.success) return { kind: 'gone' }; // rule 4: no other type is a body
      return { kind: 'image', mediaType: image.data, data: base64(new Uint8Array(await response.arrayBuffer())) };
    },

    async upload(session, image) {
      let response: Response | 'unproven';
      try {
        response = await authorized(`${sheetPath(session)}/uploads`, { method: 'POST', headers: { 'Content-Type': image.mediaType }, body: image.bytes.slice().buffer });
      } catch {
        return { ok: false, why: SEND.imageNotSaved };
      }
      if (response === 'unproven' || response.status !== 200) return { ok: false, why: SEND.imageNotSaved };
      const body = await read(response);
      if (body.ok === true && typeof body.path === 'string') return { ok: true, path: body.path };
      return { ok: false, why: typeof body.why === 'string' ? body.why : SEND.imageNotSaved };
    },
  };
}
