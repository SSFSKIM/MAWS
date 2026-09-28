// The failure half of X2's `CommandResult`. `IpcError` is re-exported from `@shared/ipc/schema`, its canonical path.
import * as z from 'zod';

export const IPC_ERROR_CODES = [
  'invalid_input', // main rejected the command input (issues attached)
  'invalid_output', // the renderer client rejected the command output (issues attached)
  'unknown_command', // the name is not in the command registry
  'forbidden_sender', // the invoke did not come from the app window's top frame at the app's origin
  'host_unavailable', // the owning utility process is not running
  'timeout', // a host-owned command did not answer within 10 s
  'internal', // anything else: a handler threw, no handler is registered, the transport failed
] as const;
export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export const IpcErrorSchema = z.strictObject({
  code: z.enum(IPC_ERROR_CODES),
  message: z.string(),
  issues: z.unknown().optional(),
});
export type IpcError = z.infer<typeof IpcErrorSchema>;

// The envelope every command answers with, before its `value` is checked against the command's own output schema.
export const CommandResultEnvelopeSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: IpcErrorSchema }),
]);

export function ipcError(code: IpcErrorCode, message: string, issues?: unknown): IpcError {
  return issues === undefined ? { code, message } : { code, message, issues };
}
