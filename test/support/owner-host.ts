// P2-C M4: one session's engine host as main's owner channel hears it, for the owner channel's tests. The host's real
// queue (`src/engine-host/queue.ts`) handles every send, steer, hold, cancel, promotion, removal and exit; every row it
// journals, every frame written and every engine frame the test plays (`command_lifecycle`, an assistant message) goes
// through the real normaliser, launch by launch, and the events reach main as the live stream carries them (or are lost
// while main is not listening). `session.promptHistory` answers by reading the same journals through a fresh
// normaliser per launch, as the host's reader does, so its events and ids are the live ones. Nothing here stands in for
// the engine's acceptance: delivery is only ever the engine's `command_lifecycle`, played by the test.
import { randomUUID } from 'node:crypto';
import { SessionEventSchema, type PromptHistoryEvent, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { JournalRow } from '@shared/wire/journal';
import type { UserInputFrame } from '@shared/wire/frames';
import { Normalizer } from '../../src/engine-host/normalizer';
import { UnsettledFold } from '../../src/engine-host/prompt-history';
import { MessageQueue, type ExitKind } from '../../src/engine-host/queue';
import { MemorySessionStateStore } from '../../src/engine-host/store/memory-session-state-store';

type Lifecycle = Extract<SessionEvent, { kind: 'command.lifecycle' }>;
type LifecycleState = Lifecycle['state'];

export class OwnerHostSim {
  readonly store = new MemorySessionStateStore();
  readonly launches: { launchId: string; rows: JournalRow[] }[] = [];
  queue!: MessageQueue;
  turn = false;
  ready = true;
  listening = true; // main hears the live stream; false: what the host emits is lost to main (E10's resync aside)
  lost: SessionEvent[] = []; // what the host emitted while main was not listening
  holding: SessionEvent[] | null = null; // set: events wait here (a test reorders them), not delivered
  failWrite: ((frame: UserInputFrame) => boolean) | null = null;
  // the engine's answer to `cancel_async_message`: it withdraws the steer (its `cancelled` lifecycle, then true), had
  // nothing to withdraw (false), or the request fails; `cancelGate`, when set, delays the answer after the lifecycle
  cancelAnswer: 'withdrawn' | 'nothing' | Error = 'withdrawn';
  cancelGate: Promise<void> | ((uuid: MessageUuid) => Promise<void>) | null = null;
  historyComplete = true;
  failCommand: CommandName | null = null;
  readonly commands: { name: string; input: unknown }[] = [];
  private normalizer!: Normalizer;
  private clock = Date.parse('2026-10-09T10:00:00.000Z');

  constructor(
    readonly appSessionId: AppSessionId,
    readonly sessionId: SessionId,
    private readonly deliver: (events: SessionEvent[]) => void,
  ) {}

  nowIso(): string {
    return new Date(this.clock).toISOString();
  }

  // A new launch of the session's process: a fresh normaliser and queue over the same stored queue, recovered as the
  // session does before `ready` (the steers an earlier launch that died with its host left unstated, from its journal).
  async launch(): Promise<void> {
    const prior = this.launches.flatMap((l) => l.rows);
    const launchId = `L${this.launches.length + 1}`;
    this.launches.push({ launchId, rows: [] });
    this.normalizer = new Normalizer({ appSessionId: this.appSessionId, launchId, sessionId: this.sessionId });
    this.turn = false;
    this.queue = new MessageQueue({
      appSessionId: this.appSessionId,
      store: this.store,
      write: async (frame) => {
        if (this.failWrite?.(frame)) throw new Error('EPIPE');
        this.row('out', frame);
        if (frame.shouldQuery !== false) this.turn = true;
      },
      meta: (frame) => void this.row('meta', frame),
      turnOpen: () => this.turn,
      canWrite: () => this.ready,
      cancel: async (uuid) => {
        const gate = () => (typeof this.cancelGate === 'function' ? this.cancelGate(uuid) : this.cancelGate);
        if (this.cancelAnswer instanceof Error) {
          await gate();
          throw this.cancelAnswer;
        }
        if (this.cancelAnswer === 'withdrawn') this.engine(uuid, 'cancelled');
        await gate();
        return this.cancelAnswer === 'withdrawn';
      },
      onChange: () => {},
      log: () => {},
      unsettled: async () => {
        const fold = new UnsettledFold();
        for (const row of prior) fold.push(row);
        return fold.unsettled();
      },
    });
    await this.queue.recover();
  }

  // The engine's `command_lifecycle` for a prompt: journaled, normalised, delivered, then handed to the queue as the
  // session does.
  engine(uuid: MessageUuid, state: LifecycleState): void {
    const events = this.row('in', { type: 'command_lifecycle', command_uuid: uuid, state, uuid: randomUUID(), session_id: this.sessionId });
    const lifecycle = events.find((e): e is Lifecycle => e.kind === 'command.lifecycle');
    if (lifecycle) this.queue.onLifecycle(lifecycle);
  }

  // The engine's assistant message with one text block per string; answers the message uuid.
  assistant(texts: string[], over: { uuid?: string; supersedes?: string[]; aborted?: boolean } = {}): MessageUuid {
    const uuid = over.uuid ?? randomUUID();
    this.row('in', {
      type: 'assistant', uuid, session_id: this.sessionId, parent_tool_use_id: null,
      message: { id: `msg_${uuid.slice(0, 8)}`, role: 'assistant', model: 'claude-haiku-4-5', content: texts.map((text) => ({ type: 'text', text })) },
      ...(over.supersedes ? { supersedes: over.supersedes } : {}),
      ...(over.aborted ? { aborted: true } : {}),
    });
    return uuid as MessageUuid;
  }

  // The turn's end as the session hands it to the queue (the queue's own release rule; main reads no turn end).
  async turnEnded(userMessageUuids: MessageUuid[] = []): Promise<void> {
    this.turn = false;
    const at = this.nowIso();
    await this.queue.onTurnEnded({
      id: `turn-end-${at}` as SessionEvent['id'], sessionId: this.sessionId, at, seq: null, agentId: null, parentToolUseId: null, kind: 'turn.ended',
      result: 'success', isError: false, terminalReason: 'completed', resultText: 'OK', durationMs: 1, numTurns: 1, costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null }, permissionDenials: [], errors: [],
      userMessageUuids, origin: 'human', resultIndex: null, isEchoReceipt: false,
    });
  }

  // The process's end: the queue states what it leaves (abandon, uncertain, retire), then the exit row.
  async exit(kind: ExitKind = 'crash'): Promise<void> {
    await this.queue.onProcessExited(kind);
    this.ready = false;
    this.row('meta', { event: 'exit', code: kind === 'crash' ? 1 : 0, signal: null, reason: kind });
    this.ready = true;
  }

  // E10's resync burst on reconnect: what main missed of the given kinds, re-delivered; the rest stays lost.
  resync(kinds: SessionEvent['kind'][]): void {
    const burst = this.lost.filter((event) => kinds.includes(event.kind));
    this.lost = [];
    if (burst.length > 0) this.deliver(burst);
  }

  // Delivers what `holding` kept, in the given order.
  release(order: (events: SessionEvent[]) => SessionEvent[] = (events) => events): void {
    const held = this.holding ?? [];
    this.holding = null;
    this.deliver(order(held));
  }

  // `session.promptHistory` over the journals: each launch through a fresh normaliser seeded as its live one was.
  history(since: string): { events: PromptHistoryEvent[]; complete: boolean } {
    const from = Date.parse(since);
    const events: PromptHistoryEvent[] = [];
    for (const launch of this.launches) {
      const normalizer = new Normalizer({ appSessionId: this.appSessionId, launchId: launch.launchId, sessionId: this.sessionId });
      for (const row of launch.rows) {
        for (const event of normalizer.push(row)) {
          if ((event.kind === 'queue.transition' || event.kind === 'command.lifecycle') && Date.parse(event.at) >= from) events.push(event);
        }
      }
    }
    return { events, complete: this.historyComplete };
  }

  // The engine host's side of main's dispatch for the commands the owner channel sends.
  readonly dispatch = async (_owner: string, name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    this.commands.push({ name, input });
    const fail = (message: string) => ({ ok: false as const, error: { code: 'internal' as const, message } });
    if (this.failCommand === name) return fail(`${name} failed`);
    const args = input as { queueId?: string; messageUuid?: MessageUuid; since?: string };
    try {
      switch (name) {
        case 'session.queue.list':
          return { ok: true, value: this.queue.state };
        case 'session.queue.remove':
          await this.queue.remove(args.queueId!);
          return { ok: true, value: undefined };
        case 'session.steer.cancel':
          return { ok: true, value: await this.queue.cancelSteer(args.messageUuid!) };
        case 'session.promptHistory':
          return { ok: true, value: this.history(args.since!) };
        default:
          return fail(`unexpected command ${name}`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  // One journal row of the current launch (a frame the host wrote or read, or a meta row), normalised and delivered.
  row(direction: JournalRow['direction'], frame: unknown): SessionEvent[] {
    this.clock += 1000;
    const launch = this.launches.at(-1)!;
    const row = { seq: (launch.rows.at(-1)?.seq ?? 0) + 1, direction, at: this.nowIso(), frame } as JournalRow; // a test may drop rows: never reuse a seq
    launch.rows.push(row);
    const events = this.normalizer.push(row).map((event) => SessionEventSchema.parse(event));
    if (events.length === 0) return events;
    if (this.holding !== null) this.holding.push(...events);
    else if (this.listening) this.deliver(events);
    else this.lost.push(...events);
    return events;
  }
}
