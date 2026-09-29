// The derived agent fixtures (C8b execution document, Interfaces *Harness API*; M4): recorded journals through C3's
// normaliser with recorded pass-3 sequences appended, re-keyed to the journal's own ids, so every frame the `#panel`
// harness's agent cases react to is in a fixture file the player releases (C6's replay source has no push). Generated,
// not hand-written, as C8a's `events/panel-child` is:
//   events/agents-relay          pass 1's `subagent` up to and including the first child's last own event (its finish and
//                                the parent's later events withheld, so both background agents run), then R1's first
//                                SendMessage (its assistant row) re-keyed to the first child, its tool.result, and R1's
//                                foreground `subagent.started` re-keyed to a second agent. No receipt (O3, ruled
//                                2026-09-29: 2.1.283 forwards none to a live child's host surfaces).
//   events/agents-stop-workflow  pass 2's `workflow` through its last progress frame, then `stop-task`'s workflow stop.
//   events/agents-stop-shell     pass 2's `per-task-stop-on` through the Bash result naming the shell's output file
//                                (seq 44), then `stop-task`'s shell stop.
// Appended events continue the journal's clock at 300 ms steps and its seq, one seq per recorded row, with ids
// `<fixture>:journal:<seq>:<n>`: the `journal` launch segment is the one the replayed ids carry and `feed` sets on the
// fed status, so the task-graph store's launch check keeps them. A recorded stop is re-keyed to the task it stops: its
// id, tool use and summary (the engine's summary for a stop is the task's description), its end time on the continued
// clock and its output file the one the engine reported for that task in the journal it joins.
import { join } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId } from '@shared/graph/ids';
import { journalToEvents } from '../../src/renderer/src/transcript/dev/journal';
import { AGENTS_RELAY_TAIL } from './agents-fixtures-tail';
import { loadJournal, TEST_FIXTURE_DIR, type FixturePass } from './fixtures';
import { firstChildOf } from './panel-child-fixture';

export { AGENTS_RELAY_TAIL, AGENTS_STOP_SHELL_TAIL, AGENTS_STOP_WORKFLOW_TAIL } from './agents-fixtures-tail';

const EVENTS_DIR = join(TEST_FIXTURE_DIR, 'transcript/events');
export const AGENTS_FIXTURE_FILES = {
  relay: join(EVENTS_DIR, 'agents-relay.events.jsonl'),
  stopWorkflow: join(EVENTS_DIR, 'agents-stop-workflow.events.jsonl'),
  stopShell: join(EVENTS_DIR, 'agents-stop-shell.events.jsonl'),
} as const;

const STEP_MS = 300;
const LAUNCH = 'journal';
const FOREGROUND_TOOL_USE = 'toolu_agents_relay_foreground';

const replayed = (pass: FixturePass, name: string) => journalToEvents(loadJournal(pass, name));
const rowOf = (events: SessionEvent[], seq: number) => events.filter((event) => event.seq === seq);

// Re-keys a recorded frame by replacing every occurrence of each id string in it (ids are unique opaque strings).
function rekey<T>(value: T, ids: Record<string, string>): T {
  let text = JSON.stringify(value);
  for (const [from, to] of Object.entries(ids)) text = text.split(from).join(to);
  return JSON.parse(text) as T;
}

// Appends recorded rows to a history: one seq per row, the clock continued at STEP_MS, ids in the fixture's name.
function appendRows(name: string, history: SessionEvent[], rows: SessionEvent[][]): SessionEvent[] {
  const last = history.at(-1)!;
  let seq = Math.max(...history.map((event) => event.seq ?? 0)) + 1;
  let clock = Date.parse(last.at);
  const tail: SessionEvent[] = [];
  for (const row of rows) {
    clock += STEP_MS;
    const at = new Date(clock).toISOString();
    row.forEach((event, n) => tail.push({ ...event, id: `${name}:${LAUNCH}:${seq}:${n}` as EventId, sessionId: last.sessionId, at, seq }));
    seq += 1;
  }
  return [...history, ...tail];
}

const isTaskStart = (type: string, background: boolean) => (event: SessionEvent) => event.kind === 'task.started' && event.taskType === type && event.isBackground === background;

// R6's recorded stop of one task (`stop-task.jsonl`): the snapshot just before its `task.updated killed`, that update,
// and its `task.notification stopped`, in the recorded order.
function recordedStop(type: 'local_workflow' | 'local_bash', background: boolean): { taskId: string; toolUseId: string; frames: SessionEvent[] } {
  const events = replayed('pass3', 'stop-task');
  const started = events.find(isTaskStart(type, background));
  if (started?.kind !== 'task.started' || started.toolUseId === null) throw new Error(`agents fixtures: stop-task records no ${type} start`);
  const updated = events.findIndex((event) => event.kind === 'task.updated' && event.taskId === started.taskId && event.patch.status === 'killed');
  const notification = events.findIndex((event) => event.kind === 'task.notification' && event.taskId === started.taskId);
  const snapshot = events.slice(0, updated).findLastIndex((event) => event.kind === 'tasks.snapshot');
  if (snapshot < 0 || notification < updated) throw new Error(`agents fixtures: stop-task's ${type} stop is not snapshot, updated, notification`);
  return { taskId: started.taskId, toolUseId: started.toolUseId, frames: [events[snapshot], events[updated], events[notification]] };
}

// The recorded stop re-keyed onto a task of the history, appended one frame per row.
function appendStop(name: string, history: SessionEvent[], stop: ReturnType<typeof recordedStop>, target: { taskId: string; toolUseId: string; description: string; outputFile: string }): SessionEvent[] {
  const frames = stop.frames.map((frame) => rekey(frame, { [stop.taskId]: target.taskId, [stop.toolUseId]: target.toolUseId }));
  const events = appendRows(name, history, frames.map((frame) => [frame]));
  return events.map((event, i) => {
    if (i < history.length) return event;
    if (event.kind === 'task.updated') return { ...event, patch: { ...event.patch, endTime: Date.parse(event.at) } };
    if (event.kind === 'task.notification') return { ...event, summary: target.description, outputFile: target.outputFile };
    return event;
  });
}

function notificationOf(events: SessionEvent[], taskId: string): Extract<SessionEvent, { kind: 'task.notification' }> {
  const found = events.find((event) => event.kind === 'task.notification' && event.taskId === taskId);
  if (found?.kind !== 'task.notification' || found.outputFile === null) throw new Error(`agents fixtures: no reported output file for ${taskId}`);
  return found;
}

export function deriveAgentsRelayFixture(): SessionEvent[] {
  const source = replayed('pass1', 'subagent');
  const child = firstChildOf(source);
  const lastOwn = source.findLastIndex((event) => (event.parentToolUseId as string | null) === (child.toolUseId as string));
  const history = source.slice(0, lastOwn + 1);

  const r1 = replayed('pass3', 'relay-to-child');
  const background = r1.find((event) => event.kind === 'subagent.started' && event.isBackground);
  const send = r1.find((event) => event.kind === 'tool.use' && event.agentId === null && event.toolName === 'SendMessage' && (event.input as { to?: unknown }).to === (background?.kind === 'subagent.started' ? background.taskId : null));
  const foreground = r1.find((event) => event.kind === 'subagent.started' && !event.isBackground);
  if (send?.kind !== 'tool.use' || send.seq === null || foreground?.kind !== 'subagent.started' || background?.kind !== 'subagent.started' || foreground.toolUseId === null) {
    throw new Error('agents fixtures: relay-to-child records no background SendMessage or foreground start');
  }
  const result = r1.find((event) => event.kind === 'tool.result' && event.toolUseId === send.toolUseId)!;
  // The assistant row that issued the SendMessage (its tool_use block and tool.use), as the parent's one round; its
  // `userMessageUuids` named R1's steer, which is not in this journal.
  const sendRow = rowOf(r1, send.seq).map((event) => (event.kind === 'assistant.block.complete' ? { ...event, userMessageUuids: [] } : event));
  const toChild = { [background.taskId]: AGENTS_RELAY_TAIL.agentId };
  const toForeground = { [foreground.taskId]: AGENTS_RELAY_TAIL.foregroundAgentId, [foreground.toolUseId]: FOREGROUND_TOOL_USE };
  return appendRows('agents-relay', history, [rekey(sendRow, toChild), [rekey(result, toChild)], [rekey(foreground, toForeground)]]);
}

export function deriveAgentsStopWorkflowFixture(): SessionEvent[] {
  const source = replayed('pass2', 'workflow');
  const started = source.find(isTaskStart('local_workflow', false));
  if (started?.kind !== 'task.started' || started.toolUseId === null) throw new Error('agents fixtures: pass2/workflow starts no workflow');
  const lastFrame = source.findLast((event) => event.kind === 'workflow.progress' && event.taskId === started.taskId)!;
  const history = source.filter((event) => event.seq !== null && event.seq <= lastFrame.seq!);
  const target = { taskId: started.taskId, toolUseId: started.toolUseId, description: started.description, outputFile: notificationOf(source, started.taskId).outputFile! };
  return appendStop('agents-stop-workflow', history, recordedStop('local_workflow', false), target);
}

export function deriveAgentsStopShellFixture(): SessionEvent[] {
  const source = replayed('pass2', 'per-task-stop-on');
  const started = source.find(isTaskStart('local_bash', true));
  if (started?.kind !== 'task.started' || started.toolUseId === null) throw new Error('agents fixtures: per-task-stop-on starts no background shell');
  // Through the Bash result that reports the output file (the shell is running with `Output` enabled).
  const reported = source.find((event) => event.kind === 'tool.result' && event.toolUseId === started.toolUseId)!;
  const history = source.filter((event) => event.seq !== null && event.seq <= reported.seq!);
  const target = { taskId: started.taskId, toolUseId: started.toolUseId, description: started.description, outputFile: notificationOf(source, started.taskId).outputFile! };
  return appendStop('agents-stop-shell', history, recordedStop('local_bash', true), target);
}

export const serializeAgentsFixture = (events: SessionEvent[]): string => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

const firstAppended = (events: SessionEvent[], name: string) => events.find((event) => event.id.startsWith(`${name}:`))!.seq!;
const tailLength = (events: SessionEvent[], first: number) => events.filter((event) => event.seq! >= first).length;

// The tails' boundaries, measured: the counts that end each batch on the frame it is named for.
export function measureAgentsRelay(events: SessionEvent[]) {
  const first = firstAppended(events, 'agents-relay');
  const tail = events.filter((event) => event.seq! >= first);
  const send = tail.findIndex((event) => event.kind === 'tool.use' && event.toolName === 'SendMessage');
  const foreground = tail.findIndex((event) => event.kind === 'subagent.started');
  const sent = tail[send];
  if (sent?.kind !== 'tool.use' || foreground !== tail.length - 1) throw new Error('agents-relay: the tail does not end on the foreground start');
  return {
    first,
    batches: [send + 1, foreground - send],
    agentId: (sent.input as { to: string }).to,
    text: (sent.input as { message: string }).message,
    foregroundAgentId: (tail[foreground] as Extract<SessionEvent, { kind: 'subagent.started' }>).taskId as string,
  };
}

export function measureAgentsStopWorkflow(events: SessionEvent[]) {
  const first = firstAppended(events, 'agents-stop-workflow');
  const stopped = events.find((event) => event.seq! >= first && event.kind === 'task.updated');
  const taskId = stopped?.kind === 'task.updated' ? (stopped.taskId as string) : '';
  const frames = events.filter((event) => event.kind === 'workflow.progress' && (event.taskId as string) === taskId);
  const releaseTo = frames[0].seq!;
  // Events released to reach each progress frame's row, in turn.
  const reach = frames.map((frame) => events.filter((event) => event.seq! >= releaseTo && event.seq! <= frame.seq!).length);
  return {
    first,
    batches: Array.from({ length: tailLength(events, first) }, () => 1),
    taskId,
    progress: { releaseTo, frames: reach.map((n, i) => n - (i === 0 ? 0 : reach[i - 1])) },
  };
}

export function measureAgentsStopShell(events: SessionEvent[]) {
  const first = firstAppended(events, 'agents-stop-shell');
  const notification = events.findLast((event) => event.kind === 'task.notification');
  if (notification?.kind !== 'task.notification') throw new Error('agents-stop-shell: no notification');
  return { first, batches: Array.from({ length: tailLength(events, first) }, () => 1), taskId: notification.taskId as string, outputFile: notification.outputFile };
}
