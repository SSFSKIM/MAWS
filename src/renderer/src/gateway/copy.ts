// The gateway's sentences from M4 (C11 execution document, Interfaces "Gateway": routing facts, the route switch and its
// sheet, the Direct model choice; W2: the usage popover's footer went with the status line, the switch is Session info's).

export type Route = 'gateway' | 'direct';
// P5 O7 M9: the route switch's targets, the machine's own route among them (every session's default, so always one to go
// back to); the legacy two routes stay `Route` wherever only they apply
export type SwitchTarget = Route | 'machine';

export const ROUTE = {
  routed: "Routed through ClaudeUsage's relay",
  direct: "Direct · engine's own login",
  directLogin: (login: string) => `Direct · engine's own login · ${login}`,
  directNote: 'no gateway models · usage windows from the engine',
  lastRouted: 'Last ran routed',
  lastDirect: 'Last ran direct',
  notRecorded: 'Route not recorded · a resume uses the default route', // P5 O7 M9: the machine's, which the legacy field no longer names
  switchTo: { direct: 'Switch to Direct…', gateway: 'Switch to gateway…', machine: 'Back to the machine’s own…' } satisfies Record<SwitchTarget, string>,
  held: (holder: string) => `Held by ${holder} · switch it there`,
  holders: { terminal: 'a terminal', background_job: 'a background job' } as Record<string, string>,
  archived: 'Archived · unarchive it to switch',
  // an unstarted session (D-19's per-session Direct): the intent's route, chosen before the first send
  starts: { gateway: "Starts routed through ClaudeUsage's relay", direct: "Starts direct · engine's own login" } satisfies Record<Route, string>,
  choice: { gateway: 'ClaudeUsage relay', direct: 'Direct' } satisfies Record<Route, string>,
};

// P5 O7 M9: the machine's own route (nothing injected), named by what `get_status` reported (observed-route.ts)
export const MACHINE_ROUTE = {
  line: (what: string) => `The machine’s own · ${what}`,
  claudeUsage: (baseUrl: string) => (baseUrl === '' ? 'ClaudeUsage relay' : `ClaudeUsage relay · ${baseUrl}`),
  login: (login: string | null) => (login === null ? 'Anthropic login' : `Anthropic login · ${login}`),
  pending: 'not verified yet',
  reachedClaudeUsage: 'ClaudeUsage', // the switch's toast: what the machine reached, briefly
  choice: 'Machine’s own', // the route segment's (an unstarted session's, Settings › Gateway's)
  starts: 'Starts on the machine’s own route · its settings and login decide',
  lastRan: (what: string) => `Last ran on the machine’s own route · ${what}`,
  toolSearch: 'as the machine’s settings set it',
};

export const FOOTER = {
  openClaudeUsageAction: 'Open ClaudeUsage', // a toast's action (no arrow: it runs the hand-off)
};

export const PACE = {
  weekly: (when: string) => `At this rate weekly runs out ${when}, before it resets`,
  fiveHour: (time: string) => `At this rate the 5-hour window runs out at ${time}`,
};

export const SWITCH = {
  title: (target: SwitchTarget) => (target === 'machine' ? 'Switch this session back to the machine’s own route?' : `Switch this session to ${target === 'direct' ? 'Direct' : 'the gateway'}?`),
  body: 'The engine process restarts and resumes the same session: the transcript and session grants are kept, and queued messages are kept and sent after the restart; a running turn is stopped first.',
  effect: {
    direct: 'Gateway models become unavailable · usage windows come from the engine',
    gateway: 'Gateway models become available',
    machine: 'MAWS injects nothing: the machine’s own settings, environment and login decide · Session info names what it reaches',
  } satisfies Record<SwitchTarget, string>,
  backgroundLead: 'These stop with the process and do not resume:',
  stopAndSwitch: 'Stop them and switch',
  restart: { direct: 'Restart direct', gateway: 'Restart routed', machine: 'Restart on the machine’s own' } satisfies Record<SwitchTarget, string>,
  cancel: 'Cancel',
  newWork: 'New background work started since you confirmed · check the list again',
  checking: 'Checking the session…', // confirming, before the sheet: the fresh status read
  phase: {
    confirming: 'Waiting for your answer',
    interrupting: 'Stopping the running turn…',
    rechecking: 'Checking for background work…',
    stopping: 'Stopping the process…',
    starting: 'Restarting…',
    advising: 'Waiting for your answer', // P5 O7 M9: the machine's relay isn't answering
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
  // P5 O7 M9: the machine's own settings name ClaudeUsage's relay and it isn't answering (main's launch check, heard at
  // the restart, after the stop); Cancel leaves the session stopped on the route its record keeps
  relayAdvisory: {
    title: 'This machine’s relay isn’t answering. Switch anyway?',
    body: 'This machine’s own settings send its requests to ClaudeUsage’s relay, which isn’t answering, so the first turn may fail. The session is stopped: Cancel leaves it so, to resume on the route it was on.',
    submit: 'Switch anyway',
    cancelled: 'Stopped, not switched: this machine’s relay isn’t answering · Resume from the sidebar to restart it on the route it was on',
  },
  // P5 O7 M9: a model the machine's own route can't reach, refused at the restart, and the Claude model pick then cancelled
  notSwitched: (why: string) => `Stopped, not switched: ${why} · Resume from the sidebar to restart it on the route it was on`,
  // P5 O7 M9: back on the machine's own route, named by what get_status reported it reaching
  toastMachine: (title: string, reached: string, model: string | null) => `${title} restarted · now on this machine’s own setup (${reached})${model === null ? '' : ` · on ${model}`}`,
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
  cannotHoldAuto: 'Cannot hold auto mode', // L99: as the model widget's caption
  defaultBadge: 'Default', // W3: the `default` row, named by the model it runs
  choose: 'Use this model',
  cancel: 'Cancel',
  loading: 'Reading the catalogue…',
  none: 'No Claude model in the catalogue',
};
