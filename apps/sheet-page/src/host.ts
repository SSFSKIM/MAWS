// The page's SheetHost (§P; T17): what C3's components ask of a surface, answered through the page's requests (api.ts),
// each of which carries the credential only on a proven connection. A Send is one put, answered `failed` where it was
// not made, failed, met a 5xx or had no answer in 30 seconds, so C3's sheet offers the same lines again. A link opens in
// a new tab that has no opener. A pasted image is scaled as the app scales one, then uploaded; the record's service
// checks its bytes and writes it. A browser opens no file of the machine, so there is no `openFile`.
//
// Every write to the inbox (a Send, and a card's Dismiss and Take back, all of them `send`) is refused here while the
// model of the session on screen is not fresh (`writable`: from a connection's `paired` until the read after its
// `ready` is applied, T14), answered `failed` as a Send not made, so C3's sheet offers it again once it can. Editing a
// draft stays possible, a pasted image's upload included: it writes nothing the door reads until a Send names it.
import type { SheetImageType, SheetPutResult } from '@shared/sheet/model';
import { downscaleImage } from '../../../src/renderer/src/composer/editor/attachments';
import type { SheetHost } from '../../../src/renderer/src/sheet';
import type { Api } from './api';
import { SEND } from './copy';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 'page-' and 26 characters of base32 from 16 random bytes */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return `page-${out}`;
}

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

export function pageSheetHost(deps: {
  api: Api;
  downscale?: (blob: Blob, mediaType: string) => Promise<{ mediaType: string; data: string }>;
  open?: (url: string, target: string, features: string) => unknown;
  writable?: (session: string) => boolean; // the session is the one on screen and its model is fresh; a refusal reads as a Send made while no connection was proven
}): SheetHost {
  const { api } = deps;
  const writable = deps.writable ?? (() => true);
  const downscale = deps.downscale ?? downscaleImage;
  return {
    by: 'page',
    newKey,
    send: (session, lines) => (writable(session) ? api.put(session, lines) : Promise.resolve<SheetPutResult>({ ok: false, why: 'failed', message: SEND.notConnected })),
    openLink: (url) => void (deps.open ? deps.open(url, '_blank', 'noopener,noreferrer') : window.open(url, '_blank', 'noopener,noreferrer')),
    body: (session, of) => api.body(session, of),
    async saveImage(session, image) {
      let scaled: { mediaType: string; data: string };
      try {
        scaled = await downscale(new Blob([image.bytes.slice()], { type: image.mediaType }), image.mediaType);
      } catch {
        return { ok: false, why: SEND.imageNotSaved };
      }
      return api.upload(session, { mediaType: scaled.mediaType as SheetImageType, bytes: bytesOf(scaled.data) });
    },
  };
}
