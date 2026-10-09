// X2 IPC schema, canonical file (charter §13 X2; C1 execution document, Interfaces "X2 — IPC schema").
// The registries are composed from one module per namespace under `schema/` (charter §12 C1 *IPC registry
// composition*); this file merges them and is the only module anyone imports. A child adds entries to its own
// namespace module, never here. `schema.test.ts` pins that every module's keys carry its namespace and that the merged
// registries lose no key to a duplicate, which the spread below would otherwise overwrite without a word.
import type * as z from 'zod';
import type { IpcError } from './errors';
import type { BridgedCommandName, BridgedEventName, MainOnlyCommandName } from './names';
import * as attention from './schema/attention';
import type { CommandSpec, Namespace } from './schema/common';
import * as engine from './schema/engine';
import * as fs from './schema/fs';
import * as git from './schema/git';
import * as layout from './schema/layout';
import * as pty from './schema/pty';
import * as session from './schema/session';
import * as settings from './schema/settings';
// C8c start
import * as files from './schema/files';
// C8c end
// E8 start
import * as plugins from './schema/plugins';
import * as marketplaces from './schema/marketplaces';
// E8 end
// E9 start
import * as voice from './schema/voice';
// E9 end
// E1 start
import * as maws from './schema/maws';
// E1 end
// E6 start
import * as scm from './schema/scm';
// E6 end
// E3 start
import * as side from './schema/side';
// E3 end
// E2 start
import * as deliverables from './schema/deliverables';
// E2 end
// E10 start
import * as host from './schema/host';
// E10 end
// E4a start
import * as browser from './schema/browser';
// E4a end
// P2-C start (2026-10-09)
import * as mods from './schema/mods';
// P2-C end

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
// C11 start: settings v3 and the ClaudeUsage hand-off shapes
export {
  CLAUDE_USAGE_BUNDLE_ID,
  ClaudeUsageOpenIntentSchema,
  NotificationKindsSchema,
  type ClaudeUsageOpenIntent,
  type ClaudeUsageOpenResult,
  type ClaudeUsageStatus,
  type NotificationKinds,
} from './schema/settings';
export { EngineBinaryConfigSchema, type EngineBinaryConfig } from './schema/engine';
// C11 end
export { TRANSCRIPT_WIDTHS, TranscriptWidthSchema, type TranscriptWidth } from './schema/settings'; // W2: settings v5
// W6 route executor: ClaudeUsage's control API as main answers it
export type { UsageAction, UsageActionResult, UsageControlReason, UsageControlsAnswer, UsageControlState } from './schema/settings';

export const commands = {
  ...session.commands,
  ...engine.commands,
  ...fs.commands,
  ...git.commands,
  ...pty.commands,
  ...layout.commands,
  ...attention.commands,
  ...settings.commands,
  // C8c start
  ...files.commands,
  // C8c end
  ...plugins.commands, // E8
  ...marketplaces.commands, // E8
  // E9 start
  ...voice.commands,
  // E9 end
  // E1 start
  ...maws.commands,
  // E1 end
  // E6 start
  ...scm.commands,
  // E6 end
  // E3 start
  ...side.commands,
  // E3 end
  // E2 start
  ...deliverables.commands,
  // E2 end
  // E10 start
  ...host.commands,
  // E10 end
  // E4a start
  ...browser.commands,
  // E4a end
  ...mods.commands, // P2-C (2026-10-09)
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
  // C8c start
  ...files.events,
  // C8c end
  ...plugins.events, // E8
  ...marketplaces.events, // E8
  // E9 start
  ...voice.events,
  // E9 end
  // E1 start
  ...maws.events,
  // E1 end
  // E6 start
  ...scm.events,
  // E6 end
  // E3 start
  ...side.events,
  // E3 end
  // E2 start
  ...deliverables.events,
  // E2 end
  // E10 start
  ...host.events,
  // E10 end
  // E4a start
  ...browser.events,
  // E4a end
  ...mods.events, // P2-C (2026-10-09)
} as const satisfies Record<`${Namespace}.${string}`, z.ZodType>;

export type CommandName = keyof typeof commands;
export type EventName = keyof typeof events;

// E10 start: the events the engine host emits, and only those (E10 execution document, §Design 2). They cross the
// main ↔ engine-host wire, so they enter the wire fingerprint (`wire-fingerprint.ts`); the host runtime refuses to emit
// an event outside the list, so the list cannot drift from the emitters. Main-emitted events (`engine.hostState`,
// `deliverables.console`, settings, layout, git…) never cross the socket and stay out.
export const HOST_EVENTS = [
  'session.eventBatch',
  'session.status',
  'session.queue',
  'session.brokerItems',
  'session.catalogChanged',
  'session.operation',
  'session.forgotten',
  'session.replay.progress',
  'engine.budget',
  'fs.sessionChanged',
  'fs.sessionRemoved',
  'fs.holderChanged',
  'fs.scanProgress',
  'fs.followState',
  'fs.subagentsChanged',
  'fs.workflowChanged',
  'fs.tasksChanged',
  'fs.foreignWrite',
  'plugins.operation',
  'plugins.changed',
  'deliverables.changed',
  'maws.pane.show',
  'maws.artifact.capture',
  'host.supervisorStatus', // the supervisor's own facts (host.status is main's)
] as const satisfies readonly EventName[];
// E10 end
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>;
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>;
export type EventPayload<N extends EventName> = z.output<(typeof events)[N]>;

export type CommandResult<N extends CommandName> = { ok: true; value: CommandOutput<N> } | { ok: false; error: IpcError };

// The whole surface the preload exposes as `window.maws`; nothing else is bridged.
export interface MawsBridge {
  invoke<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void; // returns unsubscribe
  pathForFile(file: File): string; // C7: a dropped file's path through Electron's webUtils.getPathForFile; '' when Electron has none (a file dragged from a browser)
}

// The bridged and main-only zod-free lists together cover the registries, without exposing main-only commands.
// This alias refuses an incomplete partition. `schema.test.ts` pins the same per namespace.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type BridgedNamesAreRegistered = Assert<Same<BridgedCommandName | MainOnlyCommandName, CommandName>> &
  Assert<Same<BridgedEventName, EventName>>;

export { commandChannel, eventChannel } from './names';
