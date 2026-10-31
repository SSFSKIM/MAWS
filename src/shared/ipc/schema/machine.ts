// X2 `machine.*` (P5 O6 M1, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2): the machine's own
// identity. `machine.identity` is the first production `machine`-owned command: answered by main's embedded binding
// today and by `mawsd` once O3 moves the machine services, the same handler either way (src/main/machine/identity.ts).
// It crosses between builds, so it is in the wire manifest (src/shared/ipc/wire.ts).
//
// P5 O3-D (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H, §I): the services front's own commands, all
// main-only (`internal`): `machine.client`, the attached app telling `mawsd` its browser's socket; `machine.op` and
// `machine.opQuery`, the services' operation ledger (O3X7), which the endpoint reaches as `host.op` reaches lane B's.
import * as z from 'zod';
import { MachineRefSchema } from '../../machine/ref';
import { JsonValueSchema, type CommandSpec } from './common';
import { HostOpOutputSchema, HostOpQueryOutputSchema, OpBindingShape, OpIdSchema } from './host';

// The machine's own project, where its sessions with no checkout sit (OX3). `key` is `machine:<ref>`; `smnsId` is
// sminos's machine project id once the machine is enrolled (M5; none is until O10).
export const MachineProjectSchema = z.strictObject({ key: z.string().min(1), name: z.string(), smnsId: z.string().nullable() });
export type MachineProject = z.infer<typeof MachineProjectSchema>;

// `name` is a display attribute, never an identity (OX2): every contract field named `machine` carries the ref.
export const MachineIdentitySchema = z.strictObject({ ref: MachineRefSchema, name: z.string(), project: MachineProjectSchema });
export type MachineIdentity = z.infer<typeof MachineIdentitySchema>;

// A claimed act on the services (Interfaces §H): who claims it (the binding the endpoint verified, as `host.op` carries it),
// and the `machine`-owned act it runs with its input, which crossed the channel as JSON. The answers are `host.op`'s.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): `action`, the sealed action as the
// device sent it (its step-up signature included), kept with the claim and handed to the command's handler
// (`HandlerContext.op`), so a handler can record who asked and keep the proof (`session.spawn`'s `launchedBy`).
export const MachineOpInputSchema = z.strictObject({ opId: OpIdSchema, opCreated: z.string(), claim: z.strictObject(OpBindingShape), name: z.string().min(1), input: JsonValueSchema, action: JsonValueSchema.optional() });

export const commands = {
  'machine.identity': { input: z.void(), output: MachineIdentitySchema, owner: 'machine' },
  'machine.client': { input: z.strictObject({ browserSocket: z.string().nullable() }), output: z.void(), owner: 'machine' }, // the attached app's browser socket directory (E13; each session's `<dir>/<appSessionId>.sock`, @shared/browser/cua-socket): null, none
  'machine.op': { input: MachineOpInputSchema, output: HostOpOutputSchema, owner: 'machine' },
  'machine.opQuery': { input: z.strictObject({ opId: OpIdSchema, opCreated: z.string(), tombstoneIfAbsent: z.boolean() }), output: HostOpQueryOutputSchema, owner: 'machine' },
} as const satisfies Record<`machine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`machine.${string}`, z.ZodType>;
