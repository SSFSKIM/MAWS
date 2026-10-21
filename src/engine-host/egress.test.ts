// P4-B2 D19 (R-8): the host's egress rule as the architect conditioned it: GET only to exactly the three Google Fonts
// routes; no cookies, credentials or redirects; a timeout, a size cap and a content type per response; the e2e's
// fixture map in place of the network. And the source guard: no `fetch(` in src/engine-host outside this module and
// route D's transport.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { admitted, egressBase, egressGet, EgressError, fixtureFetch, GOOGLE_FONTS_EGRESS, type BaseFetch } from './egress';

const CSS2 = 'https://fonts.googleapis.com/css2?family=Lora:wght@400;700';
const FILE = 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJD.woff2';
const META = 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/METADATA.pb';

const answer = (body: string | Uint8Array | null, init: ResponseInit = {}) => new Response(body, init);
const recording = (respond: () => Response = () => answer('x', { headers: { 'content-type': 'text/css' } })) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const base: BaseFetch = async (url, init) => (calls.push({ url, init }), respond());
  return { calls, base };
};
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EgressError);
    return (error as EgressError).failure;
  }
  throw new Error('not refused');
};

describe('the google-fonts egress rule', () => {
  it('admits exactly its three routes', () => {
    for (const url of [CSS2, 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700', FILE, META, 'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/apache/robotoslab/METADATA.pb'])
      expect(admitted(GOOGLE_FONTS_EGRESS, url), url).not.toBeNull();
    for (const url of [
      'http://fonts.googleapis.com/css2?family=Lora',
      'https://fonts.googleapis.com/css?family=Lora',
      'https://fonts.googleapis.com/css2?family=Lora&display=swap',
      'https://fonts.googleapis.com/css2?family=Lora&text=abc',
      'https://fonts.googleapis.com:8443/css2?family=Lora',
      'https://user:pass@fonts.googleapis.com/css2?family=Lora',
      'https://fonts.gstatic.com/l/font?kit=x',
      `${FILE}?x=1`,
      'https://raw.githubusercontent.com/google/fonts/main/ofl/lora/Lora%5Bwght%5D.ttf',
      'https://raw.githubusercontent.com/google/fonts/main/ofl/../lora/METADATA.pb',
      'https://raw.githubusercontent.com/someone/fonts/main/ofl/lora/METADATA.pb',
      'https://evil.example/css2?family=Lora',
      'https://fonts.googleapis.com.evil.example/css2?family=Lora',
    ])
      expect(admitted(GOOGLE_FONTS_EGRESS, url), url).toBeNull();
  });

  it('refuses a URL outside the rule before the network', async () => {
    const { calls, base } = recording();
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, base)('https://evil.example/x'))).toBe('notAdmitted');
    expect(calls).toEqual([]);
  });

  it('asks by GET with no cookies, credentials, referrer, cache or redirects, and only the user agent it is given', async () => {
    const { calls, base } = recording();
    await egressGet(GOOGLE_FONTS_EGRESS, base)(CSS2, { userAgent: 'Old Firefox' });
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe(CSS2);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(['accept', 'user-agent']);
    expect((init.headers as Record<string, string>)['user-agent']).toBe('Old Firefox');
    expect(init.body).toBeUndefined();
  });

  it('refuses a redirect, never following it', async () => {
    const { calls, base } = recording(() => answer(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, base)(CSS2))).toBe('redirect');
    expect(calls).toHaveLength(1);
  });

  it('answers a non-2xx status alone, its body unread', async () => {
    const { base } = recording(() => answer('<html>', { status: 404, headers: { 'content-type': 'text/html' } }));
    expect(await egressGet(GOOGLE_FONTS_EGRESS, base)(META)).toEqual({ status: 404, contentType: null, bytes: null });
  });

  it('checks each 2xx answer’s content type against its route', async () => {
    const html = recording(() => answer('<html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, html.base)(CSS2))).toBe('contentType');
    const css = recording(() => answer('x', { headers: { 'content-type': 'text/css; charset=utf-8' } }));
    expect(await egressGet(GOOGLE_FONTS_EGRESS, css.base)(CSS2)).toMatchObject({ status: 200, contentType: 'text/css' });
    const font = recording(() => answer('x', { headers: { 'content-type': 'text/css' } }));
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, font.base)(FILE))).toBe('contentType');
  });

  it('caps each answer’s size, declared or streamed', async () => {
    const over = 'x'.repeat(64 * 1024 + 1);
    const declared = recording(() => answer('x', { headers: { 'content-type': 'text/css', 'content-length': String(over.length) } }));
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, declared.base)(CSS2))).toBe('tooLarge');
    const streamed = recording(() => answer(over, { headers: { 'content-type': 'text/css' } }));
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, streamed.base)(CSS2))).toBe('tooLarge');
  });

  it('times out an answer that does not come, and names a network failure', async () => {
    const hanging: BaseFetch = (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    expect(await failure(egressGet({ ...GOOGLE_FONTS_EGRESS, timeoutMs: 20 }, hanging)(CSS2))).toBe('timeout');
    const offline: BaseFetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, offline)(CSS2))).toBe('network');
  });
});

describe('the e2e’s fixture map (MAWS_E2E=1)', () => {
  it('answers the URLs its map lists from files and fails every other one as offline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-gf-'));
    try {
      writeFileSync(join(dir, 'lora.css'), '@font-face {}');
      writeFileSync(join(dir, 'map.json'), JSON.stringify({ [CSS2]: { file: 'lora.css', type: 'text/css; charset=utf-8' }, [META]: { status: 404, type: 'text/plain' } }));
      const get = egressGet(GOOGLE_FONTS_EGRESS, fixtureFetch(dir));
      const css = await get(CSS2);
      expect(new TextDecoder().decode(css.bytes!)).toBe('@font-face {}');
      expect(await get(META)).toEqual({ status: 404, contentType: null, bytes: null });
      expect(await failure(get(FILE))).toBe('network');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never reaches the network under MAWS_E2E=1, a directory named or not', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await failure(egressGet(GOOGLE_FONTS_EGRESS, egressBase({ MAWS_E2E: '1' }))(CSS2))).toBe('network');
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});

// The source guard: the host's only doors out are this module's rules and route D's verified transport.
describe('the engine host’s outbound requests', () => {
  const root = resolve(__dirname);
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const code = (path: string) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

  it('calls fetch only in egress.ts and route D’s transport', () => {
    const calling = sources(root).filter((path) => /\bfetch\s*\(/.test(code(path)));
    expect(calling.map((path) => relative(root, path)).sort()).toEqual(['connectors/direct-http.ts', 'egress.ts']);
  });

  it('opens HTTP only to the loopback relay (relay-health.ts), never with node:http(s) elsewhere', () => {
    const importing = sources(root).filter((path) => /from\s+'(?:node:)?(?:https?|undici)'|require\(\s*'(?:node:)?(?:https?|undici)'\s*\)/.test(code(path)));
    expect(importing.map((path) => relative(root, path)).sort()).toEqual(['relay-health.ts']);
  });
});
