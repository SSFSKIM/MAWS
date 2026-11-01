// X2 `pty.*`, owned by C9 (C1 M4 handed the namespace over; C9 execution document, Interfaces "X2 — `pty.*`"). C1's
// five commands and two events are replaced by this set: `pty.spawn` names the session and the tab instance instead
// of carrying an environment (the host constructs it), output crosses as binary chunks stamped with their stream
// offset, the renderer acknowledges what it has parsed (`pty.ack`, the host's backpressure), keeps a checkpoint of its
// emulator state in the host (`pty.checkpoint`) and re-adopts a live pty after a reload (`pty.list`, `pty.attach`).
// `z.instanceof(Uint8Array)` checks the realm-local class each structured-clone hop produces.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { HostPingSchema, HostStateSchema, type CommandSpec } from './common';
import { HostOpOutputSchema, HostOpQueryOutputSchema, OpIdSchema } from './host';
import { ClaimedOpInputSchema } from './machine';

export const PtyIdSchema = z.string().brand<'PtyId'>();
export type PtyId = z.infer<typeof PtyIdSchema>;

export const PtyExitSchema = z.strictObject({ exitCode: z.number().int().nullable(), signal: z.number().int().nullable() });
export type PtyExit = z.infer<typeof PtyExitSchema>;

export const PtySpawnInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, // which session the terminal belongs to; a label, the host never reads session state
  label: z.string().min(1), // the tool's tab-instance id; (appSessionId, label) is unique among live ptys and is how a reloaded renderer re-adopts
  cwd: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  shell: z.string().optional(), // absolute path; default the login shell; the probe passes a program here
  args: z.array(z.string()).optional(), // default ['-l']
  command: z.string().optional(), // written to the pty followed by '\n' right after spawn (C10's attach path)
});

export const PtyInfoSchema = z.strictObject({
  ptyId: PtyIdSchema,
  appSessionId: AppSessionIdSchema,
  label: z.string(),
  pid: z.number().int(),
  cwd: z.string(),
  shell: z.string(),
  cols: z.number().int(),
  rows: z.number().int(),
  spawnedAt: z.string(),
  alive: z.boolean(),
  paused: z.boolean(),
  exit: PtyExitSchema.nullable(),
  offset: z.number().int().nonnegative(), // total bytes emitted so far
});
export type PtyInfo = z.infer<typeof PtyInfoSchema>;

const Offset = z.number().int().nonnegative();
export const PtyCheckpointSchema = z.strictObject({ offset: Offset, state: z.string() });
export type PtyCheckpoint = z.infer<typeof PtyCheckpointSchema>;

export const PtyAttachSchema = z.strictObject({
  info: PtyInfoSchema,
  checkpoint: PtyCheckpointSchema.nullable(),
  replay: z.instanceof(Uint8Array), // the ring's bytes for [replayFrom, nextOffset)
  replayFrom: Offset, // max(checkpoint.offset, ring start); equal to checkpoint.offset means the reattach is exact
  nextOffset: Offset,
});
export type PtyAttach = z.infer<typeof PtyAttachSchema>;

// P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): what `pty.op` keeps and answers
// for a remote attach: where the pty's output stands, no bytes and no checkpoint (the ring crosses as a stream, read by
// `pty.replay` from the viewer's own offset; the checkpoint is the local app's). JSON throughout, so it reads back whole
// from the ledger.
export const PtyOpAttachSchema = z.strictObject({ info: PtyInfoSchema, ringStart: Offset, nextOffset: Offset });
export type PtyOpAttach = z.infer<typeof PtyOpAttachSchema>;

// P5 O7 M3: the ring from an offset, independent of any checkpoint and taking no credit.
export const PtyReplaySchema = z.strictObject({
  replay: z.instanceof(Uint8Array), // the ring's bytes for [replayFrom, nextOffset)
  replayFrom: Offset, // max(from, ring start): above `from` when the ring moved past it
  nextOffset: Offset,
});
export type PtyReplay = z.infer<typeof PtyReplaySchema>;

export const commands = {
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'pty.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
  'pty.ping': { input: z.void(), output: HostPingSchema, owner: 'pty-host' },
  'pty.spawn': {
    input: PtySpawnInputSchema,
    output: z.strictObject({ ptyId: PtyIdSchema, pid: z.number().int() }),
    owner: 'pty-host',
  },
  'pty.write': { input: z.strictObject({ ptyId: PtyIdSchema, data: z.string() }), output: z.void(), owner: 'pty-host' },
  'pty.resize': {
    input: z.strictObject({ ptyId: PtyIdSchema, cols: z.number().int().positive(), rows: z.number().int().positive() }),
    output: z.void(),
    owner: 'pty-host',
  },
  // SIGHUP by default; on a dead pty it only removes the entry.
  'pty.kill': {
    input: z.strictObject({ ptyId: PtyIdSchema, signal: z.string().optional() }),
    output: z.void(),
    owner: 'pty-host',
  },
  'pty.ack': { input: z.strictObject({ ptyId: PtyIdSchema, offset: Offset }), output: z.void(), owner: 'pty-host' },
  // The emulator's boundary-safe serialised state as of `offset`; the host keeps the latest per pty.
  'pty.checkpoint': {
    input: z.strictObject({ ptyId: PtyIdSchema, offset: Offset, state: z.string() }),
    output: z.void(),
    owner: 'pty-host',
  },
  // P5 O2 M4: `credit: false` answers the same replay without taking the output credit (the flow reducer's attach), so
  // the reader that holds it keeps it: how a remote viewer reads a terminal (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md)
  'pty.attach': { input: z.strictObject({ ptyId: PtyIdSchema, credit: z.boolean().optional() }), output: PtyAttachSchema, owner: 'pty-host' },
  'pty.list': { input: z.void(), output: z.strictObject({ ptys: z.array(PtyInfoSchema) }), owner: 'pty-host' },
  // P5 O2 M4: main-only. A fresh login-shell capture that spawns use once it resolves (a spawn already waiting keeps the
  // environment it awaited): `mawsd` sends it at each app welcome on `pty-host.sock`, since a socket-mode pty host
  // outlives every app (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8's login-shell capture)
  'pty.recaptureEnv': { input: z.void(), output: z.void(), owner: 'pty-host' },
  'pty.foreground': {
    input: z.strictObject({ ptyId: PtyIdSchema }),
    output: z.strictObject({ process: z.string().nullable(), busy: z.boolean() }),
    owner: 'pty-host',
  },
  // Handler in main: the one scheme-checked `shell.openExternal` (`openExternalUrl`, src/main/open-external.ts).
  'pty.openLink': { input: z.strictObject({ url: z.url() }), output: z.strictObject({ opened: z.boolean() }), owner: 'main' },
  // P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M3 "Acts, then streams", Interfaces §O; the pty
  // host's ledger, src/pty-host/ops.ts): `pty.listFor`, a session's ptys (`pty.list` takes no input, which an act cannot
  // carry), a remote act's and the renderer's for a remote session; `pty.op` and `pty.opQuery`, the shapes of
  // `machine.op` and `machine.opQuery`, sent by the endpoint in `mawsd` for a remote act (`pty.spawn`, `pty.attach`,
  // `pty.kill`, `pty.listFor`) and its query; `pty.replay`, the endpoint's in-process read of the ring at a stream's open.
  'pty.listFor': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ ptys: z.array(PtyInfoSchema) }), owner: 'pty-host' },
  'pty.op': { input: ClaimedOpInputSchema, output: HostOpOutputSchema, owner: 'pty-host' },
  'pty.opQuery': { input: z.strictObject({ opId: OpIdSchema, opCreated: z.string(), tombstoneIfAbsent: z.boolean() }), output: HostOpQueryOutputSchema, owner: 'pty-host' },
  'pty.replay': { input: z.strictObject({ ptyId: PtyIdSchema, from: Offset }), output: PtyReplaySchema, owner: 'pty-host' },
} as const satisfies Record<`pty.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'pty.hostState': HostStateSchema,
  'pty.data': z.strictObject({ ptyId: PtyIdSchema, offset: Offset, data: z.instanceof(Uint8Array) }),
  // C1's shape; nulls mean the host died (supervisor-emitted).
  'pty.exit': z.strictObject({ ptyId: PtyIdSchema }).extend(PtyExitSchema.shape),
} as const satisfies Record<`pty.${string}`, z.ZodType>;
