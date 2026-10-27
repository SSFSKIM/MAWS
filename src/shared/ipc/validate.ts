// X2 runtime validation, shared by both sides of the boundary: main checks command inputs on receipt and event
// payloads before sending; the renderer client checks command outputs and event payloads on receipt. Validators never
// transform, default or coerce (charter §12 C1 *Validation library*), so an accepted value deep-equals what was sent.
// P5 O1 M5: the validators are built over a registry (`codecOf`); the free functions are the production registry's.
// P5 O1 M6 (OX1): the codec's `read*` functions are the tolerant readers (tolerant.ts), for a receiver whose peer may be
// another build of the wire's major: the host runtime's inputs, main's supervisor's outputs and events. They accept what
// was sent less the object keys this build does not know, and name those keys in `dropped`. The renderer boundary keeps
// the strict `validate*`.
import * as z from 'zod';
import { ipcError, type IpcError } from './errors';
import { REGISTRY, type EventNameOf, type InputOf, type NameOf, type OutputOf, type PayloadOf, type ResultOf, type WireRegistry } from './registry';
import type { CommandInput, CommandName, CommandResult, EventName, EventPayload } from './schema';
import { readTolerant } from './tolerant';

export interface WireCodec<R extends WireRegistry> {
  isCommandName(name: unknown): name is NameOf<R>;
  isEventName(name: unknown): name is EventNameOf<R>;
  validateCommandInput<N extends NameOf<R>>(name: N, input: unknown): { ok: true; value: InputOf<R, N> } | { ok: false; error: IpcError };
  validateCommandOutput<N extends NameOf<R>>(name: N, output: unknown): ResultOf<R, N>;
  validateEventPayload<N extends EventNameOf<R>>(name: N, payload: unknown): { ok: true; value: PayloadOf<R, N> } | { ok: false; issues: z.core.$ZodIssue[] };
  // P5 O1 M6: the tolerant readers
  readCommandInput<N extends NameOf<R>>(name: N, input: unknown): { ok: true; value: InputOf<R, N>; dropped: string[] } | { ok: false; error: IpcError };
  readCommandOutput<N extends NameOf<R>>(name: N, output: unknown): { ok: true; value: OutputOf<R, N>; dropped: string[] } | { ok: false; error: IpcError };
  readEventPayload<N extends EventNameOf<R>>(name: N, payload: unknown): { ok: true; value: PayloadOf<R, N>; dropped: string[] } | { ok: false; issues: z.core.$ZodIssue[] };
}

export function codecOf<R extends WireRegistry>(registry: R): WireCodec<R> {
  const { commands, events } = registry;
  return {
    // Own keys only: a name such as `constructor` or `toString` is not a registered command.
    isCommandName: (name): name is NameOf<R> => typeof name === 'string' && Object.hasOwn(commands, name),
    isEventName: (name): name is EventNameOf<R> => typeof name === 'string' && Object.hasOwn(events, name),
    validateCommandInput(name, input) {
      const parsed = commands[name].input.safeParse(input);
      if (parsed.success) return { ok: true, value: parsed.data as InputOf<R, typeof name> };
      return { ok: false, error: ipcError('invalid_input', explain(`input for ${name}`, parsed.error), parsed.error.issues) };
    },
    validateCommandOutput(name, output) {
      const parsed = commands[name].output.safeParse(output);
      if (parsed.success) return { ok: true, value: parsed.data } as ResultOf<R, typeof name>;
      return { ok: false, error: ipcError('invalid_output', explain(`output of ${name}`, parsed.error), parsed.error.issues) };
    },
    validateEventPayload(name, payload) {
      const parsed = events[name].safeParse(payload);
      if (parsed.success) return { ok: true, value: parsed.data as PayloadOf<R, typeof name> };
      return { ok: false, issues: parsed.error.issues };
    },
    // P5 O1 M6 start
    readCommandInput(name, input) {
      const read = readTolerant(commands[name].input, input);
      if (read.ok) return { ok: true, value: read.value as InputOf<R, typeof name>, dropped: read.dropped };
      return { ok: false, error: ipcError('invalid_input', explain(`input for ${name}`, read.error), read.error.issues) };
    },
    readCommandOutput(name, output) {
      const read = readTolerant(commands[name].output, output);
      if (read.ok) return { ok: true, value: read.value as OutputOf<R, typeof name>, dropped: read.dropped };
      return { ok: false, error: ipcError('invalid_output', explain(`output of ${name}`, read.error), read.error.issues) };
    },
    readEventPayload(name, payload) {
      const read = readTolerant(events[name], payload);
      if (read.ok) return { ok: true, value: read.value as PayloadOf<R, typeof name>, dropped: read.dropped };
      return { ok: false, issues: read.error.issues };
    },
    // P5 O1 M6 end
  };
}

const production = codecOf(REGISTRY);

export const isCommandName: (name: unknown) => name is CommandName = production.isCommandName;
export const isEventName: (name: unknown) => name is EventName = production.isEventName;
export const validateCommandInput: <N extends CommandName>(name: N, input: unknown) => { ok: true; value: CommandInput<N> } | { ok: false; error: IpcError } =
  production.validateCommandInput;
export const validateCommandOutput: <N extends CommandName>(name: N, output: unknown) => CommandResult<N> = production.validateCommandOutput;
export const validateEventPayload: <N extends EventName>(
  name: N,
  payload: unknown,
) => { ok: true; value: EventPayload<N> } | { ok: false; issues: z.core.$ZodIssue[] } = production.validateEventPayload;

const explain = (what: string, error: z.ZodError) => `invalid ${what}: ${z.prettifyError(error)}`;
