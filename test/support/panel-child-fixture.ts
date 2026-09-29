// The derived child fixture `events/panel-child` (C8a execution document, M4; R7): the `#panel` harness mounts C6's
// child transcript over this fixture's first child and grows it inside the panel region at each width. Generated, not
// hand-written: pass 1's `subagent` journal through C3's normaliser up to and including the first child's last own
// event (its finish and the parent's later events withheld, so the child's turn stays open), then a tail appended to
// that child: sixty units, each a Read call with its result followed by a completed text block (C6 merges adjacent
// Reads into one row, and a text block between two calls flushes the open group, so each unit is two top-level rows),
// then a Bash call with a permission request nobody answers, so the child's request slot is pending.
//
// `PANEL_CHILD_TAIL` is what the e2e reads (never a guessed count): `first`, the seq of the tail's first event (C6's
// `seek` releases the events strictly below it); `batches`, three release counts covering the tail in order, the third
// running through the Bash call and its request; `rows`, the child's top-level row count after each batch, as C6's
// `createState`, `applyEvents` and `rowsOf` derive it. The suite `panel-child fixture is reproducible` regenerates the
// committed file and measures these numbers again.
import { join } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, RequestId, ToolUseId } from '@shared/graph/ids';
import { journalToEvents } from '../../src/renderer/src/transcript/dev/journal';
import { rowsOf } from '../../src/renderer/src/transcript/model/derive';
import { applyEvents, createState } from '../../src/renderer/src/transcript/model/reduce';
import type { Row } from '../../src/renderer/src/transcript/model/rows';
import { loadJournal, TEST_FIXTURE_DIR } from './fixtures';

export const PANEL_CHILD_FILE = join(TEST_FIXTURE_DIR, 'transcript/events/panel-child.events.jsonl');
export const PANEL_CHILD_UNITS = 60;
const UNITS_PER_BATCH = 20;
const STEP_MS = 300;
const EVENTS_PER_UNIT = 4; // the Read's tool_use block and tool.use, its tool.result, the text block

// Recorded in a module of its own, so the e2e imports the numbers without the generator's imports; the generator's test
// (`panel-child fixture is reproducible`) measures them again.
export { PANEL_CHILD_TAIL } from './panel-child-tail';

// Paths of this repository the child reads, in turn; a fixed list, so the fixture never changes with the tree.
const PATHS = [
  'docs/charter.md',
  'docs/doperpowers/plans/2026-09-28-c8-right-panel.md',
  'docs/doperpowers/plans/2026-09-28-c8a-panel-host.md',
  'docs/doperpowers/plans/2026-09-28-c8-decomposing-grounding.md',
  'src/renderer/src/panel/host.ts',
  'src/renderer/src/panel/tool.ts',
  'src/renderer/src/panel/PanelHost.tsx',
  'src/renderer/src/panel/TabStrip.tsx',
  'src/renderer/src/panel/ToolBody.tsx',
  'src/renderer/src/panel/copy.ts',
  'src/renderer/src/panel/arrives-with.ts',
  'src/renderer/src/panel/summary/Summary.tsx',
];

// The first child agent of pass 1's `subagent` journal, as the parent's tool use and the agent's id.
export interface PanelChild {
  toolUseId: ToolUseId;
  agentId: AgentId;
}

export function firstChildOf(events: SessionEvent[]): PanelChild {
  const started = events.find((event) => event.kind === 'subagent.started');
  if (started?.kind !== 'subagent.started' || started.toolUseId === null) throw new Error('panel-child: pass1/subagent starts no child');
  return { toolUseId: started.toolUseId, agentId: started.taskId as string as AgentId };
}

const ofChild = (child: PanelChild) => (event: SessionEvent) => event.parentToolUseId !== null && (event.parentToolUseId as string) === (child.toolUseId as string);

export function derivePanelChildFixture(): SessionEvent[] {
  const source = journalToEvents(loadJournal('pass1', 'subagent'));
  const child = firstChildOf(source);
  const last = source.findLastIndex(ofChild(child));
  const history = source.slice(0, last + 1);
  const lastOwn = history[last];

  let seq = Math.max(...history.map((event) => event.seq ?? 0)) + 1;
  let clock = Date.parse(lastOwn.at);
  let n = 0;
  const base = () => {
    clock += STEP_MS;
    n += 1;
    return {
      id: `panel-child:${n}` as EventId,
      sessionId: lastOwn.sessionId,
      at: new Date(clock).toISOString(),
      seq: seq++,
      agentId: child.agentId,
      parentToolUseId: child.toolUseId as string as ParentToolUseId,
    };
  };
  const model = lastOwn.kind === 'assistant.block.complete' ? lastOwn.model : 'claude-haiku-4-5-20251001';
  const toolCall = (unit: string, name: string, input: Record<string, unknown>): SessionEvent[] => {
    const toolUseId = `toolu_panel_child_${unit}` as ToolUseId;
    const apiMessageId = `msg_panel_child_${unit}_call` as ApiMessageId;
    const messageUuid = `panel-child-${unit}-call` as MessageUuid;
    return [
      { ...base(), kind: 'assistant.block.complete', messageUuid, apiMessageId, blockIndex: 0, block: { type: 'tool_use', id: toolUseId, name, input, caller: { type: 'direct' } }, model, supersedes: null, aborted: false, userMessageUuids: [] },
      { ...base(), kind: 'tool.use', toolUseId, toolName: name, input, apiMessageId, messageUuid },
    ];
  };

  const tail: SessionEvent[] = [];
  for (let i = 0; i < PANEL_CHILD_UNITS; i += 1) {
    const unit = String(i + 1).padStart(2, '0');
    const path = PATHS[i % PATHS.length];
    tail.push(...toolCall(unit, 'Read', { file_path: path }));
    tail.push({
      ...base(), kind: 'tool.result', toolUseId: `toolu_panel_child_${unit}` as ToolUseId, content: `1\t// ${path}\n`, isError: false, structured: null,
      spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: `panel-child-${unit}-result` as MessageUuid,
    });
    tail.push({
      ...base(), kind: 'assistant.block.complete', messageUuid: `panel-child-${unit}-text` as MessageUuid, apiMessageId: `msg_panel_child_${unit}_text` as ApiMessageId,
      blockIndex: 0, block: { type: 'text', text: `Read ${path}; its first line names the file.` }, model, supersedes: null, aborted: false, userMessageUuids: [],
    });
  }
  const bash = toolCall('bash', 'Bash', { command: 'pnpm test', description: 'Run the unit tests' });
  tail.push(...bash);
  tail.push({
    ...base(), kind: 'permission.requested', requestId: 'panel-child-permission' as RequestId, toolUseId: 'toolu_panel_child_bash' as ToolUseId, toolName: 'Bash',
    displayName: null, input: { command: 'pnpm test', description: 'Run the unit tests' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
  });
  return [...history, ...tail];
}

export const serializePanelChild = (events: SessionEvent[]): string => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

// The tail's boundaries and the child's top-level rows after each batch, measured as the child transcript derives them:
// its own events applied to a child state (C6's `createState` with the agent's id), as `HarnessSession.childSource`
// delivers them.
export function measurePanelChild(events: SessionEvent[]): { first: number; batches: number[]; rows: number[]; before: number; pendingRequests: number } {
  const child = firstChildOf(events);
  const firstIndex = events.findIndex((event) => typeof event.id === 'string' && event.id.startsWith('panel-child:'));
  const first = events[firstIndex].seq!;
  const tail = events.length - firstIndex;
  const batches = [UNITS_PER_BATCH * EVENTS_PER_UNIT, UNITS_PER_BATCH * EVENTS_PER_UNIT];
  batches.push(tail - batches[0] - batches[1]);

  const own = ofChild(child);
  let state = applyEvents(createState(null, child.agentId), events.slice(0, firstIndex).filter(own));
  const before = rowsOf(state).length;
  const rows: number[] = [];
  let at = firstIndex;
  let last: Row[] = [];
  for (const count of batches) {
    state = applyEvents(state, events.slice(at, at + count).filter(own));
    at += count;
    last = rowsOf(state);
    rows.push(last.length);
  }
  return { first, batches, rows, before, pendingRequests: last.filter((row) => row.kind === 'request_slot').length };
}
