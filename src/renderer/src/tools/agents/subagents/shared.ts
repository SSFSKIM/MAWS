// What the Subagents lists, the drill-in and the summary share: the one-second ticker, a node's glyph ref (C6's
// `SubagentGlyph` takes a `SubagentRef`, and the mark follows the task id, so a row, the transcript and the summary
// agree), a finished agent's outcome line, and the agent a tool-use id started.
import { useEffect, useState } from 'react';
import type { AgentId, TaskId, ToolUseId } from '@shared/graph/ids';
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

// A Done row's outcome: the terminal status with how long ago it ended, the bare word when no end time is known.
export function outcomeOf(node: TaskNode, now: number): string {
  if (node.status === 'exited') return SUBAGENTS_COPY.endedWithSession;
  const ago = node.endedAt === null ? null : formatAgo(now - Date.parse(node.endedAt));
  if (node.status === 'failed') return ago ? SUBAGENTS_COPY.finishedWithErrors(ago) : SUBAGENTS_COPY.finishedWithErrorsUndated;
  if (node.status === 'stopped') return ago ? SUBAGENTS_COPY.stopped(ago) : SUBAGENTS_COPY.stoppedUndated;
  return ago ? SUBAGENTS_COPY.finished(ago) : SUBAGENTS_COPY.finishedUndated;
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
