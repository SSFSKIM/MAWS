// The X2 registry as one value (P5 O1 M5), so the pieces that read it (main's router, a host runtime, main's host
// supervisor) can be built over another registry: a test's fixture namespace, or (M6) two registries a minor apart in one
// process. Production passes nothing and gets `REGISTRY`, typed by its own names.
import type * as z from 'zod';
import type { IpcError } from './errors';
import { MAIN_ONLY_COMMANDS } from './names';
import { commands, events, HOST_EVENTS, type CommandSpec } from './schema';

export interface WireRegistry {
  readonly commands: Readonly<Record<string, CommandSpec<z.ZodType, z.ZodType>>>;
  readonly events: Readonly<Record<string, z.ZodType>>;
  readonly hostEvents: readonly string[];
  readonly mainOnly: ReadonlySet<string>; // commands only main sends; the rest are bridged to the renderer
}

// `satisfies`, not an annotation, so `typeof REGISTRY` keeps the production names.
export const REGISTRY = { commands, events, hostEvents: HOST_EVENTS, mainOnly: new Set<string>(MAIN_ONLY_COMMANDS) } satisfies WireRegistry;

// Types over a registry R.
export type NameOf<R extends WireRegistry> = keyof R['commands'] & string;
export type InputOf<R extends WireRegistry, N extends NameOf<R>> = z.input<R['commands'][N]['input']>;
export type OutputOf<R extends WireRegistry, N extends NameOf<R>> = z.output<R['commands'][N]['output']>;
export type ResultOf<R extends WireRegistry, N extends NameOf<R>> = { ok: true; value: OutputOf<R, N> } | { ok: false; error: IpcError };
export type EventNameOf<R extends WireRegistry> = keyof R['events'] & string;
export type PayloadOf<R extends WireRegistry, N extends EventNameOf<R>> = z.output<R['events'][N]>;
