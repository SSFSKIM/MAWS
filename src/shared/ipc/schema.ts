// X2 IPC schema, canonical file (charter §13 X2; C1 execution document, Interfaces "X2 — IPC schema").
// The registries are composed from one module per namespace under `schema/` (charter §12 C1 *IPC registry
// composition*); this file merges them and is the only module anyone imports. A child adds entries to its own
// namespace module, never here. `schema.test.ts` pins that every module's keys carry its namespace and that the merged
// registries lose no key to a duplicate, which the spread below would otherwise overwrite without a word.
import type * as z from 'zod';
import type { IpcError } from './errors';
import type { BridgedCommandName, BridgedEventName, MainOnlyCommandName } from './names';
import type { PathCommandName } from './routes'; // P5 O6 M2
import type { MachineRef } from '../machine/ref'; // P5 O6 M2
import type { AppSessionId } from '../graph/ids'; // P5 O7 M4
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
// E2 end
// E10 start
import * as host from './schema/host';
// E10 end
// E4a start
import * as browser from './schema/browser';
// E4a end
// P2-C start (2026-10-09)
import * as mods from './schema/mods';
import * as ownerChannel from './schema/owner-channel'; // M4
// P2-C end
// P3-A start (M4)
import * as artifacts from './schema/artifacts';
import * as spaces from './schema/spaces';
// P3-A end
// P3-L start (M1)
import * as library from './schema/library';
import * as presentations from './schema/presentations'; // P3-C M6
// P3-L end
import * as designSystems from './schema/design-systems'; // P3-D (the P3 spec's Decision Log 61)
import * as connectors from './schema/connectors'; // P3-H H3b
import * as delivery from './schema/delivery'; // P4-B5
import * as customization from './schema/customization'; // UX2-K
import * as catalog from './schema/catalog'; // P4-AGG M2
import * as daemon from './schema/daemon'; // P5 O2 M5
import * as machine from './schema/machine'; // P5 O6 M1
import * as machines from './schema/machines'; // P5 O6 M3
import * as org from './schema/org'; // P5 O8 M1
import * as laneA from './schema/lane-a'; // P5 O9 M2
import * as machineSettings from './schema/machine-settings'; // P5 O3-D
import * as clientPort from './schema/client-port'; // P5 O3-D
import * as render from './schema/render'; // P5 O5 M3
import * as remote from './schema/remote'; // P5 O7 M2
export { CustomizationInventorySchema, type CustomizationInventory, type CustomizationSkill, type CustomizationServer, type CustomizationEndpoint } from './schema/customization';

export {
  HostPingSchema,
  HostStateSchema,
  JsonValueSchema,
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
  // E2 end
  // E10 start
  ...host.commands,
  // E10 end
  // E4a start
  ...browser.commands,
  // E4a end
  ...mods.commands, // P2-C (2026-10-09)
  ...ownerChannel.commands, // P2-C M4 (2026-10-09)
  ...artifacts.commands, // P3-A M4
  ...spaces.commands, // P3-A M4
  ...library.commands, // P3-L M1
  ...designSystems.commands, // P3-D (Decision Log 61)
  ...presentations.commands, // P3-C M6
  ...connectors.commands, // P3-H H3b
  ...delivery.commands, // P4-B5
  ...customization.commands, // UX2-K
  ...catalog.commands, // P4-AGG M2
  ...daemon.commands, // P5 O2 M5
  ...machine.commands, // P5 O6 M1
  ...machines.commands, // P5 O6 M3
  ...org.commands, // P5 O8 M1
  ...laneA.commands, // P5 O9 M2
  ...machineSettings.commands, // P5 O3-D
  ...clientPort.commands, // P5 O3-D
  ...render.commands, // P5 O5 M3
  ...remote.commands, // P5 O7 M2
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
  // E2 end
  // E10 start
  ...host.events,
  // E10 end
  // E4a start
  ...browser.events,
  // E4a end
  ...mods.events, // P2-C (2026-10-09)
  ...ownerChannel.events, // P2-C M4 (2026-10-09)
  ...artifacts.events, // P3-A M4
  ...spaces.events, // P3-A M4
  ...library.events, // P3-L M1
  ...designSystems.events, // P3-D (Decision Log 61)
  ...presentations.events, // P3-C M6
  ...connectors.events, // P3-H H3b
  ...delivery.events, // P4-B5
  ...customization.events, // UX2-K
  ...catalog.events, // P4-AGG M2
  ...daemon.events, // P5 O2 M5
  ...machine.events, // P5 O6 M1
  ...machines.events, // P5 O6 M3
  ...org.events, // P5 O8 M1
  ...laneA.events, // P5 O9 M2
  ...machineSettings.events, // P5 O3-D
  ...clientPort.events, // P5 O3-D
  ...render.events, // P5 O5 M3
  ...remote.events, // P5 O7 M2
} as const satisfies Record<`${Namespace}.${string}`, z.ZodType>;

export type CommandName = keyof typeof commands;
export type EventName = keyof typeof events;

// E10 start: the events the engine host emits, and only those (E10 execution document, §Design 2). They cross the
// main ↔ engine-host wire, so they enter the wire fingerprint (`wire-fingerprint.ts`); the host runtime refuses to emit
// an event outside the list, so the list cannot drift from the emitters. Main-emitted events (`engine.hostState`,
// `artifacts.console`, settings, layout, git…) never cross the socket and stay out.
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
  'maws.pane.show',
  'maws.artifact.capture',
  'maws.artifact.export', // P3-A M7: `artifact_export` asks main's export service
  'maws.artifact.datasetRefresh', // E3: `artifact_dataset`'s refresh asks main's connector service, by its id alone
  'host.supervisorStatus', // the supervisor's own facts (host.status is main's)
  'artifacts.changed', 'spaces.changed', // P3-A M4: the store's change feed
  'connectors.operation', 'connectors.grantChanged', // P3-H H3b: an operation's end (its id alone) and a committed grant change
  'connectors.directOperation', // P3-HD: a direct operation's end, its id alone
] as const satisfies readonly EventName[];
// E10 end
// P5 O2 M4 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): the events the pty host emits. Under the daemon shape
// the pty host is `mawsd`'s build, which may be another than the app's, so they join the wire manifest beside
// HOST_EVENTS (not the protocol-2 fingerprint, which no pty host link ever speaks); the host runtime refuses a pty host
// event outside the list, as it does the engine host's. `pty.hostState` is main's.
export const PTY_HOST_EVENTS = ['pty.data', 'pty.exit'] as const satisfies readonly EventName[];
// P5 O3-D (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §I): the events the machine host emits, the
// services front in `mawsd` on the daemon shape (main's embedded binding emits the same in process): every event the
// spine's parts emit through the services bus, and the front's own (the machine half's settings, the visible set, the
// client port). They join the wire manifest beside the other two lists; a name in two lists (`session.eventBatch`, which
// the spine synthesises too) is one entry and one schema. src/services/spine-root.test.ts holds the list to what the
// spine's source emits; the front's emit gate is M2's.
export const MACHINE_EVENTS = [
  'attention.changed',
  'session.changed', 'session.removed', 'session.projects.changed', 'session.digest', 'session.setup', 'session.intent.changed',
  'session.eventBatch', 'session.status', 'engine.budget', // the side threads', setups' and yield's rows; the scenario stub's statuses and budget
  'library.changed', 'ownerChannel.changed', 'laneA.changed', 'laneA.plane',
  'machineSettings.changed', 'session.visibleChanged', 'clientPort.request', // the front's own
  'git.changed', 'files.changed', 'scm.remote.output', // P5 O3-E M2: the checkouts', composed with the spine (O3 Decision Log 17)
  'render.request', 'render.exit', // P5 O5 M3: the render host's work, posted to it alone
  'render.hostGeneration', // P5 O5 M4: the engine host's link generation, to the render host alone
  'connectors.watchUpdate', 'connectors.serversChanged', 'connectors.signInChanged', 'delivery.receipt', // P5 O4 M2: the connectors' and delivery's, composed with the spine
  'catalog.engineChanged', // P5 O4 M3: the catalog's machine half, composed with the spine
] as const satisfies readonly EventName[];
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>;
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>;
export type EventPayload<N extends EventName> = z.output<(typeof events)[N]>;

export type CommandResult<N extends CommandName> = { ok: true; value: CommandOutput<N> } | { ok: false; error: IpcError };

// P5 O6 M2 (OX2; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The bridge types"): every invoke goes to a
// machine and every event comes from one. `MawsBridge` is the renderer client's surface (`src/renderer/src/ipc/client.ts`),
// over addresses; `PreloadBridge` is `window.maws`, the raw pipe over bare ids, whose invoke with no machine is the local
// machine's (the e2e specs' and harness pages' convenience).
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The checkout rule and its boundary"): `session`
// is the session a path command is made from (a panel tool's, the composer's), as an address on the command's machine;
// the client sends it bare beside the machine, and a machine that bounds a path read by its session places the read by it.
export interface InvokeOptions {
  machine?: MachineRef;
  session?: AppSessionId;
  from?: AppSessionId; // P5 O7 M4c fix wave 2: the tab of this Mac a machine-wide act is made from (a spawn's New chat tab)
}
// A `path` command's options name its machine (`src/shared/ipc/routes.ts`; M4 required it): a path is no machine's by
// itself, so every call site names the machine of the session or project it is about. Every other command's options are
// optional: its addresses name its machine, else it is the local machine's.
export type MachineOptions<N extends CommandName> = N extends PathCommandName ? [opts: { machine: MachineRef; session?: AppSessionId }] : [opts?: InvokeOptions];
export type InvokeRest<N extends CommandName> = MachineOptions<N>;
// `invoke` as seen by a wrapper generic over commands whose every input carries an address (a session read, a session
// operation), which names the machine: TypeScript defers `InvokeRest` over a generic name, so such a wrapper calls this.
export type AddressedInvoke = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;
export interface EventSource {
  machine: MachineRef;
}

// The renderer client's surface over `window.maws`: components and stores use it through `ipc`.
export interface MawsBridge {
  readonly localMachine: MachineRef;
  invoke<N extends CommandName>(name: N, input: CommandInput<N>, ...opts: InvokeRest<N>): Promise<CommandResult<N>>;
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>, from: EventSource) => void): () => void; // returns unsubscribe
  pathForFile(file: File): string; // C7: a dropped file's path through Electron's webUtils.getPathForFile; '' when Electron has none (a file dragged from a browser)
}

// The whole surface the preload exposes as `window.maws`; nothing else is bridged. Typed by name as the client is (the ids
// it carries are bare, which the same branded types describe), so a spec's raw call reads its answer typed.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O, `MainContext.session`): the invoke's
// last argument is its machine, or its machine with the session a path-class command is made from (the session's bare id
// on that machine), which main sends with the command to a machine that bounds a path read by its session.
export interface InvokeTarget {
  machine: MachineRef;
  session?: AppSessionId;
}
export interface PreloadBridge {
  readonly localMachine: MachineRef;
  invoke<N extends CommandName>(name: N, input: CommandInput<N>, target?: MachineRef | InvokeTarget): Promise<CommandResult<N>>; // no machine: the local one
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>, machine: MachineRef | undefined) => void): () => void;
  pathForFile(file: File): string;
}

// The bridged and main-only zod-free lists together cover the registries, without exposing main-only commands.
// This alias refuses an incomplete partition. `schema.test.ts` pins the same per namespace.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type BridgedNamesAreRegistered = Assert<Same<BridgedCommandName | MainOnlyCommandName, CommandName>> &
  Assert<Same<BridgedEventName, EventName>>;

export { commandChannel, eventChannel } from './names';
