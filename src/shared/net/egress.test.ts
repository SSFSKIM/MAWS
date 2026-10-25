// P4-B2 D19 (R-8): MAWS's egress rules as the architect conditioned them: GET only to exactly a rule's routes (the three
// Google Fonts routes; P4-AGG’s six catalog routes, four sources and two icon routes); no cookies, credentials or redirects; a timeout, a size cap and a
// content type per response; the e2e's fixture map in place of the network. And the source guards: no `fetch(` in
// src/engine-host outside route D's transport, none at all in src/main/catalog (both go through this module).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { admitted, CATALOG_EGRESS, EGRESS_RULES, egressBase, egressGet, EgressError, fixtureFetch, GOOGLE_FONTS_EGRESS, type BaseFetch } from './egress';

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

// P4-AGG (Decision Log, fourth entry): Discover's catalog reads its four sources and its icons through this rule and no other way.
describe('the catalog egress rule', () => {
  const RAW = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json';
  const PLUGINS = 'https://api.anthropic.com/api/directory/plugins?visibility=public&limit=5000';
  const SERVERS = 'https://api.anthropic.com/api/directory/servers?limit=500';
  const DETAILS = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json';
  // the icons Discover's cards show (Decision Log 7(b)): the directory's plugin icons and its server icons bucket
  const PLUGIN_ICON = 'https://api.anthropic.com/api/directory/plugin-icons/52b13b65807248f1c7acfb4830807f49447f4aa9b5434681261620e4cd067162/256.png';
  const SERVER_ICON = 'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/chembl.png';
  const SERVER_SVG = 'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/pubmed.svg';

  it('is declared beside google-fonts', () => {
    expect(EGRESS_RULES.map((rule) => rule.name)).toEqual(['google-fonts', 'catalog']);
  });

  it('admits exactly its six routes: a seed manifest, the two directory walks with their page tokens, plugin-details, the two icon routes', () => {
    for (const url of [
      RAW,
      'https://raw.githubusercontent.com/canva-sdks/canva-skills/HEAD/.claude-plugin/marketplace.json',
      'https://raw.githubusercontent.com/makenotion/claude-code-notion-plugin/HEAD/.claude-plugin/marketplace.json',
      PLUGINS,
      `${PLUGINS}&page=eyJvZmZzZXQiOjUwMDB9`,
      `${PLUGINS}&page=abc%3D%3D`,
      SERVERS,
      `${SERVERS}&cursor=fixture-page-2`,
      DETAILS,
      PLUGIN_ICON,
      SERVER_ICON,
      SERVER_SVG,
    ])
      expect(admitted(CATALOG_EGRESS, url), url).not.toBeNull();
    for (const url of [
      'http://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json',
      'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
      'https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/plugins/x/.claude-plugin/plugin.json',
      'https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json?token=x',
      'https://raw.githubusercontent.com/a/b/c/HEAD/.claude-plugin/marketplace.json',
      'https://api.anthropic.com/api/directory/plugins',
      'https://api.anthropic.com/api/directory/plugins?visibility=commercial,public&limit=5000',
      'https://api.anthropic.com/api/directory/plugins?visibility=public&limit=5000&q=legal',
      'https://api.anthropic.com/api/directory/plugins?limit=5000&visibility=public',
      `${PLUGINS}&page=`,
      `${PLUGINS}&page=a&page=b`,
      `${SERVERS}&cursor=a&x=1`,
      'https://api.anthropic.com/api/directory/servers?limit=5000',
      'https://api.anthropic.com/api/organizations/x/library/discover/home',
      'https://api.anthropic.com/v1/messages',
      `${DETAILS}?alt=media`,
      'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.309/manifest.json',
      'https://user:pass@api.anthropic.com/api/directory/servers?limit=500',
      'https://api.anthropic.com:8443/api/directory/servers?limit=500',
      'https://api.anthropic.com.evil.example/api/directory/servers?limit=500',
      // icons: only the two Anthropic origins, at their exact shapes; Google's favicon service and every vendor host never
      `${PLUGIN_ICON}?size=64`,
      'https://api.anthropic.com/api/directory/plugin-icons/52b13b65/256.png',
      'https://api.anthropic.com/api/directory/plugin-icons/52b13b65807248f1c7acfb4830807f49447f4aa9b5434681261620e4cd067162/512.png',
      'https://api.anthropic.com/api/directory/plugin-icons/../plugins',
      'https://storage.googleapis.com/media-assets-00000000-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/chembl.png',
      'https://storage.googleapis.com/adspirer-images-v1/brand/adspirer-logo-square.png',
      'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/chembl.html',
      'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/other/chembl.png',
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://drive.google.com&size=64',
      'https://claude.ai/api/dxt/extensions/ant.dir.ant.anthropic.filesystem/versions/2026.7.10/icon.png',
      'https://www.notion.so/images/notion-logo-block-main.svg',
    ])
      expect(admitted(CATALOG_EGRESS, url), url).toBeNull();
  });

  it('checks each route’s content type: a seed manifest is served as text, the directory and plugin-details as JSON', async () => {
    const get = (type: string) => egressGet(CATALOG_EGRESS, recording(() => answer('{}', { headers: { 'content-type': type } })).base);
    expect(await get('text/plain; charset=utf-8')(RAW)).toMatchObject({ status: 200, contentType: 'text/plain' });
    expect(await get('application/json')(PLUGINS)).toMatchObject({ status: 200, contentType: 'application/json' });
    expect(await get('application/json')(DETAILS)).toMatchObject({ status: 200, contentType: 'application/json' });
    expect(await failure(get('text/html')(SERVERS))).toBe('contentType');
    expect(await failure(get('application/json')(RAW))).toBe('contentType');
    expect(await get('image/png')(PLUGIN_ICON)).toMatchObject({ status: 200, contentType: 'image/png' });
    expect(await failure(get('image/svg+xml')(PLUGIN_ICON))).toBe('contentType');
    expect(await get('image/png')(SERVER_ICON)).toMatchObject({ status: 200, contentType: 'image/png' });
    expect(await get('image/svg+xml')(SERVER_SVG)).toMatchObject({ status: 200, contentType: 'image/svg+xml' });
    expect(await failure(get('text/html')(SERVER_ICON))).toBe('contentType');
  });

  it('caps each route at about three to five times what it served on the live walk (2026-10-25)', () => {
    const room = (url: string, served: number) => admitted(CATALOG_EGRESS, url)!.maxBytes / served;
    // the icons: the largest of every Anthropic-origin icon the directory named on 2026-10-25 (756 plugin icons, 11 server icons)
    for (const [url, served] of [[RAW, 1_566_074], [PLUGINS, 13_149_916], [SERVERS, 1_348_270], [DETAILS, 538_696], [PLUGIN_ICON, 111_087], [SERVER_ICON, 93_026]] as const) {
      expect(room(url, served), url).toBeGreaterThan(3);
      expect(room(url, served), url).toBeLessThan(6);
    }
  });
});

// The source guards: the host's only doors out are this module's rules and route D's verified transport; the catalog's
// only door is this module.
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
const HTTP_IMPORT = /from\s+'(?:node:)?(?:https?|undici|net|tls)'|require\(\s*'(?:node:)?(?:https?|undici|net|tls)'\s*\)/;

describe('the engine host’s outbound requests', () => {
  const root = resolve(__dirname, '../../engine-host');

  it('calls fetch only in route D’s transport (the egress module is src/shared/net/egress.ts)', () => {
    const calling = sources(root).filter((path) => /\bfetch\s*\(/.test(code(path)));
    expect(calling.map((path) => relative(root, path)).sort()).toEqual(['connectors/direct-http.ts']);
  });

  it('opens HTTP only to the loopback relay (relay-health.ts), never with node:http(s) elsewhere', () => {
    const importing = sources(root).filter((path) => /from\s+'(?:node:)?(?:https?|undici)'|require\(\s*'(?:node:)?(?:https?|undici)'\s*\)/.test(code(path)));
    expect(importing.map((path) => relative(root, path)).sort()).toEqual(['relay-health.ts']);
  });
});

describe('the catalog’s outbound requests (P4-AGG)', () => {
  const root = resolve(__dirname, '../../main/catalog');

  it('never calls fetch nor opens a socket itself: every request is egressGet’s under the catalog rule', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((path) => /\bfetch\s*\(/.test(code(path)) || HTTP_IMPORT.test(code(path))).map((path) => relative(root, path))).toEqual([]);
  });

  it('names only the catalog rule', () => {
    const rules = sources(root).flatMap((path) => [...code(path).matchAll(/\b([A-Z_]+)_EGRESS\b/g)].map((m) => m[1]));
    expect(new Set(rules)).toEqual(new Set(['CATALOG']));
  });
});
