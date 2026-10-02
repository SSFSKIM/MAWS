// The plan outcome "clear context and implement" as the session runs it (C3 execution document, Interfaces "Broker";
// moved out of session.ts in debt wave 3, unchanged): staged before the deny is written, then after the plan turn's
// result the pre-plan mode is restored, `/clear` is sent, and once /clear's turn has ended (or its command finished)
// the plan goes out as a new prompt. While staged it holds the session's queue like an open turn. The session owns the
// process; the sequence asks it through `ClearAndImplementHost`.
import { randomUUID } from 'node:crypto';
import type { PermissionMode } from '@shared/graph/enums';
import type { MessageUuid } from '@shared/graph/ids';
import type { UserInputFrame } from '@shared/wire/frames';
import { setPermissionMode } from './controls';
import type { ControlClient } from './rpc';

const TERMINAL_LIFECYCLE = new Set(['completed', 'cancelled', 'discarded', 'refused']);

// `delivered` settles when the deny response's write settles: the operation is staged before the write so a `result`
// racing the write continuation finds it, and the sequence waits on delivery before sending anything (M3 review).
interface ClearAndImplement { phase: 'awaiting_result' | 'restoring_mode' | 'ready_to_clear' | 'awaiting_clear' | 'ready_to_implement' | 'writing_implementation'; plan: string; clearUuid: MessageUuid | null; delivered: Promise<boolean> }

type AnswerOutcome = 'delivered' | 'not_pending' | 'write_failed';

export interface ClearAndImplementHost {
  client(): ControlClient | null;
  isReady(): boolean;
  prePlanMode(): PermissionMode | null;
  write(frame: UserInputFrame): Promise<void>; // the process's one writer; throws when there is no process
  notice(key: string, text: string): void;
  touch(): void;
  log(message: string): void;
}

export class ClearAndImplementSequence {
  private clear: ClearAndImplement | null = null;
  private paused = false;
  private pending: string | null = null; // a clear_and_implement plan kept for retry after the mode restore failed

  constructor(private readonly host: ClearAndImplementHost) {}

  // A host sequence that writes its own prompts holds the queue like an open turn.
  get holding(): boolean {
    return this.clear !== null;
  }

  get pendingPlan(): string | null {
    return this.pending;
  }

  // Stages the sequence, then writes the deny through `write`; rolled back when the engine never received it.
  async stage(plan: unknown, write: () => Promise<AnswerOutcome>): Promise<AnswerOutcome> {
    let settle!: (ok: boolean) => void;
    const staged: ClearAndImplement = { phase: 'awaiting_result', plan: typeof plan === 'string' ? plan : '', clearUuid: null, delivered: new Promise((resolve) => (settle = resolve)) };
    const previous = { clear: this.clear, pendingPlan: this.pending };
    this.clear = staged;
    this.pending = null;
    let outcome: AnswerOutcome = 'write_failed';
    try {
      outcome = await write();
      return outcome;
    } finally {
      settle(outcome === 'delivered');
      if (outcome !== 'delivered' && this.clear === staged && staged.phase === 'awaiting_result') {
        this.clear = previous.clear; // rolled back: the engine never received the deny
        this.pending = previous.pendingPlan;
      }
      this.host.touch();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.advance();
  }

  turnEnded(succeeded: boolean): void {
    const clear = this.clear;
    if (!clear) return;
    if (clear.phase === 'awaiting_result') {
      clear.phase = 'restoring_mode';
      void this.runClear(clear);
    } else if (clear.phase === 'awaiting_clear') {
      if (!succeeded) return this.fail(clear, 'did not complete successfully');
      clear.phase = 'ready_to_implement';
      this.advance();
    }
  }

  commandLifecycle(commandUuid: MessageUuid | null, state: string): void {
    const clear = this.clear;
    if (!clear || clear.clearUuid === null || clear.clearUuid !== commandUuid || !TERMINAL_LIFECYCLE.has(state)) return;
    if (state !== 'completed') return this.fail(clear, state);
    if (clear.phase === 'awaiting_clear') {
      clear.phase = 'ready_to_implement';
      this.advance();
    }
  }

  processExited(): void {
    this.clear = null;
  }

  // Results can arrive while Stop is pausing the queue or a mode request is in flight. They update the phase,
  // but only an unpaused sequence may write the next prompt. Resume uses the same gate as the app queue.
  private advance(): void {
    const clear = this.clear;
    if (!clear || this.paused || !this.host.isReady()) return;
    if (clear.phase === 'ready_to_clear') {
      const uuid = randomUUID() as MessageUuid;
      clear.clearUuid = uuid;
      clear.phase = 'awaiting_clear';
      void this.writeUser('/clear', uuid).catch((error: unknown) => this.fail(clear, `not written: ${messageOf(error)}`));
    } else if (clear.phase === 'ready_to_implement') {
      // Keep the queue held until the out row registers the prompt with the normalizer. A further resume or
      // queue save must not write a second implementation while this write is in flight.
      clear.phase = 'writing_implementation';
      void this.writeUser(`Implement this plan:\n\n${clear.plan}`)
        .catch((error: unknown) => this.host.log(`plan prompt not written: ${messageOf(error)}`))
        .finally(() => {
          if (this.clear === clear) this.clear = null;
          this.host.touch();
        });
    }
  }

  private fail(clear: ClearAndImplement, reason: string): void {
    if (this.clear !== clear) return;
    this.clear = null;
    this.pending = clear.plan;
    this.host.notice('plan:clear_failed', `Context clear ${reason}; implementation was not started. The plan is kept for retry.`);
    this.host.touch();
  }

  private async runClear(clear: ClearAndImplement): Promise<void> {
    const client = this.host.client();
    if (!(await clear.delivered) || !client || !this.host.isReady()) {
      if (this.clear === clear) this.clear = null;
      return;
    }
    if (this.clear !== clear) return;
    try {
      await setPermissionMode(client, { mode: this.host.prePlanMode() ?? 'default' });
    } catch (error) {
      if (this.clear !== clear) return;
      this.clear = null;
      this.pending = clear.plan;
      this.host.notice('plan:mode_restore_failed', `The mode before plan mode could not be restored: ${messageOf(error)}`);
      this.host.touch();
      return;
    }
    if (this.clear !== clear) return;
    clear.phase = 'ready_to_clear';
    this.advance();
  }

  private async writeUser(content: UserInputFrame['message']['content'], uuid: MessageUuid = randomUUID() as MessageUuid): Promise<MessageUuid> {
    const frame: UserInputFrame = { type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } };
    await this.host.write(frame); // journaled once the bytes reached the pipe, `write_failed` otherwise (M3 review)
    return uuid;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
