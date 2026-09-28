// X2 IPC schema, canonical file (charter §13 X2; C1 execution document, Interfaces "X2 — IPC schema").
// M1 seed: the bridge's types over empty registries, so the preload and the renderer are typed against
// `MawsBridge` from the start. M3 composes the registries from `schema/<namespace>.ts` and fills them.
import type * as z from 'zod';

export type Owner = 'main' | 'engine-host' | 'pty-host';
export interface CommandSpec<I extends z.ZodType, O extends z.ZodType> {
  input: I;
  output: O;
  owner: Owner;
}

export const NAMESPACES = ['session', 'engine', 'fs', 'git', 'pty', 'layout', 'attention', 'settings'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const commands = {} as const satisfies Record<`${Namespace}.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
export const events = {} as const satisfies Record<`${Namespace}.${string}`, z.ZodType>;

export type CommandName = keyof typeof commands;
export type EventName = keyof typeof events;
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>;
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>;
export type EventPayload<N extends EventName> = z.output<(typeof events)[N]>;

export interface IpcError {
  code: 'invalid_input' | 'invalid_output' | 'unknown_command' | 'forbidden_sender' | 'host_unavailable' | 'timeout' | 'internal';
  message: string;
  issues?: unknown;
}
export type CommandResult<N extends CommandName> = { ok: true; value: CommandOutput<N> } | { ok: false; error: IpcError };

// The whole surface the preload exposes as `window.maws`; nothing else is bridged.
export interface MawsBridge {
  invoke<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void; // returns unsubscribe
}
