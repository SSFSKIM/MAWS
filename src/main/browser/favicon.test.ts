import { describe, expect, it, vi } from 'vitest';
import { FAVICON_CACHE_MAX, FAVICON_MAX_BYTES, Favicons, faviconDataUrl, sniffImage } from './favicon';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
const WEBP = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0x24, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
const ICO = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);
const SVG = new TextEncoder().encode('\uFEFF<?xml version="1.0"?>\n<!-- an icon -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const HTML = new TextEncoder().encode('<!doctype html><html><body>not found</body></html>');

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

describe('sniffImage (E4a Design §7, Decision Log 13)', () => {
  it('recognises PNG, JPEG, GIF, WebP and ICO by signature and SVG by its root', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(JPEG)).toBe('jpeg');
    expect(sniffImage(GIF)).toBe('gif');
    expect(sniffImage(WEBP)).toBe('webp');
    expect(sniffImage(ICO)).toBe('x-icon');
    expect(sniffImage(SVG)).toBe('svg+xml');
    expect(sniffImage(new TextEncoder().encode('<svg>'))).toBe('svg+xml');
  });

  it('refuses junk: HTML, an empty body, text that merely mentions <svg later on, a RIFF that is not WebP', () => {
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(new TextEncoder().encode('hello <svg></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt '))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<svgfoo/>'))).toBeNull();
  });

  it('builds a data: URL of the original bytes, never re-encoded', () => {
    expect(faviconDataUrl(ICO)).toBe(`data:image/x-icon;base64,${base64(ICO)}`);
    expect(faviconDataUrl(SVG)).toBe(`data:image/svg+xml;base64,${base64(SVG)}`);
    expect(faviconDataUrl(HTML)).toBeNull();
  });
});

function response(bytes: Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(bytes, { status: init.status ?? 200, headers: init.headers });
}

describe('Favicons: fetch in order, sniff, bound, cache', () => {
  it('fetches the candidates in order on the tab\'s partition until one is an image', async () => {
    const fetchIn = vi.fn(async (_partition: string, url: string) => (url.endsWith('a.png') ? response(HTML, { status: 404 }) : url.endsWith('b.html') ? response(HTML) : response(ICO)));
    const favicons = new Favicons(fetchIn);
    const icon = await favicons.resolve('persist:maws-browser', ['https://s.test/a.png', 'https://s.test/b.html', 'https://s.test/favicon.ico']);
    expect(icon).toBe(`data:image/x-icon;base64,${base64(ICO)}`);
    expect(fetchIn.mock.calls.map(([partition, url]) => [partition, url])).toEqual([
      ['persist:maws-browser', 'https://s.test/a.png'],
      ['persist:maws-browser', 'https://s.test/b.html'],
      ['persist:maws-browser', 'https://s.test/favicon.ico'],
    ]);
  });

  it('answers null when nothing is an image, and skips schemes it does not fetch', async () => {
    const fetchIn = vi.fn(async () => response(HTML));
    const favicons = new Favicons(fetchIn);
    expect(await favicons.resolve('persist:maws-browser', ['file:///etc/hosts', 'chrome://favicon/x', 'https://s.test/x'])).toBeNull();
    expect(fetchIn).toHaveBeenCalledTimes(1);
  });

  it('reads a data: candidate without fetching it, sniffed like any other', async () => {
    const fetchIn = vi.fn();
    const favicons = new Favicons(fetchIn);
    expect(await favicons.resolve('persist:maws-browser', [`data:image/png;base64,${base64(PNG)}`])).toBe(`data:image/png;base64,${base64(PNG)}`);
    expect(await favicons.resolve('persist:maws-browser', [`data:image/svg+xml,${encodeURIComponent('<svg/>')}`])).toBe(`data:image/svg+xml;base64,${base64(new TextEncoder().encode('<svg/>'))}`);
    expect(await favicons.resolve('persist:maws-browser', ['data:text/html;base64,PGh0bWw+'])).toBeNull();
    expect(fetchIn).not.toHaveBeenCalled();
  });

  it('refuses an icon over 64 KiB, by its declared length or by what it streams', async () => {
    const big = new Uint8Array(FAVICON_MAX_BYTES + 1);
    big.set(PNG);
    const declared = new Favicons(async () => response(PNG, { headers: { 'content-length': String(FAVICON_MAX_BYTES + 1) } }));
    expect(await declared.resolve('persist:maws-browser', ['https://s.test/declared.png'])).toBeNull();
    const streamed = new Favicons(async () => response(big));
    expect(await streamed.resolve('persist:maws-browser', ['https://s.test/big.png'])).toBeNull();
    const exact = new Uint8Array(FAVICON_MAX_BYTES);
    exact.set(PNG);
    const fits = new Favicons(async () => response(exact));
    expect(await fits.resolve('persist:maws-browser', ['https://s.test/fits.png'])).toMatch(/^data:image\/png;base64,/);
  });

  it('gives up on a candidate past its deadline and tries the next', async () => {
    vi.useFakeTimers();
    try {
      const fetchIn = vi.fn((_partition: string, url: string, init: { signal: AbortSignal }) =>
        url.endsWith('slow.ico') ? new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) : Promise.resolve(response(PNG)),
      );
      const favicons = new Favicons(fetchIn, 5000);
      const pending = favicons.resolve('persist:maws-browser', ['https://s.test/slow.ico', 'https://s.test/ok.png']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toMatch(/^data:image\/png;base64,/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches per (partition, icon URL), misses included, and keeps at most 200 entries', async () => {
    const fetchIn = vi.fn(async (_partition: string, url: string) => (url.includes('junk') ? response(HTML) : response(PNG)));
    const favicons = new Favicons(fetchIn);
    await favicons.resolve('persist:maws-browser', ['https://s.test/i.png']);
    await favicons.resolve('persist:maws-browser', ['https://s.test/i.png']);
    await favicons.resolve('persist:maws-browser', ['https://s.test/junk.png']);
    await favicons.resolve('persist:maws-browser', ['https://s.test/junk.png']);
    expect(fetchIn).toHaveBeenCalledTimes(2);
    await favicons.resolve('persist:maws-chrome-Default', ['https://s.test/i.png']); // another partition: its own cookies, its own entry
    expect(fetchIn).toHaveBeenCalledTimes(3);

    for (let i = 0; i < FAVICON_CACHE_MAX; i++) await favicons.resolve('persist:maws-browser', [`https://s.test/${i}.png`]);
    fetchIn.mockClear();
    await favicons.resolve('persist:maws-browser', ['https://s.test/i.png']); // evicted: the least recently used
    await favicons.resolve('persist:maws-browser', [`https://s.test/${FAVICON_CACHE_MAX - 1}.png`]); // still cached
    expect(fetchIn.mock.calls.map(([, url]) => url)).toEqual(['https://s.test/i.png']);
  });

  it('a fetch that throws is a miss, not a failure, and is tried again next time', async () => {
    const fetchIn = vi.fn(async (): Promise<Response> => {
      throw new Error('net::ERR_FAILED');
    });
    const favicons = new Favicons(fetchIn);
    expect(await favicons.resolve('persist:maws-browser', ['https://s.test/x.ico'])).toBeNull();
    expect(await favicons.resolve('persist:maws-browser', ['https://s.test/x.ico'])).toBeNull();
    expect(fetchIn).toHaveBeenCalledTimes(2);
  });

  it('caches only definitive answers: a 404 or 410 is, a 5xx, a 403 and a timeout are not', async () => {
    vi.useFakeTimers();
    try {
      const statuses: Record<string, number> = { gone: 410, missing: 404, broken: 503, forbidden: 403 };
      const fetchIn = vi.fn((_partition: string, url: string, init: { signal: AbortSignal }) => {
        const name = /\/(\w+)\.ico$/.exec(url)![1]!;
        if (name === 'slow') return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        return Promise.resolve(response(HTML, { status: statuses[name] }));
      });
      const favicons = new Favicons(fetchIn, 5000);
      const urls = ['https://s.test/gone.ico', 'https://s.test/missing.ico', 'https://s.test/broken.ico', 'https://s.test/forbidden.ico', 'https://s.test/slow.ico'];
      for (let round = 0; round < 2; round++) {
        const pending = favicons.resolve('persist:maws-browser', urls);
        await vi.advanceTimersByTimeAsync(5000);
        expect(await pending).toBeNull();
      }
      const calls = fetchIn.mock.calls.map(([, url]) => /\/(\w+)\.ico$/.exec(url)![1]);
      expect(calls).toEqual(['gone', 'missing', 'broken', 'forbidden', 'slow', 'broken', 'forbidden', 'slow']);
    } finally {
      vi.useRealTimers();
    }
  });
});

// cua #90: the bookmarks bar's icons, from what the partition's pages already showed (never a fetch of its own)
describe('Favicons: the icon a page origin showed', () => {
  it('remembers the icon of the page it was resolved for, by origin and per partition, and answers it without a fetch', async () => {
    const fetchIn = vi.fn(async () => response(ICO));
    const favicons = new Favicons(fetchIn);
    const icon = `data:image/x-icon;base64,${base64(ICO)}`;
    expect(await favicons.resolve('persist:p', ['https://s.test/favicon.ico'], 'https://s.test/some/page?q=1')).toBe(icon);
    expect(fetchIn).toHaveBeenCalledTimes(1);
    expect(favicons.forOrigins('persist:p', ['https://s.test', 'https://other.test', 'not a url'])).toEqual({ 'https://s.test': icon });
    expect(favicons.forOrigins('persist:q', ['https://s.test'])).toEqual({}); // another partition's pages showed nothing
    expect(fetchIn).toHaveBeenCalledTimes(1);
  });

  it('forgets an origin whose page now has no icon, and keeps nothing for a lookup without a page', async () => {
    let bytes: Uint8Array = PNG;
    const favicons = new Favicons(async () => response(bytes));
    await favicons.resolve('persist:p', ['https://s.test/a.png'], 'https://s.test/');
    expect(Object.keys(favicons.forOrigins('persist:p', ['https://s.test']))).toEqual(['https://s.test']);
    bytes = HTML;
    await favicons.resolve('persist:p', ['https://s.test/b.html'], 'https://s.test/');
    expect(favicons.forOrigins('persist:p', ['https://s.test'])).toEqual({});
    await favicons.resolve('persist:p', ['https://t.test/a.png']);
    await favicons.resolve('persist:p', ['https://u.test/a.png'], null);
    expect(favicons.forOrigins('persist:p', ['https://t.test', 'https://u.test'])).toEqual({});
  });

  it('keeps at most FAVICON_CACHE_MAX origins, the least recently shown out first', async () => {
    const favicons = new Favicons(async () => response(PNG));
    for (let k = 0; k <= FAVICON_CACHE_MAX; k++) await favicons.resolve('persist:p', [`https://s${k}.test/i.png`], `https://s${k}.test/`);
    expect(Object.keys(favicons.forOrigins('persist:p', ['https://s0.test', 'https://s1.test', `https://s${FAVICON_CACHE_MAX}.test`]))).toEqual(['https://s1.test', `https://s${FAVICON_CACHE_MAX}.test`]);
  });
});
