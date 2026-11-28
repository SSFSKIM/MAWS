// What enters a session from elsewhere, as the arrivals reader names it (UX wave U3, UC-2;
// docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md, Contracts), and the schema of the classes that travel
// on X1's `user.message.arrival`. The reader is `./arrival`; this module holds its types and the schema beside them, so
// that `graph/events.ts` imports the schema without the reader's parsers.
import * as z from 'zod';
import { AskAnswerSchema, type AskAnswer } from '../maws/tools';
import { SheetDeliverySchema, type SheetDelivery } from '../sheet/delivery';

export type Arrival =
  // a message from another session: by the engine's inbox, by the sminos bridge, from a teammate, or typed in as a background session's prompt
  | { class: 'peer'; via: 'inbox' | 'bridge' | 'team' | 'prompt';
      sender: { name: string | null; address: string; session: string | null; owners: string[] | null };
      body: string;            // as drawn: sminos's frame line, note and reply line cut
      frame: string | null;    // sminos's frame line, kept whole for the reader that matches a send to its delivery
      midTurn: boolean; lineage: 'peer' | 'descendant'; replyTo: string | null;
      note: string | null }    // sminos's own note after the words, from its wake release (T2), its words after `[sminos] `; carried, not drawn
  // a message from one of this session's subagents to its main conversation; `report` when it is a hand-back
  | { class: 'subagent'; agentId: string; body: string; report: string | null;
      taskId: string | null }  // a hand-back's `senderTaskId`: the task whose end it is
  // a background task's notification: one <task-notification> block (a background command, agent, workflow, monitor or
  // MCP task), or, told to an idle session MAWS runs, the system/task_notification frame of a background command or monitor
  | { class: 'task'; taskId: string | null; toolUseId: string | null;
      runId: string | null;    // the run that ended: the frame's `run_id`, the origin's `runId`; null where the carrier names none
      outcome: 'completed' | 'failed' | 'stopped' | null;  // null: it reports no end (a monitor's event, the engine's notice that a command seems to wait for input, a check-in on a quiet command)
      summary: string;         // the engine's own sentence, verbatim; the block's first line when it has no <summary>
      durationMs: number | null;  // only an agent's and a workflow's notification carries one
      outputFile: string | null;
      detail: string | null }  // what the engine delivered with it: the result, the note, the event's text, the lines after the block
  // a scheduled prompt firing
  | { class: 'schedule'; prompt: string | null }  // null on the live wire, which does not carry the prompt's text
  // the person's answer to a question that was asked without waiting for it
  | { class: 'answer'; tool: 'maws' | 'sminos';
      call: string;            // the tool-use id of the call that asked
      summary: string;         // the answer as it was delivered to the model
      answers: AskAnswer[] | null;  // parsed, when the carrier holds them (MAWS's own envelope); else null
      dismissed: boolean }     // the person dismissed the question without answering: `summary` is then the bridge's dismissal sentence, whole
  // a slash command's output, its tags cut and a terminal's ANSI escapes removed; `plain` where the carrier's text held
  // such escapes (a terminal's text, not markdown: UX wave U3b, decision 2)
  | { class: 'command'; run: { command: string; args: string } | null; stdout: string; stderr: string; plain: boolean }
  // the person's own words that sminos delivered (a send or a steer, through the inbox or by the bridge): theirs, never a peer's
  | { class: 'own'; via: 'chat' | 'steer'; words: string; frame: string;
      note: string | null }    // sminos's own note after the words, as on `peer`; null for a steer
  // the sminos bridge's own prompt, which wakes a session to read what it has not read
  | { class: 'wake' }
  // MAWS's own "Approve and retry" message for a call auto mode blocked (U1, l4-approvals-12): the person's act, not their prose
  | { class: 'consent'; kind: 'command' | 'call';
      subject: string }        // the command, or the call's input, as the message quotes it (JSON-unquoted)
  // the question sheet's deliveries: the blocks of the envelopes a plugin's prompt or a hook's context carried (the C3
  // plan's §I), each held to the pinned delivery schema
  | { class: 'sheet'; deliveries: SheetDelivery[] };

/** The classes that travel on `user.message.arrival` (B). */
export type CarriedArrival = Extract<Arrival, { class: 'task' | 'schedule' | 'answer' | 'wake' | 'consent' }>;

const OUTCOME = z.enum(['completed', 'failed', 'stopped']).nullable();

export const CarriedArrivalSchema: z.ZodType<CarriedArrival> = z.discriminatedUnion('class', [
  z.strictObject({
    class: z.literal('task'), taskId: z.string().nullable(), toolUseId: z.string().nullable(), runId: z.string().nullable(), outcome: OUTCOME,
    summary: z.string(), durationMs: z.number().nullable(), outputFile: z.string().nullable(), detail: z.string().nullable(),
  }),
  z.strictObject({ class: z.literal('schedule'), prompt: z.string().nullable() }),
  z.strictObject({ class: z.literal('answer'), tool: z.enum(['maws', 'sminos']), call: z.string(), summary: z.string(), answers: z.array(AskAnswerSchema).nullable(), dismissed: z.boolean() }),
  z.strictObject({ class: z.literal('wake') }),
  z.strictObject({ class: z.literal('consent'), kind: z.enum(['command', 'call']), subject: z.string() }),
]);

const CARRIED_CLASSES: ReadonlySet<string> = new Set(['task', 'schedule', 'answer', 'wake', 'consent']);

/** One entry of the field as it travels: a carried arrival, or an entry of a class this build does not know (decision 20). */
export type ArrivalEntry = CarriedArrival | { class: string; [key: string]: unknown };

// A later build adds classes. An entry whose class this build knows is held to its schema, field for field; any other
// passes as it was sent, so one class a build does not know does not fail the whole event. `command` (U3b) is such a
// class on purpose, read by `commandOf` below, never by `carriedOf`.
const UnknownEntrySchema = z.looseObject({ class: z.string().refine((name) => !CARRIED_CLASSES.has(name), 'a class this build knows is read by its own schema') });

export const ArrivalEntrySchema: z.ZodType<ArrivalEntry> = z.union([CarriedArrivalSchema, UnknownEntrySchema]);

/** The entries of the classes this build knows; none for an absent field. */
export function carriedOf(arrival: readonly ArrivalEntry[] | undefined): CarriedArrival[] {
  return (arrival ?? []).filter((entry): entry is CarriedArrival => CARRIED_CLASSES.has(entry.class));
}

// UX wave U3b (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, decision 2 and Interfaces A): what
// travels with a command's output on its own `user.message`. Not a member of the carried union, which the wire's rule
// would count a breaking change: it passes the event's schema through the member above and is held here to a strict
// schema of its own, so a build that knows no such entry keeps the event and an entry that does not fit is ignored.

/** What travels with a command's output: the command the engine ran, and that its text was a terminal's. */
export interface CommandFacts { run: { command: string; args: string } | null; plain: boolean }

const CommandEntrySchema = z.strictObject({
  class: z.literal('command'),
  run: z.strictObject({ command: z.string(), args: z.string() }).optional(),
  plain: z.literal(true).optional(),
});

/** The entry of `arrival` that carries them; none when there is nothing to say (no run, not plain). */
export function commandEntry(facts: CommandFacts): ArrivalEntry[] {
  if (facts.run === null && !facts.plain) return [];
  return [{ class: 'command', ...(facts.run !== null && { run: { command: facts.run.command, args: facts.run.args } }), ...(facts.plain && { plain: true }) }];
}

/** What a `user.message` of origin `local-command` carries: its first entry of class `command`, held to
 *  `{ class: 'command', run?: { command: string; args: string }, plain?: true }` strictly. An entry that does not fit,
 *  or none, reads as `{ run: null, plain: false }`; never an error. */
export function commandOf(arrival: readonly ArrivalEntry[] | undefined): CommandFacts {
  const read = CommandEntrySchema.safeParse(arrival?.find((entry) => entry.class === 'command'));
  return read.success ? { run: read.data.run ?? null, plain: read.data.plain === true } : { run: null, plain: false };
}

// The question sheet's C3 M5 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §I): what travels with a
// carrier of the sheet's envelope, on the same rule as `command`'s: not a member of the carried union, held here to a
// strict schema of its own, so a build that knows no such entry keeps the event and an entry that does not fit is none.

const SheetEntrySchema = z.strictObject({ class: z.literal('sheet'), deliveries: z.array(SheetDeliverySchema) });

/** The deliveries the arrivals of one carrier hold, in order. */
export function sheetFactsOf(arrivals: readonly Arrival[]): SheetDelivery[] {
  return arrivals.flatMap((arrival) => (arrival.class === 'sheet' ? arrival.deliveries : []));
}

/** The entry of `arrival` that carries them; none when there is none. */
export function sheetEntry(deliveries: readonly SheetDelivery[]): ArrivalEntry[] {
  return deliveries.length === 0 ? [] : [{ class: 'sheet', deliveries: [...deliveries] }];
}

/** The deliveries a `user.message` carries: its first entry of class `sheet`, held strictly; an entry that does not fit, or none, reads as none. */
export function sheetDeliveriesOf(arrival: readonly ArrivalEntry[] | undefined): SheetDelivery[] {
  const read = SheetEntrySchema.safeParse(arrival?.find((entry) => entry.class === 'sheet'));
  return read.success ? (read.data.deliveries as SheetDelivery[]) : [];
}
