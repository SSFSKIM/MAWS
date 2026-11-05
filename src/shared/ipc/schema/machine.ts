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
import { TrustStateSchema } from '../../sessions/trust';
import { JsonValueSchema, SetupOpenedSchema, type CommandSpec } from './common';
import { HostOpOutputSchema, HostOpQueryOutputSchema, OpBindingShape, OpIdSchema, OpTargetSchema } from './host';

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
// P5 O7 M5a: the claim's `target`, the artifact the endpoint resolved an artifact-targeted act to (host.ts' `OpTargetSchema`);
// `input` and `action` may hold bytes in json-bytes' tagged form, which the ledger decodes for the run and keeps as sent.
// `ClaimedOpInputSchema` is that shape before M5a, which `pty.op` keeps (its ledger names its own target).
export const ClaimedOpInputSchema = z.strictObject({ opId: OpIdSchema, opCreated: z.string(), claim: z.strictObject(OpBindingShape), name: z.string().min(1), input: JsonValueSchema, action: JsonValueSchema.optional() });
export const MachineOpInputSchema = ClaimedOpInputSchema.extend({ claim: z.strictObject({ ...OpBindingShape, target: OpTargetSchema.optional() /* P5 O7 M5a */ }) });

// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup", §U): the folders under the machine's
// home, a page at a time, names only, for "+ Session" on a machine with no checkout of the project. `path` is absolute or
// `~`-relative (absent: the home); `protected` marks a macOS TCC-protected folder, read inside only with `open: true`
// (src/shared/machine/home-folders.ts); `cursor` is the next page's, null after the last.
export const FolderEntrySchema = z.strictObject({ name: z.string(), path: z.string(), protected: z.boolean() });
export type FolderEntry = z.infer<typeof FolderEntrySchema>;
export const FoldersListInputSchema = z.strictObject({ path: z.string().min(1).max(4096).optional(), open: z.literal(true).optional(), cursor: z.string().min(1).max(1024).optional() });

export const commands = {
  'machine.identity': { input: z.void(), output: MachineIdentitySchema, owner: 'machine' },
  'machine.client': { input: z.strictObject({ browserSocket: z.string().nullable() }), output: z.void(), owner: 'machine' }, // the attached app's browser socket directory (E13; each session's `<dir>/<appSessionId>.sock`, @shared/browser/cua-socket): null, none
  'machine.op': { input: MachineOpInputSchema, output: HostOpOutputSchema, owner: 'machine' },
  'machine.opQuery': { input: z.strictObject({ opId: OpIdSchema, opCreated: z.string(), tombstoneIfAbsent: z.boolean() }), output: HostOpQueryOutputSchema, owner: 'machine' },
  'machine.folders.list': { input: FoldersListInputSchema, output: z.strictObject({ entries: z.array(FolderEntrySchema), cursor: z.string().nullable() }), owner: 'machine' }, // P5 O7 M9
  // P5 O7 M9 (the task review's findings 2 and 3): main-only, the endpoint's: a remote `session.trust.check` read on the
  // directory its setup policy resolved and checked, guarded again on the machine (src/services/machine/setup.ts)
  // directory; `opened`, the asking member's opens (the endpoint's record, `SetupOpenedSchema`), never another member's
  // (absent: none but the folders the directory itself is in)
  'machine.setupTrust': { input: z.strictObject({ directory: z.string().min(1), opened: SetupOpenedSchema.optional() }), output: TrustStateSchema, owner: 'machine' },
} as const satisfies Record<`machine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`machine.${string}`, z.ZodType>;
