// X2 `machine.*` (P5 O6 M1, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2): the machine's own
// identity. `machine.identity` is the first production `machine`-owned command: answered by main's embedded binding
// today and by `mawsd` once O3 moves the machine services, the same handler either way (src/main/machine/identity.ts).
// It crosses between builds, so it is in the wire manifest (src/shared/ipc/wire.ts).
import * as z from 'zod';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';

// The machine's own project, where its sessions with no checkout sit (OX3). `key` is `machine:<ref>`; `smnsId` is
// sminos's machine project id once the machine is enrolled (M5; none is until O10).
export const MachineProjectSchema = z.strictObject({ key: z.string().min(1), name: z.string(), smnsId: z.string().nullable() });
export type MachineProject = z.infer<typeof MachineProjectSchema>;

// `name` is a display attribute, never an identity (OX2): every contract field named `machine` carries the ref.
export const MachineIdentitySchema = z.strictObject({ ref: MachineRefSchema, name: z.string(), project: MachineProjectSchema });
export type MachineIdentity = z.infer<typeof MachineIdentitySchema>;

export const commands = {
  'machine.identity': { input: z.void(), output: MachineIdentitySchema, owner: 'machine' },
} as const satisfies Record<`machine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`machine.${string}`, z.ZodType>;
