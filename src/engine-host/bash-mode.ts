// `!` bash mode (charter §4.2; C3 execution document, Interfaces "Rewind, `!`, `#`", M4): `bash_command` runs the
// command in the engine and replays two `user` frames, `<bash-input>` and `<bash-stdout>…<bash-exit-code>`; the model
// sees none of it unless the host then writes a non-querying echo (`pass2/bash-context-alone` vs `bash-context-echoed`).
// The command is answered at the `bash_command` write; the echo follows the replayed output, carrying
// `<bash-input>${command}</bash-input>\n` plus the replayed stdout frame's content verbatim, with the engine's
// closed origin vocabulary on the wire (`human`); the normaliser marks its event `bash_echo` from the out row, and the
// empty `result` that follows is the echo receipt. No output within 30 s posts a warning notice and writes no echo.
import { randomUUID } from 'node:crypto';
import type { ContentBlock } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { StdinFrame } from '@shared/wire/frames';
import { bashPartOf } from './normalizer-support';
import type { EngineSession } from './session';

export const BASH_OUTPUT_TIMEOUT_MS = 30_000;

export interface BashModeDeps {
  cwd: () => string; // the session's working directory (system/init's canonical cwd once known)
  write: (frame: StdinFrame) => Promise<void>; // the process's OutboundWriter
  notice: (key: string, text: string) => void; // a `meta notice` row
  canWrite: () => boolean;
  log: (message: string) => void;
  outputTimeoutMs?: number;
}

interface Pending {
  uuid: MessageUuid;
  command: string;
  inputSeen: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

// C12: a command the engine is running, from its write until its output is replayed or the process exits. Apart from
// `Pending`, which is the echo's bookkeeping and gives up at the no-output warning: a warning is not completion.
interface Running {
  uuid: MessageUuid;
  command: string;
  inputSeen: boolean;
}

export class BashMode {
  private readonly pending: Pending[] = [];
  private readonly running: Running[] = []; // C12

  constructor(private readonly deps: BashModeDeps) {}

  // C12: a `!` command written whose output has not been replayed yet, the no-output warning notwithstanding (the
  // status's `busy`: the budget never releases a process with a command still running)
  get hasPending(): boolean {
    return this.running.length > 0;
  }

  // Writes `bash_command` and answers at the flush; the echo follows from `observe`.
  async run(command: string): Promise<{ commandUuid: MessageUuid }> {
    if (!this.deps.canWrite()) throw new Error('the session is not ready');
    const uuid = randomUUID() as MessageUuid;
    const entry: Pending = { uuid, command, inputSeen: false, timer: null };
    const live: Running = { uuid, command, inputSeen: false }; // C12
    this.pending.push(entry); // before the write: the replayed frames may be read while it is in flight
    this.running.push(live); // C12
    try {
      await this.deps.write({ type: 'bash_command', command, cwd: this.deps.cwd(), uuid });
    } catch (error) {
      this.drop(entry);
      this.finish(live); // C12: never written, never run
      throw error;
    }
    if (this.pending.includes(entry) && entry.timer === null) {
      entry.timer = setTimeout(() => {
        if (!this.pending.includes(entry)) return;
        this.drop(entry);
        this.deps.notice(`bash:no_output:${uuid}`, `The ! command produced no output within ${Math.round((this.deps.outputTimeoutMs ?? BASH_OUTPUT_TIMEOUT_MS) / 1000)} s, so the model was not shown it.`);
      }, this.deps.outputTimeoutMs ?? BASH_OUTPUT_TIMEOUT_MS);
      (entry.timer as { unref?: () => void }).unref?.();
    }
    return { commandUuid: uuid };
  }

  // An inbound frame (already journaled): the engine's replayed `<bash-input>` and `<bash-stdout>` frames, in order.
  // C12: the output also ends the command's run, whether or not the echo still waits for it.
  observe(frame: unknown): void {
    const f = frame as { type?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } };
    if (f.type !== 'user' || (typeof f.parent_tool_use_id === 'string' && f.parent_tool_use_id.length > 0) || (this.pending.length === 0 && this.running.length === 0)) return;
    const content = f.message?.content;
    if (typeof content !== 'string' && !Array.isArray(content)) return;
    const part = bashPartOf(content as string | ContentBlock[]);
    if (part?.part === 'input') {
      const entry = this.pending.find((p) => !p.inputSeen && p.command === part.command) ?? this.pending.find((p) => !p.inputSeen);
      if (entry) entry.inputSeen = true;
      const live = this.running.find((r) => !r.inputSeen && r.command === part.command) ?? this.running.find((r) => !r.inputSeen); // C12
      if (live) live.inputSeen = true;
    } else if (part?.part === 'output') {
      const live = this.running.find((r) => r.inputSeen) ?? this.running[0]; // C12
      if (live) this.finish(live);
      const entry = this.pending.find((p) => p.inputSeen);
      if (entry) this.echo(entry, content as string);
    }
  }

  processExited(): void {
    for (const entry of [...this.pending]) this.drop(entry);
    this.running.length = 0; // C12: an exited process runs nothing
  }

  // C12
  private finish(live: Running): void {
    const index = this.running.indexOf(live);
    if (index >= 0) this.running.splice(index, 1);
  }

  private echo(entry: Pending, stdout: string): void {
    this.drop(entry);
    if (!this.deps.canWrite()) return;
    const frame: StdinFrame = {
      type: 'user', uuid: randomUUID(), shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' },
      message: { role: 'user', content: `<bash-input>${entry.command}</bash-input>\n${stdout}` },
    };
    this.deps.write(frame).catch((error: unknown) => this.deps.log(`! echo for ${entry.uuid} not written: ${error instanceof Error ? error.message : String(error)}`));
  }

  private drop(entry: Pending): void {
    if (entry.timer) clearTimeout(entry.timer);
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
  }
}

// `session.bash`: the X2 handler's entry point.
export function bashCommand(session: EngineSession, command: string): Promise<{ commandUuid: MessageUuid }> {
  return session.bash(command);
}
