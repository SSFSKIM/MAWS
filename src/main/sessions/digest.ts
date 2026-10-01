// The digest fold (C5 execution document, Interfaces "Main modules", *Digest fold*): the live facts a sidebar row, an
// Overview card and a status line show, folded from X1 events by a pure reducer over the parent conversation only.
//
// Three rules come before the table. Partition: an event with `agentId` or `parentToolUseId` set is child-agent
// traffic (forwarded child messages, C4's sidecar backfill with its own turn.started/turn.ended) and touches only the
// pending count; the child-agent counts come from the parent's own subagent.started/finished. Echo receipts: a
// `turn.ended { isEchoReceipt }` and a `user.message { origin: 'bash_echo' }` are not turns. Deduplication by event id
// over a bounded window lives in `foldEvents`, since `foldDigest` is pure per event.
import { basename } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import type { EngineSessionStatus } from '@shared/engine/status';
import { stripAnsi } from '@shared/wire/ansi';

export const SEEN_WINDOW = 2_000;
const LAST_LINE_MAX = 160;

export function emptyDigest(appSessionId: AppSessionId): SessionDigest {
  return {
    appSessionId, phase: 'idle', activity: null, lastAssistantLine: null, turnStartedAt: null, lastTurnEndedAt: null,
    context: null, cost: null, childAgents: { active: 0, done: 0 }, pendingRequests: 0, revision: 0,
  };
}

const REQUESTED = new Set<SessionEvent['kind']>(['permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested']);
const RESOLVED = new Set<SessionEvent['kind']>(['permission.resolved', 'question.answered', 'plan.resolved', 'dialog.resolved', 'elicitation.resolved']);

const input = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function activityForTool(toolName: string, toolInput: unknown): string {
  const args = input(toolInput);
  switch (toolName) {
    case 'Bash':
      return `Running ${text(args.command).slice(0, 60)}`;
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return `Editing ${basename(text(args.file_path))}`;
    case 'Read':
      return `Reading ${basename(text(args.file_path))}`;
    case 'Glob':
    case 'Grep':
      return 'Searching';
    case 'WebFetch':
      try {
        return `Fetching ${new URL(text(args.url)).host}`;
      } catch {
        return 'Fetching';
      }
    default:
      return `Running ${toolName}`;
  }
}

// The first non-blank line of a text block, ANSI stripped (a MessageDisplay hook's display form carries colour codes,
// which the transcript strips too; W1).
function firstLine(block: { type: string } & Record<string, unknown>): string | null {
  if (block.type !== 'text') return null;
  const line = stripAnsi(text(block.text)).split('\n').find((candidate) => candidate.trim().length > 0);
  return line === undefined ? null : line.trim().slice(0, LAST_LINE_MAX);
}

// The engine reports cost as the process's running total (`result.total_cost_usd`; the probe's pass2/rewind results read
// 0.0555, 0.0614, 0.0674), so a sample replaces the process's total rather than adding to it. A session outlives its
// processes, and the engine carries its cost across them: at exit it records the running total in the transcript
// (2.1.283's `cost-state` entry) and a resumed process restores it, so the resumed total continues the conversation's
// (resume-fork-start ends at 0.02668, the resume of the same id, resume-fork-no-replay, reads 0.02951 after one short
// turn, and the next resume 0.03220). The restored part is the previous process's final total: the session's cost is
// what every finished process added beyond what it restored, plus what the live one has added. A process that restored
// nothing (it was resumed while the previous one still ran, pass2/resume-live-second) shows as a first total below the
// restored figure, and counts from zero. Not covered: a process killed before it could record its total (SIGKILL)
// leaves an older `cost-state` to restore, which the ledger cannot tell apart; and a fork restores its source's total
// (resume-fork-cli), so a forked session starts at its source's cost. A synthesised `turn.ended` (`seq: null`, C4's
// backfill from disk, where no accounting is recorded per turn) carries no cost and leaves the ledger alone.
export interface CostLedger {
  finishedUsd: number; // what the processes that exited added beyond what each restored
  restoredUsd: number; // the live process's restored part: the previous process's final total
  runningUsd: number; // the live process's running total, restored part included
  awaitingFirst: boolean; // a process exited and its successor has reported no total yet
}

// A session's ledger when its fold begins: a cost already on the digest (scripted by the stub, seeded, or folded before
// main restarted) is the live process's running total, all of it its own.
export const costLedger = (d: SessionDigest): CostLedger => ({ finishedUsd: 0, restoredUsd: 0, runningUsd: d.cost?.totalUsd ?? 0, awaitingFirst: false });

// The session's cost the ledger holds.
export const costOf = (ledger: CostLedger) => ledger.finishedUsd + ledger.runningUsd - ledger.restoredUsd;

// A process's running total: the first one after an exit tells whether the process restored its predecessor's.
const sample = (ledger: CostLedger, totalUsd: number): CostLedger => ({
  ...ledger,
  restoredUsd: ledger.awaitingFirst && totalUsd < ledger.restoredUsd ? 0 : ledger.restoredUsd,
  runningUsd: totalUsd,
  awaitingFirst: false,
});

export function foldCost(ledger: CostLedger, event: SessionEvent): CostLedger {
  if (event.agentId !== null || event.parentToolUseId !== null) return ledger; // a child's cost is inside the parent's total
  switch (event.kind) {
    case 'turn.ended':
      return event.isEchoReceipt || event.seq === null ? ledger : sample(ledger, event.costUsd);
    case 'usage.sample':
      return sample(ledger, event.costUsd);
    case 'process.exited':
      return { finishedUsd: costOf(ledger), restoredUsd: ledger.runningUsd, runningUsd: ledger.runningUsd, awaitingFirst: true };
    default:
      return ledger;
  }
}

const withCost = (d: SessionDigest, totalUsd: number): SessionDigest => ({ ...d, cost: { totalUsd, sinceSeenUsd: d.cost?.sinceSeenUsd ?? 0 } });

// One event on its own: the digest's cost is taken as its process's running total (`foldEvents` carries the ledger).
export function foldDigest(prev: SessionDigest, event: SessionEvent): SessionDigest {
  return foldWithLedger(prev, event, foldCost(costLedger(prev), event));
}

// `ledger` is the session's cost ledger after this event (`foldCost`).
function foldWithLedger(prev: SessionDigest, event: SessionEvent, ledger: CostLedger): SessionDigest {
  const pending = REQUESTED.has(event.kind) ? 1 : RESOLVED.has(event.kind) ? -1 : 0;
  const d = pending === 0 ? prev : { ...prev, pendingRequests: Math.max(0, prev.pendingRequests + pending) };

  if (event.agentId !== null || event.parentToolUseId !== null) return d; // child traffic

  switch (event.kind) {
    case 'turn.started':
      return { ...d, phase: 'working', turnStartedAt: event.at, activity: 'Thinking' };
    case 'assistant.block.delta':
      return event.thinkingDelta !== null ? { ...d, activity: 'Thinking' } : d;
    case 'tool.use':
      return { ...d, activity: activityForTool(event.toolName, event.input) };
    case 'tool.result':
      return { ...d, activity: 'Working' };
    case 'assistant.block.complete': {
      const line = firstLine(event.block);
      return line === null ? d : { ...d, lastAssistantLine: line };
    }
    case 'session.state':
      // C12: the engine's `idle` follows every result (X6 emits the frames from C12 M5 on), so it keeps a failed turn failed
      if (event.state === 'idle' && d.phase === 'failed') return d;
      return { ...d, phase: event.state === 'requires_action' ? 'waiting' : event.state === 'running' ? 'working' : 'idle' };
    case 'turn.ended': {
      if (event.isEchoReceipt) return d;
      // An interrupt is the human's stop, not a failure: `aborted_streaming` mid-reply, `aborted_tools` mid-tool (debt
      // wave 5), as C3's attention service and C6's divider (`isAbortedReason`) read every `aborted_*` reason.
      const failed = event.isError && !event.terminalReason?.startsWith('aborted_');
      const ended: SessionDigest = { ...d, phase: failed ? 'failed' : 'idle', lastTurnEndedAt: event.at, activity: null };
      return event.seq === null ? ended : withCost(ended, costOf(ledger));
    }
    case 'context.sample':
      return {
        ...d,
        context: {
          percent: event.percentage,
          totalTokens: Math.round(event.totalTokens),
          maxTokens: Math.round(event.maxTokens),
          // no threshold applies when the engine reports autocompact off (debt wave 4), whatever figure it still sends
          autoCompactThreshold: !event.isAutoCompactEnabled || event.autoCompactThreshold === null ? null : Math.round(event.autoCompactThreshold),
        },
      };
    case 'usage.sample':
      return withCost(d, costOf(ledger));
    case 'subagent.started':
      return { ...d, childAgents: { ...d.childAgents, active: d.childAgents.active + 1 } };
    case 'subagent.finished':
      return { ...d, childAgents: { active: Math.max(0, d.childAgents.active - 1), done: d.childAgents.done + 1 } };
    case 'process.exited':
      // C12: a release under the memory budget reads idle with the released mark (an existing mark kept)
      if (event.reason === 'budget' && event.budget !== null) return { ...d, phase: 'idle', activity: null, pendingRequests: 0, released: d.released ?? { at: event.at, limitKiB: event.budget.limitKiB } };
      // The broker retires every pending item on exit (they become one `interrupted` attention item).
      return { ...d, phase: event.reason === 'crash' ? 'failed' : 'exited', activity: null, pendingRequests: 0 };
    case 'session.reconnect':
      return event.phase === 'attempting' ? { ...d, activity: 'Reconnecting' } : d;
    case 'boundary.compaction':
      return d.phase === 'working' ? { ...d, activity: 'Compacting' } : d;
    default:
      return d; // user.message (bash echoes included) and every other kind leave the digest alone
  }
}

// Folds a batch, skipping ids already in `seen` (a backfill overlapping a snapshot, a repeated batch) and keeping the
// last SEEN_WINDOW ids. `seen` and `ledger` are the caller's per-session state, mutated here; insertion order is age
// order.
//
// Liveness: `live` says the session has a live process (the read model's call: an engine status in starting,
// initializing, ready or exiting, or a replay run the host plays). Without one the events are history — C4 following or
// backfilling a transcript nobody here runs — and move only the last line, context and pending count, never the
// phase, activity, turn times or child agents, so replayed history never turns a done or foreign session idle or
// gives it an active child.
export function foldEvents(
  prev: SessionDigest,
  seen: Set<string>,
  events: SessionEvent[],
  ledger: CostLedger = costLedger(prev),
  live = true,
): SessionDigest {
  let digest = prev;
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (seen.size > SEEN_WINDOW) seen.delete(seen.values().next().value as string);
    Object.assign(ledger, foldCost(ledger, event));
    const next = foldWithLedger(digest, event, ledger);
    digest = live
      ? next
      : { ...next, phase: digest.phase, activity: digest.activity, turnStartedAt: digest.turnStartedAt, lastTurnEndedAt: digest.lastTurnEndedAt, childAgents: digest.childAgents };
  }
  return digest;
}

// C3's process table onto the digest's phase: a launching process is `starting`, an exited one `exited` unless the
// digest already says `failed`; a process that became ready while the digest still says `starting` takes the engine
// state's phase (the events that would otherwise say so may have preceded the fold).
// C12: a release (exit reason `budget`) reads idle with the released mark, an existing mark kept; a launch drops it.
export function applyStatusToDigest(d: SessionDigest, status: EngineSessionStatus): SessionDigest {
  switch (status.process) {
    case 'starting':
    case 'initializing':
      return withoutReleased({ ...d, phase: 'starting' }); // C12
    case 'exited':
      // C12 start
      if (status.exit?.reason === 'budget' && status.exit.release !== null) return { ...d, phase: 'idle', activity: null, released: d.released ?? { at: status.exit.at, limitKiB: status.exit.release.limitKiB } };
      // C12 end
      return d.phase === 'failed' ? d : { ...d, phase: 'exited', activity: null };
    case 'ready':
      if (d.phase !== 'starting') return d;
      return { ...d, phase: status.engineState === 'running' ? 'working' : status.engineState === 'requires_action' ? 'waiting' : 'idle' };
    default:
      return d;
  }
}

// C12 start: the digest without the released mark (the field is optional, so it is left out rather than set undefined)
export function withoutReleased(d: SessionDigest): SessionDigest {
  if (d.released === undefined) return d;
  const { released: _released, ...rest } = d;
  void _released;
  return rest;
}
// C12 end
