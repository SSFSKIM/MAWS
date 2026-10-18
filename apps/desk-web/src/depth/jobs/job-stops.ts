// A job's Stop (DC10): the jobs view sends DX6 `stop` for one running job, and reads what became of it from the RPCs the
// conversation keeps (`ConversationState.rpcs`), the latest stop of that job winning. The RPC's answer only says the
// stop ran: the job turns `stopped` on the session's own DX4 body, so the row reads `stopping…` from the press until
// the body says the job no longer runs, or until the stop fails, when the row keeps its status and says why under it.
import type { RpcError } from 'desk-hub/protocol';
import { failureOf } from '../../conversation/outcome';
import { failureText } from '../../conversation/words';
import type { RpcEntry } from '../../project/conversation';

/**
 * How a job's row draws its stop. `stopping`: MAWS's `stopping…`, Stop disabled. `error`: a failure in words, shown while
 * the job runs. `status`: the nonce of a stop whose fate the row cannot tell (the machine dropped before answering, or
 * nothing was sent), drawn with the desk's own RPC status line and its Retry.
 */
export type JobStop = { stopping: boolean; error: string | null; status: string | null };

const NONE: JobStop = { stopping: false, error: null, status: null };

/** The latest stop sent for each job of the session, by task id. */
export function latestStops(rpcs: Record<string, RpcEntry>, machine: string, session: string): Map<string, RpcEntry> {
  const latest = new Map<string, RpcEntry>();
  // Kept in the order they were sent (a nonce is never an integer key), so a later stop of a job replaces an earlier.
  for (const entry of Object.values(rpcs)) {
    const { rpc } = entry;
    if (rpc.rpc === 'stop' && rpc.machine === machine && rpc.args.session === session) latest.set(rpc.args.taskId, entry);
  }
  return latest;
}

/** What `entry`, the job's latest stop, draws on its row while the job is `running` or not. */
export function jobStop(entry: RpcEntry | undefined, running: boolean): JobStop {
  if (!entry || !running) return NONE;
  switch (entry.state) {
    case 'sending':
    case 'forwarded':
      return { ...NONE, stopping: true };
    case 'done':
      // It ran; the body has not caught up yet.
      return { ...NONE, stopping: true };
    case 'failed': {
      const failure = failureOf(entry.outcome);
      return { ...NONE, error: failure ? stopFailureText(failure, entry.rpc.machine) : 'it failed' };
    }
    case 'uncertain':
    case 'not-connected':
      return { ...NONE, status: entry.nonce };
  }
}

/** A failed stop in words, after MAWS's "Couldn't stop it: ": the engine's own message when `TaskStop` erred. */
export function stopFailureText(failure: RpcError, machine: string): string {
  return failure.code === 'failed' && failure.message ? failure.message : failureText(failure, machine);
}
