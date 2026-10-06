// The derived agent fixtures' tails, as their generators (`agents-fixtures.ts`) measured them. Recorded here, with no
// imports, so the e2e reads the numbers directly; the suite `agents fixtures are reproducible` measures them again.
// `first` is the seq of a tail's first event (the `releaseTo` the e2e passes: C6's `seek` releases the events strictly
// below it); `batches` are the release counts covering the tail in order, each ending on the frame its name says.

// events/agents-relay: pass 1's two background agents running (the first child's finish withheld), then R1's recorded
// SendMessage re-keyed to the first agent (`batches[0]` ends on its tool.use), then its tool.result and R1's recorded
// foreground start re-keyed to a second agent (`batches[1]` ends on the start). No receipt (O3).
export const AGENTS_RELAY_TAIL = {
  first: 333,
  batches: [2, 2],
  agentId: 'ad286defbc77bc090',
  text: 'Say PING in your next inbox line',
  foregroundAgentId: 'a0f00d0f00d0f00d1',
} as const;

// events/agents-stop-workflow: pass 2's workflow through its last progress frame, then R6's recorded workflow stop
// re-keyed to it: the snapshot without it, `task.updated killed`, `task.notification stopped`. `progress.releaseTo` is
// the seq of the first progress frame and `progress.frames` the release counts reaching each progress frame in turn.
export const AGENTS_STOP_WORKFLOW_TAIL = {
  first: 94,
  batches: [1, 1, 1],
  taskId: 'wayue3on6',
  progress: { releaseTo: 82, frames: [1, 6, 1] },
} as const;

// events/agents-stop-shell: pass 2's background shell through the Bash result that reports its output file, then R6's
// recorded shell stop re-keyed to it, in the same order.
export const AGENTS_STOP_SHELL_TAIL = {
  first: 45,
  batches: [1, 1, 1],
  taskId: 'b53no4rmo',
  outputFile: '/private/tmp/claude-501/-private-tmp-maws-probe2-jJmuGs/dd4b0f5f-2900-4680-84df-c1930264bb5d/tasks/b53no4rmo.output',
} as const;

// E7 start (M7): what the E7 cases release to and read, measured from the recorded journals (`pass3/e7-peer-a`,
// `pass3/nested-agents`) and the derived `events/agents-cron`. Seqs are a row's own: `releaseTo` releases the events
// strictly below it; `releaseThrough` releases through it.

// pass3/e7-peer-a: A's ListAgents (its result), B's idle message (A answers it unasked with a SendMessage by B's name),
// the owner's reply steer echoed as a human message, its SendMessage to the envelope's `from` and the result, B's second
// message mid-turn, and a SendMessage to nobody answered `success: false`.
export const E7_PEER_A = {
  listingResult: 29,
  inbound: 73,
  unaskedResult: 134,
  replyFrom: 160,
  replySend: 191,
  replyResult: 195,
  midTurn: 258,
  failureResult: 311,
  address: 'uds:/tmp/cc-socks/10562.sock',
  name: 'repo-b-gen1il-79',
  text: 'E7 probe: reply from A',
} as const;

// pass3/nested-agents: the outer agent dispatches the inner one, which finishes first.
export const E7_NESTED_AGENTS = {
  outer: 'a38d4aebfaea9f6b1',
  inner: 'a425e926e506edeb1',
  innerStart: 112,
  innerFinish: 121,
  outerFinish: 126,
} as const;

// events/agents-cron: e7-cron's turns (the first ends once both session-only jobs are created; the CronDelete's result;
// the third ends with the durable and the nightly jobs created), then e7-cron-resume's launch from `first`.
export const AGENTS_CRON_TAIL = {
  first: 503,
  firstTurnEnd: 166,
  deleteResult: 335,
  lastLaunchEnd: 495,
  jobs: {
    tick: { id: '481abb0a', toolUseId: 'toolu_015d8GrxGZ4yJdT1N1rNLyct', cron: '*/2 * * * *' },
    oneShot: { id: '8d1a2582', toolUseId: 'toolu_01CLe4A37sTciznqrMHJFUbf', cron: '15 4 6 10 *' },
    durable: { id: '598b1690', toolUseId: 'toolu_01BuDFh81XgBTkFdrA3jog5x', cron: '0 9 * * 1' },
    nightly: { id: '1040f3a5', toolUseId: 'toolu_01MsAPejq7jjdf3yfoyUG6Fc', cron: '0 3 * * *' },
  },
} as const;
// E7 end
