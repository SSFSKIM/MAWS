// The spine's commands whose own waits run past a host request's 10 s (REQUEST_TIMEOUT_MS), each with the budget that
// covers them (the panel's sweep#3 on P5 O3-D). On the daemon shape main reaches these commands through its `machine`
// host, whose spec carries this table (src/main/hosts/daemon.ts), so a take-over whose `claude stop` takes 11 s is
// answered as mawsd finishes it rather than `timeout` while mawsd goes on; in the embedded shape they run in main
// with no deadline of their own. A command not named here answers within the default: its own work is short, and
// only stalled inner host calls (each bounded at 10 s) take it past that.
import type { CommandName } from '@shared/ipc/schema';
import { GIT_TIMEOUT_MS } from './git/runner';
import { GH_READ_TIMEOUT_MS } from './scm/pr-state';
import { COMMIT_TIMEOUT_MS, LOCAL_TIMEOUT_MS, SCM_ADMIT_MS } from './scm/service';
import { BRIDGE_SLACK_MS, LANE_A_TIMING } from './lane-a/driver';
import { CONFIGURE_WAIT_MS } from './settings/engine-configure';
import { EXIT_WAIT_MS, STOP_WAIT_MS, WATCHDOG_MS } from './sessions/context';
import { CLEAR_WAIT_MS, PAUSE_WAIT_MS } from './sessions/pause-take-over';
import { PAUSED_READY_MS } from './sessions/resume';
import { STOP_TIMEOUT_MS, TAKE_OVER_WAIT_MS } from './sessions/take-over';

// Over a command's named waits: the inner host calls around them (milliseconds each while the hosts answer), a git
// kill's grace, and the answer's way back to main.
const MARGIN_MS = 10_000;
// A bridge command lane A posts: the bridge's own wait, and its socket's slack past it.
const BRIDGE_MS = LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS;
// A pane take-over (W14): the CLI's pause, the resume (the configure gate, a launch and its one retry, each ready within
// PAUSED_READY_MS), the old row's clearing, and a rollback's stop wait.
const PANE_TAKE_OVER_MS = PAUSE_WAIT_MS + CONFIGURE_WAIT_MS + 2 * PAUSED_READY_MS + CLEAR_WAIT_MS + STOP_WAIT_MS;

// P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §H; D11): the checkouts' commands, each
// the sum of its longest sequential chain of bounded phases as the code runs it (a git call GIT_TIMEOUT_MS, a gh read
// GH_READ_TIMEOUT_MS; calls made in parallel count once), and for a mutation its admission (SCM_ADMIT_MS, which covers
// the checkout's key resolution and the repository's chain). A budget short of a legitimate wait would answer `timeout`
// for a commit mawsd then finishes, inviting a retry.
const GIT = GIT_TIMEOUT_MS;
const GH = GH_READ_TIMEOUT_MS;
const STATUS = 3 * GIT; // GitService.status: rev-parse, then status beside stash list, then the remote's URL
const TRUST = GIT; // trustedKeyOf's rev-parse (the store read is a file's)
const KEYS = GIT; // ScmService.keysOf's rev-parse
const PROBE = GH; // gh --version beside gh auth status
const MUTATION = (commands: number, timeoutMs: number) => SCM_ADMIT_MS + TRUST + STATUS + commands * timeoutMs + STATUS;
const CHECKOUTS_BUDGETS_MS = {
  'git.status': STATUS + MARGIN_MS,
  'git.watch': STATUS + MARGIN_MS, // the first status; the projection's and the nested checkouts' reads are the filesystem's
  'git.branches': GIT + MARGIN_MS,
  'git.diff': STATUS + GIT + MARGIN_MS, // the untracked scope: the status that confines it, then the diff (the others: one round)
  'git.log': GIT + MARGIN_MS,
  'git.lsFiles': GIT + MARGIN_MS, // ls-files, or a walk bounded by its entries
  // trust beside the gh probe, then the remotes, the default remote and its HEAD
  'scm.status': Math.max(TRUST, PROBE) + 3 * GIT + MARGIN_MS,
  'scm.stage': MUTATION(1, LOCAL_TIMEOUT_MS) + MARGIN_MS,
  'scm.unstage': MUTATION(1, LOCAL_TIMEOUT_MS) + MARGIN_MS,
  'scm.discard': MUTATION(2, LOCAL_TIMEOUT_MS) + MARGIN_MS, // restore, then clean
  'scm.commit': MUTATION(1, COMMIT_TIMEOUT_MS) + GIT + MARGIN_MS, // the hooks, then the new commit's log read
  // trust and status, the upstream, the remotes, the push URLs and the fetch URL, the branch's name, the checkout's keys
  'scm.push.plan': TRUST + STATUS + 5 * GIT + KEYS + MARGIN_MS,
  // trust and status, the gh probe, the upstream, gh repo view, the base's name, the push URLs and the fetch URL, the keys
  'scm.pr.plan': TRUST + STATUS + PROBE + GIT + GH + 3 * GIT + KEYS + MARGIN_MS,
  // admitted, then the revalidation (trust, status, the push URLs); the run answers at its start
  'scm.push': SCM_ADMIT_MS + TRUST + STATUS + GIT + MARGIN_MS,
  'scm.pr.create': SCM_ADMIT_MS + TRUST + STATUS + GIT + MARGIN_MS,
  'scm.remote.cancel': KEYS + MARGIN_MS,
  'scm.remote.last': KEYS + MARGIN_MS,
  // trust beside the probe, status, the remotes, the keys, then gh pr view and gh pr checks
  'scm.pr.state': Math.max(TRUST, PROBE) + STATUS + GIT + KEYS + 2 * GH + MARGIN_MS,
  'files.upload': GIT + MARGIN_MS, // the exclude's git read (M3's write)
} as const satisfies Partial<Record<CommandName, number>>;

export const COMMAND_BUDGETS_MS: Readonly<Partial<Record<CommandName, number>>> = {
  ...CHECKOUTS_BUDGETS_MS,
  // a background job's `claude stop` and the registry's clearing after it, or a terminal pane's pause and resume
  'session.takeOver': Math.max(STOP_TIMEOUT_MS + TAKE_OVER_WAIT_MS, PANE_TAKE_OVER_MS) + MARGIN_MS,
  // a process still exiting, the configure gate, and the launch to ready (the watch fails one silent for WATCHDOG_MS;
  // a launch whose SessionStart hooks keep it reporting for longer answers `timeout` here and still becomes ready)
  'session.acquire': EXIT_WAIT_MS + CONFIGURE_WAIT_MS + WATCHDOG_MS + MARGIN_MS,
  // P5 O7 M4: a spawn answers at its setup's `launching`: the configure gate, a new worktree's git, and the trust
  // bootstrap's launch (watched for WATCHDOG_MS) before the record
  'session.spawn': CONFIGURE_WAIT_MS + GIT_TIMEOUT_MS + WATCHDOG_MS + MARGIN_MS,
  'settings.engineApplied': CONFIGURE_WAIT_MS + MARGIN_MS, // the engine host's verdict on the settings
  'laneA.interrupt': BRIDGE_MS + MARGIN_MS,
  'laneA.command': BRIDGE_MS + MARGIN_MS,
  'laneA.btw': BRIDGE_MS + MARGIN_MS,
  'laneA.compact': BRIDGE_MS + MARGIN_MS,
  'laneA.stopAgent': BRIDGE_MS + MARGIN_MS,
  'laneA.tell': BRIDGE_MS + MARGIN_MS,
  'laneA.read': BRIDGE_MS + MARGIN_MS,
  'laneA.stopTask': BRIDGE_MS + MARGIN_MS, // after the transcript's catch-up, which reads the jobs it holds
  'laneA.answer': LANE_A_TIMING.requestMs + LANE_A_TIMING.decisionMs + MARGIN_MS, // the request read again, then the decision
  'laneA.model': 2 * BRIDGE_MS + MARGIN_MS, // the status read, then the change (one change at a time per session)
  // the status read, the uploads' git exclude, and the post with its retries
  'laneA.media': BRIDGE_MS + GIT_TIMEOUT_MS + 3 * BRIDGE_MS + LANE_A_TIMING.lane.retryDelaysMs.reduce((sum, ms) => sum + ms, 0) + MARGIN_MS,
};
