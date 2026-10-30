// The spine's commands that run past a host request's 10 s (the panel's sweep#3): each keeps a budget that covers its
// own named waits, so main's `machine` binding does not answer `timeout` while mawsd goes on to finish it.
import { describe, expect, it } from 'vitest';
import { REQUEST_TIMEOUT_MS } from '@shared/host/host-supervisor';
import { REGISTRY } from '@shared/ipc/registry';
import { COMMAND_BUDGETS_MS } from './command-budgets';
import { GIT_TIMEOUT_MS } from './git/runner';
import { BRIDGE_SLACK_MS, LANE_A_TIMING } from './lane-a/driver';
import { CONFIGURE_WAIT_MS } from './settings/engine-configure';
import { EXIT_WAIT_MS, WATCHDOG_MS } from './sessions/context';
import { CLEAR_WAIT_MS, PAUSE_WAIT_MS } from './sessions/pause-take-over';
import { PAUSED_READY_MS } from './sessions/resume';
import { STOP_TIMEOUT_MS, TAKE_OVER_WAIT_MS } from './sessions/take-over';

describe('the spine’s command budgets', () => {
  it('a take-over covers `claude stop` and the registry’s wait after it, and a pane’s pause and resume', () => {
    expect(COMMAND_BUDGETS_MS['session.takeOver']).toBeGreaterThan(STOP_TIMEOUT_MS + TAKE_OVER_WAIT_MS);
    expect(COMMAND_BUDGETS_MS['session.takeOver']).toBeGreaterThan(PAUSE_WAIT_MS + CONFIGURE_WAIT_MS + 2 * PAUSED_READY_MS + CLEAR_WAIT_MS);
  });

  it('an acquisition covers an exiting process’s wait, the configure gate and a launch to ready', () => {
    expect(COMMAND_BUDGETS_MS['session.acquire']).toBeGreaterThan(EXIT_WAIT_MS + CONFIGURE_WAIT_MS + WATCHDOG_MS);
  });

  it('the engine settings’ verdict, and lane A’s bridge commands, cover their own waits', () => {
    expect(COMMAND_BUDGETS_MS['settings.engineApplied']).toBeGreaterThan(CONFIGURE_WAIT_MS);
    for (const name of ['laneA.interrupt', 'laneA.command', 'laneA.btw', 'laneA.compact', 'laneA.stopAgent', 'laneA.tell', 'laneA.read', 'laneA.stopTask'] as const) {
      expect(COMMAND_BUDGETS_MS[name], name).toBeGreaterThan(LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS);
    }
    expect(COMMAND_BUDGETS_MS['laneA.answer']).toBeGreaterThan(LANE_A_TIMING.requestMs + LANE_A_TIMING.decisionMs);
    expect(COMMAND_BUDGETS_MS['laneA.model']).toBeGreaterThan(2 * (LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS));
    expect(COMMAND_BUDGETS_MS['laneA.media']).toBeGreaterThan(4 * (LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS) + GIT_TIMEOUT_MS + 1_000 + 3_000);
  });

  it('names only machine-owned commands, each budgeted past the default it replaces', () => {
    for (const [name, budget] of Object.entries(COMMAND_BUDGETS_MS)) {
      expect(REGISTRY.commands[name as keyof typeof REGISTRY.commands]?.owner, name).toBe('machine');
      expect(budget, name).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    }
  });
});
