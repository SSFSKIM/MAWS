// The spine's commands whose own waits run past a host request's 10 s (REQUEST_TIMEOUT_MS), each with the budget that
// covers them (the panel's sweep#3 on P5 O3-D). On the daemon shape main reaches these commands through its `machine`
// host, whose spec carries this table (src/main/hosts/daemon.ts), so a take-over whose `claude stop` takes 11 s is
// answered as mawsd finishes it rather than `timeout` while mawsd goes on; in the embedded shape they run in main
// with no deadline of their own. A command not named here answers within the default: its own work is short, and
// only stalled inner host calls (each bounded at 10 s) take it past that.
import type { CommandName } from '@shared/ipc/schema';
import { GIT_TIMEOUT_MS } from './git/runner';
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

export const COMMAND_BUDGETS_MS: Readonly<Partial<Record<CommandName, number>>> = {
  // a background job's `claude stop` and the registry's clearing after it, or a terminal pane's pause and resume
  'session.takeOver': Math.max(STOP_TIMEOUT_MS + TAKE_OVER_WAIT_MS, PANE_TAKE_OVER_MS) + MARGIN_MS,
  // a process still exiting, the configure gate, and the launch to ready (the watch fails one silent for WATCHDOG_MS;
  // a launch whose SessionStart hooks keep it reporting for longer answers `timeout` here and still becomes ready)
  'session.acquire': EXIT_WAIT_MS + CONFIGURE_WAIT_MS + WATCHDOG_MS + MARGIN_MS,
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
