// P3-A M5: main's `artifacts.resync`, its one reconcile hook for a view that mirrors the store: announced each time the
// engine host's connection starts streaming, in either mode, and no more once the artifacts' side is stopped.
// P5 O5 M2: on the daemon shape the scheme goes through the proxy to the daemon's artifact endpoint while the daemon's
// welcome lists machine.artifacts, and to the store's files in main otherwise.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveOverHttp } from '../../services/artifacts/scheme/http';
import { artifactSchemeHandler } from '../../render/scheme';
import { endableClientRef } from '@shared/ipc/client';
import { frameUrl } from '@shared/files/framed';
import { fileFrameResponder } from '../file-frames/responder';
import { createFrameTokens } from '../file-frames/tokens';

const sessions = vi.hoisted(() => {
  const make = () => ({ protocol: { handle: vi.fn() } });
  return { default: make(), capture: make(), partitions: [] as string[] };
});
vi.mock('electron', () => ({
  protocol: {},
  MessageChannelMain: class {},
  session: {
    defaultSession: sessions.default,
    fromPartition: (name: string) => {
      sessions.partitions.push(name);
      return sessions.capture;
    },
  },
}));

import { startArtifacts, type ArtifactsDeps } from '.';

describe('startArtifacts', () => {
  it('announces artifacts.resync at every start of the engine host’s stream, until stopped', () => {
    const streaming: (() => void)[] = [];
    const emit = vi.fn(() => true);
    const hosts = {
      dispatch: vi.fn(),
      postDocPort: vi.fn(),
      closeDocPorts: vi.fn(),
      onState: () => () => {},
      onEvent: vi.fn(() => () => {}),
      onStreaming: (owner: string, listener: () => void) => {
        expect(owner).toBe('engine-host');
        streaming.push(listener);
        return () => void streaming.splice(streaming.indexOf(listener), 1);
      },
    };
    const started = startArtifacts({
      hosts: hosts as unknown as ArtifactsDeps['hosts'],
      register: vi.fn() as never,
      registerMachine: vi.fn() as never,
      emit: emit as never,
      env: {},
      openWindow: vi.fn() as never,
      root: '/tmp/artifacts',
      artifactsSocket: '/tmp/artifacts.sock',
    });
    streaming.forEach((listener) => listener());
    streaming.forEach((listener) => listener());
    expect(emit.mock.calls).toEqual([['artifacts.resync', {}], ['artifacts.resync', {}]]);
    started.stop();
    expect(streaming).toEqual([]);
  });

  it('serves maws-artifact: on the window’s session and the capture partition, registers artifacts.export (P5 O5 M4: machine-owned) and every kind’s exporters through the render library, and listens for the host’s exports and captures (M7; P5 O5 M3)', () => {
    const register = vi.fn();
    const registerMachine = vi.fn();
    const onEvent = vi.fn(() => () => {});
    const hosts = { dispatch: vi.fn(), postDocPort: vi.fn(), closeDocPorts: vi.fn(), onState: () => () => {}, onStreaming: () => () => {}, onEvent };
    const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: register as never, registerMachine: registerMachine as never, emit: vi.fn() as never, env: {}, openWindow: vi.fn() as never, root: '/tmp/artifacts', artifactsSocket: '/tmp/artifacts.sock' });
    expect(sessions.default.protocol.handle).toHaveBeenCalledWith('maws-artifact', expect.any(Function));
    expect(sessions.capture.protocol.handle).toHaveBeenCalledWith('maws-artifact', expect.any(Function));
    expect(sessions.partitions).toContain('maws-capture');
    expect(register.mock.calls.map(([name]) => name)).toEqual(['artifacts.open']);
    expect(registerMachine.mock.calls.map(([name]) => name)).toEqual(['artifacts.export']);
    expect(onEvent).toHaveBeenCalledWith('maws.artifact.export', expect.any(Function));
    expect(onEvent).toHaveBeenCalledWith('maws.artifact.capture', expect.any(Function));
    expect(started.exporters.get('html', 'pdf')).toMatchObject({ kind: 'html', format: 'pdf' });
    expect(started.exporters.get('html', 'png')).toMatchObject({ kind: 'html', format: 'png' });
    expect(started.exporters.get('document', 'pdf')).toMatchObject({ kind: 'document', format: 'pdf' }); // P5 O5 M3: composed with the rest, no longer registered by the app's root
    started.stop();
    expect(started.exporters.get('html', 'pdf')).toBeUndefined();
    expect(started.exporters.get('document', 'pdf')).toBeUndefined();
  });
});

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M4 decision 6; "Who owns a token"): the
// default partition's chain asks the file frames' responder first; the capture partition's holds none, so with the
// request filter set aside a live token asked there reaches only the store's own path, which answers 404.
describe('the file frames’ responder in the chains (UX wave U6b-2)', () => {
  it('the default partition’s chain asks the file responder first, and the capture partition’s chain has none: a live token asked there answers 404', async () => {
    const tokens = createFrameTokens();
    const bytes = Buffer.from('%PDF-1.4 an invented ledger');
    let reads = 0;
    const source = { read: async (offset: number, length: number) => (reads++, { bytes: new Uint8Array(bytes.subarray(offset, offset + length)), size: bytes.length, identity: 'one' }), close: async () => {} };
    const issued = tokens.issue(endableClientRef('page:7.1'), 7, { name: 'ledger.pdf', framed: 'pdf', mime: 'application/pdf', csp: null, source });
    if (typeof issued === 'string') throw new Error(`not issued: ${issued}`);
    const url = frameUrl(issued.token, 'ledger.pdf');
    const dispatch = vi.fn(async () => ({ ok: false, error: { code: 'invalid_input', message: 'no such artifact' } }));
    const hosts = { dispatch, postDocPort: vi.fn(), closeDocPorts: vi.fn(), onState: () => () => {}, onStreaming: () => () => {}, onEvent: vi.fn(() => () => {}), peer: () => null };
    sessions.default.protocol.handle.mockClear();
    sessions.capture.protocol.handle.mockClear();
    const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: vi.fn() as never, registerMachine: vi.fn() as never, emit: vi.fn() as never, env: {}, openWindow: vi.fn() as never, root: '/tmp/artifacts', artifactsSocket: '/tmp/artifacts.sock', fileFrames: fileFrameResponder(tokens, () => {}) });
    const onDefault = sessions.default.protocol.handle.mock.calls.at(-1)![1] as (request: Request) => Promise<Response>;
    const onCapture = sessions.capture.protocol.handle.mock.calls.at(-1)![1] as (request: Request) => Promise<Response>;
    const served = await onDefault(new Request(url));
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled(); // neither the presenter's embeds nor the store were asked first
    const before = reads;
    const refused = await onCapture(new Request(url));
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain('ledger');
    expect(reads).toBe(before); // the file's source was never read for it
    expect(tokens.get(issued.token)).toBe(issued); // live throughout
    // an artifact's page still goes down today's chain on the default partition
    expect((await onDefault(new Request('maws-artifact://0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d/live/index.html'))).status).toBe(404);
    expect(dispatch).toHaveBeenCalled();
    started.stop();
  });
});

// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M2's Proves; Interfaces §A, §D)
describe('the scheme on the daemon shape (P5 O5 M2)', () => {
  const PAGE = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const URL_ = `maws-artifact://${PAGE}/live/index.html`;
  let root: string | null = null;
  let endpoint: Server | null = null;
  afterEach(async () => {
    if (endpoint) await new Promise<void>((resolve) => endpoint!.close(() => resolve()));
    if (root) rmSync(root, { recursive: true, force: true });
    endpoint = null;
    root = null;
  });

  // A stand-in artifact endpoint on a socket, answering every request with one line, and main's own file for the URL
  async function scene() {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scheme-proxy-')));
    const socketPath = join(root, 'artifacts.sock');
    const asked: string[] = [];
    endpoint = createServer(serveOverHttp(async (request) => (asked.push(request.url), new Response('from the endpoint', { headers: { 'Content-Range': 'bytes 0-16/99' }, status: 206 }))));
    await new Promise<void>((resolve) => endpoint!.listen(socketPath, resolve));
    const file = join(root, 'page.html');
    writeFileSync(file, '<p>from main</p>');
    const content = vi.fn(async () => ({ ok: true as const, value: { revision: 1, kind: 'html' as const, name: 'index.html', size: 0, sha256: 'x', path: file } }));
    return { socketPath, asked, content };
  }

  it('startArtifacts proxies to artifacts.sock only while the machine host’s welcome lists machine.artifacts, and serves main’s files otherwise', async () => {
    const { socketPath, asked } = await scene();
    const file = join(root!, 'page.html');
    let listed: string[] | null = ['socket.ptyFrames', 'machine.artifacts'];
    const dispatch = vi.fn(async () => ({ ok: true, value: { revision: 1, kind: 'html', name: 'index.html', size: 0, sha256: 'x', path: file } }));
    const hosts = { dispatch, postDocPort: vi.fn(), closeDocPorts: vi.fn(), onState: () => () => {}, onStreaming: () => () => {}, onEvent: vi.fn(() => () => {}), peer: (owner: string) => (owner === 'machine' && listed ? { major: 3, minor: 13, build: 'b', capabilities: listed } : null) };
    const start = (artifactsSocket: string) => {
      sessions.default.protocol.handle.mockClear();
      const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: vi.fn() as never, registerMachine: vi.fn() as never, emit: vi.fn() as never, env: {}, openWindow: vi.fn() as never, root: '/tmp/artifacts', artifactsSocket });
      const handler = sessions.default.protocol.handle.mock.calls.at(-1)![1] as (request: Request) => Promise<Response>;
      return { started, load: async () => (await handler(new Request(URL_))).text() };
    };
    const daemonShape = start(socketPath);
    expect(sessions.capture.protocol.handle).toHaveBeenLastCalledWith('maws-artifact', expect.any(Function));
    expect(await daemonShape.load()).toBe('from the endpoint');
    expect(asked).toEqual([URL_]);
    expect(dispatch).not.toHaveBeenCalledWith('engine-host', 'artifacts.content', expect.anything());
    listed = ['socket.ptyFrames']; // an older daemon: no endpoint, main serves the store as before
    expect(await daemonShape.load()).toContain('from main');
    listed = null; // no daemon welcomed yet
    expect(await daemonShape.load()).toContain('from main');
    expect(dispatch).toHaveBeenCalledWith('engine-host', 'artifacts.content', { artifactId: PAGE, path: 'index.html' });
    daemonShape.started.stop();
  });

  it('asks the presenter’s embeds first on both paths, and relays the endpoint’s status and headers as received', async () => {
    const { socketPath, asked, content } = await scene();
    let proxying = true;
    const first = vi.fn(async (request: Request) => (request.url.includes('/embeds/') ? new Response('embed') : null));
    const handler = artifactSchemeHandler(content, first, () => (proxying ? { socketPath } : null));
    expect(await (await handler(new Request(`maws-artifact://${PAGE}/live/embeds/s/e.html`))).text()).toBe('embed');
    const proxied = await handler(new Request(URL_, { headers: { Range: 'bytes=0-16' } }));
    expect(proxied.status).toBe(206);
    expect(proxied.headers.get('content-range')).toBe('bytes 0-16/99');
    expect(await proxied.text()).toBe('from the endpoint');
    proxying = false;
    expect(await (await handler(new Request(`maws-artifact://${PAGE}/live/embeds/s/e.html`))).text()).toBe('embed');
    expect(await (await handler(new Request(URL_))).text()).toContain('from main');
    expect(first).toHaveBeenCalledTimes(4);
    expect(asked).toEqual([URL_]);
  });
});
