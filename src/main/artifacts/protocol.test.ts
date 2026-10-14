import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { DELIVERABLE_HTML_CSP } from '../deliverables/protocol';
import { createArtifactHandler } from './protocol';

vi.mock('electron', () => ({ protocol: {} }));

const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const FILE = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const DOC = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const MARKER = 'data-maws-bridge';

let root: string;
let asked: CommandInput<'artifacts.content'>[];
let files: Map<string, { kind: ArtifactKind; path: string; name: string }>; // `<id> <revision|live> <path>` → the host's answer
let handle: (request: Request) => Promise<Response>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-artifact-protocol-')));
  asked = [];
  files = new Map();
  // The host's `artifacts.content`, as far as the handler can tell: an answer for what it holds, a refusal otherwise.
  handle = createArtifactHandler(async (input) => {
    asked.push(input);
    const found = files.get(`${input.artifactId} ${input.revision ?? 'live'} ${input.path}`);
    if (!found) return { ok: false, error: { code: 'invalid_input', message: 'not found' } } as CommandResult<'artifacts.content'>;
    return { ok: true, value: { revision: 1, kind: found.kind, name: found.name, size: 0, sha256: 'x', path: found.path } };
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// The store keeps an asset under its hash and a page under its name: the file on disk has no extension to read a type
// from, so the host's answer's name gives it.
async function hold(artifactId: string, revision: number | 'live', path: string, kind: ArtifactKind, content: string): Promise<void> {
  const file = join(root, `${artifactId}-${revision}-${files.size}`);
  await writeFile(file, content);
  files.set(`${artifactId} ${revision} ${path}`, { kind, path: file, name: path.split('/').at(-1)! });
}
const get = (url: string, init: RequestInit = {}) => handle(new Request(url, init));

describe('the maws-artifact: handler (Decision Log 14, 35e): the files the host names, served as maws-deliverable: serves its own', () => {
  it('serves an html page, live and at a revision, with the bridge script, the sandboxing policy, CORS and the shared headers', async () => {
    await hold(PAGE, 'live', 'index.html', 'html', '<!doctype html><head><title>v2</title></head><p>two</p>');
    await hold(PAGE, 3, 'index.html', 'html', '<!doctype html><p>one</p>');
    const live = await get(artifactUrl(PAGE, 'live', 'index.html'));
    expect(live.status).toBe(200);
    expect(Object.fromEntries(live.headers)).toMatchObject({
      'content-type': 'text/html',
      'content-security-policy': DELIVERABLE_HTML_CSP,
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
    });
    const text = await live.text();
    expect(text.indexOf(MARKER)).toBeGreaterThan(text.indexOf('<head>'));
    expect(text).toContain('<p>two</p>');
    const older = await (await get(artifactUrl(PAGE, 3, 'index.html'))).text();
    expect(older).toContain(MARKER);
    expect(older).toContain('<p>one</p>');
    expect(asked).toEqual([
      { artifactId: PAGE, path: 'index.html' }, // live: no revision asked
      { artifactId: PAGE, revision: 3, path: 'index.html' },
    ]);
  });

  it('serves an asset and a file artifact’s html byte for byte, and a PDF without the sandboxing policy', async () => {
    await hold(PAGE, 'live', 'assets/frame.html', 'html', '<p>asset</p>');
    await hold(FILE, 'live', 'notes.html', 'file', '<p>file</p>');
    await hold(DOC, 'live', 'assets/report.pdf', 'document', '%PDF-1.7');
    expect(await (await get(artifactUrl(PAGE, 'live', 'assets/frame.html'))).text()).toBe('<p>asset</p>');
    expect(await (await get(artifactUrl(FILE, 'live', 'notes.html'))).text()).toBe('<p>file</p>');
    const pdf = await get(artifactUrl(DOC, 'live', 'assets/report.pdf'));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-security-policy')).toBeNull();
  });

  it('answers a byte range 206, and an unsatisfiable one 416', async () => {
    await hold(DOC, 'live', 'assets/clip.mp4', 'document', '0123456789');
    expect((await get(artifactUrl(DOC, 'live', 'assets/clip.mp4'))).headers.get('content-type')).toBe('video/mp4');
    const part = await get(artifactUrl(DOC, 'live', 'assets/clip.mp4'), { headers: { Range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect((await get(artifactUrl(DOC, 'live', 'assets/clip.mp4'), { headers: { Range: 'bytes=20-' } })).status).toBe(416);
  });

  it('answers 404 for what the host does not hold (an unknown revision included), and never asks it about a malformed URL', async () => {
    await hold(PAGE, 'live', 'index.html', 'html', '<p>x</p>');
    expect((await get(artifactUrl(PAGE, 7, 'index.html'))).status).toBe(404);
    expect((await get(artifactUrl(PAGE, 'live', 'other.html'))).status).toBe(404);
    asked = [];
    for (const url of [`maws-artifact://${PAGE}/live/%2e%2e/store.sqlite`, `maws-artifact://${PAGE}/live/assets%2F..%2Fx`, 'maws-artifact://report/live/index.html', `maws-artifact://${PAGE}/latest/index.html`]) {
      expect((await get(url)).status, url).toBe(404);
    }
    expect(asked).toEqual([]);
    expect((await get(artifactUrl(PAGE, 'live', 'index.html'), { method: 'POST' })).status).toBe(405);
  });

  it('answers 404 when the host’s answer names a file that cannot be served (gone, a directory)', async () => {
    files.set(`${PAGE} live index.html`, { kind: 'html', path: join(root, 'gone.html'), name: 'index.html' });
    files.set(`${PAGE} live assets/dir`, { kind: 'html', path: root, name: 'dir' });
    expect((await get(artifactUrl(PAGE, 'live', 'index.html'))).status).toBe(404);
    expect((await get(artifactUrl(PAGE, 'live', 'assets/dir'))).status).toBe(404);
  });
});
