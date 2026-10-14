// The store scheme's one handler (E2 Design §3; P3-A M7, Decision Log 35e; P3-L M6b: what served `maws-deliverable:`
// serves `maws-artifact:` alone): over a resolver standing in for the scheme's, which names a file, its type's name and
// whether it is an `html` artifact's page.
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT } from './bridge-script';
import { createSchemeHandler, insertBridgeScript, STORE_FRAME_CSP, type SchemeFile } from './scheme-handler';

let root: string;
let work: string;
let files: Map<string, SchemeFile>;
let handle: (request: Request) => Promise<Response>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-scheme-')));
  work = join(root, 'work');
  await mkdir(work, { recursive: true });
  files = new Map();
  handle = createSchemeHandler(async (url) => files.get(url) ?? null);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MARKER = 'data-maws-bridge';
let served = 0;

// A file the resolver names at a URL of its own: a File artifact's (byte for byte) or, with `bridge`, a page's.
async function serve(name: string, content: string | Buffer, bridge = false): Promise<{ url: string; path: string }> {
  const path = join(work, `${++served}-${name}`);
  await writeFile(path, content);
  const url = `maws-artifact://0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/${served}/${encodeURIComponent(name)}`;
  files.set(url, { path, name, bridge });
  return { url, path };
}
const get = (url: string, init: RequestInit = {}) => handle(new Request(url, init));
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe('the store scheme’s handler: one named file per URL', () => {
  it('serves the file the resolver names, with the headers every answer carries', async () => {
    const { url } = await serve('notes.md', '# hi');
    const response = await get(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# hi');
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'text/markdown',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-length': '4',
    });
    expect(response.headers.get('content-security-policy')).toBe(STORE_FRAME_CSP); // every answer but a PDF's
    expect(response.headers.get('access-control-allow-origin')).toBeNull(); // CORS only when the scheme asks (its fonts)
  });

  it('types a file by its name, and an unknown name as application/octet-stream', async () => {
    expect((await get((await serve('clip.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).url)).headers.get('content-type')).toBe('video/webm');
    expect((await get((await serve('blob.bin', Buffer.from([0, 1, 2]))).url)).headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers 404 for a URL the resolver names nothing at, a resolver that throws, a gone file and a directory, naming no path', async () => {
    expect((await get('maws-artifact://0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/1/unknown.html')).status).toBe(404);
    const throwing = createSchemeHandler(async () => Promise.reject(new Error('the host is away')));
    expect((await throwing(new Request('maws-artifact://x/1/a.html'))).status).toBe(404);
    const { url, path } = await serve('a.txt', 'a');
    await rm(path);
    const gone = await get(url);
    expect(gone.status).toBe(404);
    expect(await gone.text()).not.toContain(work); // the body names no path
    files.set('maws-artifact://x/1/dir', { path: work, name: 'dir', bridge: false });
    expect((await get('maws-artifact://x/1/dir')).status).toBe(404);
  });

  it('answers 405 for anything but GET and HEAD, and HEAD with the headers alone', async () => {
    const { url } = await serve('a.txt', 'abc');
    expect((await get(url, { method: 'POST', body: 'x' })).status).toBe(405);
    const head = await get(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('3');
    expect(await head.text()).toBe('');
  });

  it('honours a Range with 206 and the slice, an open-ended and a suffix range, and 416 past the end', async () => {
    const { url } = await serve('a.wav', '0123456789');
    const ranged = await get(url, { headers: { Range: 'bytes=2-5' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(ranged.headers.get('content-length')).toBe('4');
    expect(await ranged.text()).toBe('2345');
    expect(await (await get(url, { headers: { Range: 'bytes=7-' } })).text()).toBe('789');
    expect(await (await get(url, { headers: { Range: 'bytes=-3' } })).text()).toBe('789');
    expect(await (await get(url, { headers: { Range: 'bytes=8-99' } })).text()).toBe('89'); // clamped to the end
    const past = await get(url, { headers: { Range: 'bytes=10-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
    expect((await get(url, { headers: { Range: 'bytes=0-1,4-5' } })).status).toBe(200); // a multi-range is answered whole
  });

  it('puts the sandboxing policy, with no network source and no self, on every answer but a PDF’s', async () => {
    expect(STORE_FRAME_CSP.startsWith('sandbox allow-scripts; ')).toBe(true);
    expect(STORE_FRAME_CSP).not.toMatch(/'self'|https?:/);
    // HTML, and the other documents that can run script when a frame loads them (SVG, XML), and everything else
    for (const [name, type] of [['page.html', 'text/html'], ['logo.svg', 'image/svg+xml'], ['feed.xml', 'application/xml'], ['clip.webm', 'video/webm'], ['blob.bin', 'application/octet-stream']]) {
      const response = await get((await serve(name!, '<x/>')).url);
      expect(response.headers.get('content-type'), name).toBe(type);
      expect(response.headers.get('content-security-policy'), name).toBe(STORE_FRAME_CSP);
    }
    // a PDF has none: Chromium's viewer draws it, and the sandbox directive would keep the viewer from loading
    expect((await get((await serve('report.pdf', '%PDF-1.4')).url)).headers.get('content-security-policy')).toBeNull();
  });

  it('serves a File artifact’s HTML byte for byte, with no bridge script', async () => {
    const page = '<!doctype html><html><head><title>t</title></head><body><script>1</script></body></html>';
    expect(await (await get((await serve('page.html', page)).url)).text()).toBe(page);
  });

  it('puts the bridge script once into a page’s HTML, as the first element of <head>', async () => {
    const response = await get((await serve('index.html', '<!DOCTYPE html><html><head lang="en"><script>own()</script></head><body></body></html>', true)).url);
    const text = await response.text();
    expect(occurrences(text, MARKER)).toBe(1);
    expect(text.startsWith(`<!DOCTYPE html><html><head lang="en"><script ${MARKER}>`)).toBe(true);
    expect(text.indexOf(MARKER)).toBeLessThan(text.indexOf('own()')); // before the page's own scripts
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
  });

  it('adds no line to a page’s HTML, so its console errors keep the line numbers of the agent’s file', async () => {
    const source = '<!doctype html>\n<html>\n<head>\n<title>t</title>\n</head>\n<body>\n<script>\nthrow new Error("x")\n</script>\n</body>\n</html>\n';
    const text = await (await get((await serve('index.html', source, true)).url)).text();
    expect(occurrences(text, MARKER)).toBe(1);
    expect(occurrences(text, '\n')).toBe(occurrences(source, '\n'));
    expect(text.indexOf('throw')).toBeGreaterThan(text.indexOf(MARKER));
    expect(text.split('\n').indexOf('throw new Error("x")')).toBe(source.split('\n').indexOf('throw new Error("x")'));
  });

  it('adds CORS to every answer of a scheme that asks for it', async () => {
    const cors = createSchemeHandler(async (url) => files.get(url) ?? null, { cors: true });
    expect((await cors(new Request((await serve('face.woff2', 'x')).url))).headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('insertBridgeScript (E2 Design §3, §10)', () => {
  const tag = `<script ${MARKER}>${BRIDGE_SCRIPT}</script>`;
  const insert = (html: string) => insertBridgeScript(Buffer.from(html, 'utf8')).toString('utf8');

  it('goes right after the doctype when there is no <head>, never before it', () => {
    expect(insert('<!doctype html>\n<body>x</body>')).toBe(`<!doctype html>${tag}\n<body>x</body>`);
    expect(insert('\uFEFF  <!DOCTYPE html><p>x')).toBe(`\uFEFF  <!DOCTYPE html>${tag}<p>x`);
  });

  it('goes first when there is neither, and is not fooled by <header>', () => {
    expect(insert('<header>h</header>')).toBe(`${tag}<header>h</header>`);
    expect(insert('<HEAD><p>x')).toBe(`<HEAD>${tag}<p>x`);
  });

  // M3's review: a `<head` inside a comment before the real head took the script into the comment, where it never runs;
  // a leading comment hid the doctype from a start-anchored match, which put the script ahead of it (quirks mode)
  it('passes over comments: a <head> inside one is not the head, and a leading comment never puts it before the doctype', () => {
    expect(insert('<!-- <head> --><!doctype html><html><head><title>t</title>')).toBe(`<!-- <head> --><!doctype html><html><head>${tag}<title>t</title>`);
    expect(insert('<!-- note -->\n<!DOCTYPE html>\n<body>x</body>')).toBe(`<!-- note -->\n<!DOCTYPE html>${tag}\n<body>x</body>`);
    expect(insert('<!doctype html><!-- <head> --><html lang="en"><body>x')).toBe(`<!doctype html><!-- <head> --><html lang="en">${tag}<body>x`);
    expect(insert('<!--><!doctype html><p>x')).toBe(`<!--><!doctype html>${tag}<p>x`); // the abrupt comment closes at once
    expect(insert('<?xml version="1.0"?><!doctype html><p>x')).toBe(`<?xml version="1.0"?><!doctype html>${tag}<p>x`); // a bogus comment
  });

  it('looks for the head only before the page’s content: a <head> in the body’s script text is not one', () => {
    expect(insert('<!doctype html><body><script>document.write("<head>")</script>')).toBe(`<!doctype html>${tag}<body><script>document.write("<head>")</script>`);
  });

  it('reads a head whose attribute value holds a >', () => {
    expect(insert('<head data-x="a>b"><title>t')).toBe(`<head data-x="a>b">${tag}<title>t`);
  });

  it('never goes before a byte-order mark, and goes before a comment that never closes', () => {
    expect(insert('\uFEFF<p>x')).toBe(`\uFEFF${tag}<p>x`);
    expect(insert('<!doctype html><!-- open')).toBe(`<!doctype html>${tag}<!-- open`);
  });

  it('leaves every other byte as it was, including bytes that are not UTF-8', () => {
    const html = Buffer.concat([Buffer.from('<head>'), Buffer.from([0xff, 0xfe, 0xe9]), Buffer.from('</head>')]);
    const out = insertBridgeScript(html);
    expect(out.subarray(0, 6).toString()).toBe('<head>');
    expect(out.subarray(out.length - 10)).toEqual(Buffer.concat([Buffer.from([0xff, 0xfe, 0xe9]), Buffer.from('</head>')]));
  });
});
