import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName, MawsBridge } from '@shared/ipc/schema';
import { createBridge, type BridgeTransport } from './bridge';

function fakeTransport() {
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  const transport = {
    invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(async () => ({ ok: true, value: 'answer' })),
    on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    }),
    removeListener: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      listeners.get(channel)?.delete(listener);
    }),
  };
  const deliver = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((l) => l({}, payload));
  return { transport: transport as unknown as BridgeTransport & typeof transport, deliver, listeners };
}

// The page can call the bridge with any string; the registries' types do not reach across contextBridge.
const loose = (bridge: MawsBridge) => bridge as unknown as {
  invoke(name: string, input?: unknown): Promise<unknown>;
  on(name: string, listener: (payload: unknown) => void): () => void;
};

describe('preload bridge', () => {
  it('answers a name outside the command registry with unknown_command, without touching IPC', async () => {
    const { transport } = fakeTransport();
    const result = await loose(createBridge(transport)).invoke('nope.thing');
    expect(result).toEqual({ ok: false, error: { code: 'unknown_command', message: 'unknown command: nope.thing' } });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('refuses prototype keys as command names', async () => {
    const { transport } = fakeTransport();
    const result = await loose(createBridge(transport)).invoke('constructor');
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_command' } });
  });

  it('invokes a registered command on its command channel and returns main’s result as is', async () => {
    const { transport } = fakeTransport();
    const result = await createBridge(transport).invoke('settings.set', { theme: 'dark' });
    expect(transport.invoke).toHaveBeenCalledWith('maws:cmd:settings.set', { theme: 'dark' });
    expect(result).toEqual({ ok: true, value: 'answer' });
  });

  it('turns a transport rejection into an internal error rather than a rejected promise', async () => {
    const { transport } = fakeTransport();
    transport.invoke.mockRejectedValueOnce(new Error("No handler registered for 'maws:cmd:settings.get'"));
    const result = await createBridge(transport).invoke('settings.get', undefined);
    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: "No handler registered for 'maws:cmd:settings.get'" },
    });
  });

  it('throws synchronously for an event name outside the registry', () => {
    const { transport } = fakeTransport();
    expect(() => loose(createBridge(transport)).on('nope.thing', () => {})).toThrow('unknown event: nope.thing');
    expect(transport.on).not.toHaveBeenCalled();
  });

  it('delivers a registered event’s payload, without the IPC event object, until unsubscribed', () => {
    const { transport, deliver, listeners } = fakeTransport();
    const listener = vi.fn();
    const off = createBridge(transport).on('pty.data', listener);
    deliver('maws:evt:pty.data', { ptyId: 'p1', data: 'x' });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ ptyId: 'p1', data: 'x' });
    off();
    deliver('maws:evt:pty.data', { ptyId: 'p1', data: 'y' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listeners.get('maws:evt:pty.data')?.size).toBe(0);
  });

  it('exposes exactly invoke, on and pathForFile', () => {
    const { transport } = fakeTransport();
    expect(Object.keys(createBridge(transport)).sort()).toEqual(['invoke', 'on', 'pathForFile']); // C7: pathForFile
  });
});

// Compile-time: the registries type the bridge.
void ((bridge: MawsBridge) => {
  const name: CommandName = 'settings.get';
  const event: EventName = 'settings.changed';
  void bridge.invoke(name, undefined);
  bridge.on(event, (state) => void state.resolvedTheme);
});

// Debt wave 4: the sandboxed preload bundles its whole import graph, so the allowlist is X2's zod-free name lists and
// nothing it imports reaches a registry module or zod (235 kB, then 313 kB, when it imported the registries).
describe('preload bundle', () => {
  it('imports no schema: its module graph reaches neither `@shared/ipc/schema` nor zod', () => {
    const src = resolve(__dirname, '..');
    const seen = new Set<string>();
    const bare = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      // value imports and re-exports only: `import type` and `export type` are erased from the bundle
      for (const [, spec] of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
        if (spec.startsWith('.') || spec.startsWith('@shared/')) {
          const base = spec.startsWith('.') ? resolve(dirname(file), spec) : resolve(src, 'shared', spec.slice(8));
          walk(existsSync(`${base}.ts`) ? `${base}.ts` : resolve(base, 'index.ts'));
        } else bare.add(spec);
      }
    };
    walk(resolve(__dirname, 'index.ts'));
    expect([...bare]).toEqual(['electron']);
    expect([...seen].filter((f) => f.includes('/shared/ipc/schema'))).toEqual([]);
    expect(seen).toContain(resolve(src, 'shared/ipc/names.ts'));
  });
});

// C7 start: a dropped file's path comes only from Electron's webUtils in the preload (C7 execution document, §4.1 rule)
describe('preload bridge: pathForFile (C7)', () => {
  it("answers Electron's path for a file, and '' when Electron has none or no webUtils was given", () => {
    const { transport } = fakeTransport();
    const file = new File(['x'], 'a.txt');
    const getPathForFile = vi.fn((f: File) => (f === file ? '/Users/x/a.txt' : ''));
    expect(createBridge(transport, { getPathForFile }).pathForFile(file)).toBe('/Users/x/a.txt');
    expect(createBridge(transport, { getPathForFile }).pathForFile(new File(['y'], 'b.txt'))).toBe('');
    const throwing = () => {
      throw new TypeError('not a File');
    };
    expect(createBridge(transport, { getPathForFile: throwing }).pathForFile(file)).toBe('');
    expect(createBridge(transport).pathForFile(file)).toBe('');
    expect(transport.invoke).not.toHaveBeenCalled();
  });
});
// C7 end
