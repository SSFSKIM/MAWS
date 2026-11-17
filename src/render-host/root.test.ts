// P5 O5 M3: the render host's root never leaves a failure to Electron's error dialog (modal, and before `ready` it holds
// Chromium's start with nothing said): a failure of its start, or a later uncaught exception, is written to stderr at once
// and ends the process with EXIT_FAILED.
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { endpointLibrary } from '../services/artifacts/scheme/endpoint-library';

const exits: number[] = [];
const written: string[] = [];
let started: Promise<void> = Promise.resolve();

const calls: string[] = []; // what the root's Electron side does, in order (acceptance 6: no Dock icon, no focus, no lock)
// UX wave U6b-2: the render host's capture partition and default session, as its `sessions` step sets them up
const sessions = vi.hoisted(() => {
  type Listener = (details: unknown, callback: (response: { cancel: boolean }) => void) => void;
  type Fake = { beforeRequest: Listener | null; handler: ((request: Request) => Promise<Response>) | null; webRequest: object; on(): void; protocol: object; setPermissionRequestHandler(): void; setPermissionCheckHandler(): void };
  const make = (): Fake => {
    const made: Fake = {
      beforeRequest: null,
      handler: null,
      webRequest: { onBeforeRequest: (_filter: unknown, listener: Listener) => void (made.beforeRequest = listener) },
      on: () => {},
      protocol: { handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => void (made.handler = handler) },
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
    };
    return made;
  };
  return { capture: make(), default: make(), policies: [] as unknown[][] };
});
vi.mock('../render/policies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/policies')>();
  return { ...actual, installFramePolicies: (...args: Parameters<typeof actual.installFramePolicies>) => (sessions.policies.push(args), actual.installFramePolicies(...args)) };
});
vi.mock('electron', () => ({
  app: {
    exit: (code: number) => exits.push(code),
    setPath: (name: string, path: string) => calls.push(`setPath ${name} ${path}`),
    setActivationPolicy: (policy: string) => calls.push(`setActivationPolicy ${policy}`),
    on: (event: string) => calls.push(`on ${event}`),
    whenReady: async () => void calls.push('whenReady'),
    dock: { hide: () => calls.push('dock.hide'), show: () => calls.push('dock.show') },
    focus: () => calls.push('focus'),
    requestSingleInstanceLock: () => (calls.push('requestSingleInstanceLock'), true),
  },
  session: { fromPartition: () => sessions.capture, defaultSession: sessions.default },
}));
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), writeSync: (_fd: number, text: string) => written.push(text) }));
let startedWith: import('./host').RenderHostDeps | null = null;
vi.mock('./host', async (importOriginal) => ({ ...(await importOriginal<typeof import('./host')>()), startRenderHost: (deps: import('./host').RenderHostDeps) => ((startedWith = deps), started) }));

const listeners = process.listeners('uncaughtException');
let root: typeof import('./root');
let EXIT_FAILED: number;
beforeAll(async () => {
  ({ EXIT_FAILED } = await import('./host'));
  root = await import('./root'); // the render library's whole graph
}, 60_000);
afterEach(() => {
  exits.length = 0;
  written.length = 0;
  for (const listener of process.listeners('uncaughtException')) if (!listeners.includes(listener)) process.off('uncaughtException', listener);
});

describe('the render host root (src/render-host/root.ts)', () => {
  it('writes a failed start to stderr and exits EXIT_FAILED', async () => {
    started = Promise.reject(new Error('the library would not compose'));
    await root.runRenderHost('/app/out/main');
    expect(exits).toEqual([EXIT_FAILED]);
    expect(written).toEqual([expect.stringMatching(/^\[render-host\] failed: Error: the library would not compose\n/)]);
  });

  it('takes a later uncaught exception the same way, so Electron shows no dialog', async () => {
    started = Promise.resolve();
    await root.runRenderHost('/app/out/main');
    const added = process.listeners('uncaughtException').filter((listener) => !listeners.includes(listener));
    expect(added).toHaveLength(1);
    added[0]!(new Error('a request handler threw'), 'uncaughtException');
    expect(exits).toEqual([EXIT_FAILED]);
    expect(written[0]).toMatch(/^\[render-host\] failed: Error: a request handler threw/);
  });

  it('goes accessory before ready, so no Dock icon shows and nothing takes the focus, and never asks for the app’s lock (acceptance 6)', async () => {
    started = Promise.resolve();
    calls.length = 0;
    await root.runRenderHost('/app/out/main');
    startedWith!.userData('/profile/mawsd/render-host');
    await startedWith!.ready();
    expect(calls).toEqual(['setPath userData /profile/mawsd/render-host', 'setActivationPolicy accessory', 'on window-all-closed', 'whenReady', 'dock.hide']);
  });

  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, "Who owns a token"): the render host's
  // process holds no tokens. Its capture partition takes the frame policies with no owner's lookup, and its scheme goes
  // to the daemon's artifact endpoint, which answers a token host 404 without asking the store about it.
  it('the render host installs the frame policies with no owner’s lookup and hands a token host to the daemon’s endpoint, which answers 404', async () => {
    started = Promise.resolve();
    await root.runRenderHost('/app/out/main');
    const dir = await mkdtemp(join(tmpdir(), 'rh-'));
    const asked: unknown[] = [];
    const endpoint = endpointLibrary(async (input) => (asked.push(input), { ok: false, error: { code: 'invalid_input', message: 'no such artifact' } }));
    const server: Server = createServer({ pauseOnConnect: true }, (socket) => endpoint.accept(socket));
    try {
      const paths = { ...daemonPaths(dir), artifactsSocket: join(dir, 'a.sock') };
      await new Promise<void>((resolve) => server.listen(paths.artifactsSocket, resolve));
      sessions.policies.length = 0;
      startedWith!.sessions(paths);
      expect(sessions.policies).toHaveLength(1);
      expect(sessions.policies[0]![0]).toBe(sessions.capture);
      expect(sessions.policies[0]![3]).toBeUndefined(); // no owner's lookup
      const token = 'maws-artifact://3f9c2b7e4d1a8c6f0e5b9a2d7c4f1e8b/ledger%20draft.pdf';
      let cancel: boolean | null = null;
      sessions.capture.beforeRequest!({ url: token, method: 'GET', webContentsId: 5, frame: null }, (answer) => (cancel = answer.cancel));
      expect(cancel).toBe(false); // not judged by owner here: the endpoint's 404 is what holds
      const answer = await sessions.capture.handler!(new Request(token));
      expect(answer.status).toBe(404);
      expect(asked).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
