// Main's file frames (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §D; M4,
// decisions 1 to 9; "The refusals of the route"; sequences 6 and 7; "Nothing new is asked of or offered to another
// machine"): `layout.frameFile` issues a token to the asking page after one raw read of the file's head on this Mac, or
// after copying another machine's file into a descriptor that never has a name; `layout.releaseFrame` releases it for
// its page alone; a read that fails for a live token tells that page alone. This Mac's reads are the real files service,
// and another machine's are the real files service behind a link, so what crosses is what would. Every path, name and
// byte here is invented.
import { mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_TOKEN, frameUrl } from '@shared/files/framed';
import type { AppSessionId } from '@shared/graph/ids';
import { thrownError } from '@shared/host/runtime';
import { endableClientRef, type ClientRef, type EndableClientRef } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import type { CommandOutput } from '@shared/ipc/schema';
import type { FilesReadInput, FilesReadOutput } from '@shared/ipc/schema/files';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import type { MachineRef } from '@shared/machine/ref';
import { STORE_FRAME_CSP } from '../../services/artifacts/scheme/scheme-handler';
import { createFilesService, type FilesService } from '../../services/files/service';
import { fetchInto } from '../lane-b/remote-copy';
import { REMOTE_READ_PAGE_BYTES } from '../lane-b/remote-files-read';
import type { RemoteLink } from '../machines/remote/link';
import { FRAME_HEAD_BYTES } from './charset';
import type { RawRead } from './source';
import { FRAME_TOKENS_MAX } from './tokens';
import { FRAME_COPIES_DIR, startFileFrames, type FileFramesDeps } from '.';

/** The OS's unlink, as a test makes it: its own (`null`), or one that fails. */
const fsHooks = vi.hoisted(() => ({ unlink: null as null | ((path: string) => Promise<void>) }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: (path: string) => (fsHooks.unlink ?? actual.unlink)(path) };
});

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const MINI = 'MiniMachineRef00000000' as MachineRef;
const FAR = 'FarMachineRef000000000' as MachineRef; // no link reaches it
const SESSION = 'app-session-lark-91' as AppSessionId;
const UNHELD = 'c0ffee11d00d4e5fa6b7c8d9e0f1a2b3';
/** What the copy of "Open externally" sends today when it proves a text file, and nothing else. */
const SENT = ['appSessionId', 'path', 'offset', 'length', 'hash'];

type FrameAnswer = CommandOutput<'layout.frameFile'>;
type Ready = Extract<FrameAnswer, { status: 'ready' }>;
type Answer<T> = { ok: true; value: T } | { ok: false; error: IpcError };

const dirs: string[] = [];
const services: FilesService[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  fsHooks.unlink = null;
  vi.useRealTimers();
  for (const stop of stops.splice(0)) stop();
  for (const service of services.splice(0)) service.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const scratch = async (prefix: string) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** This Mac's files service over a session whose folder is `root`, as main's raw reads reach it; what it was asked, as whom. */
function serviceRead(root: string): RawRead & { asked: Array<{ input: FilesReadInput; as: ClientRef }> } {
  const files = createFilesService({ records: (id) => (id === SESSION ? { directory: root, additionalDirectories: [], worktree: null } : null) });
  services.push(files);
  const asked: Array<{ input: FilesReadInput; as: ClientRef }> = [];
  const read: RawRead = async (input, as) => {
    asked.push({ input, as });
    try {
      return { ok: true, value: await files.read(input) };
    } catch (error) {
      return { ok: false, error: ipcError('invalid_input', (error as Error).message) };
    }
  };
  return Object.assign(read, { asked });
}

/** Another machine whose `files.read` is the real files service; each call it was sent, the `n`th held by `before[n]`. */
function machine(before: Record<number, () => Promise<void>> = {}) {
  const files = createFilesService({ records: () => null });
  services.push(files);
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const link = {
    machine: MINI,
    name: 'mini',
    call: async (name: string, input: { path: string; offset?: number; length?: number; hash?: boolean }) => {
      calls.push({ name, input });
      await before[calls.length]?.();
      return { ok: true, output: await files.readResolved({ path: input.path, ...(input.offset !== undefined && { offset: input.offset }), ...(input.length !== undefined && { length: input.length }), ...(input.hash !== undefined && { hash: input.hash }) }) };
    },
  } as unknown as RemoteLink;
  return { link, calls };
}

/** Main's file frames over a session folder of this Mac, and `link` for the machine MINI. */
async function lab(options: { link?: RemoteLink; read?: RawRead; seam?: boolean } = {}) {
  const userData = await scratch('maws-file-frames-profile-');
  const root = await scratch('maws-file-frames-session-');
  const read = options.read ?? serviceRead(root);
  const registered = new Map<string, (input: unknown, context: { client: ClientRef; target: MachineRef }) => unknown>();
  const pages = new Map<string, { id: number; live: boolean; sent: Array<{ name: string; payload: { token: string } }> }>();
  const logged: string[] = [];
  const seams: string[] = [];
  const sinks: FileHandle[] = [];
  const deps: FileFramesDeps = {
    local: LOCAL,
    read,
    copy: async (to, source, sink, max, copyOptions) => {
      sinks.push(sink);
      return to === MINI && options.link ? fetchInto(options.link, source, sink, max, (line) => void logged.push(line), copyOptions) : null;
    },
    page: (client) => {
      const page = pages.get(client.id);
      return page?.live ? { id: page.id, send: (name, payload) => void page.sent.push({ name, payload }) } : null;
    },
    userData: () => userData,
    register: ((name: string, handler: (input: unknown, context: { client: ClientRef; target: MachineRef }) => unknown) => void registered.set(name, handler)) as unknown as FileFramesDeps['register'],
    ...(options.seam && { seam: (line: string) => void seams.push(line) }),
    log: (line) => void logged.push(line),
  };
  const started = startFileFrames(deps);
  stops.push(() => started.stop());
  /** An app page whose web contents' id is `id`, live until it ends. */
  const pageOf = (id: number): EndableClientRef => {
    const ref = endableClientRef(`page:${id}.1`);
    const page = { id, live: true, sent: [] as Array<{ name: string; payload: { token: string } }> };
    pages.set(ref.id, page);
    ref.onGone(() => void (page.live = false));
    return ref;
  };
  /** A command as the router answers it: the handler's value, or its failure's IpcError. */
  const call = async <T>(name: string, input: unknown, client: ClientRef, target: MachineRef = LOCAL): Promise<Answer<T>> => {
    const handler = registered.get(name);
    if (!handler) throw new Error(`${name} is not registered`);
    try {
      return { ok: true, value: (await handler(input, { client, target })) as T };
    } catch (error) {
      return { ok: false, error: thrownError(error) };
    }
  };
  const frameFile = (path: string, client: ClientRef, target: MachineRef = LOCAL) => call<FrameAnswer>('layout.frameFile', { appSessionId: SESSION, path }, client, target);
  const ready = async (path: string, client: ClientRef, target: MachineRef = LOCAL): Promise<Ready> => {
    const answer = await frameFile(path, client, target);
    if (!answer.ok || answer.value.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(answer)}`);
    return answer.value;
  };
  const get = async (url: string, init?: RequestInit) => (await started.responder(new Request(url, init)))!;
  const copies = () => readdir(join(userData, FRAME_COPIES_DIR)).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const sentTo = (client: ClientRef) => pages.get(client.id)!.sent;
  return { started, root, userData, read, logged, seams, sinks, pageOf, call, frameFile, ready, get, copies, sentTo };
}

describe('layout.frameFile on this Mac', () => {
  it('reads the file’s head once, raw, as the asking page, and its token serves the file to that page’s web contents', async () => {
    const l = await lab();
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(FRAME_HEAD_BYTES * 2, 0x20)]);
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, bytes);
    const owner = l.pageOf(7);
    const answer = await l.ready(path, owner);
    expect(answer).toStrictEqual({ status: 'ready', token: answer.token, url: frameUrl(answer.token, 'ledger.pdf'), framed: 'pdf' });
    expect(answer.token).toMatch(FRAME_TOKEN);
    expect((l.read as ReturnType<typeof serviceRead>).asked).toStrictEqual([{ input: { appSessionId: SESSION, path, offset: 0, length: FRAME_HEAD_BYTES, raw: true, named: true }, as: owner }]);
    expect(l.started.tokens.ownerOf(answer.token)).toBe(7);
    const served = await l.get(answer.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(served.headers.get('content-security-policy')).toBeNull();
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
    // a video's token carries the store's frame policy, fixed at issue
    await writeFile(join(l.root, 'clip.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]));
    const clip = await l.ready(join(l.root, 'clip.webm'), owner);
    expect(clip.framed).toBe('video');
    expect((await l.get(clip.url)).headers.get('content-security-policy')).toBe(STORE_FRAME_CSP);
  });

  it('answers unserved for a daemon that answers no identity or text, and unframed for a type no frame draws', async () => {
    const plain = (extra: Partial<FilesReadOutput>): RawRead => async () => ({ ok: true, value: { encoding: 'base64', content: '', bytes: 10, offset: 0, length: 0, truncated: true, mime: 'application/pdf', hash: null, utf8: null, ...extra } });
    const older = await lab({ read: plain({}) }); // a daemon that does not know `raw` drops it and answers the plain read
    const issue = vi.spyOn(older.started.tokens, 'issue');
    expect(await older.frameFile('/w/invented/ledger.pdf', older.pageOf(7))).toEqual({ ok: true, value: { status: 'row', why: 'unserved' } });
    const text = await lab({ read: plain({ encoding: 'utf8', mime: 'text/html', identity: '1:2:10:3:4' }) });
    expect(await text.frameFile('/w/invented/notes.html', text.pageOf(7))).toEqual({ ok: true, value: { status: 'row', why: 'unserved' } });
    const l = await lab();
    await writeFile(join(l.root, 'notes.txt'), 'plain invented words');
    expect(await l.frameFile(join(l.root, 'notes.txt'), l.pageOf(7))).toEqual({ ok: true, value: { status: 'row', why: 'unframed' } });
    expect(issue).not.toHaveBeenCalled();
  });

  it('frameFile refuses a path the files service refuses, with its words', async () => {
    const l = await lab();
    const outside = await scratch('maws-file-frames-outside-');
    await writeFile(join(outside, 'ledger.pdf'), '%PDF-1.4 invented');
    const issue = vi.spyOn(l.started.tokens, 'issue');
    for (const path of [join(outside, 'ledger.pdf'), join(l.root, 'nothing-here.pdf')]) {
      const direct = await l.read({ appSessionId: SESSION, path, offset: 0, length: FRAME_HEAD_BYTES, raw: true, named: true }, l.pageOf(9));
      expect(direct.ok, path).toBe(false);
      expect(await l.frameFile(path, l.pageOf(7))).toEqual(direct);
    }
    expect(issue).not.toHaveBeenCalled();
  });

  it('the URL answered ends in the file’s encoded base name and holds no folder', async () => {
    const l = await lab();
    const folder = join(l.root, 'quillon orchard #5c1');
    await mkdir(folder);
    const name = 'Q3 ledger draft #2 ?ä%.pdf';
    await writeFile(join(folder, name), '%PDF-1.4 invented');
    const answer = await l.ready(join(folder, name), l.pageOf(7));
    expect(answer.url).toBe(`maws-artifact://${answer.token}/${encodeURIComponent(name)}`);
    expect(answer.url).not.toContain('quillon');
    expect(answer.url).not.toContain(l.root);
    expect(answer.url.slice('maws-artifact://'.length).split('/')).toHaveLength(2);
    expect((await l.get(answer.url)).status).toBe(200);
    expect((await l.get(`maws-artifact://${answer.token}/${encodeURIComponent('quillon orchard #5c1')}/${encodeURIComponent(name)}`)).status).toBe(404);
  });

  it('an issue past the bound fails with main’s words, and another page still has its own', async () => {
    const l = await lab();
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, '%PDF-1.4 invented');
    const owner = l.pageOf(7);
    for (let n = 0; n < FRAME_TOKENS_MAX; n++) await l.ready(path, owner);
    expect(await l.frameFile(path, owner)).toEqual({ ok: false, error: ipcError('invalid_input', 'layout.frameFile: too many file frames in this window') });
    expect((await l.ready(path, l.pageOf(8))).status).toBe('ready');
  });
});

describe('layout.frameFile for another machine', () => {
  it('frameFile for another machine sends that machine nothing but the copy’s pages', async () => {
    const { link, calls } = machine();
    const l = await lab({ link });
    const bytes = Buffer.from(Array.from({ length: REMOTE_READ_PAGE_BYTES + 4096 }, (_, i) => i % 251));
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, bytes);
    const owner = l.pageOf(7);
    const answer = await l.ready(path, owner, MINI);
    expect(answer).toStrictEqual({ status: 'ready', token: answer.token, url: frameUrl(answer.token, 'ledger.pdf'), framed: 'pdf' });
    expect(calls.length).toBeGreaterThan(1);
    for (const { name, input } of calls) {
      expect(name).toBe('files.read');
      expect(input).toMatchObject({ appSessionId: SESSION, path, hash: true });
      expect(Object.keys(input).filter((key) => !SENT.includes(key))).toEqual([]);
    }
    expect((l.read as ReturnType<typeof serviceRead>).asked).toEqual([]); // this Mac's daemon is asked nothing for it
    const sent = calls.length;
    const served = await l.get(answer.url);
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
    expect(calls).toHaveLength(sent); // served from the copy, not from the machine
    expect(await l.copies()).toEqual([]);
    expect(l.logged.filter((line) => line.includes(path) || line.includes(answer.token))).toEqual([]);
    // the page's end releases its token and closes the copy, which has no name: the copy's end
    (owner as EndableClientRef).end();
    expect((await l.get(answer.url)).status).toBe(404);
    await vi.waitFor(() => expect(l.sinks[0]!.fd).toBe(-1));
  });

  it('frameFile answers too-large past the copy’s bound, with its descriptor closed', async () => {
    const { link, calls } = machine();
    const l = await lab({ link });
    const path = join(l.root, 'long take.mp4');
    const handle = await open(path, 'w');
    await handle.truncate(REMOTE_COPY_MAX_BYTES + 1); // sparse: nothing of it is written
    await handle.close();
    expect(await l.frameFile(path, l.pageOf(7), MINI)).toEqual({ ok: true, value: { status: 'row', why: 'too-large' } });
    expect(calls).toHaveLength(1);
    expect(l.sinks).toHaveLength(1);
    expect(l.sinks[0]!.fd).toBe(-1);
    expect(await l.copies()).toEqual([]);
  });

  it('frameFile fails when the machine is not connected', async () => {
    const l = await lab();
    const issue = vi.spyOn(l.started.tokens, 'issue');
    expect(await l.frameFile('/w/invented/ledger.pdf', l.pageOf(7), FAR)).toEqual({ ok: false, error: ipcError('host_unavailable', `layout.frameFile: machine ${FAR} is not connected`) });
    expect(l.sinks.every((sink) => sink.fd === -1)).toBe(true);
    expect(await l.copies()).toEqual([]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('a copy that does not arrive fails with the link’s words and leaves no token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let arrived!: () => void;
    const asked = new Promise<void>((resolve) => (arrived = resolve));
    // the link's own timeout answers the page it holds
    const link = { machine: MINI, name: 'mini', call: () => (arrived(), new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: { code: 'timeout' } }), 30_000))) } as unknown as RemoteLink;
    const l = await lab({ link });
    const issue = vi.spyOn(l.started.tokens, 'issue');
    const answer = l.frameFile('/w/invented/ledger.pdf', l.pageOf(7), MINI);
    await asked;
    expect(await l.copies()).toEqual([]); // at the held page
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await answer).toEqual({ ok: false, error: ipcError('timeout', 'files.read: machine mini did not answer in time') });
    expect(l.sinks).toHaveLength(1);
    expect(l.sinks[0]!.fd).toBe(-1);
    expect(await l.copies()).toEqual([]);
    expect(issue).not.toHaveBeenCalled();
  });

  it('at every held point of a copy the copies folder lists no entry: before the first page, between two pages, between two passes, after the answer, after the release', async () => {
    const size = REMOTE_READ_PAGE_BYTES + 4096;
    const looked: Array<[string, string[]]> = [];
    let l: Awaited<ReturnType<typeof lab>> | null = null;
    let path = '';
    const look = (point: string) => async () => void looked.push([point, await l!.copies()]);
    const { link, calls } = machine({
      1: look('before the first page'),
      2: async () => {
        await look('between two pages')();
        await writeFile(`${path}.next`, Buffer.alloc(size, 0x62)); // another file of the same size, put in its place
        await rename(`${path}.next`, path);
      },
      3: look('between two passes'),
    });
    l = await lab({ link });
    path = join(l.root, 'ledger.pdf');
    await writeFile(path, Buffer.alloc(size, 0x61));
    const owner = l.pageOf(7);
    const answer = await l.ready(path, owner, MINI);
    await look('after the answer')();
    expect(calls).toHaveLength(4); // two pages, then both again
    expect(Buffer.from(await (await l.get(answer.url)).arrayBuffer()).equals(Buffer.alloc(size, 0x62))).toBe(true); // one version
    expect(await l.call('layout.releaseFrame', { token: answer.token }, owner)).toEqual({ ok: true, value: undefined });
    await look('after the release')();
    expect(looked).toEqual([
      ['before the first page', []],
      ['between two pages', []],
      ['between two passes', []],
      ['after the answer', []],
      ['after the release', []],
    ]);
    expect((await stat(join(l.userData, FRAME_COPIES_DIR))).mode & 0o777).toBe(0o700);
    await vi.waitFor(() => expect(l!.sinks[0]!.fd).toBe(-1)); // the release closed the copy's descriptor
  });

  it('a sink whose name cannot be removed fetches nothing', async () => {
    const { link, calls } = machine();
    const l = await lab({ link });
    fsHooks.unlink = async () => {
      throw Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' });
    };
    const issue = vi.spyOn(l.started.tokens, 'issue');
    const answer = await l.frameFile(join(l.root, 'ledger.pdf'), l.pageOf(7), MINI);
    expect(answer.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(l.sinks).toEqual([]); // the copy was never asked
    expect(issue).not.toHaveBeenCalled();
    const left = await l.copies(); // the file whose name stayed holds no byte
    expect(left).toHaveLength(1);
    expect((await stat(join(l.userData, FRAME_COPIES_DIR, left[0]!))).size).toBe(0);
  });

  it('an HTML file with no declared charset is issued as text/html; charset=utf-8 and one that declares its own as text/html, on this Mac and from a copy', async () => {
    const bare = '<!doctype html><title>Kassenbuch</title><p>Grüße aus der Werkstatt</p>';
    const declared = '<!doctype html><meta charset="utf-8"><title>Kassenbuch</title><p>Grüße aus der Werkstatt</p>';
    const { link } = machine();
    const l = await lab({ link });
    await writeFile(join(l.root, 'bare.html'), bare);
    await writeFile(join(l.root, 'declared.html'), declared);
    const owner = l.pageOf(7);
    for (const target of [LOCAL, MINI]) {
      const plain = await l.ready(join(l.root, 'bare.html'), owner, target);
      const own = await l.ready(join(l.root, 'declared.html'), owner, target);
      expect([plain.framed, own.framed], target).toEqual(['html', 'html']);
      const a = await l.get(plain.url);
      expect(a.headers.get('content-type'), target).toBe('text/html; charset=utf-8');
      expect(a.headers.get('content-security-policy'), target).toBe(STORE_FRAME_CSP);
      expect(await a.text(), target).toBe(bare);
      const b = await l.get(own.url);
      expect(b.headers.get('content-type'), target).toBe('text/html');
      expect(await b.text(), target).toBe(declared);
    }
  });
});

// M5, decision 14 (the owner's answer to card 2): an HTML file's ready answer says whether its head names files beside
// it, read from the head already read for the charset; never for another kind.
describe('the files beside an HTML page', () => {
  it('an HTML file’s ready answer carries neighbours from its head, on this Mac and from a copy', async () => {
    const { link } = machine();
    const l = await lab({ link });
    await writeFile(join(l.root, 'styled.html'), '<!doctype html><link rel="stylesheet" href="ledger.css"><p>Kassenbuch</p>');
    await writeFile(join(l.root, 'alone.html'), '<!doctype html><style>p { margin: 0 }</style><p>Kassenbuch</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">');
    const owner = l.pageOf(7);
    for (const target of [LOCAL, MINI]) {
      const styled = await l.ready(join(l.root, 'styled.html'), owner, target);
      expect(styled, target).toStrictEqual({ status: 'ready', token: styled.token, url: frameUrl(styled.token, 'styled.html'), framed: 'html', neighbours: true });
      const alone = await l.ready(join(l.root, 'alone.html'), owner, target);
      expect(alone, target).toStrictEqual({ status: 'ready', token: alone.token, url: frameUrl(alone.token, 'alone.html'), framed: 'html', neighbours: false });
    }
  });

  it('a PDF’s, a video’s and a sound’s ready answer carries no neighbours', async () => {
    const { link } = machine();
    const l = await lab({ link });
    // each names a file beside it in the shape a page would, so only the kind keeps the fact away
    const named = '<link rel="stylesheet" href="ledger.css"><script src="app.js"></script>';
    await writeFile(join(l.root, 'ledger.pdf'), `%PDF-1.4 ${named}`);
    await writeFile(join(l.root, 'tide.webm'), Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(named)]));
    await writeFile(join(l.root, 'bell.wav'), Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.from(named)]));
    const owner = l.pageOf(7);
    for (const target of [LOCAL, MINI]) {
      for (const [name, framed] of [['ledger.pdf', 'pdf'], ['tide.webm', 'video'], ['bell.wav', 'audio']] as const) {
        const answer = await l.ready(join(l.root, name), owner, target);
        expect(answer, `${name} ${target}`).toStrictEqual({ status: 'ready', token: answer.token, url: frameUrl(answer.token, name), framed });
      }
    }
  });
});

describe('a token’s page', () => {
  it('an issue whose page ended during its admission read, or during its copy, records nothing and closes the copy’s descriptor', async () => {
    // on this Mac: the head's read held while the page reloads
    let readHeld!: () => void;
    let readAsked!: () => void;
    const asked = new Promise<void>((resolve) => (readAsked = resolve));
    const root = await scratch('maws-file-frames-held-');
    await writeFile(join(root, 'ledger.pdf'), '%PDF-1.4 invented');
    const inner = serviceRead(root);
    const read: RawRead = async (input, as) => {
      readAsked();
      await new Promise<void>((resolve) => (readHeld = resolve));
      return inner(input, as);
    };
    const here = await lab({ read });
    const issueHere = vi.spyOn(here.started.tokens, 'issue');
    const reloading = here.pageOf(7);
    const pending = here.frameFile(join(root, 'ledger.pdf'), reloading);
    await asked;
    reloading.end();
    readHeld();
    expect((await pending).ok).toBe(false);
    expect(issueHere.mock.results.filter((result) => typeof result.value !== 'string')).toEqual([]); // no token came of it

    // from another machine: the copy's first page held while the page reloads
    let away: EndableClientRef | null = null;
    const { link } = machine({ 1: async () => away!.end() });
    const there = await lab({ link });
    await writeFile(join(there.root, 'ledger.pdf'), '%PDF-1.4 invented');
    const issueThere = vi.spyOn(there.started.tokens, 'issue');
    away = there.pageOf(8);
    expect((await there.frameFile(join(there.root, 'ledger.pdf'), away, MINI)).ok).toBe(false);
    expect(issueThere.mock.results.filter((result) => typeof result.value !== 'string')).toEqual([]);
    expect(there.sinks[0]!.fd).toBe(-1);
    expect(await there.copies()).toEqual([]);
  });

  it('layout.releaseFrame fails with one sentence for another page’s token and an unknown one, and its owner’s release ends the token’s answers', async () => {
    const l = await lab();
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, '%PDF-1.4 invented');
    const owner = l.pageOf(7);
    const other = l.pageOf(8);
    const answer = await l.ready(path, owner);
    const refusal = { ok: false, error: ipcError('invalid_input', 'layout.releaseFrame: no frame of this window') };
    expect(await l.call('layout.releaseFrame', { token: answer.token }, other)).toEqual(refusal);
    expect(await l.call('layout.releaseFrame', { token: UNHELD }, owner)).toEqual(refusal);
    expect((await l.get(answer.url)).status).toBe(200); // still its owner's
    expect(await l.call('layout.releaseFrame', { token: answer.token }, owner)).toEqual({ ok: true, value: undefined });
    expect((await l.get(answer.url)).status).toBe(404);
    expect(await l.call('layout.releaseFrame', { token: answer.token }, owner)).toEqual(refusal);
  });

  it('a read that fails for a live token tells its owner’s page alone, with layout.frameFailed', async () => {
    const l = await lab();
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, '%PDF-1.4 invented');
    const owner = l.pageOf(7);
    const other = l.pageOf(8);
    const mine = await l.ready(path, owner);
    const theirs = await l.ready(path, other);
    await rm(path);
    expect((await l.get(mine.url)).status).toBe(404);
    expect(l.sentTo(owner)).toEqual([{ name: 'layout.frameFailed', payload: { token: mine.token } }]);
    expect(l.sentTo(other)).toEqual([]);
    expect((await l.get(theirs.url)).status).toBe(404);
    expect(l.sentTo(other)).toEqual([{ name: 'layout.frameFailed', payload: { token: theirs.token } }]);
    expect(l.logged.filter((line) => line.includes(mine.token) || line.includes(theirs.token) || line.includes(path))).toEqual([]);
  });

  it('the responder writes a frame-entry line at its entry when the e2e seam is given, and none without it', async () => {
    const l = await lab({ seam: true });
    const path = join(l.root, 'ledger.pdf');
    await writeFile(path, '%PDF-1.4 invented');
    const answer = await l.ready(path, l.pageOf(7));
    await l.get(answer.url, { headers: { Range: 'bytes=0-3' } });
    await l.get(answer.url, { method: 'HEAD' });
    await l.get(`maws-artifact://${UNHELD}/ledger.pdf`);
    expect(await l.started.responder(new Request('maws-artifact://0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/live/index.html'))).toBeNull(); // an artifact's: no line
    expect(l.seams).toEqual([`frame-entry GET bytes=0-3 ${answer.url}`, `frame-entry HEAD - ${answer.url}`, `frame-entry GET - maws-artifact://${UNHELD}/ledger.pdf`]);
    const quiet = await lab();
    await writeFile(join(quiet.root, 'ledger.pdf'), '%PDF-1.4 invented');
    await quiet.get((await quiet.ready(join(quiet.root, 'ledger.pdf'), quiet.pageOf(7))).url);
    expect(quiet.seams).toEqual([]);
  });
});
