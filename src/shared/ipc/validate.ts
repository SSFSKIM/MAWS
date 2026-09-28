// X2 runtime validation, shared by both sides of the boundary: main checks command inputs on receipt and event
// payloads before sending; the renderer client checks command outputs and event payloads on receipt. Validators never
// transform, default or coerce (charter §12 C1 *Validation library*), so an accepted value deep-equals what was sent.
import * as z from 'zod';
import { ipcError, type IpcError } from './errors';
import {
  commands,
  events,
  type CommandInput,
  type CommandOutput,
  type CommandName,
  type CommandResult,
  type EventName,
  type EventPayload,
} from './schema';

// Own keys only: a name such as `constructor` or `toString` is not a registered command.
export const isCommandName = (name: unknown): name is CommandName => typeof name === 'string' && Object.hasOwn(commands, name);
export const isEventName = (name: unknown): name is EventName => typeof name === 'string' && Object.hasOwn(events, name);

export function validateCommandInput<N extends CommandName>(
  name: N,
  input: unknown,
): { ok: true; value: CommandInput<N> } | { ok: false; error: IpcError } {
  const parsed = commands[name].input.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as CommandInput<N> };
  return { ok: false, error: ipcError('invalid_input', explain(`input for ${name}`, parsed.error), parsed.error.issues) };
}

export function validateCommandOutput<N extends CommandName>(name: N, output: unknown): CommandResult<N> {
  const parsed = commands[name].output.safeParse(output);
  if (parsed.success) return { ok: true, value: parsed.data as CommandOutput<N> };
  return { ok: false, error: ipcError('invalid_output', explain(`output of ${name}`, parsed.error), parsed.error.issues) };
}

export function validateEventPayload<N extends EventName>(
  name: N,
  payload: unknown,
): { ok: true; value: EventPayload<N> } | { ok: false; issues: z.core.$ZodIssue[] } {
  const parsed = events[name].safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data as EventPayload<N> };
  return { ok: false, issues: parsed.error.issues };
}

const explain = (what: string, error: z.ZodError) => `invalid ${what}: ${z.prettifyError(error)}`;
