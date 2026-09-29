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
