// The handlers of the action table (C5 execution document, Keyboard runtime). `runAction` is the one entry point for
// menu events (`layout.action`), the ⌘K palette, the renderer's key dispatcher and every button that mirrors an
// action. C5 registers the shell's handlers; later children register theirs (C10 `session.new`). An action with no
// handler renders disabled everywhere: in the page through `useActionEnabled`, in the application menu through the
// enabled set the dispatcher reports to main.
import type { ActionId } from '@shared/keymap/actions';
import { createHandlerRegistry } from './registry';

export type ActionHandler = (arg: number | null) => void | Promise<void>;

const registry = createHandlerRegistry<ActionId, [number | null]>('actions');

export const registerAction = (id: ActionId, handler: ActionHandler): (() => void) => registry.register(id, handler);
export const runAction = (id: ActionId, arg: number | null = null): void => registry.run(id, arg);
export const isActionEnabled = (id: ActionId): boolean => registry.has(id);
export const enabledActions = (): ActionId[] => registry.ids();
export const subscribeActions = (listener: () => void): (() => void) => registry.subscribe(listener);
export const useActionEnabled = (id: ActionId): boolean => registry.useEnabled(id);
