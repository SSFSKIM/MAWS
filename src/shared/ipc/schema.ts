// X2 IPC schema, canonical file (charter §13 X2; C1 execution document, Interfaces "X2 — IPC schema").
// The registries are composed from one module per namespace under `schema/` (charter §12 C1 *IPC registry
// composition*); this file merges them and is the only module anyone imports. A child adds entries to its own
// namespace module, never here. `schema.test.ts` pins that every module's keys carry its namespace and that the merged
// registries lose no key to a duplicate, which the spread below would otherwise overwrite without a word.
import type * as z from 'zod';
import type { IpcError } from './errors';
import * as attention from './schema/attention';
import type { CommandSpec, Namespace } from './schema/common';
import * as engine from './schema/engine';
import * as fs from './schema/fs';
import * as git from './schema/git';
import * as layout from './schema/layout';
import * as pty from './schema/pty';
import * as session from './schema/session';
import * as settings from './schema/settings';

export {
  HostPingSchema,
  HostStateSchema,
  NAMESPACES,
  type CommandSpec,
  type HostPing,
  type HostState,
  type Namespace,
  type Owner,
} from './schema/common';
export { PtyIdSchema, type PtyAttach, type PtyCheckpoint, type PtyExit, type PtyId, type PtyInfo } from './schema/pty';
export {
  SettingsPatchSchema,
  SettingsSchema,
  SettingsStateSchema,
  ThemeSettingSchema,
  type Settings,
  type SettingsPatch,
  type SettingsState,
  type ThemeSetting,
} from './schema/settings';
export type { IpcError } from './errors';
// C5 start: the read side and the shapes the shell's stores consume.
export {
  ProjectRecordSchema,
  SESSION_PHASES,
  SessionDigestSchema,
  SessionPatchSchema,
  type ProjectRecord,
  type SessionDigest,
  type SessionPatch,
  type SessionPhase,
} from './schema/session';
export { ChordSchema } from './schema/settings';
// C5 end

export const commands = {
  ...session.commands,
  ...engine.commands,
  ...fs.commands,
  ...git.commands,
  ...pty.commands,
  ...layout.commands,
  ...attention.commands,
  ...settings.commands,
} as const satisfies Record<`${Namespace}.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  ...session.events,
  ...engine.events,
  ...fs.events,
  ...git.events,
  ...pty.events,
  ...layout.events,
  ...attention.events,
  ...settings.events,
} as const satisfies Record<`${Namespace}.${string}`, z.ZodType>;

export type CommandName = keyof typeof commands;
export type EventName = keyof typeof events;
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>;
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>;
export type EventPayload<N extends EventName> = z.output<(typeof events)[N]>;

export type CommandResult<N extends CommandName> = { ok: true; value: CommandOutput<N> } | { ok: false; error: IpcError };

// The whole surface the preload exposes as `window.maws`; nothing else is bridged.
export interface MawsBridge {
  invoke<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void; // returns unsubscribe
}

export const commandChannel = (name: CommandName) => `maws:cmd:${name}`;
export const eventChannel = (name: EventName) => `maws:evt:${name}`;
