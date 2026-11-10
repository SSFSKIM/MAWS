// The repair window's controller (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M2 "Retrying",
// Interfaces §B), with no Electron: the window (./index.ts) brings the page, the opens and the quit. One attempt runs at a
// time and re-runs §A's table from the top. An attempt starts at the retry action, at the window's next focus after Open
// Login Items was used, and at a second launch of MAWS; no timer retries, since a kickstart every few seconds against a
// job the owner turned off is noise in their system log. The first attempt that succeeds hands its launch on, once.
import type { RepairAction, RepairState } from '@shared/repair';
import type { LaunchOutcome, LaunchShape, Unavailable } from '../hosts/daemon';

export interface RepairControllerDeps {
  first: Unavailable; // the launch's own failure
  packaged: boolean;
  attempt(): LaunchOutcome | Promise<LaunchOutcome>; // §A's table again, from the top
  readLog(): RepairState['log']; // read at every state change (./log-tail.ts)
  changed(state: RepairState): void; // to the page
  openLoginItems(): void;
  revealLog(path: string): void;
  quit(): void;
  succeeded(launch: LaunchShape): void;
}

export interface RepairController {
  state(): RepairState;
  act(action: RepairAction): void;
  focused(): void; // the window regained focus
  secondLaunch(): void; // a second launch of MAWS arrived
}

export function createRepairController(deps: RepairControllerDeps): RepairController {
  // Fix wave 1: the log is a diagnostic; a read that fails shows none, and the window shows either way
  const readLog = (): RepairState['log'] => {
    try {
      return deps.readLog();
    } catch {
      return null;
    }
  };
  let failure: Unavailable = deps.first;
  let attempting = false;
  let done = false;
  let focusRetries = false; // Open Login Items was used: the window's next focus tries once
  let current: RepairState = { kind: failure.kind, why: failure.why, packaged: deps.packaged, attempting, log: readLog() };

  const change = () => {
    current = { kind: failure.kind, why: failure.why, packaged: deps.packaged, attempting, log: readLog() };
    deps.changed(current);
  };
  const attempt = () => {
    if (done || attempting) return;
    attempting = true;
    change();
    let pending: Promise<LaunchOutcome>;
    try {
      pending = Promise.resolve(deps.attempt());
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.then(
      (outcome) => {
        attempting = false;
        if (outcome.ok) {
          done = true;
          deps.succeeded(outcome.launch);
          return;
        }
        failure = outcome.unavailable;
        change();
      },
      (error: unknown) => {
        attempting = false;
        failure = { kind: failure.kind, why: error instanceof Error ? error.message : String(error) };
        change();
      },
    );
  };

  return {
    state: () => current,
    act(action) {
      if (done) return;
      if (action === 'retry') return attempt();
      if (action === 'open-login-items') {
        focusRetries = true;
        return deps.openLoginItems();
      }
      if (action === 'reveal-log') {
        if (current.log) deps.revealLog(current.log.path);
        return;
      }
      deps.quit();
    },
    focused() {
      if (!focusRetries || done || attempting) return;
      focusRetries = false;
      attempt();
    },
    secondLaunch: attempt,
  };
}
