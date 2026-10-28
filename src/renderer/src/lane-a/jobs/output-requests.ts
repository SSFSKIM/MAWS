// A job's output on request (DC9; the composite's §9.4, DX4's `output` consumer paragraph): the outputs the jobs view
// has open, by task, each asked for on the session's main subscription (`output(taskId, tail)`) and drawn by the
// answer's variant. `ok` is the tail; `missing` says the file is gone (a path) or not named yet (`path` null) and asks
// again once a later `subagents` names a different file for the job; `refused` is final, never asked again;
// `unknown-task` means the request raced the machine's index, so it waits for the next `subagents`: asked again once if
// that carries the task, else (or when none comes within its patience) the task is unknown. A request a reset or an end
// lost, or one made while the subscription was down, is asked again after the fresh snapshot.
import type { Job, TaskOutput } from 'desk-hub/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** How much of a file's end one Output asks for: a screen of a log (the mockup's "Last 4 KB"). */
export const OUTPUT_TAIL = 4096;
/** How long an unknown task waits for the next `subagents` before it is said to be unknown. */
export const UNKNOWN_PATIENCE_MS = 10_000;

type Ok = Extract<TaskOutput, { result: 'ok' }>;

/** One open output as the view draws it. */
export type OutputView =
  | { phase: 'asking'; last: Ok | null } // asked, no answer yet (`last` the text a Refresh keeps drawn meanwhile)
  | { phase: 'ok'; answer: Ok }
  | { phase: 'missing'; path: string | null }
  | { phase: 'refused'; path: string; reason: string }
  | { phase: 'checking' } // the machine does not know the task yet: waiting for the next `subagents`
  | { phase: 'unknown' };

type Open = {
  view: OutputView;
  /** The request is not on the wire: lost to a reset or an end, or made while the subscription was down. */
  unsent: boolean;
  /** Asked again after an unknown task's `subagents` carried it: a second unknown is the answer. */
  retried: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export class OutputRequests {
  readonly state: StoreApi<{ open: ReadonlyMap<string, OutputView> }> = createStore(() => ({ open: new Map<string, OutputView>() as ReadonlyMap<string, OutputView> }));
  private readonly entries = new Map<string, Open>();

  /** `ask` sends a request on the subscription, false when there is none to send it on. */
  constructor(private readonly ask: (taskId: string, tail: number) => boolean) {}

  /** Opens a job's output and asks for it. */
  open(taskId: string): void {
    if (this.entries.has(taskId)) return;
    this.entries.set(taskId, { view: { phase: 'asking', last: null }, unsent: false, retried: false, timer: null });
    this.request(taskId);
  }

  /** Asks again for an open output (a refusal is final). */
  refresh(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry || entry.view.phase === 'refused' || entry.view.phase === 'asking') return;
    entry.retried = false;
    this.request(taskId);
  }

  close(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    this.stopWaiting(entry);
    this.entries.delete(taskId);
    this.publish();
  }

  /** The machine's answer, by its variant; one for an output no longer open changes nothing. */
  answer(output: TaskOutput): void {
    const entry = this.entries.get(output.taskId);
    if (!entry) return;
    switch (output.result) {
      case 'ok':
        entry.view = { phase: 'ok', answer: output };
        break;
      case 'missing':
        entry.view = { phase: 'missing', path: output.path };
        break;
      case 'refused':
        entry.view = { phase: 'refused', path: output.path, reason: output.reason };
        break;
      case 'unknown-task':
        if (entry.retried) entry.view = { phase: 'unknown' };
        else {
          entry.view = { phase: 'checking' };
          entry.timer = setTimeout(() => this.giveUp(output.taskId), UNKNOWN_PATIENCE_MS);
        }
        break;
    }
    this.publish();
  }

  /** The jobs as a snapshot or a `subagents` message now carries them. */
  jobs(jobs: readonly Job[]): void {
    const byTask = new Map(jobs.map((job) => [job.taskId, job]));
    for (const [taskId, entry] of this.entries) {
      const job = byTask.get(taskId);
      if (entry.view.phase === 'checking') {
        this.stopWaiting(entry);
        if (job === undefined) entry.view = { phase: 'unknown' };
        else {
          entry.retried = true;
          this.request(taskId);
        }
      } else if (entry.view.phase === 'missing' && job !== undefined && job.outputFile !== null && job.outputFile !== entry.view.path) {
        this.request(taskId);
      }
    }
    this.publish();
  }

  /** The subscription was reset or ended: what is still awaited is asked again after its fresh snapshot. */
  lost(): void {
    for (const entry of this.entries.values()) if (entry.view.phase === 'asking') entry.unsent = true;
  }

  /** After a fresh snapshot: asks again for every output whose request is not on the wire. */
  resend(): void {
    for (const [taskId, entry] of this.entries) if (entry.unsent) this.request(taskId);
  }

  /** Every output forgotten (the transcript is closed). */
  clear(): void {
    for (const entry of this.entries.values()) this.stopWaiting(entry);
    this.entries.clear();
    this.publish();
  }

  private request(taskId: string): void {
    const entry = this.entries.get(taskId)!;
    const last = entry.view.phase === 'ok' ? entry.view.answer : entry.view.phase === 'asking' ? entry.view.last : null;
    entry.view = { phase: 'asking', last };
    entry.unsent = !this.ask(taskId, OUTPUT_TAIL);
    this.publish();
  }

  private giveUp(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry?.view.phase !== 'checking') return;
    entry.timer = null;
    entry.view = { phase: 'unknown' };
    this.publish();
  }

  private stopWaiting(entry: Open): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  private publish(): void {
    this.state.setState({ open: new Map([...this.entries].map(([taskId, entry]) => [taskId, entry.view])) });
  }
}
