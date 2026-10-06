// The `#panel` harness's agent-tool surface, `window.__maws_harness.agents` (C8b execution document, Interfaces
// *Harness API*). Types only, so the e2e project can import them. Every read is of what the panel renders (the DOM of
// the selected tool), so a case asserts what the owner would see; the calls go through the same controls a click does.
// Beyond the document's list: `graph` and `stopSettleMs` (the store's cursor and settle window, read in the page),
// `patchStatus` (the e2e cannot build a whole status), `reset` (a graph that has seen the
// page's seeded status starts over for a disk-only case), `releaseThrough` (a recorded journal's
// release counts measured from the fixture rather than guessed), `agentTab` and `childTranscript` (the
// stand-in for C5's agent tab in the shared-attachment case) and fields the views carry besides the document's
// (`line`, `meta`, `heading`, `noFile`, `end`).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SubagentEntry, WorkflowRun, FsReadSpillInput } from '@shared/ipc/schema/fs';
import type { PersistedTask } from '@shared/wire/store';

export type AgentsFakeId = 'A' | 'B';

export interface AgentsHarnessCalls {
  steer: { appSessionId: string; content: string; priority: string }[];
  stopTask: { appSessionId: string; taskId: string }[];
  readSpill: FsReadSpillInput[];
}

// One rendered agent row: `status` is the node's (the graph's word for it), `line` the row's second line as shown.
export interface AgentRowView {
  agentId: string;
  title: string;
  depth: number;
  orphan: boolean;
  status: string;
  elapsed: string;
  waiting: boolean;
  line: string;
}

export interface SubagentsView {
  agents: AgentRowView[]; // E7: the tree's Agents section (its agent rows; `tree()` reads its folds and team rows too)
  done: AgentRowView[]; // the rows shown: none while Done is collapsed, its default (E7)
  disk: AgentRowView[];
  headings: string[]; // the sections' headings as shown (`Agents · 2 running`, `Done · 1`)
  notes: string[]; // the lines above the sections (the disk-only header line, an unavailable read)
  drillIn: {
    agentId: string;
    header: string; // the agent's title
    meta: string; // `<model> · <elapsed> · <tokens>`
    dispatchedBy: string;
    rows: number; // the child transcript's rows as the store derives them
    requestCards: number; // C7's inline request cards rendered in the child transcript
    relay: { label: string; disabled: string | null; tooltip: string | null; pending: string | null };
  } | null;
}

export interface BackgroundView {
  // E7: a card is compact (its per-phase tables live in the widget); `summary` is its one line under the run's line
  workflows: { taskId: string; title: string; line: string; status: string; summary: string; stopping: boolean; error: string | null }[];
  shells: { taskId: string; line: string; output: 'enabled' | 'disabled'; stopping: boolean; error: string | null }[];
  monitors: { taskId: string; line: string }[];
  tasks: { heading: string; label: string | null; rows: string[]; earlier: number; unavailable: string | null };
  notes: string[]; // the disk-only sentence, `Nothing running`, an unavailable read
  headings: string[];
}

// E7 start: the Subagents tree as shown (E7 execution document, Interfaces *Harness and e2e*): the Agents and Done
// sections' rows in order. An agent row by its id; a running parent's `Done · N` fold by that parent's id, with its
// count and whether it is open; the team header, and a roster teammate (no agent of its own) by its name in `title`.
export interface TreeRowView {
  section: 'agents' | 'done';
  kind: 'agent' | 'done-fold' | 'team' | 'roster';
  agentId: string | null;
  title: string;
  depth: number;
  count: number | null;
  expanded: boolean | null;
  orphan: boolean;
}

// the workflow widget as shown (E7 execution document, Interfaces *Harness and e2e*): the run's header, its
// phase options (`All phases` first, its count and state empty) and the selected phase's agent rows.
export interface RunWidgetView {
  taskId: string;
  header: string;
  line: string;
  status: string;
  phases: { title: string; count: string; state: string; selected: boolean }[];
  agents: { label: string; model: string; state: string; time: string; tokens: string; openable: boolean }[];
  note: string | null; // `Phases arrive with the first progress frame`, `Run not found yet`
  stopping: boolean;
  error: string | null;
}

// M7: the Tasks panel as shown (read-only, P-20): its rows in order, the completed fold's rows only once opened.
export interface TasksView {
  progress: string | null; // `<c> of <t> completed`
  label: string | null; // `session list` for a session that is not live here
  rows: { id: string; subject: string; status: string; selected: boolean }[];
  completedToggle: string | null; // the completed fold's button (`N earlier tasks completed`)
  note: string | null; // the line shown in place of a list (unavailable, no session)
}

// M7: Background work's Scheduled rows as shown, in order (durable first).
export interface ScheduledRowView {
  id: string;
  store: string; // `durable-this` | `durable-other` | `session`
  schedule: string; // the schedule in words, or the cron
  kind: string; // `recurring · session-only`, `one-shot · durable · this session`
  prompt: string;
  when: string; // `Next ≈ <time> (<relative>)` with any expiry and last run, or `Resumes with the session`
  dormant: boolean; // greyed: a session-only job of a session not running here
  link: boolean; // `Open creating turn` offered
}
export interface ScheduledView {
  heading: string | null; // `Scheduled · N`, null when the section is not shown
  rows: ScheduledRowView[];
  error: string | null; // `Scheduled jobs unavailable: <message>`
}

// M7: the column transcript's messages between sessions and its `ListAgents` listings, as shown (rows inside a folded
// turn are not shown, so a row's presence before and after `expandAll` tells its persistence).
export type PeerRowView =
  | { kind: 'message'; direction: 'inbound' | 'outbound'; who: string; address: string | null; preview: string; result: string | null; resultText: string | null; reply: boolean; line: string | null }
  | { kind: 'listing'; self: string; sections: { heading: string; rows: { name: string; ref: string | null; extras: string }[] }[]; notes: string[] };
// E7 end

export interface LogView {
  title: string; // the tab's title as the strip shows it (`Log · <basename>`)
  heading: string | null; // the header's title (the row's description or the cell's label)
  path: string | null;
  size: string | null;
  pages: number;
  offsets: number[]; // the rendered pages' read offsets
  text: string;
  end: boolean; // `End of file` shown
  noFile: string | null; // the "no file reported" (or "not restored") note
  refused: string | null;
}

export interface AgentsHarnessApi {
  // Binds the fake client's wire half to the transcript `panel.loadTranscript(id, fixture)` loaded (call it right after,
  // with the same fixture; the e2e's `load` helper does both), sets the session's status launch to the replayed ids'
  // `journal` (and its background list empty: the fixture's frames are the facts), starts the task graph over, and
  // watches the session. The block's column shows the fed transcript from then on.
  feed(id: AgentsFakeId, fixture: string): Promise<void>;
  reset(id: AgentsFakeId): void; // the session's task graph started over (as `feed` does first), the status's background list emptied
  // E7: `files` the session's project files by path, `refusals` a `files.read` refusal's message by path (M7)
  fakeFs(data: { sidecars?: SubagentEntry[]; runs?: WorkflowRun[]; tasks?: Record<string, PersistedTask[]>; spills?: Record<string, string>; files?: Record<string, string>; refusals?: Record<string, string> }): void;
  fixtureFs(name: 'subagent-sidecars' | 'workflow-disk' | 'nested-agents-sidecars'): Promise<void>;
  patchStatus(id: AgentsFakeId, patch: Partial<EngineSessionStatus>): void; // the current status (or A's live one) with the patch
  releaseThrough(id: AgentsFakeId, seq: number): Promise<number>; // the fed fixture's unreleased events through `seq`, as panel.transcript(id).release(n) would; resolves with n
  calls(): AgentsHarnessCalls;
  answerStop(taskId: string, outcome: 'ok' | 'error'): void; // 'error' rejects with FAKE_STOP_REFUSAL's message

  subagents(): SubagentsView | null; // the selected tab's Subagents body, else null
  tree(): TreeRowView[] | null; // E7: the selected Subagents tab's tree rows, else null
  background(): BackgroundView | null;
  widget(): RunWidgetView | null; // E7: the selected Background work tab's run widget, else null
  log(): LogView | null;
  // E7 start (M7)
  tasks(): TasksView | null; // the selected Tasks tab, else null
  scheduled(): ScheduledView | null; // the selected Background work tab's Scheduled section, else null
  peerRows(): Promise<PeerRowView[]>; // the column's rows, read from its top down (the list scrolled to mount each)
  columnTexts(): Promise<string[]>; // every row of the column as text, read from its top down
  scrollColumnTo(text: string): Promise<void>; // the column's first row whose text holds `text`, at the list's top
  pushTasks(listId: string, tasks: PersistedTask[]): void; // the list's new contents, announced as `fs.tasksChanged`
  setClock(iso: string | null): void; // the agent tools' clock fixed at `iso` (null: the wall clock again)
  clearStatus(id: AgentsFakeId): void; // a disk-only session: no status, its task graph started over on disk
  selectPhase(n: number): void; // the widget's n-th phase option (0 is `All phases`)
  toggleFold(parentId: string): void; // the Subagents tree's `Done · N` fold under that parent
  reply(n: number, text: string): Promise<void>; // the n-th (1-based) Reply of the column: opened, typed, sent; resolves once the steer is answered
  openCreatingTurn(id: string): void; // the Scheduled row's `Open creating turn`
  setColumnWidth(px: number): number; // the debug strip (C5's sidebar column, clamped as C5 clamps it) holding the column; answers the width it had
  // E7 end

  clickRow(agentId: string): void;
  back(): void;
  typeRelay(text: string): void;
  sendRelay(): Promise<void>; // resolves once the steer is answered (or the send refused)
  stop(taskId: string): Promise<void>; // a Background row's Stop, or the drill-in's `Stop agent` confirmed; resolves once answered
  output(taskId: string): void;
  loadMore(): Promise<void>;
  showEarlier(): Promise<void>;

  graph(id: AgentsFakeId): { phase: string; launchId: string | null; lastSeq: number | null } | null; // the task-graph store's cursor for the session
  stopSettleMs(): number; // the store's STOP_SETTLE_MS (the e2e cannot import the renderer's store)
  instances(toolId: string): string[]; // the tab ids of the tool's live instances, in creation order (O2)
  clickTranscriptSubagent(n: number): Promise<void>; // the n-th (1-based) agent control of the column's transcript, its turns expanded
  clickTranscriptFullLog(n: number): Promise<void>; // the n-th "Open full log" of the column's transcript, its cells expanded
  agentTab(agentId: string | null): void; // a second child transcript in the column over the same childSource (C5's agent tab)
  childTranscript(agentId: string): { keys: string[]; sources: number; attaches: number; rows: number; drillInRows: number | null; agentTabRows: number | null };
}

// The message a stop answered 'error' rejects with (the card reads `Couldn't stop it: <message>`).
export const FAKE_STOP_REFUSAL = 'the harness refused this stop';
