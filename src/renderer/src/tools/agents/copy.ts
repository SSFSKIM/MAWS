// Every sentence the Subagents, Background work and Log tools and their two summary sections show (C8b execution
// document, Interfaces *Copy*; the exact strings are decisions). `<session>` is the parent's record title and `<title>`
// an agent row's title (`name ?? description`); elapsed and token values come from `model/elapsed.ts`'s formatters.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const SUBAGENTS_COPY = {
  title: 'Subagents',
  // lists
  done: (n: number) => `Done · ${n}`, // the Done section's heading, and (E7) a running parent's fold over its finished children
  onDisk: (n: number) => `On disk · ${n}`,
  showMore: (n: number) => `Show ${n} more`,
  working: 'Working', // a row's second line when it has neither a summary nor (under a real name) a description
  nested: '· nested',
  childOf: (parentTitle: string) => `Child of ${parentTitle}`,
  childOfUnlisted: 'Child of an agent this session does not list',
  waiting: 'waiting',
  approvalNeeded: 'Approval needed',
  finished: (ago: string) => `finished · ${ago}`,
  finishedWithErrors: (ago: string) => `finished with errors · ${ago}`,
  stopped: (ago: string) => `stopped · ${ago}`,
  endedWithSession: 'ended with the session',
  // the same outcomes with no end time known (a sidecar's `stoppedByUser` carries none)
  finishedUndated: 'finished',
  finishedWithErrorsUndated: 'finished with errors',
  stoppedUndated: 'stopped',
  noSession: 'Open a session to see its subagents', // a pinned tab while no session is shown
  statusUnavailable: 'status unavailable',
  elapsedUnavailable: 'elapsed unavailable',
  footer: 'Live activity · includes nested agents',
  diskOnly: 'Status is known only while the session runs here',
  empty: 'No subagents yet',
  sidecarsUnavailable: (message: string) => `Sidecars unavailable: ${message}`,
  // drill-in
  back: '‹ Subagents',
  header: (model: string, elapsed: string, tokens: string) => `${model} · ${elapsed} · ${tokens}`,
  modelUnknown: 'model unknown',
  tokensUnavailable: 'tokens unavailable',
  dispatchedBy: (session: string) => `Dispatched by ${session}`,
  stopAgent: 'Stop agent',
  stopConfirm: (title: string) => `Stop ${title}?`,
  stopConfirmYes: 'Stop',
  stopConfirmNo: 'Keep running',
  stopping: 'stopping…',
  stopFailed: (message: string) => `Couldn't stop it: ${message}`,
  waitingToStart: 'Waiting for the agent to start',
  // E7 start: the topology tree (Design §3, §5)
  agents: (running: number) => `Agents · ${running} running`,
  foldLabel: (n: number, parentTitle: string) => `Done · ${n} under ${parentTitle}`, // the fold's accessible name
  team: 'Team · led by this session',
  // the listing's own extras, then when it was listed; its `joined <age> ago` is an age at the listing's time, which would
  // read as current long after, so it is dropped (E11 W-D) and `listed <ago>` dates the row
  teammateListed: (extras: string[], ago: string) => [...extras.filter((extra) => !/^joined .* ago$/.test(extra)), `listed ${ago}`].join(' · '),
  teammateNoTranscript: 'Named by the team listing; no transcript of it is known here',
  // E7 end
} as const;

// The relay composer (Interfaces *The relay*): its label, its disabled reasons (shown as the placeholder) and the pending
// line through the three observables.
export const RELAY_COPY = {
  label: (session: string) => `Relay via ${session}`,
  placeholder: (title: string) => `Message ${title}…`,
  send: 'Send',
  disabled: {
    notRunningHere: 'Relay needs the session running here',
    foreground: (session: string) => `${session} is waiting on this agent and reads messages only after it returns`,
    foregroundTooltip: 'A message sent now would resume the finished agent instead of reaching this one',
    backgroundUnknown: (session: string) => `Not known whether ${session} is waiting on this agent`,
    finished: 'This agent has finished',
    stopped: 'This agent was stopped',
    exited: 'This agent ended with the session',
    diskOnly: 'Known only from disk',
    pending: 'Waiting for the last relay',
  },
  asked: (session: string, elapsed: string) => `Asked ${session} to relay · ${elapsed}`,
  askedTurnOpen: (session: string, elapsed: string) => `Asked ${session} to relay · ${elapsed} · ${session} forwards at its next tool boundary or when this turn ends`,
  askedLongWait: (session: string, elapsed: string) =>
    `Asked ${session} to relay · ${elapsed} · ${session} is inside a long tool call; it forwards when that call returns or this turn ends`,
  childEnded: (title: string, session: string) => `${title} finished before ${session} forwarded it · a SendMessage now would resume it`,
  forwarded: (session: string, rounds: number, title: string) =>
    `${session} sent it with SendMessage after ${plural(rounds, 'parent round')} · ${title} gets it at its next tool round`,
  failed: (message: string) => `Relay failed: ${message}`,
  dropped: (state: 'cancelled' | 'discarded' | 'refused') => `the engine ${state} it before starting it`, // the failed state's message (O1)
  notSent: 'the session ended that turn without sending it', // E7: a peer relay whose steer's own turn ended with no matching SendMessage
} as const;

export const BACKGROUND_COPY = {
  title: 'Background work',
  noSession: 'Open a session to see its background work', // a pinned tab while no session is shown
  workflows: (n: number) => `Workflows · ${n}`,
  shellsRunning: (n: number) => `Shells · ${n} running`,
  monitors: (n: number) => `Monitors · ${n}`,
  tasks: (completed: number, total: number) => `Tasks · ${completed}/${total}`,
  tasksHeading: 'Tasks', // before the list is read, or when it cannot be
  // a workflow card: the node's description as its title, then this line (the frame's summary is not on X1); a run whose
  // name no frame or snapshot gave reads `workflow · …`
  workflowLine: (workflowName: string | null, elapsed: string, agents: number, tokens: string) =>
    `workflow${workflowName ? ` ${workflowName}` : ''} · ${elapsed} · ${plural(agents, 'agent')} · ${tokens}`,
  phasesLabel: 'Phases', // the widget's phase column, by its accessible name (E7: the card's disclosure left with its tables)
  // an ended task's state word (a card's badge, a row's `· <status> <ago>`)
  status: { completed: 'completed', failed: 'failed', stopped: 'stopped', exited: 'ended with the session', unknown: 'status unavailable' },
  runsUnavailable: (message: string) => `Workflow runs unavailable: ${message}`,
  phaseUntitled: (index: number) => `Phase ${index}`, // agents naming a phaseIndex with no workflow_phase row
  columns: { agent: 'Agent', model: 'Model', tokens: 'Tokens', time: 'Time', /* E7 */ state: 'State' }, // the widget's agent table
  phasesPending: 'Phases arrive with the first progress frame',
  stopWorkflow: 'Stop workflow',
  stop: 'Stop',
  stopping: 'stopping…',
  stopFailed: (message: string) => `Couldn't stop it: ${message}`,
  running: (description: string, elapsed: string) => `${description} · running ${elapsed}`, // a shell or a monitor
  runningUntimed: (description: string) => `${description} · running · elapsed unavailable`, // known from the status's list alone
  ended: (description: string, status: string, ago: string) => `${description} · ${status} ${ago}`,
  endedUndated: (description: string, status: string) => `${description} · ${status}`, // no end time known, or ended with the session
  output: 'Output',
  outputPending: 'Output path not reported yet',
  earlierCompleted: (n: number) => `${plural(n, 'earlier task')} completed`,
  sessionList: 'session list',
  tasksNoListId: 'Tasks unavailable until the engine reports its list',
  tasksUnavailable: (message: string) => `Tasks unavailable: ${message}`,
  // an empty list: TaskCreate is off on the current models unless the launch enables TODO tools (the architect's ruling,
  // 2026-09-29), so the engine is not creating one; a live and a disk-only session read the same
  noTaskLists: 'The engine is not creating task lists in this session',
  shellsDiskOnly: 'Shells and monitors are known only while the session runs here',
  runsOnDisk: (n: number) => `Workflow runs on disk · ${n}`,
  nothingRunning: 'Nothing running',
  // E7 start: the workflow widget and the compact card (E7 execution document, Design §2): the card shows one summary
  // line where its per-phase tables were, and its title and chevron open the widget.
  back: '‹ Background work',
  openRun: (description: string) => `Open ${description}`, // the card's chevron, by its accessible name
  allPhases: 'All phases',
  phaseCount: (done: number, total: number) => `${done}/${total}`,
  phaseCountQueued: 'Queued',
  agentsLabel: (phase: string) => `Agents · ${phase}`, // the agent table's accessible name
  notStarted: 'Not started', // a queued agent row: nothing to open yet
  noTranscript: 'No transcript known for this agent', // a started row whose id neither the row nor the run's journal gives
  phaseDone: 'done', // the phase mark of a finished phase, by its accessible name
  noAgentsInPhase: 'No agents in this phase yet',
  runNotFound: 'Run not found yet', // a hand-off named a run no read has brought yet; the widget opens when one does
  runSummary: {
    queued: 'Queued',
    done: 'Done',
    phase: (title: string, done: number, total: number) => `${title} · ${done}/${total} agents`,
  },
  // E7 end
} as const;

// E7 start: the Tasks panel (E7 execution document, Design §6 as superseded by P-20): the read-only checklist as its own
// tool; its list's notes are the checklist's (`BACKGROUND_COPY`), shared with the Background work section.
export const TASKS_COPY = {
  title: 'Tasks',
  noSession: 'Open a session to see its tasks', // a pinned tab while no session is shown
  progress: (completed: number, total: number) => `${completed} of ${total} completed`,
  open: 'Open', // the Background work Tasks heading's action
  openPanel: 'Open the Tasks panel', // its accessible name
} as const;
// E7 end

// E7 start: Background work's Scheduled section (E7 execution document, Design §7): one row per job the engine holds for
// the session, its schedule in the create result's words (else the cron), its kind and store, the prompt's first line,
// its next run with the engine's jitter named in the tooltip (SPEC 22 §22.7), its expiry, and a link to its creating call.
export const SCHEDULED_COPY = {
  heading: (n: number) => `Scheduled · ${n}`,
  recurring: 'recurring',
  oneShot: 'one-shot',
  store: { 'durable-this': 'durable · this session', 'durable-other': 'durable · another session', session: 'session-only' },
  next: (time: string, relative: string) => `Next ≈ ${time} (${relative})`,
  nextUnknown: 'next run unknown', // a cron MAWS's parser refuses
  jitter: 'The engine fires recurring jobs up to half a period late (30 min at most) and one-shots on :00 or :30 up to 90 s early',
  expires: (date: string) => `Expires ${date}`,
  expired: (date: string) => `Expired ${date}`, // a durable job past seven days: the engine deletes it after its next fire
  lastRan: (ago: string) => `Last ran ${ago}`, // a durable job's `lastFiredAt`
  dormant: 'Resumes with the session', // a session-only job of a session not running here (the engine resurrects it on resume)
  openTurn: 'Open creating turn',
  unavailable: (message: string) => `Scheduled jobs unavailable: ${message}`,
} as const;
// E7 end

export const LOG_COPY = {
  title: 'Log',
  loadMore: 'Load more',
  showEarlier: 'Show earlier',
  refresh: 'Refresh',
  refused: (message: string) => `Refused: ${message}`,
  endOfFile: 'End of file',
  noFile: 'No file to open: the engine reported no output file for this cell; the transcript shows what was kept',
  notRestored: 'This log was not restored. Reopen it from its row',
  copyPath: 'Copy path',
  copied: 'Copied',
  copyFailed: "Couldn't copy the path",
} as const;

// The summary card's Subagents and Background work sections, filled by the tools' `summary` components.
export const AGENTS_SUMMARY_COPY = {
  agents: (working: number, done: number) => `${working} working · ${done} done`,
  onDisk: (n: number) => `${n} on disk`,
  noAgents: 'No subagents yet',
  background: (counts: { shells: number; workflows: number; monitors: number }) =>
    [counts.shells && plural(counts.shells, 'shell'), counts.workflows && plural(counts.workflows, 'workflow'), counts.monitors && plural(counts.monitors, 'monitor')]
      .filter(Boolean)
      .join(' · ') || 'Nothing running',
  runsOnDisk: (n: number) => `${plural(n, 'workflow run')} on disk`,
  open: 'Open',
} as const;
