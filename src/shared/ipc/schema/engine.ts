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

// C3 start: the engine host level (C3 execution document, Interfaces "X2 — commands and events"): the binary, the
// relay, the process table and shutdown. Owner engine-host.
export const BinaryInfoSchema = z.strictObject({ path: z.string(), expectedVersion: z.string(), version: z.string().nullable(), ok: z.boolean(), error: z.string().nullable() });
export type BinaryInfo = z.infer<typeof BinaryInfoSchema>;

const c3Commands = {
  'engine.binaryInfo': { input: z.void(), output: BinaryInfoSchema, owner: 'engine-host' }, // runs `--version` once, cached
  'engine.relayHealth': { input: z.strictObject({ force: z.boolean() }), output: RelayHealthSchema, owner: 'engine-host' },
  'engine.sessions': { input: z.void(), output: z.array(EngineSessionStatusSchema), owner: 'engine-host' },
  'engine.shutdown': { input: z.strictObject({ graceMs: z.number().int().nonnegative() }), output: z.strictObject({ stopped: z.number().int(), forced: z.number().int() }), owner: 'engine-host' }, // C5's quit path
} as const;

export const C3_ENGINE_COMMANDS = Object.keys(c3Commands) as (keyof typeof c3Commands)[];
export const C3_ENGINE_EVENTS: string[] = []; // the engine host's events are per session (`session.*`)
// C3 end

// C10 start: the model catalogue before any session exists (C10 execution document, X2 additions; Interfaces
// "Catalogue cache"). Owner engine-host: `refresh` asks the most recently launched ready session's `list_models`.
const c10Commands = {
  'engine.models': { input: z.strictObject({ refresh: z.boolean() }), output: ModelCatalogueSchema, owner: 'engine-host' },
} as const;
// C10 end

export const commands = {
  'engine.ping': { input: z.void(), output: HostPingSchema, owner: 'engine-host' },
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'engine.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
  ...c3Commands, // C3
  ...c10Commands, // C10
} as const satisfies Record<`engine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'engine.hostState': HostStateSchema,
} as const satisfies Record<`engine.${string}`, z.ZodType>;
