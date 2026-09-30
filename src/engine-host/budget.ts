// The memory budget's policy (charter §4.4 as amended 2026-09-29; C12 execution document, Interfaces "The policy"):
// which live processes hold something an exit would lose (their hard reasons), which are candidates for a release,
// and, when the sum of the engine process trees passes the budget, the one to release now. Pure: the process table
// (process-table.ts) calls `evaluate` after each memory sample and at a policy change, and acts on the verdict.
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus, HardReason } from '@shared/engine/status';

export type { HardReason } from '@shared/engine/status';

export const DEFAULT_BUDGET_FRACTION = 0.25;
export const EXITED_RING = 500; // events an exited stream keeps in memory; older ranges rebuild from the journal
export const EXITED_ROWS_MAX = 24; // exited rows the host keeps; the oldest exit goes first

export interface BudgetPolicy { limitKiB: number; statefulMcpServers: readonly string[] }

export interface BudgetInput {
  rows: readonly EngineSessionStatus[];
  policy: BudgetPolicy;
  quiet: ReadonlySet<AppSessionId>; // rows whose lastEventSeq is unchanged since the previous sample
  releasing: AppSessionId | null; // a budget ladder still in flight
  previousOverWithoutCandidate: boolean; // the previous sample's `over && candidates === 0`
}

export interface BudgetVerdict {
  totalKiB: number; limitKiB: number; over: boolean; unmeasured: number; // live rows with no sample yet (counted as 0)
  release: AppSessionId | null; // at most one per evaluation; null while `releasing`
  blocked: { appSessionId: AppSessionId; reasons: HardReason[] }[]; // live rows with a hard reason, with why
  settling: number; // rows with no hard reason that are not yet candidates (engine running or waiting, not quiet, unmeasured, launching)
  candidates: number;
  overWithoutCandidate: boolean; // over with no candidate now and at the previous sample
}

// The default budget for a machine with `totalBytes` of physical memory (`os.totalmem()`), in KiB.
export function defaultBudgetKiB(totalBytes: number): number {
  return Math.floor((totalBytes / 1024) * DEFAULT_BUDGET_FRACTION);
}

// What the process holds, in a fixed order. An open turn is also the queue's `busy`, so `busy` is named only without
// one. Ambient background tasks are left out: the engine marks them as housekeeping it does not surface as user work
// (every skip_transcript task, such as a memory extraction or a dream, and auto-started watchers; the SDK's
// `SDKBackgroundTasksChangedMessage.tasks[].ambient`), and an auto-started watcher would otherwise hold a process
// forever. Grants never appear (the snapshot re-applies on resume), nor does a server the owner did not list.
export function hardReasons(s: EngineSessionStatus, stateful: ReadonlySet<string>): HardReason[] {
  const reasons: HardReason[] = [];
  if (s.turn !== null) reasons.push('turn');
  else if (s.busy) reasons.push('busy');
  if (s.backgroundTasks.some((t) => !t.ambient)) reasons.push('background_tasks');
  if (s.pendingRequests > 0 || s.pendingPlan !== null) reasons.push('pending_request');
  if (s.queue.length > 0) reasons.push('queued_messages');
  if (s.heldPeerMessages.length > 0) reasons.push('held_peer_message');
  if (s.mcpServers.some((m) => stateful.has(m.name) && (m.status === 'connected' || m.status === 'pending'))) reasons.push('stateful_mcp');
  return reasons;
}

// A process whose tree is in the sum: launched and not already in its termination ladder (a tree in its ladder, up
// to 7 s, is never counted twice).
const LIVE: ReadonlySet<EngineSessionStatus['process']> = new Set(['starting', 'initializing', 'ready']);

// An engine state that rules a row out: the engine said it is working or waiting. `unknown` does not, since the pinned
// engine reports its state (`session_state_changed`) only under CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS, which the
// product's launch does not set (no fixture carries the frame; M3's live run saw none): a live row reads `unknown` for
// its whole life. Its turn, work in flight and quiet stand in for the state: an engine's own follow-up turn after its
// background tasks end moves `lastEventSeq` first and then opens a turn.
const ENGINE_ACTIVE: ReadonlySet<EngineSessionStatus['engineState']> = new Set(['running', 'requires_action']);

export function evaluate(input: BudgetInput): BudgetVerdict {
  const stateful = new Set(input.policy.statefulMcpServers);
  const live = input.rows.filter((s) => LIVE.has(s.process));
  let totalKiB = 0;
  let unmeasured = 0;
  const blocked: BudgetVerdict['blocked'] = [];
  const candidates: EngineSessionStatus[] = [];
  let settling = 0;
  for (const s of live) {
    const tree = s.memory.treeRssKiB;
    if (tree === null) unmeasured += 1;
    else totalKiB += tree;
    const reasons = hardReasons(s, stateful);
    if (reasons.length > 0) blocked.push({ appSessionId: s.appSessionId, reasons });
    else if (s.process === 'ready' && !ENGINE_ACTIVE.has(s.engineState) && tree !== null && input.quiet.has(s.appSessionId)) candidates.push(s);
    else settling += 1;
  }
  const over = totalKiB > input.policy.limitKiB;
  const lru = candidates.reduce<EngineSessionStatus | null>((best, s) => (best === null || s.lastUsedAt < best.lastUsedAt || (s.lastUsedAt === best.lastUsedAt && s.appSessionId < best.appSessionId) ? s : best), null);
  return {
    totalKiB, limitKiB: input.policy.limitKiB, over, unmeasured,
    release: over && input.releasing === null && lru !== null ? lru.appSessionId : null,
    blocked, settling, candidates: candidates.length,
    overWithoutCandidate: over && candidates.length === 0 && input.previousOverWithoutCandidate,
  };
}
