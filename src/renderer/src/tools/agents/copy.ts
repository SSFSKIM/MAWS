// Every sentence the Subagents, Background tasks and Log tools and their two summary sections show (C8b execution
// document, Interfaces *Copy*; the exact strings are decisions; the UX wave's U8b document, Interfaces §F, for the two
// panels' headings and rows). `<session>` is the parent's record title and `<title>`
// an agent row's title (`name ?? description`); elapsed and token values come from `model/elapsed.ts`'s formatters.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The UX wave's U8b (M7): a panel's section heading, its label in the heading's weight and its detail (the count and
// the parts after it) muted; null detail draws the label alone.
export interface PanelHeading {
  label: string;
  detail: string | null;
}

export const SUBAGENTS_COPY = {
  title: 'Agents', // the word cut (T152, the owner's card 4 of 2026-11-20): the tab and the panel menu
  // lists
  done: (n: number) => `Done · ${n}`, // (E7) a running parent's fold over its finished children
  // The UX wave's U8b (M7; Interfaces §F) start: the sections' headings, `Running N` (N every running agent, at any
  // depth; no number when none runs), `Done N · F failed · S stopped`, `On disk N`
  running: (n: number): PanelHeading => ({ label: 'Running', detail: n > 0 ? String(n) : null }),
  doneHeading: (n: number, outcomes: { failed: number; stopped: number }): PanelHeading => ({
    label: 'Done',
    detail: [String(n), outcomes.failed > 0 && `${outcomes.failed} failed`, outcomes.stopped > 0 && `${outcomes.stopped} stopped`].filter(Boolean).join(' · '),
  }),
  earlier: (n: number): PanelHeading => ({ label: 'Earlier', detail: String(n) }), // the word cut (T158): was On disk
  // an agent whose own run has ended while tasks it started still run: after its outcome word (the word cut, T169)
  tasksRunning: (n: number) => ` · ${plural(n, 'task')} running`,
  // a row's disclosure: `(+N)` while closed and agents run under it; its accessible name
  under: (n: number) => `(+${n})`,
  underLabel: (n: number, title: string) => (n > 0 ? `${plural(n, 'agent')} running under ${title}` : `Agents under ${title}`),
  // The UX wave's U8b end
  showMore: (n: number) => `${n} more`, // the word cut (T174)
  working: 'Working', // a row's second line when it has neither a summary nor (under a real name) a description
  nested: '· nested',
  childOf: (parentTitle: string) => `Child of ${parentTitle}`,
  childOfUnlisted: 'Child of an agent this session does not list',
  approvalNeeded: 'Approval needed', // a waiting row's tooltip and description, its mark beside the glyph (the word cut, T166)
  // the word cut (T162, T163, T165): a finished agent's line is its age; the exceptions keep their word
  finished: (ago: string) => ago,
  finishedWithErrors: (ago: string) => `failed · ${ago}`,
  stopped: (ago: string) => `stopped · ${ago}`,
  endedWithSession: 'session ended',
  ended: 'ended', // card C1, the owner's answer: known to have ended, with no record of how, while the session still runs
  // the same outcomes with no end time known (a sidecar's `stoppedByUser` carries none)
  finishedUndated: 'finished',
  finishedWithErrorsUndated: 'failed',
  stoppedUndated: 'stopped',
  noSession: 'Open a session to see its subagents', // a pinned tab while no session is shown
  // The word cut (T167, T168, T183, P97): a missing value is a blank. The desk's web app's own tree and drill-in
  // (apps/desk-web/src/depth/view) read these, so they stay as empty words there.
  statusUnavailable: '',
  elapsedUnavailable: '',
  diskOnly: 'Status is known only while the session runs here',
  empty: 'No agents yet', // the word cut (N158): the tool is Agents (T152); the desk's tree reads it too
  readFailed: (message: string) => `Couldn't read agents: ${message}`, // the word cut (T160): was Sidecars unavailable
  // drill-in
  back: '‹ Agents', // the word cut (T152): the back link follows the tab
  // the values the drill-in's line has, a missing one leaving no words (the word cut, T183, P97)
  header: (model: string | null, elapsed: string | null, tokens: string | null) => [model, elapsed, tokens].filter(Boolean).join(' · '),
  modelUnknown: '',
  tokensUnavailable: '',
  stopAgent: 'Stop agent',
  stopConfirm: (title: string) => `Stop ${title}?`,
  stopConfirmYes: 'Stop',
  stopConfirmNo: 'Keep running',
  stopping: 'stopping…',
  stopFailed: (message: string) => `Couldn't stop it: ${message}`,
  stopUncertain: 'May not have stopped', // P5 O9: a terminal session's stop whose outcome is unknown
  waitingToStart: 'Waiting for the agent to start', // the quiet spinner's name (the word cut, T189)
  // E7 start: the topology tree (Design §3, §5)
  foldLabel: (n: number, parentTitle: string) => `Done · ${n} under ${parentTitle}`, // the fold's accessible name
  team: 'Team', // the word cut (T175)
  // the listing's own extras, then when it was listed; its `joined <age> ago` is an age at the listing's time, which would
  // read as current long after, so it is dropped (E11 W-D) and the listing's age dates the row (the word cut, T176)
  teammateListed: (extras: string[], ago: string) => [...extras.filter((extra) => !/^joined .* ago$/.test(extra)), ago].join(' · '),
  teammateNoTranscript: 'No transcript here', // the word cut (T177)
  // E7 end
} as const;

// The relay composer (Interfaces *The relay*): its label, its disabled reasons (shown as the placeholder) and the pending
// line through the three observables.
export const RELAY_COPY = {
  label: (session: string) => `Relay via ${session}`, // for screen readers only (the word cut, T190)
  placeholder: (title: string) => `Message ${title}…`, // a terminal-driven session's box
  placeholderVia: (title: string, session: string) => `Message ${title} via ${session}…`, // the word cut (T190): the label folded in
  send: 'Send', // the round arrow's hidden word and its tooltip (the word cut, T193)
  disabled: {
    notRunningHere: 'Relay needs the session running here',
    foreground: (session: string) => `${session} is waiting on this agent`, // the word cut (T195)
    foregroundTooltip: 'A message sent now would resume the finished agent instead of reaching this one',
    backgroundUnknown: (session: string) => `Not known whether ${session} is waiting on this agent`,
    finished: 'This agent has finished',
    stopped: 'This agent was stopped',
    exited: 'This agent ended with the session',
    ended: 'This agent ended', // card C1: its row reads ended (Decision Log 17 (a))
    diskOnly: 'Known only from disk',
    pending: 'Waiting for the last relay',
  },
  // the word cut (T199, T200, T201): what happened and how long it has waited, not how the engine forwards it
  asked: (session: string, elapsed: string) => `Asked ${session} to relay · ${elapsed}`,
  childEnded: (title: string) => `${title} finished before the message reached it`,
  forwarded: (title: string) => `Sent · ${title} reads it at its next step`,
  failed: (message: string) => `Relay failed: ${message}`,
  dropped: (state: 'cancelled' | 'discarded' | 'refused') => `the engine ${state} it before starting it`, // the failed state's message (O1)
  notSent: 'the session ended that turn without sending it', // E7: a peer relay whose steer's own turn ended with no matching SendMessage
  // P5 O9 M5: a terminal session driven through its bridge tells the agent directly (the bridge's `tell`)
  driven: {
    label: (title: string) => `Message ${title}`, // for screen readers only (the word cut, T191)
    told: 'Sent', // the word cut (T203)
    unknown: 'Sent; the terminal did not confirm it arrived',
    failed: (message: string) => `Not sent: ${message}`,
  },
} as const;

export const BACKGROUND_COPY = {
  title: 'Background', // the word cut (T153, the owner's card 4 of 2026-11-20); the UX wave's U8b (M7) named it Background tasks
  noSession: 'Open a session to see its background tasks', // a pinned tab while no session is shown
  // The UX wave's U8b (M7; Interfaces §F) start: the sections' headings, `Running N`, `Scheduled N`, `Tasks`, and
  // `Done N · W workflows · S shells · M monitors · T tasks` (a kind of zero left out)
  running: (n: number): PanelHeading => ({ label: 'Running', detail: String(n) }),
  scheduled: (n: number): PanelHeading => ({ label: 'Scheduled', detail: String(n) }),
  tasks: { label: 'Tasks', detail: null } satisfies PanelHeading,
  done: (n: number, kinds: { workflows: number; shells: number; monitors: number; other: number }): PanelHeading => ({
    label: 'Done',
    detail: [
      String(n),
      kinds.workflows > 0 && plural(kinds.workflows, 'workflow'),
      kinds.shells > 0 && plural(kinds.shells, 'shell'),
      kinds.monitors > 0 && plural(kinds.monitors, 'monitor'),
      kinds.other > 0 && plural(kinds.other, 'task'),
    ].filter(Boolean).join(' · '),
  }),
  // The UX wave's U8b end
  // a workflow card: the node's description as its title, then this line (the frame's summary is not on X1): its name,
  // its time and its agents, with no kind word and no tokens (the word cut, T210); what no frame gave leaves no words
  workflowLine: (workflowName: string | null, elapsed: string | null, agents: number) => [workflowName, elapsed, plural(agents, 'agent')].filter(Boolean).join(' · '),
  phasesLabel: 'Phases', // the widget's phase column, by its accessible name (E7: the card's disclosure left with its tables)
  // an ended task's state word (a card's badge, a row's `· <status> <ago>`); the word cut (T213, T218, P126): a completed
  // task shows none (a card's badge is a check named by it) and an unknown outcome none at all
  status: { completed: 'completed', failed: 'failed', stopped: 'stopped', exited: 'ended with the session', unknown: '' },
  runsUnavailable: (message: string) => `Workflow runs unavailable: ${message}`,
  phaseUntitled: (index: number) => `Phase ${index}`, // agents naming a phaseIndex with no workflow_phase row
  columns: { agent: 'Agent', model: 'Model', tokens: 'Tokens', time: 'Time', /* E7 */ state: 'State' }, // the widget's agent table
  phasesPending: 'Phases arrive with the first progress frame', // the quiet spinner's name (the word cut, T212)
  noPhases: 'No phases', // a run that ended before any progress: its wait is over (the word cut, T212)
  noPhaseData: 'No phase data', // a run read from disk without its snapshot, in a session nothing else reports (T212)
  stop: 'Stop', // a workflow's too, on its own card and page (the word cut, T215)
  stopping: 'stopping…',
  stopFailed: (message: string) => `Couldn't stop it: ${message}`,
  stopUncertain: 'May not have stopped', // P5 O9: a terminal session's stop whose outcome is unknown
  // a shell's, a monitor's or another task's line: its description, then its state and time (the UX wave's U8b, M7: the
  // two drawn apart, so a narrow row cuts the description and never the state). The word cut (T216, T217, T218): a
  // running row's time alone, a finished one's age alone, and nothing for a time no source gave.
  line: (description: string, state: string) => `${description}${state}`,
  state: (parts: readonly string[]) => (parts.length === 0 ? '' : ` · ${parts.join(' ')}`),
  output: 'Output',
  outputPending: 'Output path not reported yet',
  earlierCompleted: (n: number) => `${n} done`, // the word cut (T231)
  tasksNoListId: 'No list yet', // the word cut (T233)
  tasksUnavailable: (message: string) => `Tasks unavailable: ${message}`,
  // an empty list: TaskCreate is off on the current models unless the launch enables TODO tools (the architect's ruling,
  // 2026-09-29), so the engine is not creating one; a live and a disk-only session read the same (the word cut, T234)
  noTaskLists: 'No tasks',
  shellsDiskOnly: 'Shells and monitors are known only while the session runs here',
  nothingRunning: 'Nothing running',
  // E7 start: the workflow widget and the compact card (E7 execution document, Design §2): the card shows one summary
  // line where its per-phase tables were, and its title and chevron open the widget.
  back: '‹ Background', // the word cut (T153): the back link follows the tab
  openRun: (description: string) => `Open ${description}`, // the card's chevron, by its accessible name
  allPhases: 'All phases',
  phaseCount: (done: number, total: number) => `${done}/${total}`,
  phaseCountQueued: 'Queued',
  agentsLabel: (phase: string) => `Agents · ${phase}`, // the agent table's accessible name
  notStarted: 'Not started', // a queued agent row: nothing to open yet
  noTranscript: 'No transcript known for this agent', // a started row whose id neither the row nor the run's journal gives
  phaseDone: 'done', // the phase mark of a finished phase and a done agent's state, by its accessible name
  noAgentsInPhase: 'No agents yet', // the word cut (T239)
  // a hand-off named a run no read has brought yet; the widget opens when one does (the word cut, T209: a quiet spinner
  // while a read can still bring it; `runMissing` once the session's read answered without it)
  runNotFound: 'Loading run…',
  runMissing: 'Run not found',
  runSummary: {
    queued: 'Queued',
    done: 'Done',
    phase: (title: string, done: number, total: number) => `${title} · ${done}/${total} agents`,
  },
  // E7 end
} as const;

// E7 start: the Tasks panel (E7 execution document, Design §6 as superseded by P-20): the read-only checklist as its own
// tool; its list's notes are the checklist's (`BACKGROUND_COPY`), shared with the Background tasks section.
export const TASKS_COPY = {
  title: 'Tasks',
  noSession: 'Open a session to see its tasks', // a pinned tab while no session is shown
  progress: (completed: number, total: number) => `${completed}/${total}`, // the word cut (T232)
  progressMeaning: (completed: number, total: number) => `${completed} of ${total} completed`, // its name and tooltip
  open: 'Open', // the Background tasks Tasks heading's action
  openPanel: 'Open the Tasks panel', // its accessible name
} as const;
// E7 end

// E7 start: Background tasks' Scheduled section (E7 execution document, Design §7): one row per job the engine holds for
// the session, its schedule in the create result's words (else the cron), its kind and store, the prompt's first line,
// its next run with the engine's jitter named in the tooltip (SPEC 22 §22.7), its expiry, and a link to its creating call.
export const SCHEDULED_COPY = {
  recurring: 'recurring',
  oneShot: 'one-shot',
  store: { 'durable-this': 'durable · this session', 'durable-other': 'durable · another session', session: 'session-only' },
  next: (time: string, relative: string) => `${time} · ${relative}`, // the word cut (T224); a cron MAWS cannot read, none (T226)
  jitter: 'The engine fires recurring jobs up to half a period late (30 min at most) and one-shots on :00 or :30 up to 90 s early',
  expires: (date: string) => `Expires ${date}`,
  expired: (date: string) => `Expired ${date}`, // a durable job past seven days: the engine deletes it after its next fire
  lastRan: (ago: string) => `Last ran ${ago}`, // a durable job's `lastFiredAt`
  dormant: 'Resumes with the session', // a session-only job of a session not running here (the engine resurrects it on resume)
  openTurn: 'Open creating turn', // the arrow's name and tooltip (the word cut, T222)
  unavailable: (message: string) => `Scheduled jobs unavailable: ${message}`,
} as const;
// E7 end

export const LOG_COPY = {
  title: 'Log',
  loadMore: 'Load more',
  showEarlier: 'Show earlier',
  refresh: 'Refresh', // the circular arrow's name and tooltip (the word cut, T241)
  refused: (message: string) => `Refused: ${message}`,
  endOfFile: 'End of file',
  noFile: 'No output file for this cell', // the word cut (T246)
  notRestored: 'This log was not restored. Reopen it from its row',
  copyPath: 'Copy path',
  copied: 'Copied',
  copyFailed: "Couldn't copy the path",
} as const;

// The summary card's Subagents and Background tasks sections, filled by the tools' `summary` components.
export const AGENTS_SUMMARY_COPY = {
  agents: (working: number, done: number) => `${working} working · ${done} done`,
  onDisk: (n: number) => `${n} on disk`,
  noAgents: 'No subagents yet',
  background: (counts: { shells: number; workflows: number; monitors: number; other: number }) =>
    [
      counts.shells && plural(counts.shells, 'shell'),
      counts.workflows && plural(counts.workflows, 'workflow'),
      counts.monitors && plural(counts.monitors, 'monitor'),
      counts.other && plural(counts.other, 'task'),
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing running',
  runsOnDisk: (n: number) => `${plural(n, 'workflow run')} on disk`,
  starting: 'Starting…', // the runs line while the session starts (P4)
  open: 'Open',
} as const;
