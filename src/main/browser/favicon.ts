// Favicons (E4a execution document, Design §7; Decision Log 13): a page names its icon URLs (`page-favicon-updated`);
// main fetches them in order on the tab's own partition (so the request carries the partition's cookies as the page's
// would), each within a deadline and a size bound, until one is an image, and hands the chrome a `data:` URL of the
// icon's original bytes, since the app's CSP admits only `data:` images and ICO and SVG, which most sites serve, decode
// in an `<img>` but not through `nativeImage` (an SVG in image context runs no script). The format is the bytes' own,
// read by signature; a body that is not one of the six formats is no icon, whatever its content type says. Definitive
// answers, misses included, are cached per (partition, icon URL), least recently used first out; a failure that may
// pass (a throw, the deadline, a 5xx) is tried again next time.
//
// cua #90: the icon a lookup answers for a page is also kept by the page's origin (per partition, the last
// FAVICON_CACHE_MAX origins), so the bookmarks bar can show the icon of a site the partition has shown, never fetching
// one for a bookmark that was never visited (a bar of a hundred bookmarks must not fire a hundred requests at open).

export const FAVICON_MAX_BYTES = 64 * 1024;
export const FAVICON_FETCH_MS = 5000;
export const FAVICON_CACHE_MAX = 200;

export type FaviconFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'x-icon' | 'svg+xml';

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// An SVG document's root, after an optional BOM, XML declaration, comments and doctype.
const SVG_ROOT = /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i;

export function sniffImage(bytes: Uint8Array): FaviconFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'x-icon';
  if (SVG_ROOT.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) return 'svg+xml';
  return null;
}

export function faviconDataUrl(bytes: Uint8Array): string | null {
  const format = sniffImage(bytes);
  return format === null ? null : `data:image/${format};base64,${Buffer.from(bytes).toString('base64')}`;
}

// `ses.fetch` on the tab's partition (`electron.d.ts:13232`).
export type FetchInPartition = (partition: string, url: string, init: { signal: AbortSignal }) => Promise<Response>;

export class Favicons {
  private readonly cache = new Map<string, string | null>();
  private readonly byOrigin = new Map<string, string>(); // cua #90: `<partition>\n<origin>` → the icon its page last showed

  constructor(
    private readonly fetchIn: FetchInPartition,
    private readonly deadlineMs = FAVICON_FETCH_MS,
  ) {}

  // The first candidate that is an image, as a data: URL; null when none is. `page`: the page the icons are for, whose
  // origin then keeps the answer (cua #90).
  async resolve(partition: string, urls: readonly string[], page: string | null = null): Promise<string | null> {
    let icon: string | null = null;
    for (const url of urls) {
      icon = await this.cached(partition, url);
      if (icon !== null) break;
    }
    const origin = page === null ? null : originOf(page);
    if (origin !== null) {
      const key = `${partition}\n${origin}`;
      this.byOrigin.delete(key);
      if (icon !== null) this.byOrigin.set(key, icon);
      while (this.byOrigin.size > FAVICON_CACHE_MAX) this.byOrigin.delete(this.byOrigin.keys().next().value!);
    }
    return icon;
  }

  // cua #90: the icons the partition's pages last showed for these origins (an origin with none is left out).
  forOrigins(partition: string, origins: readonly string[]): Record<string, string> {
    const icons: Record<string, string> = {};
    for (const origin of origins) {
      const icon = this.byOrigin.get(`${partition}\n${origin}`);
      if (icon !== undefined) icons[origin] = icon;
    }
    return icons;
  }

  private async cached(partition: string, url: string): Promise<string | null> {
    const key = `${partition}\n${url}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      this.cache.delete(key); // most recently used last
      this.cache.set(key, hit);
      return hit;
    }
    const { icon, definitive } = await this.fetchOne(partition, url);
    if (!definitive) return icon;
    this.cache.set(key, icon);
    while (this.cache.size > FAVICON_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return icon;
  }

  // `definitive`: the answer is the resource's own (an image, a body that is none, a 404 or 410, too large), so it is
  // cached; a throw, the deadline or any other status may answer otherwise next time, so it is not.
  private async fetchOne(partition: string, url: string): Promise<{ icon: string | null; definitive: boolean }> {
    if (/^data:/i.test(url)) return { icon: dataUrlBytes(url), definitive: true };
    if (!/^https?:/i.test(url)) return { icon: null, definitive: true };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.deadlineMs);
    try {
      const response = await this.fetchIn(partition, url, { signal: abort.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { icon: null, definitive: response.status === 404 || response.status === 410 };
      }
      const bytes = await readCapped(response, FAVICON_MAX_BYTES);
      return { icon: bytes === null ? null : faviconDataUrl(bytes), definitive: true };
    } catch {
      return { icon: null, definitive: false };
    } finally {
      clearTimeout(timer);
    }
  }
}

// An http(s) page's origin, or null (cua #90).
export function originOf(url: string): string | null {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
}

// A page's own `data:` icon, read without a fetch.
function dataUrlBytes(url: string): string | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/is.exec(url);
  if (!match) return null;
  try {
    const bytes = match[1] ? Buffer.from(match[2]!, 'base64') : Buffer.from(decodeURIComponent(match[2]!), 'utf8');
    return bytes.length > FAVICON_MAX_BYTES ? null : faviconDataUrl(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

// The body, or null past `max` bytes (declared or streamed).
async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > max) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
