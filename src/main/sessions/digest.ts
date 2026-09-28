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

function firstLine(block: { type: string } & Record<string, unknown>): string | null {
  if (block.type !== 'text') return null;
  const line = text(block.text).split('\n').find((candidate) => candidate.trim().length > 0);
  return line === undefined ? null : line.trim().slice(0, LAST_LINE_MAX);
}

// The engine reports cost as the process's running total (`result.total_cost_usd`; the probe's pass2/rewind results read
// 0.0555, 0.0614, 0.0674), so a sample replaces the total rather than adding to it.
const withCost = (d: SessionDigest, totalUsd: number): SessionDigest => ({ ...d, cost: { totalUsd, sinceSeenUsd: d.cost?.sinceSeenUsd ?? 0 } });

export function foldDigest(prev: SessionDigest, event: SessionEvent): SessionDigest {
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
      return { ...d, phase: event.state === 'requires_action' ? 'waiting' : event.state === 'running' ? 'working' : 'idle' };
    case 'turn.ended': {
      if (event.isEchoReceipt) return d;
      const failed = event.isError && event.terminalReason !== 'aborted_streaming';
      return withCost({ ...d, phase: failed ? 'failed' : 'idle', lastTurnEndedAt: event.at, activity: null }, event.costUsd);
    }
    case 'context.sample':
      return {
        ...d,
        context: {
          percent: event.percentage,
          totalTokens: Math.round(event.totalTokens),
          maxTokens: Math.round(event.maxTokens),
          autoCompactThreshold: event.autoCompactThreshold === null ? null : Math.round(event.autoCompactThreshold),
        },
      };
    case 'usage.sample':
      return withCost(d, event.costUsd);
    case 'subagent.started':
      return { ...d, childAgents: { ...d.childAgents, active: d.childAgents.active + 1 } };
    case 'subagent.finished':
      return { ...d, childAgents: { active: Math.max(0, d.childAgents.active - 1), done: d.childAgents.done + 1 } };
    case 'process.exited':
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
// last SEEN_WINDOW ids. `seen` is the caller's per-session window, mutated here; insertion order is age order.
export function foldEvents(prev: SessionDigest, seen: Set<string>, events: SessionEvent[]): SessionDigest {
  let digest = prev;
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (seen.size > SEEN_WINDOW) seen.delete(seen.values().next().value as string);
    digest = foldDigest(digest, event);
  }
  return digest;
}

// C3's process table onto the digest's phase: a launching process is `starting`, an exited one `exited` unless the
// digest already says `failed`; a process that became ready while the digest still says `starting` takes the engine
// state's phase (the events that would otherwise say so may have preceded the fold).
export function applyStatusToDigest(d: SessionDigest, status: EngineSessionStatus): SessionDigest {
  switch (status.process) {
    case 'starting':
    case 'initializing':
      return { ...d, phase: 'starting' };
    case 'exited':
      return d.phase === 'failed' ? d : { ...d, phase: 'exited', activity: null };
    case 'ready':
      if (d.phase !== 'starting') return d;
      return { ...d, phase: status.engineState === 'running' ? 'working' : status.engineState === 'requires_action' ? 'waiting' : 'idle' };
    default:
      return d;
  }
}
