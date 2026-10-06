import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { recordPath, versionPath, writeRecord } from '@shared/maws/deliverable-files';
import { BRIDGE_SCRIPT } from './bridge-script';
import { createDeliverableHandler, DELIVERABLE_HTML_CSP, insertBridgeScript } from './protocol';
import { DeliverableReader } from './reader';

vi.mock('electron', () => ({ protocol: {} }));

let root: string;
let userData: string;
let work: string;
let handle: (request: Request) => Promise<Response>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-protocol-')));
  userData = join(root, 'userData');
  work = join(root, 'work');
  await mkdir(work, { recursive: true });
  handle = createDeliverableHandler(new DeliverableReader(userData));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const A = 'App-A' as AppSessionId;
const FILE = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const ART = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const MARKER = 'data-maws-bridge';

async function deliver(name: string, content: string | Buffer, id = FILE): Promise<DeliverableRecord> {
  const path = join(work, name);
  await writeFile(path, content);
  const record: DeliverableRecord = { id, appSessionId: A, kind: 'file', path, title: name, versions: [{ path, at: 't' }], createdAt: 't' };
  await writeRecord(recordPath(userData, A, id), record);
  return record;
}
async function artifact(versions: string[]): Promise<DeliverableRecord> {
  const list = [];
  for (const [k, html] of versions.entries()) {
    const path = versionPath(userData, A, ART, k + 1);
    await mkdir(join(userData, 'deliverables', A, ART), { recursive: true });
    await writeFile(path, html);
    list.push({ path, at: 't' });
  }
  const record: DeliverableRecord = { id: ART, appSessionId: A, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: list.at(-1)!.path, versions: list, createdAt: 't', updatedAt: 't' };
  await writeRecord(recordPath(userData, A, ART), record);
  return record;
}
const get = (url: string, init: RequestInit = {}) => handle(new Request(url, init));
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe('the maws-deliverable: handler (E2 Design §3): one recorded file per URL', () => {
  it('serves the file the record names for /<appSessionId>/<n>, with the headers every answer carries', async () => {
    await deliver('notes.md', '# hi');
    const response = await get(deliverableUrl(A, FILE, 1));
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
    expect(response.headers.get('content-security-policy')).toBeNull(); // the policy is for HTML only
  });

  it('serves each version of an artifact from its own copy', async () => {
    await artifact(['<p>one</p>', '<p>two</p>']);
    expect(await (await get(deliverableUrl(A, ART, 1))).text()).toContain('<p>one</p>');
    expect(await (await get(deliverableUrl(A, ART, 2))).text()).toContain('<p>two</p>');
  });

  it('types a file by its name, and an unknown name as application/octet-stream', async () => {
    await deliver('clip.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect((await get(deliverableUrl(A, FILE, 1))).headers.get('content-type')).toBe('video/webm');
    await deliver('blob.bin', Buffer.from([0, 1, 2]), ART);
    expect((await get(deliverableUrl(A, ART, 1))).headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers 404 for an unknown id, a version out of range, a wrong path shape, an unsafe app session id and a gone file', async () => {
    const record = await deliver('a.txt', 'a');
    const notFound = [
      deliverableUrl(A, ART, 1), // no such record
      deliverableUrl(A, FILE, 2), // one version only
      `maws-deliverable://${FILE}/${A}/0`,
      `maws-deliverable://${FILE}/${A}`, // no version
      `maws-deliverable://${FILE}/${A}/1/extra`,
      `maws-deliverable://${FILE}/..%2Fx/1`,
      `maws-deliverable://${FILE}/.hidden/1`, // parses, but is not a safe app session id
      `maws-deliverable://00000000-0000-0000-0000-000000000000/${A}/1`, // hex, but not a record uuid
      `maws-deliverable://${FILE}/App-B/1`, // another session's directory
    ];
    for (const url of notFound) expect((await get(url)).status, url).toBe(404);
    await rm(record.path);
    const gone = await get(deliverableUrl(A, FILE, 1));
    expect(gone.status).toBe(404);
    expect(await gone.text()).not.toContain(work); // the body names no path
  });

  it('answers 405 for anything but GET and HEAD, and HEAD with the headers alone', async () => {
    await deliver('a.txt', 'abc');
    expect((await get(deliverableUrl(A, FILE, 1), { method: 'POST', body: 'x' })).status).toBe(405);
    const head = await get(deliverableUrl(A, FILE, 1), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('3');
    expect(await head.text()).toBe('');
  });

  it('honours a Range with 206 and the slice, an open-ended and a suffix range, and 416 past the end', async () => {
    await deliver('a.wav', '0123456789');
    const url = deliverableUrl(A, FILE, 1);
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

  it('puts the sandboxing policy, with no network source and no self, on HTML only', async () => {
    expect(DELIVERABLE_HTML_CSP.startsWith('sandbox allow-scripts; ')).toBe(true);
    expect(DELIVERABLE_HTML_CSP).not.toMatch(/'self'|https?:/);
    await deliver('page.html', '<p>x</p>');
    const response = await get(deliverableUrl(A, FILE, 1));
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-security-policy')).toBe(DELIVERABLE_HTML_CSP);
  });

  it('serves a delivered HTML file byte for byte, with no bridge script', async () => {
    const page = '<!doctype html><html><head><title>t</title></head><body><script>1</script></body></html>';
    await deliver('page.html', page);
    expect(await (await get(deliverableUrl(A, FILE, 1))).text()).toBe(page);
  });

  it('puts the bridge script once into an artifact’s HTML, as the first element of <head>', async () => {
    await artifact(['<!DOCTYPE html><html><head lang="en"><script>own()</script></head><body></body></html>']);
    const response = await get(deliverableUrl(A, ART, 1));
    const text = await response.text();
    expect(occurrences(text, MARKER)).toBe(1);
    expect(text.startsWith(`<!DOCTYPE html><html><head lang="en"><script ${MARKER}>`)).toBe(true);
    expect(text.indexOf(MARKER)).toBeLessThan(text.indexOf('own()')); // before the artifact's own scripts
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
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

  it('leaves every other byte as it was, including bytes that are not UTF-8', () => {
    const html = Buffer.concat([Buffer.from('<head>'), Buffer.from([0xff, 0xfe, 0xe9]), Buffer.from('</head>')]);
    const out = insertBridgeScript(html);
    expect(out.subarray(0, 6).toString()).toBe('<head>');
    expect(out.subarray(out.length - 10)).toEqual(Buffer.concat([Buffer.from([0xff, 0xfe, 0xe9]), Buffer.from('</head>')]));
  });
});
