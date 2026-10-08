// X2 `engine.*`. C1 ships the ping and the host-state snapshot; C3 fills the rest of the namespace.
import * as z from 'zod';
// C3 start
import { RelayHealthSchema } from '../../engine/relay-health';
import { EngineSessionStatusSchema } from '../../engine/status';
// C3 end
// C10 start
import { ModelCatalogueSchema } from '../../sessions/models';
// C10 end
import { HostPingSchema, HostStateSchema, type CommandSpec } from './common';
// C12 start
import { AppSessionIdSchema } from '../../graph/ids';
import { HardReasonSchema } from '../../engine/status';
// C12 end
// C11 start
import { AbsolutePathSchema } from './settings';
// C11 end

// C3 start: the engine host level (C3 execution document, Interfaces "X2 — commands and events"): the binary, the
// relay, the process table and shutdown. Owner engine-host.
// W13 (charter D-1 as amended 2026-10-01): `path` is the real path the next launch spawns (the installed Claude Code
// unless Settings names a binary), `version` its `--version`, `testedVersion` the version MAWS was verified
// against (E11: its live sittings; the replay fixtures are this release or older; information, never a refusal); `ok` false only for a missing binary or one that prints no version.
export const BinaryInfoSchema = z.strictObject({ path: z.string(), testedVersion: z.string(), version: z.string().nullable(), ok: z.boolean(), error: z.string().nullable() });
export type BinaryInfo = z.infer<typeof BinaryInfoSchema>;

const c3Commands = {
  'engine.binaryInfo': { input: z.void(), output: BinaryInfoSchema, owner: 'engine-host' }, // resolved per call; `--version` cached by file (W13)
  'engine.relayHealth': { input: z.strictObject({ force: z.boolean() }), output: RelayHealthSchema, owner: 'engine-host' },
  'engine.sessions': { input: z.void(), output: z.array(EngineSessionStatusSchema), owner: 'engine-host' },
  'engine.shutdown': { input: z.strictObject({ graceMs: z.number().int().nonnegative() }), output: z.strictObject({ stopped: z.number().int(), forced: z.number().int() }), owner: 'engine-host' }, // C5's quit path
} as const;

export const C3_ENGINE_COMMANDS = Object.keys(c3Commands) as (keyof typeof c3Commands)[];
export const C3_ENGINE_EVENTS: string[] = []; // the engine host's events are per session (`session.*`)
// C3 end

// C10 start: the model catalogue before any session exists (C10 execution document, X2 additions; Interfaces
// "Catalogue cache"). Owner engine-host: `refresh` asks the most recently launched ready session's `list_models`;
// `gateway` (debt wave 3, optional) names the route the caller will launch under, whose catalogue is answered; `cwd`
// (debt wave 5, optional, read only with `gateway`) the directory, whose settings may set a model environment of its own.
const c10Commands = {
  'engine.models': { input: z.strictObject({ refresh: z.boolean(), gateway: z.enum(['gateway', 'direct']).optional(), cwd: AbsolutePathSchema.optional() }), output: ModelCatalogueSchema, owner: 'engine-host' },
} as const;
// C10 end
// C11 start: the host's binary configuration (C11 execution document, Interfaces "X2 additions"; C3's BinaryConfig in
// src/engine-host/launch.ts). Sent by main after the settings load, on every change of settings.engine and whenever the
// engine host is ready again; answers engine.binaryInfo's shape for the configured path. A live process keeps its binary.
// W13: the path only (null, the installed Claude Code); the expected version is gone, since no version refuses.
export const EngineBinaryConfigSchema = z.strictObject({ binaryPath: AbsolutePathSchema.nullable() });
export type EngineBinaryConfig = z.infer<typeof EngineBinaryConfigSchema>;
const c11Commands = {
  'engine.configure': { input: EngineBinaryConfigSchema, output: BinaryInfoSchema, owner: 'engine-host' },
} as const;
// C11 end

// C12 start: the memory budget (C12 execution document, Interfaces "X2 additions"; charter §4.4). Owner engine-host.
// `engine.policy.set` is pushed by main from settings (the budget in KiB and the stateful MCP servers by exact name) and
// evaluates at once; `engine.budget` answers the table's budget state, and the event of the same name carries it
// whenever any field but `sampledAt` changes and at every release. `overWithoutCandidate` is the host's two-sample
// flag (over budget with no candidate on two consecutive samples); the renderer never counts samples.
// W7 start: `enabled` is settings' `engine.memoryBudget.enabled` (charter §4.4 as amended 2026-10-01). Off, the host
// releases nothing and `over` and `overWithoutCandidate` read false, while it keeps sampling and the state keeps the
// totals; the limit still travels, so turning it on again needs nothing else. The state echoes the policy's `enabled`.
// W7 end
export const BudgetPolicyInputSchema = z.strictObject({ enabled: z.boolean() /* W7 */, limitKiB: z.number().int().positive(), statefulMcpServers: z.array(z.string()).max(64) });
export const BudgetStateSchema = z.strictObject({
  enabled: z.boolean(), // W7
  limitKiB: z.number().int(), totalKiB: z.number().int(), sampledAt: z.string().nullable(),
  over: z.boolean(), overWithoutCandidate: z.boolean(), candidates: z.number().int(), settling: z.number().int(),
  releasing: AppSessionIdSchema.nullable(),
  blocked: z.array(z.strictObject({ appSessionId: AppSessionIdSchema, reasons: z.array(HardReasonSchema) })),
  lastRelease: z.strictObject({ appSessionId: AppSessionIdSchema, at: z.string(), totalKiB: z.number().int() }).nullable(),
});
export type BudgetState = z.infer<typeof BudgetStateSchema>;
const c12Commands = {
  'engine.policy.set': { input: BudgetPolicyInputSchema, output: BudgetStateSchema, owner: 'engine-host' },
  'engine.budget': { input: z.void(), output: BudgetStateSchema, owner: 'engine-host' },
} as const;
// C12 end

export const commands = {
  'engine.ping': { input: z.void(), output: HostPingSchema, owner: 'engine-host' },
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'engine.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
  ...c3Commands, // C3
  ...c10Commands, // C10
  ...c11Commands, // C11
  ...c12Commands, // C12
} as const satisfies Record<`engine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'engine.hostState': HostStateSchema,
  'engine.budget': BudgetStateSchema, // C12
} as const satisfies Record<`engine.${string}`, z.ZodType>;
