// The rewind repair (P5 O3-D M4, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D18; O3 Decision Log 9): the
// engine answers a rewind before its anchor is on disk, so a SIGKILL within about 100 ms of the answer loses it and the
// resumed conversation is the one from before the rewind. The session service keeps a session's last act while that act
// is a rewind, at `<userData>/sessions/rewinds/<appSessionId>.json` beside the setup intents:
// - `attempted`, the rewind's input, written before the rewind is forwarded (an answer the kill took may have landed);
// - `confirmed`, once the engine host answered `rewound: true`;
// - gone on a definitive refusal (`rewound: false`, or the host's refusal before it wrote the request), on a later
//   conversation act, and at the end of the note's launch through `end_session` (the engine exits once its writes are
//   flushed).
// The resume that `session.start` and `session.acquire` both reach (resume.ts) re-sends a note it finds once, between its
// launch's ready and any input; an anchor that landed answers `target_not_found`, which changes nothing.
//
// P5 O3-D M5a (D44(3), D47): a phone's act reaches the engine host as lane B's claimed `host.op`, run inside the host by
// its op ledger. One whose inner command is the rewind or a conversation act goes through the note as a local one does
// (`claimed`): the rewind's `attempted` written before the op is forwarded, its outcome read from the op's answer
// (`rewound: true` confirms; a refusal before it ran, `rewound: false` or the host's refusal before it wrote the request
// deletes), an act's accepted answer clearing the note. An op the host's ledger already knows (a retried action, whose
// answer the ledger replays and which runs nothing) touches no note.
//
// A note names the launch it was sent to (the live row's at the rewind; the resume's own once a re-send landed), so only
// that launch's end can clear it: a resume that fails after its launch stops a process the rewind never reached.
import { rm } from 'node:fs/promises';
import * as z from 'zod';
import { AppSessionIdSchema, MessageUuidSchema, type AppSessionId, type MessageUuid } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { RewindOutcome } from '@shared/engine/rewind-outcome';
import { HostCommandError } from '@shared/host/runtime';
import type { HostDispatch } from '@shared/host/host-supervisor';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { hostCall, reservationOf } from './context';
import { fileOf, readAll, writeWhole } from './json-files';
import { messageOf, SetupFailure } from './setup-steps';

const RewindNoteSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  state: z.enum(['attempted', 'confirmed']),
  targetMessageUuid: MessageUuidSchema,
  lastSeenMessageUuid: MessageUuidSchema,
  files: z.boolean(),
  launchId: z.string().nullable(), // null: no live row was listed at the rewind, so any end through end_session clears it
  at: z.string(),
});
export type RewindNote = z.infer<typeof RewindNoteSchema>;

// The acts after which the transcript carries the cut itself: each writes a user message (or a `!` command's rows) whose
// parent is past the rewind. `session.answer` is not among them (the read side intercepts it, and it continues a turn a
// send started); nor is `session.queue.setPaused`, which writes only when entries wait. Main's own sends straight to the
// engine host (a notification's reply, Send to main) are not seen: the note they leave is re-sent with its old
// last-seen cursor, which the engine's guard against discarding an unseen turn refuses.
export const CONVERSATION_ACTS = ['session.send', 'session.steer', 'session.queue.promote', 'session.bash'] as const;
export type ConversationAct = (typeof CONVERSATION_ACTS)[number];
const isAct = (name: string): name is ConversationAct => (CONVERSATION_ACTS as readonly string[]).includes(name);
type Op = CommandOutput<'host.op'>;

// The engine host's refusals before it writes the request to the engine (src/engine-host/ipc.ts `sessionOf`, rewind.ts
// `clientOf`): nothing reached the engine, so nothing can land later. Any other failure (a timeout, a process that exited
// before answering, a host that could not be reached) leaves the note `attempted`.
const UNSENT = /^(unknown session |session \S+ is not ready\b)/;

// A MAWS stop writes end_session first, and the engine answers it by exiting 0 on its own (the probe's journals: `exit
// { code: 0, signal: null }` after each `end_session`); a ladder that had to signal, a crash or the engine's own exit
// reports otherwise.
const STOP_REASONS = new Set(['stop', 'quit', 'archive', 'budget', 'idle']);
export function endedThroughEndSession(exit: EngineSessionStatus['exit']): boolean {
  return exit !== null && STOP_REASONS.has(exit.reason) && exit.code === 0 && exit.signal === null;
}

export interface RewindNotesDeps {
  dispatch: HostDispatch;
  now: () => string;
  log: (message: string) => void;
  track: <T>(promise: Promise<T>) => Promise<T>; // the service's work in flight: a release waits for a note's write
}

export class RewindNotes {
  private readonly notes = new Map<AppSessionId, RewindNote>();
  private loading: Promise<void> | null = null;
  private readonly tails = new Map<AppSessionId, Promise<unknown>>();
  // Each session's rewinds forwarded so far, counted as each is handed to the host: an act clears the note only when no
  // rewind was forwarded after the act was (the act's answer may come back after a later rewind's; and an act forwarded
  // while a rewind's note is still being written reaches the engine before that rewind does).
  private readonly forwarded = new Map<AppSessionId, number>();
  // P5 O3-D M5a (D47): lane B's claimed ops being admitted, by opId (the ledger's own key: another binding of a known id is
  // its `op-conflict`); one at a time per id
  private readonly admitting = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(
    readonly dir: string,
    private readonly deps: RewindNotesDeps,
  ) {}

  // The service stopped: nothing more is written (the profile may be another process's by now); acts still forward.
  close(): void {
    this.closed = true;
  }

  // ---- the intercepts ------------------------------------------------------------------------------------------------

  // `session.rewind`, through the note. A note that cannot be written refuses the rewind unsent.
  async rewind(input: CommandInput<'session.rewind'>): Promise<CommandOutput<'session.rewind'>> {
    const appSessionId = input.appSessionId as AppSessionId;
    const note = await this.attempt(input);
    const result = await this.forward(appSessionId, () => this.deps.dispatch('engine-host', 'session.rewind', input));
    if (!result.ok) {
      if (result.error.code === 'internal' && UNSENT.test(result.error.message)) await this.settle(note, null);
      throw new HostCommandError(result.error);
    }
    const outcome = result.value as RewindOutcome;
    await this.settle(note, outcome.rewound ? { ...note, state: 'confirmed' } : null);
    return outcome;
  }

  // P5 O3-D M5a (D47): lane B's claimed op (above). Its inner input is read as the command's own; one the command's schema
  // refuses goes on untouched, for the host's ledger to refuse `malformed`. The ledger's query reserves nothing, so a copy
  // of an op (a device's retry), or another binding of its id, waits for the one being admitted under that id to settle
  // and is then admitted alone: by then the ledger knows an op that reached it, replays it or refuses the other binding
  // `op-conflict`, and the copy touches no note.
  async claimed(input: CommandInput<'host.op'>): Promise<Op> {
    const name = input.name;
    if (name !== 'session.rewind' && !isAct(name)) return this.sendOp(input);
    const inner = validateCommandInput(name, input.input);
    if (!inner.ok) return this.sendOp(input);
    const key = input.opId;
    for (let earlier = this.admitting.get(key); earlier; earlier = this.admitting.get(key)) await earlier.catch(() => {});
    const admitted = this.admit(input, name, inner.value as { appSessionId: string });
    this.admitting.set(key, admitted);
    try {
      return await admitted;
    } finally {
      if (this.admitting.get(key) === admitted) this.admitting.delete(key);
    }
  }

  private async sendOp(input: CommandInput<'host.op'>): Promise<Op> {
    const result = await this.deps.dispatch('engine-host', 'host.op', input);
    if (!result.ok) throw new HostCommandError(result.error);
    return result.value as Op;
  }

  private async admit(input: CommandInput<'host.op'>, name: 'session.rewind' | ConversationAct, inner: { appSessionId: string }): Promise<Op> {
    const send = () => this.deps.dispatch('engine-host', 'host.op', input);
    const answered = (result: Awaited<ReturnType<typeof send>>): Op => {
      if (!result.ok) throw new HostCommandError(result.error);
      return result.value as Op;
    };
    const appSessionId = inner.appSessionId as AppSessionId;
    // a retried action: the ledger answers what it holds and runs nothing (or refuses it as expired); no note moves. A
    // ledger that cannot say is no proof the op is new: it is refused unsent, as the host refuses with its ledger closed.
    const known = await this.deps.dispatch('engine-host', 'host.opQuery', { opId: input.opId, opCreated: input.opCreated, tombstoneIfAbsent: false }).catch(() => null);
    const query = known?.ok ? (known.value as CommandOutput<'host.opQuery'>) : null;
    if (query === null || query.state === 'unavailable') return { state: 'refused', reason: 'unavailable', ...(query?.ledger !== undefined && { ledger: query.ledger }) };
    if (query.state !== 'not-received') return answered(await send());

    if (isAct(name)) {
      const before = this.forwarded.get(appSessionId) ?? 0;
      const op = answered(await send());
      if (op.state === 'done' && op.result.ok) await this.quietly(appSessionId, (note) => (note === null || (this.forwarded.get(appSessionId) ?? 0) !== before ? undefined : null));
      return op;
    }
    const note = await this.attempt(inner as CommandInput<'session.rewind'>);
    const result = await this.forward(appSessionId, send);
    if (!result.ok) {
      if (result.error.code === 'internal' && UNSENT.test(result.error.message)) await this.settle(note, null);
      throw new HostCommandError(result.error);
    }
    const op = result.value as Op;
    if (op.state === 'refused') await this.settle(note, null); // the ledger ran nothing: its context, its input, a conflict
    else if (op.state === 'done' && op.result.ok) await this.settle(note, (op.result.value as RewindOutcome | undefined)?.rewound ? { ...note, state: 'confirmed' } : null);
    else if (op.state === 'done' && !op.result.ok && op.result.error.code === 'internal' && UNSENT.test(op.result.error.message)) await this.settle(note, null);
    return op; // `in-progress`, or a failure after the request may have been written: `attempted` kept
  }

  // A conversation act, forwarded; once the host accepted it the note it followed has served (a rewind forwarded after
  // the act keeps its own).
  async act<N extends ConversationAct>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
    const appSessionId = input.appSessionId as AppSessionId;
    const before = this.forwarded.get(appSessionId) ?? 0; // read as the act is handed to the host, below
    const result = await this.deps.dispatch('engine-host', name, input);
    if (!result.ok) throw new HostCommandError(result.error);
    await this.quietly(appSessionId, (note) => (note === null || (this.forwarded.get(appSessionId) ?? 0) !== before ? undefined : null));
    return result.value as CommandOutput<N>;
  }

  // A rewind handed to the host: counted in the same turn as the hand-off, so the count orders it against the acts as
  // the host receives them (one link, in call order).
  private forward<T>(appSessionId: AppSessionId, send: () => Promise<T>): Promise<T> {
    this.forwarded.set(appSessionId, (this.forwarded.get(appSessionId) ?? 0) + 1);
    return send();
  }

  // The rewind's note, `attempted`, written before its forward. A note that cannot be written refuses the rewind unsent.
  private async attempt(input: CommandInput<'session.rewind'>): Promise<RewindNote> {
    const appSessionId = input.appSessionId as AppSessionId;
    const live = await reservationOf(this.deps.dispatch, appSessionId).catch(() => null);
    const note: RewindNote = {
      appSessionId,
      state: 'attempted',
      targetMessageUuid: input.targetMessageUuid as MessageUuid, // the input passed the branded id schema
      lastSeenMessageUuid: input.lastSeenMessageUuid as MessageUuid,
      files: input.files,
      launchId: live?.launchId ?? null,
      at: this.deps.now(),
    };
    await this.update(appSessionId, () => note);
    return note;
  }

  // ---- what the service tells it -------------------------------------------------------------------------------------

  // Every engine status: the note's launch ending through end_session clears it.
  observe(status: EngineSessionStatus): void {
    if (status.process !== 'exited' || !endedThroughEndSession(status.exit)) return;
    void this.deps.track(this.quietly(status.appSessionId, (note) => (note !== null && (note.launchId === null || note.launchId === status.launchId) ? null : undefined)));
  }

  // A later act the service made itself (the resume's message), or a session deleted.
  clear(appSessionId: AppSessionId): Promise<void> {
    return this.quietly(appSessionId, (note) => (note === null ? undefined : null));
  }

  // The resume's repair, between its launch's ready and its first input: a note found is re-sent once with its own
  // input. Landed, it is this launch's now (its own end decides again); refused, it goes (`target_not_found`: the anchor
  // had landed). A re-send that fails fails the resume before any input, the note kept for the next one.
  async replay(appSessionId: AppSessionId, launchId: string): Promise<void> {
    await this.load();
    const note = this.notes.get(appSessionId) ?? null;
    if (note === null) return;
    const { targetMessageUuid, lastSeenMessageUuid, files } = note;
    let outcome: RewindOutcome;
    try {
      outcome = await this.forward(appSessionId, () => hostCall(this.deps.dispatch, 'session.rewind', { appSessionId, targetMessageUuid, lastSeenMessageUuid, files }));
    } catch (error) {
      throw new SetupFailure('launching', `the last rewind, which the previous launch may have lost, could not be repeated: ${messageOf(error)}`);
    }
    if (!outcome.rewound && outcome.reason !== 'target_not_found') this.deps.log(`${appSessionId}: the repeated rewind to ${targetMessageUuid} was refused (${outcome.reason ?? outcome.error ?? 'no reason'})`);
    await this.settle(note, outcome.rewound ? { ...note, state: 'confirmed', launchId, at: this.deps.now() } : null);
  }

  // ---- the file per session ------------------------------------------------------------------------------------------

  // A transition from `expected`, unless another act replaced the note meanwhile; its write's failure is logged (the
  // command it follows has already reached the engine).
  private settle(expected: RewindNote, next: RewindNote | null): Promise<void> {
    return this.quietly(expected.appSessionId, (note) => (note === expected ? next : undefined));
  }

  private async quietly(appSessionId: AppSessionId, change: (note: RewindNote | null) => RewindNote | null | undefined): Promise<void> {
    try {
      await this.update(appSessionId, change);
    } catch (error) {
      this.deps.log(`${appSessionId}: the rewind note could not be written: ${messageOf(error)}`);
    }
  }

  // One session's changes in order, each against the note as the previous left it: on disk first, the memory copy
  // following a successful write. `change` answers the next note, null for none, or undefined to leave it.
  private update(appSessionId: AppSessionId, change: (note: RewindNote | null) => RewindNote | null | undefined): Promise<void> {
    const run = async () => {
      await this.load();
      if (this.closed) return;
      const next = change(this.notes.get(appSessionId) ?? null);
      if (next === undefined) return;
      if (next === null) {
        await rm(fileOf(this.dir, appSessionId), { force: true });
        this.notes.delete(appSessionId);
      } else {
        await writeWhole(this.dir, appSessionId, next);
        this.notes.set(appSessionId, next);
      }
    };
    const tail = (this.tails.get(appSessionId) ?? Promise.resolve()).then(run, run);
    const settled = tail.catch(() => {});
    this.tails.set(appSessionId, settled);
    void settled.then(() => this.tails.get(appSessionId) === settled && this.tails.delete(appSessionId));
    return tail;
  }

  // Every note on disk, once. A file that is not a note, or is filed under another id than it names, is skipped and kept.
  private load(): Promise<void> {
    this.loading ??= (async () => {
      const warn = (message: string) => this.deps.log(`rewind notes: ${message}`);
      try {
        for (const { id, value } of await readAll(this.dir, warn)) {
          const parsed = RewindNoteSchema.safeParse(value);
          if (!parsed.success || parsed.data.appSessionId !== id) warn(`${fileOf(this.dir, id)} is not a rewind note for ${id}; skipped`);
          else this.notes.set(parsed.data.appSessionId, parsed.data);
        }
      } catch (error) {
        warn(`${this.dir} could not be read (${messageOf(error)}); no rewind is repaired this run`);
      }
    })();
    return this.loading;
  }
}
