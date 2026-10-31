// P5 O5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): main's entry runs the bootstrap every mode
// shares, in today's order and before any root loads, then loads the app's root, or (M3) with `--render-host` the render
// host's root and nothing of the app's. A root that fails to load: the app's is rethrown as an uncaught exception, the
// render host's written to stderr at once with exit 70, never left to Electron's dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
vi.mock('electron', () => ({
  app: {
    setPath: (name: string, path: string) => order.push(`setPath ${name} ${path}`),
    exit: (code: number) => order.push(`exit ${code}`),
    commandLine: { appendSwitch: (name: string) => order.push(`switch ${name}`), getSwitchValue: () => '' },
  },
}));
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), writeSync: (fd: number, text: string) => order.push(`writeSync ${fd} ${text}`) }));
vi.mock('./stdio-guard', () => ({ guardStdio: () => order.push('guardStdio') }));
vi.mock('./chromium-features', () => ({ STARTUP_DISABLED_FEATURES: [], disableChromiumFeatures: () => order.push('disableChromiumFeatures') }));
vi.mock('../render/scheme', () => ({ registerStoreSchemes: () => order.push('registerStoreSchemes') }));
// Each root as the test's stand-in, registered afresh before each import (a case may stand in one that fails to load)
function standInRoots(): void {
  vi.doMock('./app', () => {
    order.push('app');
    return {};
  });
  vi.doMock('../render-host/root', () => {
    order.push('render-host root');
    return { runRenderHost: (entryDir: string) => order.push(`runRenderHost ${entryDir}`) };
  });
}

describe("main's entry", () => {
  const env = { ...process.env };
  const argv = process.argv;
  beforeEach(() => {
    order.length = 0;
    vi.resetModules();
    standInRoots();
    process.env.MAWS_USER_DATA = '/scratch/profile';
    process.env.MAWS_E2E = '1';
  });
  const listeners = process.listeners('SIGUSR1');
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...env };
    process.argv = argv;
    for (const listener of process.listeners('SIGUSR1')) if (!listeners.includes(listener)) process.off('SIGUSR1', listener);
  });

  it('runs the shared bootstrap, then loads the app root', async () => {
    await import('./index');
    await vi.waitFor(() => expect(order).toContain('app'));
    expect(order).toEqual(['guardStdio', 'setPath userData /scratch/profile', 'switch use-mock-keychain', 'disableChromiumFeatures', 'registerStoreSchemes', 'app']);
    expect(process.listenerCount('SIGUSR1')).toBe(listeners.length + 1); // the inspector refusal
    expect(order).not.toContain('render-host root');
  });

  it('with --render-host <profile>, runs the same bootstrap, then the render host’s root and nothing of the app’s (M3)', async () => {
    process.argv = [argv[0]!, 'out/main/index.js', '--render-host', '/scratch/profile'];
    await import('./index');
    await vi.waitFor(() => expect(order).toContain(`runRenderHost ${__dirname}`));
    expect(order).toEqual(['guardStdio', 'setPath userData /scratch/profile', 'switch use-mock-keychain', 'disableChromiumFeatures', 'registerStoreSchemes', 'render-host root', `runRenderHost ${__dirname}`]); // the entry's own directory, where mawsd.js is
    expect(order).not.toContain('app');
    expect(process.listenerCount('SIGUSR1')).toBe(listeners.length + 1);
  });

  // The deferred callbacks the entry hands setImmediate, kept rather than run
  const deferred = () => {
    const callbacks: (() => void)[] = [];
    vi.spyOn(globalThis, 'setImmediate').mockImplementation(((callback: () => void) => (callbacks.push(callback), 0)) as never);
    return callbacks;
  };

  it('rethrows an app root that fails to load as an uncaught exception, as before', async () => {
    vi.doMock('./app', () => {
      throw new Error('app.js would not load');
    });
    const callbacks = deferred();
    await import('./index');
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    let thrown: unknown;
    try {
      callbacks[0]!();
    } catch (error) {
      thrown = error;
    }
    // vitest wraps a throwing stand-in's error and keeps it as the cause: the app's own failure, rethrown
    expect(String((thrown as Error | undefined)?.cause)).toMatch(/app\.js would not load/);
    expect(order.filter((step) => step.startsWith('exit') || step.startsWith('writeSync'))).toEqual([]);
  });

  it('with --render-host, writes a root that fails to load to stderr and exits 70, never an uncaught exception (M3)', async () => {
    process.argv = [argv[0]!, 'out/main/index.js', '--render-host', '/scratch/profile'];
    // the root's module failing as it is read, as a chunk whose dependency throws while it loads
    vi.doMock('../render-host/root', () => ({
      get runRenderHost(): never {
        throw new Error('the root chunk would not load');
      },
    }));
    const callbacks = deferred();
    await import('./index');
    await vi.waitFor(() => expect(order).toContain('exit 70'));
    expect(order.slice(-2)).toEqual([expect.stringMatching(/^writeSync 2 \[render-host\] failed: Error: the root chunk would not load\n/), 'exit 70']);
    expect(order[order.length - 2]!.endsWith('\n')).toBe(true);
    expect(callbacks, 'nothing deferred to rethrow').toEqual([]);
    const { EXIT_FAILED } = await vi.importActual<typeof import('../render-host/host')>('../render-host/host');
    expect(EXIT_FAILED, 'the entry names the render host’s own failure code').toBe(70);
  });
});
