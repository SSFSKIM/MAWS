// X2 `pty.*`. C9 owns these entries from here on and may change `pty.data` to binary with backpressure, provided the
// smoke's echo still passes.
import * as z from 'zod';
import { HostPingSchema, HostStateSchema, type CommandSpec } from './common';

export const PtyIdSchema = z.string().brand<'PtyId'>();
export type PtyId = z.infer<typeof PtyIdSchema>;

export const commands = {
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'pty.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
  'pty.ping': { input: z.void(), output: HostPingSchema, owner: 'pty-host' },
  'pty.spawn': {
    input: z.strictObject({
      shell: z.string().optional(),
      args: z.array(z.string()).optional(),
      cwd: z.string(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    output: z.strictObject({ ptyId: PtyIdSchema, pid: z.number().int() }),
    owner: 'pty-host',
  },
  'pty.write': { input: z.strictObject({ ptyId: PtyIdSchema, data: z.string() }), output: z.void(), owner: 'pty-host' },
  'pty.resize': {
    input: z.strictObject({ ptyId: PtyIdSchema, cols: z.number().int().positive(), rows: z.number().int().positive() }),
    output: z.void(),
    owner: 'pty-host',
  },
  'pty.kill': {
    input: z.strictObject({ ptyId: PtyIdSchema, signal: z.string().optional() }),
    output: z.void(),
    owner: 'pty-host',
  },
} as const satisfies Record<`pty.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'pty.hostState': HostStateSchema,
  'pty.data': z.strictObject({ ptyId: PtyIdSchema, data: z.string() }),
  'pty.exit': z.strictObject({
    ptyId: PtyIdSchema,
    exitCode: z.number().int().nullable(),
    signal: z.number().int().nullable(),
  }),
} as const satisfies Record<`pty.${string}`, z.ZodType>;
