// The gateway's sentences from M4 (C11 execution document, Interfaces "Gateway": routing facts, the route switch and its
// sheet, the Direct model choice; W2: the usage popover's footer went with the status line, the switch is Session info's).

export type Route = 'gateway' | 'direct';

export const ROUTE = {
  routed: "Routed through ClaudeUsage's relay",
  direct: "Direct · engine's own login",
  directLogin: (login: string) => `Direct · engine's own login · ${login}`,
  directNote: 'no gateway models · usage windows from the engine',
  lastRouted: 'Last ran routed',
  lastDirect: 'Last ran direct',
  notRecorded: (fallback: Route) => `Route not recorded · a resume uses the default route (${fallback})`,
  switchTo: { direct: 'Switch to Direct…', gateway: 'Switch to gateway…' } satisfies Record<Route, string>,
  held: (holder: string) => `Held by ${holder} · switch it there`,
  holders: { terminal: 'a terminal', background_job: 'a background job' } as Record<string, string>,
  archived: 'Archived · unarchive it to switch',
  // an unstarted session (D-19's per-session Direct): the intent's route, chosen before the first send
  starts: { gateway: "Starts routed through ClaudeUsage's relay", direct: "Starts direct · engine's own login" } satisfies Record<Route, string>,
  choice: { gateway: 'ClaudeUsage relay', direct: 'Direct' } satisfies Record<Route, string>,
};

export const FOOTER = {
  openClaudeUsageAction: 'Open ClaudeUsage', // a toast's action (no arrow: it runs the hand-off)
};

export const PACE = {
  weekly: (when: string) => `At this rate weekly runs out ${when}, before it resets`,
  fiveHour: (time: string) => `At this rate the 5-hour window runs out at ${time}`,
};

export const SWITCH = {
  title: (target: Route) => `Switch this session to ${target === 'direct' ? 'Direct' : 'the gateway'}?`,
  body: 'The engine process restarts and resumes the same session: the transcript and session grants are kept, and queued messages are kept and sent after the restart; a running turn is stopped first.',
  effect: { direct: 'Gateway models become unavailable · usage windows come from the engine', gateway: 'Gateway models become available' } satisfies Record<Route, string>,
  backgroundLead: 'These stop with the process and do not resume:',
  stopAndSwitch: 'Stop them and switch',
  restart: { direct: 'Restart direct', gateway: 'Restart routed' } satisfies Record<Route, string>,
  cancel: 'Cancel',
  newWork: 'New background work started since you confirmed · check the list again',
  checking: 'Checking the session…', // confirming, before the sheet: the fresh status read
  phase: {
    confirming: 'Waiting for your answer',
    interrupting: 'Stopping the running turn…',
    rechecking: 'Checking for background work…',
    stopping: 'Stopping the process…',
    starting: 'Restarting…',
    done: 'Restarted',
    failed: 'The switch failed',
  },
  alreadySwitching: 'This session is already switching routes',
  relayDown: "ClaudeUsage's relay is not answering · nothing was stopped",
  notRunning: 'The session is not running in this app',
  turnDidNotStop: 'The running turn did not stop within 10 s · nothing else was changed',
  readFailed: (why: string) => `The session's status could not be read · ${why}`,
  interruptFailed: (why: string) => `The running turn could not be stopped · ${why}`,
  stopFailed: (why: string) => `The process could not be stopped · ${why}`,
  didNotExit: 'The process did not exit · nothing was restarted',
  refused: (why: string) => `Stopped; the restart was refused: ${why} · Resume from the sidebar`,
  notReady: 'Stopped; the restart did not become ready within 60 s · Resume from the sidebar',
  mismatch: (target: Route) => `Restarted, but the route reads unverified (asked for ${target === 'direct' ? 'Direct' : 'the gateway'}) · check Session info`,
  retry: 'Retry',
  toast: (title: string, target: Route, model: string | null) => `${title} restarted ${target === 'direct' ? 'direct' : 'routed'}${model === null ? '' : ` · on ${model}`}`,
};

// C10's start outcomes other than `starting`, and its setup failures, as the switch's refusal words.
export const START = {
  needsTrust: 'The folder is not trusted yet · resume it from the sidebar to answer',
  relayUnreachable: 'The relay was unreachable',
  held: (holder: string) => `Held by ${holder}`,
  alreadyLive: 'This session is already running',
  archived: 'This session is archived',
  missingDirectory: (directory: string) => `Directory not found: ${directory}`,
};

export const DIRECT_MODEL = {
  title: 'Choose a Claude model',
  why: 'The direct route cannot serve a gateway model · choose one from the Claude group',
  list: 'Claude models',
  cannotHoldAuto: 'Cannot hold auto mode · runs in default',
  defaultBadge: 'Default', // W3: the `default` row, named by the model it runs
  choose: 'Use this model',
  cancel: 'Cancel',
  loading: 'Reading the catalogue…',
  none: 'No Claude model in the catalogue',
};
