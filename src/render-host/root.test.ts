// P5 O5 M3: the render host's root never leaves a failure to Electron's error dialog (modal, and before `ready` it holds
// Chromium's start with nothing said): a failure of its start, or a later uncaught exception, is written to stderr at once
// and ends the process with EXIT_FAILED.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const exits: number[] = [];
const written: string[] = [];
let started: Promise<void> = Promise.resolve();

const calls: string[] = []; // what the root's Electron side does, in order (acceptance 6: no Dock icon, no focus, no lock)
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
  session: {},
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
});

