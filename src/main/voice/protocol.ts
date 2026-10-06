// The voice helper's wire (E9 execution document, Design §1 and Interfaces "The helper protocol"): newline-delimited
// JSON, commands on the helper's stdin and events on its stdout. `native/voice-helper/main.swift` is the source of truth
// for every field name; these are its zod mirrors, and every stdout line is validated against `HelperEventSchema` before
// main acts on it. `test/fixtures/voice/helper-lines.jsonl` holds one line of each kind as the helper writes them.
import * as z from 'zod';
import { VoiceErrorCodeSchema, VoicePermissionSchema } from '@shared/ipc/schema/voice';

export type HelperCommand =
  | { cmd: 'probe'; locale: string | null }
  | { cmd: 'start'; id: string; locale: string | null }
  | { cmd: 'stop'; id: string }
  | { cmd: 'cancel'; id: string }
  | { cmd: 'quit' };

export const encodeCommand = (command: HelperCommand): string => `${JSON.stringify(command)}\n`;

// The helper's codes are a subset of `VoiceErrorCodeSchema` (it never writes main's `helper_crashed` or `helper_failed`);
// taking the shared enum keeps one list of codes.
export const HelperEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), protocol: z.literal(1) }),
  z.strictObject({
    type: z.literal('probe'),
    locales: z.array(z.string()),
    systemLocale: z.string(),
    locale: z.string(),
    supportsOnDevice: z.boolean(),
    permission: VoicePermissionSchema,
  }),
  z.strictObject({ type: z.literal('permission'), id: z.string(), ...VoicePermissionSchema.shape }),
  z.strictObject({ type: z.literal('started'), id: z.string(), locale: z.string() }),
  z.strictObject({ type: z.literal('partial'), id: z.string(), text: z.string() }),
  z.strictObject({ type: z.literal('final'), id: z.string(), text: z.string(), timedOut: z.boolean() }),
  z.strictObject({ type: z.literal('cancelled'), id: z.string() }),
  // id null: an error the helper cannot attribute to a capture (an unparseable command line)
  z.strictObject({ type: z.literal('error'), id: z.string().nullable(), code: VoiceErrorCodeSchema, message: z.string() }),
]);
export type HelperLine = z.infer<typeof HelperEventSchema>;
// What a backend hands the service for one capture: every line but the helper's `ready` and `probe` answers.
export type HelperEvent = Exclude<HelperLine, { type: 'ready' } | { type: 'probe' }>;
export type HelperProbe = Extract<HelperLine, { type: 'probe' }>;

export const isCaptureEvent = (line: HelperLine): line is HelperEvent => line.type !== 'ready' && line.type !== 'probe';

// Splits a text stream into lines without ever holding more than `maxLength` characters of one line: a line past the
// bound is dropped (reported once with its length) and reading resumes after its newline, so a runaway line cannot grow
// main's memory. Empty lines are skipped; a `\r` before the newline is dropped.
export class LineSplitter {
  private buffer = '';
  private overlong: number | null = null; // the characters dropped so far of a line past the bound

  constructor(
    private readonly maxLength: number,
    private readonly onLine: (line: string) => void,
    private readonly onOverlong: (length: number) => void,
  ) {}

  push(chunk: string): void {
    let rest = chunk;
    for (let newline = rest.indexOf('\n'); newline !== -1; newline = rest.indexOf('\n')) {
      const head = rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      if (this.overlong !== null) {
        this.onOverlong(this.overlong + head.length);
        this.overlong = null;
        continue;
      }
      const line = (this.buffer + head).replace(/\r$/, '');
      this.buffer = '';
      if (line.length > this.maxLength) this.onOverlong(line.length);
      else if (line.length > 0) this.onLine(line);
    }
    if (this.overlong !== null) {
      this.overlong += rest.length;
    } else if (this.buffer.length + rest.length > this.maxLength) {
      this.overlong = this.buffer.length + rest.length;
      this.buffer = '';
    } else {
      this.buffer += rest;
    }
  }
}
