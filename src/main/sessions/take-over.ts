// W7 F2 (charter D-12 as amended 2026-10-01; docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md, F2): "Take
// over here" on a session another process holds. After the owner confirmed which holder (the renderer's confirm names
// it), MAWS reads the holder fresh (holder authority: C4's registry read, which checks the pid's start time, and C3's
// process table), refuses when it is not the one confirmed or is MAWS's own, ends it (`claude stop <short>` for a
// `--bg` job, SIGTERM to an interactive holder's verified pid), and waits, bounded, for the registry to clear. The
// resume itself is the existing one (`session.start` on the record, grants re-applied by the host), which the renderer
// runs on `released`. A turn in progress in the other process is lost; the confirm says so.
import { execFile } from 'node:child_process';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { ForeignHolder } from '@shared/graph/session';
import type { TakeOverOutcome } from '@shared/ipc/schema/session';
import { hostCall } from './context';
import { holderAuthority, type HolderDeps } from './holders';

export const TAKE_OVER_WAIT_MS = 10_000; // the registry clears at the holder's exit (its exit handler unlinks the record)
export const TAKE_OVER_POLL_MS = 250;
export const STOP_TIMEOUT_MS = 15_000; // `claude stop` asks the job's daemon and waits for it

export interface TakeOverDeps extends HolderDeps {
  env: NodeJS.ProcessEnv; // the environment the engine receives (its config home)
  signal?: (pid: number) => void;
  runStop?: (binary: string, jobId: string, env: NodeJS.ProcessEnv) => Promise<void>;
  waitMs?: number;
  pollMs?: number;
}

// The holder as the owner reads it in a refusal (the row's words).
export function holderName(holder: ForeignHolder): string {
  if (holder.kind === 'terminal') return `the terminal (pid ${holder.pid})`;
  if (holder.jobId !== null) return `the background job bg · ${holder.jobId}`;
  return holder.pid === null ? 'a background job' : `a background job (pid ${holder.pid})`;
}

const sameHolder = (a: ForeignHolder, b: ForeignHolder) =>
  a.kind === 'terminal' ? b.kind === 'terminal' && a.pid === b.pid : b.kind === 'background_job' && a.pid === b.pid && a.jobId === b.jobId;

const refused = (reason: Extract<TakeOverOutcome, { status: 'refused' }>['reason'], message: string): TakeOverOutcome => ({ status: 'refused', reason, message });

export async function releaseHolder(deps: TakeOverDeps, q: { engineSessionId: SessionId | null; appSessionId: AppSessionId; expected: ForeignHolder }): Promise<TakeOverOutcome> {
  const authority = () => holderAuthority(deps, { engineSessionId: q.engineSessionId, appSessionId: q.appSessionId });
  const verdict = await authority();
  if (verdict.live === 'self') return refused('self', 'This session is already running in MAWS.');
  if (verdict.live === 'none' || q.engineSessionId === null) return { status: 'released' }; // it exited meanwhile: nothing to end
  // The registry read again (liveness and the pid's start time checked) right before acting: only a row that names the
  // confirmed process is acted on. None left: the holder exited; another one: it is not the process confirmed.
  const rows = (await hostCall(deps.dispatch, 'fs.holders', { sessionIds: [q.engineSessionId], directories: null })).holders.filter((row) => row.sessionId === q.engineSessionId);
  const row = rows.find((r) => (r.holder.kind === 'terminal' || r.holder.kind === 'background_job') && sameHolder(r.holder, q.expected));
  if (row === undefined) {
    const other = rows.find((r) => r.holder.kind === 'terminal' || r.holder.kind === 'background_job')?.holder as ForeignHolder | undefined;
    if (other === undefined) return { status: 'released' };
    return refused('changed', `The session is now held by ${holderName(other)}, not the process you confirmed; nothing was stopped.`);
  }
  const holder = row.holder as ForeignHolder;
  // An interactive holder is signalled only when it is a terminal's (`cli`, or a record too old to say): another app's
  // engine (Claude Desktop, an IDE, another SDK app) registers as interactive too, and is that app's to end.
  if (holder.kind === 'terminal' && row.entrypoint !== undefined && row.entrypoint !== 'cli') {
    return refused('other_app', `The session is open in another app (${row.entrypoint}, pid ${holder.pid}); close it there, or fork a copy.`);
  }
  try {
    if (holder.kind === 'terminal') (deps.signal ?? ((pid) => process.kill(pid, 'SIGTERM')))(holder.pid);
    else {
      if (holder.jobId === null) return refused('no_job_id', `MAWS cannot stop ${holderName(holder)}: it has no job id to give \`claude stop\`.`);
      const binary = (await hostCall(deps.dispatch, 'engine.binaryInfo', undefined)).path;
      await (deps.runStop ?? runStop)(binary, holder.jobId, deps.env);
    }
  } catch (error) {
    // a holder that exited between the read and the signal is the outcome wanted
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      const why = error instanceof Error ? error.message : String(error);
      return refused(holder.kind === 'terminal' ? 'signal_failed' : 'stop_failed', `MAWS could not end ${holderName(holder)}: ${why}`);
    }
  }
  const waitMs = deps.waitMs ?? TAKE_OVER_WAIT_MS;
  const pollMs = deps.pollMs ?? TAKE_OVER_POLL_MS;
  for (const deadline = Date.now() + waitMs; ; ) {
    const now = await authority();
    if (now.live !== 'foreign') return { status: 'released' };
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return refused('timeout', `${capitalised(holderName(holder))} has not exited after ${Math.round(waitMs / 1000)} s; it may be finishing a turn or asking a question there. Try again, or fork a copy.`);
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// `claude stop <short>` with the pinned binary and the engine's environment; its stderr is the refusal's reason.
function runStop(binary: string, jobId: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['stop', jobId], { env, timeout: STOP_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}
