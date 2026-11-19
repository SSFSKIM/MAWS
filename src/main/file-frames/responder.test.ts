// The responder of file frames' tokens (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C; M3, decisions 1 to 5; "The refusals of the route"; sequences 4, 5 and 9): a token answers at one path,
// its file's name, from its source, range by range, holding one identity; every read of a live token that fails tells
// the owner once, and a release under a response ends it and tells nobody. Every path and byte here is invented.
import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactUrl } from '@shared/artifacts/scheme';
import { frameUrl, type FramedKind } from '@shared/files/framed';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { FilesReadOutput } from '@shared/ipc/schema/files';
import { createFilesService, type FilesService } from '../../services/files/service';
import { STORE_FRAME_CSP } from '../../services/artifacts/scheme/scheme-handler';
import { fileFrameResponder } from './responder';
import { FRAME_PAGE_BYTES, localSource, type ByteSource, type Page, type RawRead } from './source';
import { createFrameTokens, type FrameToken } from './tokens';

const owner = endableClientRef('page:1.1');
const SESSION = 'app-session-1' as AppSessionId;

/** A file's bytes as a source: each read recorded; a read can be held, failed, or answer another identity. */
function fileSource(file: Buffer) {
  const reads: Array<{ offset: number; length: number }> = [];
  const faults = new Map<number, Error>();
  const identities = new Map<number, string>();
  const holds = new Map<number, Promise<void>>();
  const source: ByteSource = {
    async read(offset, length): Promise<Page> {
      reads.push({ offset, length });
      const n = reads.length;
      await holds.get(n);
      const fault = faults.get(n);
      if (fault) throw fault;
      return { bytes: new Uint8Array(file.subarray(offset, offset + length)), size: file.length, identity: identities.get(n) ?? 'one version' };
    },
    close: async () => {},
  };
  return {
    source,
    reads,
    /** The `n`th read (from 1) fails. */
    fail: (n: number, error = new Error('the read failed')) => void faults.set(n, error),
    /** The `n`th read answers another identity. */
    another: (n: number) => void identities.set(n, 'another version'),
    /** The `n`th read waits until the answer is let go. */
    hold(n: number): () => void {
      let go!: () => void;
      holds.set(n, new Promise<void>((resolve) => (go = resolve)));
      return () => go();
    },
  };
}

const MIME: Record<FramedKind, string> = { pdf: 'application/pdf', html: 'text/html', video: 'video/mp4', audio: 'audio/mpeg' };

/** A responder over a token table holding `source` as `name`; what it told the owner. */
function serving(source: ByteSource, name = 'report.pdf', framed: FramedKind = 'pdf') {
  const tokens = createFrameTokens();
  const issued = tokens.issue(owner, 1, { name, framed, mime: MIME[framed], csp: framed === 'pdf' ? null : STORE_FRAME_CSP, source });
  if (typeof issued === 'string') throw new Error(`not issued: ${issued}`);
  const told: FrameToken[] = [];
  const entries: string[] = [];
  const respond = fileFrameResponder(tokens, (token) => told.push(token), (request) => entries.push(`${request.method} ${request.url}`));
  const ask = async (url = frameUrl(issued.token, name), init: RequestInit = {}) => {
    const answer = await respond(new Request(url, init));
    if (answer === null) throw new Error(`no answer for ${url}`);
    return answer;
  };
  return { tokens, token: issued, url: frameUrl(issued.token, name), respond, ask, told, entries };
}

const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());
const pattern = (size: number) => Buffer.from(Array.from({ length: size }, (_, n) => (n * 7 + 3) % 251));
const expectNotFound = async (response: Response) => {
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/plain');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('not found');
};

describe('what the responder answers at all', () => {
  it('answers null for a host that is no token, so an artifact is the next responder’s', async () => {
    const { respond, entries } = serving(fileSource(pattern(10)).source);
    expect(await respond(new Request(artifactUrl('00000000-0000-4000-8000-000000000001', 'live', 'index.html')))).toBeNull();
    expect(await respond(new Request('maws-artifact://0123456789abcdef/report.pdf'))).toBeNull();
    expect(entries).toEqual([]);
  });

  it('answers 404 for a token it does not hold', async () => {
    const file = fileSource(pattern(10));
    const { ask } = serving(file.source);
    await expectNotFound(await ask(frameUrl('ffffffffffffffffffffffffffffffff', 'report.pdf')));
    expect(file.reads).toEqual([]);
  });

  it('answers 404 for a released token', async () => {
    const file = fileSource(pattern(10));
    const { ask, tokens, token, told } = serving(file.source);
    expect((await ask()).status).toBe(200);
    expect(tokens.release(token.token, owner)).toBe(true);
    const reads = file.reads.length;
    await expectNotFound(await ask());
    expect(file.reads.length).toBe(reads);
    expect(told).toEqual([]);
  });

  it('answers 404 for any path but the token’s own name: another name, a longer path, an empty path, a query', async () => {
    const file = fileSource(pattern(10));
    const { ask, token } = serving(file.source);
    const host = `maws-artifact://${token.token}`;
    for (const url of [`${host}/other.pdf`, `${host}/REPORT.PDF`, `${host}/report.pdf/more`, `${host}/x/report.pdf`, `${host}/`, host, `${host}/report.pdf?page=2`, `${host}/report.pdf?`]) {
      await expectNotFound(await ask(url));
    }
    expect(file.reads).toEqual([]);
    expect((await ask(`${host}/report.pdf`)).status).toBe(200); // and the name itself is served
  });

  it('answers 404 for a path segment that does not decode', async () => {
    const file = fileSource(pattern(10));
    const { ask, token } = serving(file.source, '100%.pdf');
    await expectNotFound(await ask(`maws-artifact://${token.token}/100%.pdf`));
    await expectNotFound(await ask(`maws-artifact://${token.token}/%E0%A4%A`));
    expect(file.reads).toEqual([]);
    expect((await ask()).status).toBe(200);
  });

  it('serves a name that needs encoding at its encoded path, and only there', async () => {
    const name = 'notes #2? — 회의 100%.html';
    const file = fileSource(Buffer.from('<p>page</p>'));
    const { ask, token, url } = serving(file.source, name, 'html');
    expect(url).toBe(`maws-artifact://${token.token}/${encodeURIComponent(name)}`);
    const served = await ask(url);
    expect(served.status).toBe(200);
    expect((await bytesOf(served)).toString()).toBe('<p>page</p>');
    await expectNotFound(await ask(`maws-artifact://${token.token}/${name}`)); // unencoded: a fragment and a query cut it
    await expectNotFound(await ask(`maws-artifact://${token.token}/notes%20%232%3F`));
  });

  it('answers 405 for a method that is neither GET nor HEAD', async () => {
    const file = fileSource(pattern(10));
    const { ask, url, entries } = serving(file.source);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const answer = await ask(url, { method });
      expect(answer.status).toBe(405);
      expect(answer.headers.get('content-type')).toBe('text/plain');
    }
    expect(file.reads).toEqual([]);
    expect(entries).toHaveLength(4); // each was entered: the seam counts every request for a token host
  });

  it('calls entered at the entry of every request for a token host, whatever it is answered', async () => {
    const { ask, url, token, entries } = serving(fileSource(pattern(10)).source);
    await ask(url);
    await ask(`maws-artifact://${token.token}/other`);
    await ask(frameUrl('ffffffffffffffffffffffffffffffff', 'x.pdf'));
    expect(entries).toEqual([`GET ${url}`, `GET maws-artifact://${token.token}/other`, 'GET maws-artifact://ffffffffffffffffffffffffffffffff/x.pdf']);
  });
});

describe('the bytes', () => {
  it('serves a file larger than one page as the pages’ bytes in order, reading the next page only when the body is pulled', async () => {
    const content = pattern(2 * FRAME_PAGE_BYTES + 123);
    const file = fileSource(content);
    const { ask } = serving(file.source);
    const answer = await ask();
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-length')).toBe(String(content.length));
    expect(file.reads).toEqual([{ offset: 0, length: FRAME_PAGE_BYTES }]);
    const reader = answer.body!.getReader();
    const chunks: Buffer[] = [];
    let chunk = await reader.read();
    chunks.push(Buffer.from(chunk.value!));
    expect(file.reads).toHaveLength(1); // the first page was the first read's
    chunk = await reader.read();
    chunks.push(Buffer.from(chunk.value!));
    expect(file.reads).toEqual([
      { offset: 0, length: FRAME_PAGE_BYTES },
      { offset: FRAME_PAGE_BYTES, length: FRAME_PAGE_BYTES },
    ]);
    for (chunk = await reader.read(); !chunk.done; chunk = await reader.read()) chunks.push(Buffer.from(chunk.value));
    expect(file.reads).toHaveLength(3);
    expect(file.reads[2]).toEqual({ offset: 2 * FRAME_PAGE_BYTES, length: 123 });
    expect(Buffer.concat(chunks).equals(content)).toBe(true);
  });

  it('answers with the store’s headers, the token’s type, and no cross-origin grant', async () => {
    const { ask } = serving(fileSource(pattern(10)).source, 'clip.mp4', 'video');
    const answer = await ask();
    expect(Object.fromEntries(answer.headers)).toMatchObject({
      'content-type': 'video/mp4',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-length': '10',
    });
    expect(answer.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('a PDF’s answer carries no policy header and an HTML file’s, a video’s and a sound’s carry the store’s frame policy', async () => {
    const names: Record<FramedKind, string> = { pdf: 'a.pdf', html: 'a.html', video: 'a.mp4', audio: 'a.mp3' };
    for (const framed of ['pdf', 'html', 'video', 'audio'] as const) {
      const answer = await serving(fileSource(pattern(10)).source, names[framed], framed).ask();
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe(MIME[framed]);
      expect(answer.headers.get('content-security-policy')).toBe(framed === 'pdf' ? null : STORE_FRAME_CSP);
    }
  });

  it('answers a range with 206, its Content-Range and exactly those bytes', async () => {
    const content = pattern(3000);
    const file = fileSource(content);
    const { ask, url } = serving(file.source);
    const answer = await ask(url, { headers: { Range: 'bytes=10-19' } });
    expect(answer.status).toBe(206);
    expect(answer.headers.get('content-range')).toBe('bytes 10-19/3000');
    expect(answer.headers.get('content-length')).toBe('10');
    expect((await bytesOf(answer)).equals(content.subarray(10, 20))).toBe(true);
    expect(file.reads).toEqual([{ offset: 10, length: 10 }]);
    const open = await ask(url, { headers: { Range: 'bytes=2990-' } });
    expect(open.headers.get('content-range')).toBe('bytes 2990-2999/3000');
    expect((await bytesOf(open)).equals(content.subarray(2990))).toBe(true);
  });

  it('answers a suffix range from the end', async () => {
    const content = pattern(3000);
    const file = fileSource(content);
    const { ask, url } = serving(file.source);
    const answer = await ask(url, { headers: { Range: 'bytes=-100' } });
    expect(answer.status).toBe(206);
    expect(answer.headers.get('content-range')).toBe('bytes 2900-2999/3000');
    expect((await bytesOf(answer)).equals(content.subarray(2900))).toBe(true);
    expect(file.reads).toEqual([
      { offset: 0, length: 1 }, // the probe, to learn the size
      { offset: 2900, length: 100 },
    ]);
  });

  it('answers a multi-range or a malformed one with the whole file', async () => {
    const content = pattern(300);
    for (const range of ['bytes=0-1,5-9', 'bytes=-', 'items=0-5', 'bytes=9-3']) {
      const answer = await serving(fileSource(content).source).ask(undefined, { headers: { Range: range } });
      expect(answer.status).toBe(200);
      expect((await bytesOf(answer)).equals(content)).toBe(true);
    }
  });

  it('answers 416 for a range that starts past the end', async () => {
    const file = fileSource(pattern(3000));
    const { ask, url, told } = serving(file.source);
    for (const range of ['bytes=3000-', 'bytes=5000-6000', 'bytes=-0']) {
      const answer = await ask(url, { headers: { Range: range } });
      expect(answer.status).toBe(416);
      expect(answer.headers.get('content-range')).toBe('bytes */3000');
    }
    expect(told).toEqual([]);
    const empty = serving(fileSource(Buffer.alloc(0)).source);
    expect((await empty.ask(empty.url, { headers: { Range: 'bytes=0-' } })).status).toBe(416);
    const whole = await empty.ask();
    expect(whole.status).toBe(200);
    expect((await bytesOf(whole)).length).toBe(0);
  });

  it('answers HEAD with the headers and no body', async () => {
    const file = fileSource(pattern(3000));
    const { ask, url } = serving(file.source);
    const answer = await ask(url, { method: 'HEAD' });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-length')).toBe('3000');
    expect(answer.headers.get('content-type')).toBe('application/pdf');
    expect(answer.body).toBeNull();
    expect(file.reads).toEqual([{ offset: 0, length: 1 }]); // the size alone is needed
    const ranged = await ask(url, { method: 'HEAD', headers: { Range: 'bytes=100-199' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 100-199/3000');
    expect(ranged.body).toBeNull();
  });

  it('every byte of one response is from reads that answered one identity', async () => {
    const content = pattern(3 * FRAME_PAGE_BYTES);
    const identities: string[] = [];
    const file = fileSource(content);
    const recording: ByteSource = {
      read: async (offset, length) => {
        const page = await file.source.read(offset, length);
        identities.push(page.identity);
        return page;
      },
      close: async () => {},
    };
    const { ask, told } = serving(recording);
    expect((await bytesOf(await ask())).equals(content)).toBe(true);
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(1);
    expect(told).toEqual([]);
  });
});

describe('one failure path (A3; sequence 4)', () => {
  /** A raw read of this Mac's daemon that answers as `answer` says. */
  const local = (answer: () => Promise<Awaited<ReturnType<RawRead>>>) => localSource(() => answer(), owner, { appSessionId: SESSION, path: '/work/invented/report.pdf' }, { named: true });
  const older = (): FilesReadOutput => ({ encoding: 'base64', content: Buffer.from('%PDF').toString('base64'), bytes: 4, offset: 0, length: 4, truncated: false, mime: 'application/pdf', hash: null, utf8: null });

  it('a first read that fails answers 404 and tells the owner: a file gone, an admission lost, a daemon that does not answer, an answer with no identity', async () => {
    const cases: Array<[string, () => Promise<Awaited<ReturnType<RawRead>>>]> = [
      ['a file gone', async () => ({ ok: false, error: ipcError('invalid_input', 'not found: /work/invented/report.pdf') })],
      ['an admission lost', async () => ({ ok: false, error: ipcError('invalid_input', "path outside the session's directories") })],
      ['a daemon that does not answer', async () => ({ ok: false, error: ipcError('host_unavailable', 'files.read: the daemon is not running') })],
      ['an answer with no identity', async () => ({ ok: true, value: older() })],
    ];
    for (const [what, answer] of cases) {
      let asked = 0;
      const { ask, told, token } = serving(
        local(async () => {
          asked++;
          return answer();
        }),
      );
      await expectNotFound(await ask());
      expect(told, what).toEqual([token]);
      expect(asked, what).toBe(1);
    }
  });

  it('a suffix range whose probe fails tells the owner', async () => {
    const file = fileSource(pattern(3000));
    file.fail(1);
    const { ask, url, told, token } = serving(file.source);
    await expectNotFound(await ask(url, { headers: { Range: 'bytes=-100' } }));
    expect(told).toEqual([token]);
    expect(file.reads).toEqual([{ offset: 0, length: 1 }]);
  });

  it('ends the response in an error when a later page answers another identity, and tells the owner', async () => {
    const content = pattern(3 * FRAME_PAGE_BYTES);
    const file = fileSource(content);
    file.another(2);
    const { ask, told, token } = serving(file.source);
    const answer = await ask();
    expect(answer.status).toBe(200);
    const reader = answer.body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!).equals(content.subarray(0, FRAME_PAGE_BYTES))).toBe(true);
    await expect(reader.read()).rejects.toThrow();
    expect(told).toEqual([token]);
    expect(file.reads).toHaveLength(2); // no further page is asked
  });

  it('ends the response in an error when a page is refused, and tells the owner (the daemon restarted under it)', async () => {
    const content = pattern(3 * FRAME_PAGE_BYTES);
    let reads = 0;
    const source = local(async () => {
      reads++;
      if (reads === 2) return { ok: false, error: ipcError('host_unavailable', 'files.read: the daemon is restarting') };
      return { ok: true, value: { ...older(), content: content.subarray(0, FRAME_PAGE_BYTES).toString('base64'), bytes: content.length, length: FRAME_PAGE_BYTES, truncated: true, identity: 'one version' } };
    });
    const { ask, told, token } = serving(source);
    const answer = await ask();
    const reader = answer.body!.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toThrow();
    expect(told).toEqual([token]);
    expect(reads).toBe(2);
    await expect(reader.read()).rejects.toThrow(); // nothing asks again by itself
    expect(reads).toBe(2);
  });

  it('a release ends a response in flight and tells nobody', async () => {
    const content = pattern(3 * FRAME_PAGE_BYTES);
    const file = fileSource(content);
    const { ask, tokens, token, told } = serving(file.source);
    const reader = (await ask()).body!.getReader();
    await reader.read();
    expect(tokens.release(token.token, owner)).toBe(true);
    await expect(reader.read()).rejects.toThrow();
    expect(file.reads).toHaveLength(1); // its next page is not read
    expect(told).toEqual([]);
  });

  it('a release while a page is read ends the response and tells nobody, even when the read then fails', async () => {
    const content = pattern(3 * FRAME_PAGE_BYTES);
    const file = fileSource(content);
    const go = file.hold(2);
    file.fail(2);
    const { ask, tokens, token, told } = serving(file.source);
    const reader = (await ask()).body!.getReader();
    await reader.read();
    const second = reader.read();
    await expect.poll(() => file.reads.length).toBe(2);
    tokens.release(token.token, owner);
    go();
    await expect(second).rejects.toThrow();
    expect(told).toEqual([]);
  });

  it('a first read that fails after the token’s release answers 404 and tells nobody', async () => {
    const file = fileSource(pattern(10));
    const go = file.hold(1);
    file.fail(1);
    const { ask, tokens, token, told } = serving(file.source);
    const pending = ask();
    await expect.poll(() => file.reads.length).toBe(1);
    tokens.release(token.token, owner);
    go();
    await expectNotFound(await pending);
    expect(told).toEqual([]);
  });

  it('a first read held while the token is released answers 404 and tells nobody', async () => {
    const file = fileSource(pattern(10));
    const go = file.hold(1);
    const { ask, tokens, token, told } = serving(file.source);
    const pending = ask();
    await expect.poll(() => file.reads.length).toBe(1);
    tokens.release(token.token, owner);
    go();
    await expectNotFound(await pending);
    expect(told).toEqual([]);
  });
});

describe('the route over the real files service (B12, the route’s half)', () => {
  const dirs: string[] = [];
  const services: FilesService[] = [];
  afterEach(() => {
    for (const service of services.splice(0)) service.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('a same-size replacement between two ranges of one response ends it in an error', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-frame-route-')));
    dirs.push(root);
    const path = join(root, 'report.pdf');
    const size = 2 * FRAME_PAGE_BYTES + 10;
    writeFileSync(path, Buffer.alloc(size, 0x61));
    const files = createFilesService({ records: (id) => (id === SESSION ? { directory: root, additionalDirectories: [], worktree: null } : null) });
    services.push(files);
    const read: RawRead = async (input) => {
      try {
        return { ok: true, value: await files.read(input) };
      } catch (error) {
        return { ok: false, error: ipcError('invalid_input', (error as Error).message) };
      }
    };
    const { ask, told, token } = serving(localSource(read, owner, { appSessionId: SESSION, path }, { named: true }));
    const reader = (await ask()).body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!).equals(Buffer.alloc(FRAME_PAGE_BYTES, 0x61))).toBe(true);
    writeFileSync(join(root, 'replacement.pdf'), Buffer.alloc(size, 0x62));
    renameSync(join(root, 'replacement.pdf'), path); // another file of the same size, put in its place
    await expect(reader.read()).rejects.toThrow();
    expect(told).toEqual([token]);
  });
});
