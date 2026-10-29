// X2 `laneA.*` (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §A): a terminal session's
// bridge (sminos's DX5 child) as main's local driver reaches it (src/main/lane-a/). Owned by main, which the wire manifest
// leaves out, so no WIRE_MINOR moves; O3 retags the namespace `machine` when it moves main's services.
//
// Every command but `laneA.list` names its session by `appSessionId` (an address in the renderer, bare in main, OX2), so
// it routes `addressed`. What comes from the bridge (its capabilities, its raised requests and settlements, its catalog,
// the DX4 messages) is checked loosely: a field a newer bridge adds passes through rather than dropping the event.
// `LaneAState.pending` and `settled` and the plane's messages are `desk-hub/protocol`'s DX4 shapes, made locally from
// the bridge's DX5 events, so they carry no `mac` (only sminos's daemon seals one).
import * as z from 'zod';
import { RequestAnswerSchema } from '../../engine/answers';
import { PermissionModeSchema } from '../../graph/enums';
import { AppSessionIdSchema } from '../../graph/ids';
import type { CommandSpec } from './common';

// A bridge's `deliver` key: the writer is this machine's (`maws/<MachineRef>`), the seq its next for the session.
export const DeliveryKeySchema = z.strictObject({ writer: z.string(), seq: z.number().int().positive() });
export type DeliveryKey = z.infer<typeof DeliveryKeySchema>;

export const ControlCapabilitySchema = z.looseObject({ available: z.boolean(), reason: z.string().optional() });
// `desk-hub/protocol`'s `ControlCapabilities`, keyed by any string: a key a newer bridge adds is kept, never refused.
export const ControlCapabilitiesSchema = z.record(z.string(), ControlCapabilitySchema);

// DX4 `raised`, with `session` set; `t` (the bridge's stamp, ms) is kept for the attention item's `createdAt`.
export const LaneARaisedSchema = z.looseObject({
  request: z.string(),
  session: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  agentId: z.string().optional(), // absent for the main loop
  deadline: z.string().optional(), // ISO-8601: a background subagent's window
  async: z.literal(true).optional(),
  truncated: z.literal(true).optional(),
  toolUseId: z.string().optional(),
  suggestions: z.array(z.unknown()).optional(),
  t: z.number().optional(),
});
export type LaneARaised = z.infer<typeof LaneARaisedSchema>;

// DX4 `settled`, with `session` set.
export const LaneASettledSchema = z.looseObject({
  request: z.string(),
  session: z.string(),
  winner: z.string(), // 'web' | 'terminal' | 'other'
  outcome: z.string(), // 'allow' | 'deny' | 'answered' | 'withdrawn'
  by: z.string(),
  t: z.number().optional(),
});
export type LaneASettled = z.infer<typeof LaneASettledSchema>;

export const LaneADeliverySchema = z.strictObject({
  key: DeliveryKeySchema,
  at: z.string(), // when the send was taken (ISO-8601)
  state: z.enum(['queued', 'submitted', 'entered', 'refused', 'unconfirmed']),
  uuid: z.string().optional(), // the row it became (`entered`)
  reason: z.string().optional(), // why not (`refused`, `unconfirmed`)
});
export type LaneADelivery = z.infer<typeof LaneADeliverySchema>;

// P5 O9 M9: a remote session's link to its machine, as O7's `RemoteLink` and the endpoint's `caps` say it (absent for a
// local session). `reason`, when set, disables every control with it: the link is down or connecting, the machine refused
// this device, no `caps` came yet, or the device's class acts on cards only. `rights` are the member's machine rights
// (`caps.machine.grades`); a session's own rank is the endpoint's to decide (its `grade` refusal).
export const LaneALinkSchema = z.strictObject({
  state: z.enum(['connecting', 'up', 'down']),
  refusal: z.string().nullable(),
  carrier: z.enum(['direct', 'relay']).nullable(),
  member: z.string().nullable(),
  clientClass: z.string().nullable(),
  rights: z.array(z.string()),
  reason: z.string().nullable(),
});
export type LaneALink = z.infer<typeof LaneALinkSchema>;

// P5 O9 M9: a remote control's act in flight, from its creation to its outcome (`laneA.send`'s are its `deliveries`):
// `id` its opId, `control` its RPC (`interrupt`, `answer`, `decide`, `model`, `command`, `btw`, `compact`, `stop-agent`,
// `tell`), `target` what it names when it names one (an answer's or decision's request, a command's name, an agent).
export const LaneAActSchema = z.strictObject({
  id: z.string(),
  control: z.string(),
  target: z.string().optional(),
  progress: z.enum(['waiting', 'sent', 'accepted', 'unknown']),
  at: z.string(), // when it was made (ISO-8601)
});
export type LaneAAct = z.infer<typeof LaneAActSchema>;

// The main loop's permission mode as the session last reported it to its bridge (sminos 1.27.14; @shared/lane-a/mode):
// the engine's word, when the bridge read the report (epoch ms, the session's machine's clock) and the event it came in.
export const LaneAModeSchema = z.strictObject({ mode: PermissionModeSchema, at: z.number(), from: z.string() });
export type LaneAMode = z.infer<typeof LaneAModeSchema>;

export const LaneAStateSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  engineSessionId: z.string(), // bare: the engine's session id is never lifted (OX2)
  bridge: z.enum(['live', 'starting', 'observer', 'none']),
  reason: z.string().nullable(), // why not live, said to the person; null when live
  launch: z.string().nullable(), // /status's
  sminos: z.string().nullable(), // capabilities.sminos
  ops: z.array(z.string()),
  reads: z.array(z.string()),
  controls: ControlCapabilitiesSchema,
  turn: z.strictObject({ running: z.boolean(), unknown: z.boolean() }), // the main loop's
  // The session's model and effort as its main loop's latest request ran on them (the bridge's override applied), else
  // the model it started with and no effort: a `/model` or `/effort` typed in the terminal shows from its next request.
  model: z.string().nullable(),
  effort: z.string().nullable(),
  override: z.strictObject({ model: z.string().nullable(), effort: z.string().nullable() }).nullable(), // the bridge's per-request override
  // The mode the session last reported: the local heartbeat's, a remote status read's. Null until it reports one, and
  // from a bridge older than sminos 1.27.14.
  mode: LaneAModeSchema.nullable(),
  catalog: z.strictObject({ fingerprint: z.string() }).nullable(), // the body by laneA.catalog
  pending: z.array(LaneARaisedSchema),
  settled: z.array(LaneASettledSchema), // the last 100
  deliveries: z.array(LaneADeliverySchema), // this app's sends; settled ones kept 60 s
  link: LaneALinkSchema.optional(), // M9: a remote session's only
  acts: z.array(LaneAActSchema).optional(), // M9: a remote session's only
});
export type LaneAState = z.infer<typeof LaneAStateSchema>;

export const ControlResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('done'), result: z.unknown().optional() }),
  z.strictObject({ state: z.literal('refused'), code: z.string(), message: z.string() }), // the bridge's code, or the driver's
  // The op may have run: `id`, when the bridge named one, is the op's id in a later `op` or `compact` message.
  z.strictObject({ state: z.literal('unknown'), why: z.enum(['timeout', 'gone', 'no-ack', 'expired']), id: z.string().optional() }),
]);
export type ControlResult = z.infer<typeof ControlResultSchema>;

// `desk-hub/protocol`'s `Catalog`, loosely.
export const LaneACatalogSchema = z.looseObject({
  fingerprint: z.string(),
  commands: z.array(z.unknown()),
  models: z.unknown(),
  measured: z.unknown().optional(),
  skills: z.array(z.string()).optional(),
});
export type LaneACatalog = z.infer<typeof LaneACatalogSchema>;

// One DX4 session-plane message (`desk-hub/protocol`'s `SessionMessage`), as a JSON value; the renderer's lane A store
// reads it against the DX4 types.
export const PlaneMessageSchema = z.looseObject({ kind: z.string(), body: z.unknown() });
export type PlaneMessage = z.infer<typeof PlaneMessageSchema>;

const READ_ERROR_CODES = ['no-bridge', 'unsupported', 'timeout', 'busy', 'failed'] as const; // desk-hub/protocol's ReadErrorCode

const session = { appSessionId: AppSessionIdSchema };
const input = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ ...session, ...shape });

export const LaneASendOutputSchema = z.strictObject({
  key: DeliveryKeySchema.nullable(), // null: refused before a key was taken (a `/` text, a full lane, no live bridge)
  state: z.enum(['queued', 'submitted', 'entered', 'refused', 'unconfirmed']),
  uuid: z.string().optional(),
  reason: z.string().optional(),
  code: z.string().optional(), // a refusal's code
});
export type LaneASendOutput = z.infer<typeof LaneASendOutputSchema>;

// `session.answer`'s outcomes, with lane A's: a refusal (the answer can't be carried, or the bridge refused it) and an
// unknown one (the decision may have been taken). `not_pending` names the settlement the bridge gave, when it gave one.
export const LaneAAnswerOutputSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('delivered') }),
  z.strictObject({
    outcome: z.literal('not_pending'),
    settled: z.looseObject({ winner: z.string().optional(), outcome: z.string().optional(), by: z.string().optional() }).nullable(),
    terminalOnly: z.boolean().optional(), // a background request past its window: the terminal answers it
    message: z.string(),
  }),
  z.strictObject({ outcome: z.literal('refused'), code: z.string(), message: z.string() }),
  z.strictObject({ outcome: z.literal('unknown'), why: z.enum(['timeout', 'gone']) }),
]);
export type LaneAAnswerOutput = z.infer<typeof LaneAAnswerOutputSchema>;

export const LaneAReadOutputSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ ok: z.literal(false), code: z.enum(READ_ERROR_CODES), message: z.string() }),
]);

const nullableName = z.string().min(1).nullable();

// P5 O9 M7: one file of an upload as the composer serialized it (an image or document block's base64 bytes), with the
// name the person gave it, for display only: the bridge's rule, 1 to 128 characters, none a control character or a line
// separator. Main decodes and checks the bytes (src/main/lane-a/media.ts).
export const LaneAMediaFileSchema = z.strictObject({
  name: z.string().regex(/^[^\x00-\x1f\x7f\u2028\u2029]{1,128}$/), // eslint-disable-line no-control-regex
  mediaType: z.string().min(1),
  data: z.string().min(1),
});

export const commands = {
  'laneA.list': { input: z.void(), output: z.strictObject({ states: z.array(LaneAStateSchema) }), owner: 'main' }, // this machine's bridged foreign sessions
  'laneA.state': { input: input({}), output: LaneAStateSchema.nullable(), owner: 'main' },
  'laneA.watch': { input: input({}), output: z.strictObject({ watch: z.string() }), owner: 'main' }, // its first laneA.plane message is its snapshot
  'laneA.unwatch': { input: input({ watch: z.string() }), output: z.void(), owner: 'main' },
  'laneA.catalog': { input: input({}), output: LaneACatalogSchema.nullable(), owner: 'main' },
  'laneA.read': {
    input: input({ watch: z.string(), kind: z.enum(['usage', 'config', 'settings', 'mcp', 'status', 'rows', 'diff', 'output']), args: z.record(z.string(), z.unknown()).optional() }),
    output: LaneAReadOutputSchema,
    owner: 'main',
  },
  'laneA.send': { input: input({ text: z.string().min(1) }), output: LaneASendOutputSchema, owner: 'main' }, // a `/` text is refused: commands go as laneA.command
  'laneA.interrupt': { input: input({}), output: ControlResultSchema, owner: 'main' },
  'laneA.answer': { input: input({ request: z.string().min(1), answer: RequestAnswerSchema }), output: LaneAAnswerOutputSchema, owner: 'main' },
  'laneA.model': {
    input: input({ model: nullableName.optional(), effort: nullableName.optional() }).refine((v) => v.model !== undefined || v.effort !== undefined, { message: 'model, effort or both' }),
    output: ControlResultSchema,
    owner: 'main',
  },
  'laneA.command': { input: input({ name: z.string().min(1), args: z.string() }), output: ControlResultSchema, owner: 'main' },
  'laneA.btw': { input: input({ prompt: z.string().min(1) }), output: ControlResultSchema, owner: 'main' },
  'laneA.compact': { input: input({ instructions: z.string().optional() }), output: ControlResultSchema, owner: 'main' },
  'laneA.stopAgent': { input: input({ agentId: z.string().min(1) }), output: ControlResultSchema, owner: 'main' },
  'laneA.tell': { input: input({ agentId: z.string().min(1), text: z.string().min(1) }), output: ControlResultSchema, owner: 'main' },
  'laneA.stopTask': { input: input({ taskId: z.string().min(1) }), output: ControlResultSchema, owner: 'main' },
  // M7: 1 to 4 images or PDFs, saved by main and handed to the bridge's `media` op; `result.upload` names the `op` messages
  // that follow each file's state (`op: 'media'`, `id` the upload).
  'laneA.media': { input: input({ files: z.array(LaneAMediaFileSchema).min(1).max(4) }), output: ControlResultSchema, owner: 'main' },
} as const satisfies Record<`laneA.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

const watchEvent = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ ...session, watch: z.string(), ...shape });

export const events = {
  'laneA.changed': z.strictObject({ ...session, state: LaneAStateSchema.nullable() }), // to every page; null: the session left lane A
  // to the page whose watch it is (each page reads only its own ids); `paused` and `resumed` are a remote link's (M9)
  'laneA.plane': z.union([
    watchEvent({ messages: z.array(PlaneMessageSchema) }),
    watchEvent({ reset: z.literal(true) }),
    watchEvent({ paused: z.string() }),
    watchEvent({ resumed: z.literal(true) }),
    watchEvent({ ended: z.string() }),
  ]),
} as const satisfies Record<`laneA.${string}`, z.ZodType>;
