// Code tools tests (C8c): main as a fake X2 bridge the suite scripts per command, recording every call, with `emit`
// for pushed events. Installed as `window.maws`, so the stores' `ipc` client validates both directions as in the app.
// Imported only by happy-dom suites.
import type { CommandName, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';

type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
export type Handler = (name: CommandName, input: Record<string, unknown>) => Answer | Promise<Answer>;

export const ok = (value: unknown = undefined): Answer => ({ ok: true, value });
export const fail = (message: string): Answer => ({ ok: false, error: { code: 'internal', message } });

export function installFakeMain(handler: Handler) {
  const calls: { name: CommandName; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge = {
    async invoke(name: CommandName, input: Record<string, unknown>) {
      calls.push({ name, input });
      return handler(name, input);
    },
    on(name: string, listener: (payload: unknown) => void) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => set.delete(listener);
    },
  } as unknown as MawsBridge;
  window.maws = bridge;
  return {
    bridge,
    calls,
    callsOf: (name: CommandName) => calls.filter((c) => c.name === name).map((c) => c.input),
    emit<N extends EventName>(name: N, payload: EventPayload<N>) {
      listeners.get(name)?.forEach((listener) => listener(payload));
    },
  };
}

// A promise and its resolver, for answers a test releases by hand.
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
