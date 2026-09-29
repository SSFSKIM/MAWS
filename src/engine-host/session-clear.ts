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
interface ClearAndImplement { phase: 'awaiting_result' | 'clearing' | 'awaiting_clear'; plan: string; clearUuid: MessageUuid | null; delivered: Promise<boolean> }

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

  turnEnded(): void {
    this.advance('turn_ended');
  }

  commandLifecycle(commandUuid: MessageUuid | null, state: string): void {
    if (this.clear?.clearUuid === commandUuid && TERMINAL_LIFECYCLE.has(state)) this.advance('clear_done');
  }

  processExited(): void {
    this.clear = null;
  }

  // After the plan turn's result, restore the pre-plan mode, send `/clear`, and once /clear's turn has ended (or its
  // command finished) send the plan as a new prompt.
  private advance(trigger: 'turn_ended' | 'clear_done'): void {
    const clear = this.clear;
    if (!clear) return;
    if (clear.phase === 'awaiting_result' && trigger === 'turn_ended') {
      clear.phase = 'clearing';
      void this.runClear(clear);
    } else if (clear.phase === 'awaiting_clear') {
      this.clear = null;
      this.writeUser(`Implement this plan:\n\n${clear.plan}`).catch((error: unknown) => this.host.log(`plan prompt not written: ${messageOf(error)}`));
    }
  }

  private async runClear(clear: ClearAndImplement): Promise<void> {
    const client = this.host.client();
    const abandon = () => {
      if (this.clear === clear) this.clear = null;
    };
    if (!(await clear.delivered) || !client || !this.host.isReady()) return abandon();
    try {
      await setPermissionMode(client, { mode: this.host.prePlanMode() ?? 'default' });
    } catch (error) {
      // Stop here: sending /clear and the plan would run it in plan mode. The plan stays on the status for a retry.
      this.host.notice('plan:mode_restore_failed', `The mode before plan mode could not be restored: ${messageOf(error)}`);
      abandon();
      this.pending = clear.plan;
      this.host.touch();
      return;
    }
    if (this.clear !== clear || !this.host.isReady()) return;
    const uuid = randomUUID() as MessageUuid;
    clear.clearUuid = uuid;
    clear.phase = 'awaiting_clear';
    await this.writeUser('/clear', uuid).catch((error: unknown) => this.host.log(`/clear not written: ${messageOf(error)}`));
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
