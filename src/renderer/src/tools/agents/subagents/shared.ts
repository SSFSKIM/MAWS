// What the Subagents lists, the drill-in and the summary share: the one-second ticker, a node's glyph ref (C6's
// `SubagentGlyph` takes a `SubagentRef`, and the mark follows the task id, so a row, the transcript and the summary
// agree), a finished agent's outcome line, and the agent a tool-use id started.
import { useEffect, useState } from 'react';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, TaskId, ToolUseId } from '@shared/graph/ids';
import { calmWaiting, type WaitingTone } from '../../../attention/derive';
import { glyphFor, type SubagentRef } from '../../../transcript';
import { SUBAGENTS_COPY } from '../copy';
import { formatAgo } from '../model/elapsed';
import { rowTitle, type TaskNode } from '../model/task-graph';
import type { TaskGraphEntry } from '../store';

// The wall clock, advanced every `periodMs` while `active`, with no timer otherwise. A live elapsed ticks once a second
// (mockup 03 shows seconds); a finished agent's `<ago>` needs only the slow tick C5's `useNow` keeps (30 s), gated here
// by the tool's visibility, which `useNow` cannot be. The clock is read again whenever the ticker (re)activates, so a
// list shown again does not read a stale time for a whole period.
export const SLOW_TICK_MS = 30_000;

// An agent waiting on requests of its own, as its row reads it in the Subagents panel and on the summary's card
// (Interfaces §C.6): `Approval needed` in the warning tone; an agent whose waiting items are all sheet questions reads
// as an async_input item, its heading's words in the calm tone (L5; the composite's writer, 2026-11-27). Keyed by agent
// id and by task id, either of which a request may name.
export interface AgentWait {
  word: string;
  tone: WaitingTone;
}
export function agentWaitsOf(pending: readonly AttentionItem[]): ReadonlyMap<string, AgentWait> {
  const byAgent = new Map<string, AttentionItem[]>();
  for (const item of pending) for (const id of new Set([item.request.agentId, item.request.taskId])) if (id !== null) byAgent.set(id, [...(byAgent.get(id) ?? []), item]);
  const calm: AgentWait = { word: ATTENTION_HEADINGS.async_input.text, tone: 'calm' };
  const warning: AgentWait = { word: SUBAGENTS_COPY.approvalNeeded, tone: 'warning' };
  return new Map([...byAgent].map(([id, items]) => [id, calmWaiting(items) ? calm : warning]));
}

// P5 O9: how long a terminal session's stop whose outcome is unknown (a subagent's or a background task's) reads
// stopping… before Stop is offered again, if nothing has shown it stopped by then.
export const STOP_DOUBT_MS = 5000;

// E7 (M7): the clock every ticker reads, the wall clock unless the `#panel` harness fixed it (`setClock`), so a case
// reads the widget's elapsed and the Scheduled rows' next runs and expiries at a known now. Fixing or releasing it
// gives every mounted ticker the new time at once.
let fixedAt: number | null = null;
const clockListeners = new Set<() => void>();
export const wallClock = (): number => fixedAt ?? Date.now();
export function setAgentsClock(at: number | null): void {
  fixedAt = at;
  clockListeners.forEach((listener) => listener());
}

export function useTicker(active: boolean, periodMs = 1000): number {
  const [now, setNow] = useState(wallClock);
  useEffect(() => {
    const listener = () => setNow(wallClock());
    clockListeners.add(listener);
    return () => void clockListeners.delete(listener);
  }, []);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(wallClock());
    const first = setTimeout(tick, 0); // the clock as the ticker (re)activates, off the effect's own pass
    const timer = setInterval(tick, periodMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, periodMs]);
  return now;
}

export function refOf(node: TaskNode): SubagentRef {
  return {
    taskId: node.taskId, agentId: node.taskId as unknown as AgentId, toolUseId: node.toolUseId, name: rowTitle(node), glyph: glyphFor(node.taskId), kind: 'agent',
    subagentType: node.agent?.subagentType ?? null,
  };
}

// Card C1, the owner's answer (option 2): an agent that exited by the bridge's word or its starter's end, while its
// session still runs, ended with no record of how; one whose session's process went ended with the session. Neither has
// an end time of its own. The one rule the row's word and the drill-in's relay reason read (Decision Log 17 (a)).
export const endedUnrecorded = (node: TaskNode): boolean => node.status === 'exited' && (node.evidence === 'bridge' || node.evidence === 'parent');
const exitedWord = (node: TaskNode): string => (endedUnrecorded(node) ? SUBAGENTS_COPY.ended : SUBAGENTS_COPY.endedWithSession);

// A Done row's outcome: the terminal status with how long ago it ended, the bare word when no end time is known.
export function outcomeOf(node: TaskNode, now: number): string {
  if (node.status === 'exited') return exitedWord(node);
  const ago = node.endedAt === null ? null : formatAgo(now - Date.parse(node.endedAt));
  if (node.status === 'failed') return ago ? SUBAGENTS_COPY.finishedWithErrors(ago) : SUBAGENTS_COPY.finishedWithErrorsUndated;
  if (node.status === 'stopped') return ago ? SUBAGENTS_COPY.stopped(ago) : SUBAGENTS_COPY.stoppedUndated;
  return ago ? SUBAGENTS_COPY.finished(ago) : SUBAGENTS_COPY.finishedUndated;
}

// The outcome word alone, without a time (the UX wave's U8b, M7 decision 5: an agent whose own run has ended while a
// task it started still runs).
export function outcomeWord(node: TaskNode): string {
  if (node.status === 'exited') return exitedWord(node);
  if (node.status === 'failed') return SUBAGENTS_COPY.finishedWithErrorsUndated;
  if (node.status === 'stopped') return SUBAGENTS_COPY.stoppedUndated;
  return SUBAGENTS_COPY.finishedUndated;
}

// The agent a tool-use id started: the wire's `subagent.started` (the graph's `byToolUse`), else the sidecar that names
// the tool use (`fs.subagentsChanged` can land first). Null while neither has.
export function agentOfToolUse(entry: TaskGraphEntry | undefined, toolUseId: ToolUseId): AgentId | null {
  if (!entry) return null;
  const started = entry.graph.byToolUse.get(toolUseId);
  if (started !== undefined) return started as unknown as AgentId;
  const sidecar = entry.disk.agents?.find((a) => a.meta?.toolUseId === (toolUseId as string));
  return sidecar ? sidecar.agentId : null;
}

export const taskOf = (agentId: AgentId) => agentId as unknown as TaskId;
