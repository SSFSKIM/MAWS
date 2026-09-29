// Every sentence the Subagents, Background work and Log tools and their two summary sections show (C8b execution
// document, Interfaces *Copy*; the exact strings are decisions). `<session>` is the parent's record title and `<title>`
// an agent row's title (`name ?? description`); elapsed and token values come from `model/elapsed.ts`'s formatters.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const SUBAGENTS_COPY = {
  title: 'Subagents',
  // lists
  active: (n: number) => `Active · ${n}`,
  done: (n: number) => `Done · ${n}`,
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
} as const;

export const BACKGROUND_COPY = {
  title: 'Background work',
  workflows: (n: number) => `Workflows · ${n}`,
  shellsRunning: (n: number) => `Shells · ${n} running`,
  monitors: (n: number) => `Monitors · ${n}`,
  tasks: (completed: number, total: number) => `Tasks · ${completed}/${total}`,
  // a workflow card: the node's description as its title, then this line (the frame's summary is not on X1)
  workflowLine: (workflowName: string, elapsed: string, agents: number, tokens: string) => `workflow ${workflowName} · ${elapsed} · ${plural(agents, 'agent')} · ${tokens}`,
  phase: (title: string, done: number, total: number) => `${title} ${done}/${total}`,
  phaseQueued: (title: string) => `${title} · Queued`,
  phaseUntitled: (index: number) => `Phase ${index}`, // agents naming a phaseIndex with no workflow_phase row
  columns: { agent: 'Agent', model: 'Model', tokens: 'Tokens', time: 'Time' },
  phasesPending: 'Phases arrive with the first progress frame',
  stopWorkflow: 'Stop workflow',
  stop: 'Stop',
  stopping: 'stopping…',
  stopFailed: (message: string) => `Couldn't stop it: ${message}`,
  running: (description: string, elapsed: string) => `${description} · running ${elapsed}`, // a shell or a monitor
  ended: (description: string, status: string, ago: string) => `${description} · ${status} ${ago}`,
  output: 'Output',
  outputPending: 'Output path not reported yet',
  earlierCompleted: (n: number) => `${plural(n, 'earlier task')} completed`,
  sessionList: 'session list',
  tasksNoListId: 'Tasks unavailable until the engine reports its list',
  tasksUnavailable: (message: string) => `Tasks unavailable: ${message}`,
  noTasks: 'No tasks',
  shellsDiskOnly: 'Shells and monitors are known only while the session runs here',
  runsOnDisk: (n: number) => `Workflow runs on disk · ${n}`,
  nothingRunning: 'Nothing running',
} as const;

export const LOG_COPY = {
  title: 'Log',
  loadMore: 'Load more',
  showEarlier: 'Show earlier',
  refresh: 'Refresh',
  refused: (message: string) => `Refused: ${message}`,
  endOfFile: 'End of file',
  noFile: 'No file to open: the engine reported no output file for this cell; the transcript shows what was kept',
  notRestored: 'This log was not restored. Reopen it from its row',
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
