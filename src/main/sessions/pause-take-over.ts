// W14 (§2 N): a transaction over one verified pane holder. The allowance is passed down this resume only,
// never stored on the service or exposed over IPC. Rollback uses shell job control (the architect's probe ruling).
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import type { TakeOverOutcome } from '@shared/ipc/schema/session';
import type { PausedHolder } from './holders';
import { canForeground, type PaneProcess, type Processes } from './pane-holder';

export const PAUSE_WAIT_MS = 3_000;
export interface PauseDeps {
  processes(): Promise<Processes>;
  write(data: string): Promise<void>;
  foreground(): Promise<{ process: string | null; busy: boolean }>;
  signal(pid: number, signal: 'SIGKILL'): void;
  clear(): Promise<boolean>;
  resume(allow: PausedHolder): Promise<void>; // settles at ready, or rejects after launch failure
  cancel(): Promise<boolean>; // true only when the new engine is confirmed gone
  waitMs?: number;
  pollMs?: number;
}
export async function until(test: () => Promise<boolean>, waitMs: number, pollMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}
export async function pauseTakeOver(deps: PauseDeps, q: { appSessionId: AppSessionId; engineSessionId: SessionId }, target: { pane: PtyInfo; holder: PaneProcess }): Promise<TakeOverOutcome> {
  const { pane, holder } = target;
  const waitMs = deps.waitMs ?? PAUSE_WAIT_MS;
  const pollMs = deps.pollMs ?? 100;
  const sameProcess = (p: PaneProcess | undefined) => p?.started === holder.started && p.pgid === holder.pgid;
  const isPaused = async () => { const p = (await deps.processes()).get(holder.pid); return sameProcess(p) && p!.state.includes('T'); };
  let pauseSent = false;
  let resuming = false;
  let ending = false;
  try {
    const table = await deps.processes();
    const current = table.get(holder.pid);
    // Do not send control bytes to a shell prompt or to a different foreground job.
    if (!sameProcess(current) || current!.state.includes('T') || table.get(pane.pid)?.foreground !== holder.pgid) throw new Error('The confirmed CLI is no longer the foreground job in this terminal pane.');
    pauseSent = true;
    await deps.write('\x1a');
    if (!(await until(isPaused, waitMs, pollMs))) throw new Error('The terminal CLI did not pause in time; nothing was resumed here.');
    resuming = true;
    await deps.resume({ ...q, pid: holder.pid, isPaused });
    if (!(await isPaused())) throw new Error('The terminal CLI was continued while MAWS was starting.');
    ending = true;
    deps.signal(holder.pid, 'SIGKILL');
    if (!(await until(deps.clear, deps.waitMs ?? 10_000, pollMs))) throw new Error('The old holder registry row has not cleared.');
    return { status: 'resumed', warning: null };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (ending) return { status: 'resumed', warning: `The session is running here, but MAWS could not finish ending the paused terminal CLI: ${why} Do not run fg for that old CLI.` };
    if (resuming && !(await deps.cancel().catch(() => false))) return { status: 'refused', reason: 'resume_failed', message: `${why} The new engine may still be running; the terminal CLI was left paused to avoid two writers. Stop the engine here before typing fg in that pane.` };
    let restored = false;
    try {
      const table = await deps.processes();
      const p = table.get(holder.pid);
      // An untouched, still-foreground CLI needs no recovery. Otherwise only the unambiguous shell job is safe.
      restored = sameProcess(p) && !p!.state.includes('T') && p!.foreground === holder.pgid;
      if (pauseSent && !restored && sameProcess(p) && canForeground(holder.pid, pane.pid, table) && !(await deps.foreground()).busy) {
        await deps.write('\x15fg\n');
        restored = await until(async () => {
          const next = (await deps.processes()).get(holder.pid);
          return sameProcess(next) && !next!.state.includes('T') && next!.foreground === holder.pgid;
        }, waitMs, pollMs);
      }
    } catch { /* leave the job untouched when foreground ownership cannot be established */ }
    return { status: 'refused', reason: resuming ? 'resume_failed' : 'pause_failed', message: `${why} ${restored ? 'The terminal CLI is back in the foreground.' : 'To return to the CLI, type fg in that terminal pane.'}` };
  }
}
