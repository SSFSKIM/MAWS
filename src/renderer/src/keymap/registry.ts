// A registry of handlers by id, observable from React: the shell's actions (`actions-runtime.ts`) and the session
// actions (`app/session-actions.ts`) are both "a handler registered by whichever child has landed, rendered disabled
// until then". The last registration of an id wins; a disposer removes only the handler it registered.
import { create } from 'zustand';

export interface HandlerRegistry<K extends string, A extends unknown[]> {
  register(id: K, handler: (...args: A) => unknown): () => void;
  run(id: K, ...args: A): void; // a missing handler is a no-op; a throw or rejection is logged, never propagated
  get(id: K): ((...args: A) => unknown) | undefined; // for a caller that needs the handler's result
  has(id: K): boolean;
  ids(): K[];
  subscribe(listener: () => void): () => void;
  useEnabled(id: K): boolean;
}

export function createHandlerRegistry<K extends string, A extends unknown[]>(label: string): HandlerRegistry<K, A> {
  type Handler = (...args: A) => unknown;
  const store = create<{ handlers: ReadonlyMap<K, Handler> }>()(() => ({ handlers: new Map() }));
  const update = (change: (next: Map<K, Handler>) => void) => {
    const next = new Map(store.getState().handlers);
    change(next);
    store.setState({ handlers: next });
  };
  const failed = (id: K, error: unknown) => console.error(`[${label}] ${id} failed`, error);

  return {
    register(id, handler) {
      update((next) => next.set(id, handler));
      return () => {
        if (store.getState().handlers.get(id) === handler) update((next) => next.delete(id));
      };
    },
    run(id, ...args) {
      const handler = store.getState().handlers.get(id);
      if (!handler) return;
      try {
        const result = handler(...args);
        if (result instanceof Promise) result.catch((error: unknown) => failed(id, error));
      } catch (error) {
        failed(id, error);
      }
    },
    get: (id) => store.getState().handlers.get(id),
    has: (id) => store.getState().handlers.has(id),
    ids: () => [...store.getState().handlers.keys()],
    subscribe: (listener) => store.subscribe(listener),
    useEnabled: (id) => store((s) => s.handlers.has(id)),
  };
}
