// X2 `engine.*`. C1 ships the ping and the host-state snapshot; C3 fills the rest of the namespace.
import * as z from 'zod';
// C3 start
import { RelayHealthSchema } from '../../engine/relay-health';
import { EngineSessionStatusSchema } from '../../engine/status';
// C3 end
import { HostPingSchema, HostStateSchema, type CommandSpec } from './common';
// C11 start
import { AbsolutePathSchema } from './settings';
// C11 end

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

// C11 start: the host's binary configuration (C11 execution document, Interfaces "X2 additions"; C3's BinaryConfig in
// src/engine-host/launch.ts). Sent by main after the settings load, on every change of settings.engine and whenever the
// engine host is ready again; answers engine.binaryInfo's shape for the configured path. A live process keeps its binary.
export const EngineBinaryConfigSchema = z.strictObject({ binaryPath: AbsolutePathSchema.nullable(), expectedVersion: z.string() });
export type EngineBinaryConfig = z.infer<typeof EngineBinaryConfigSchema>;
const c11Commands = {
  'engine.configure': { input: EngineBinaryConfigSchema, output: BinaryInfoSchema, owner: 'engine-host' },
} as const;
// C11 end

export const commands = {
  'engine.ping': { input: z.void(), output: HostPingSchema, owner: 'engine-host' },
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'engine.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
  ...c3Commands, // C3
  ...c11Commands, // C11
} as const satisfies Record<`engine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'engine.hostState': HostStateSchema,
} as const satisfies Record<`engine.${string}`, z.ZodType>;
