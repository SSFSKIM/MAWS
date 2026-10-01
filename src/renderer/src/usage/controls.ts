// The usage popover's account actions (W6, E1; W6 route executor): ClaudeUsage's Route requests here, Add, Reconnect and
// Remove (not Switch this Mac, which signs out running sessions), which main runs through ClaudeUsage's loopback control
// API (`settings.usageControls`, `settings.usageAction`). MAWS never writes ClaudeUsage's files (its relay rewrites
// pins.json from memory, r4-usage §4.3): an action is ClaudeUsage's to carry out, and C7's reader follows its files. The
// popover renders whatever `useUsageControls` answers and does not change. While the API does not answer, every action
// is unavailable under one hint, as before the API existed. Route and Remove ask in MAWS first, on the confirm sheet,
// which takes the focus and so closes the popover; it opens again on either answer. Add and Reconnect open ClaudeUsage's
// sign-in sheet and say so. A refusal's message is the popover's notice, shown in the hint's place while it is open.
// After a Route the popover shows the new routing account at once, from ClaudeUsage's answer, until the reader catches up
// (the usage store holds it over the snapshots until then, `applyRoute`).
import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { UsageAction, UsageActionResult, UsageControlsAnswer } from '@shared/ipc/schema';
import { USAGE } from '../accounts/copy';
import { ipc } from '../ipc/client';
import { confirm, type ConfirmRequest } from '../sessions/dialogs';
import { useUsage } from '../stores/usage';
import { useUsagePopover } from './popover';

export interface UsageControl<A> {
  available(arg: A): boolean; // per account: ClaudeUsage's own `canRoute`, `canReconnect` and `canRemove`
  run(arg: A): void;
}

export interface UsageControls {
  unavailable: string | null; // why the unavailable actions are, or the notice an action left, shown once; else null
  route: UsageControl<{ uuid: string }>;
  add: UsageControl<{ email: string | null }>;
  reconnect: UsageControl<{ uuid: string; email: string }>;
  remove: UsageControl<{ uuid: string; email: string }>;
}

const UNAVAILABLE: UsageControl<never> = { available: () => false, run: () => {} };

export const READ_ONLY_CONTROLS: UsageControls = { unavailable: USAGE.controlsUnavailable, route: UNAVAILABLE, add: UNAVAILABLE, reconnect: UNAVAILABLE, remove: UNAVAILABLE };

// What main last answered (null before its first answer), the notice the last action left, and whether one runs.
interface ControlState {
  answer: UsageControlsAnswer | null;
  notice: string | null;
  busy: boolean;
}

export const useUsageControlState = create<ControlState>()(() => ({ answer: null, notice: null, busy: false }));

const NOT_ANSWERED: UsageControlsAnswer = { available: false, reason: 'no_route', state: null };
let asks = 0;

// Main checks again (`settings.usageControls`) when the popover opens and on each usage change while it is open; the
// latest ask wins.
export async function refreshUsageControls(): Promise<void> {
  const ask = ++asks;
  const result = await ipc.invoke('settings.usageControls', undefined);
  if (!result.ok) console.warn('[usage] settings.usageControls failed', result.error);
  if (ask === asks) useUsageControlState.setState({ answer: result.ok ? result.value : NOT_ANSWERED });
}

// `started`: what the action says while it runs and after it succeeds; a refusal's message replaces it.
async function perform(action: UsageAction, started: string | null): Promise<UsageActionResult> {
  useUsageControlState.setState({ busy: true, notice: started });
  const result = await ipc.invoke('settings.usageAction', action);
  if (!result.ok) console.warn('[usage] settings.usageAction failed', result.error);
  const answer: UsageActionResult = result.ok ? result.value : { ok: false, reason: 'failed', message: result.error.message };
  useUsageControlState.setState({ busy: false, notice: answer.ok ? started : answer.message });
  void refreshUsageControls();
  return answer;
}

async function ask(request: ConfirmRequest): Promise<boolean> {
  const yes = await confirm(request);
  useUsagePopover.getState().setOpen(true);
  return yes;
}

const emailOf = (uuid: string) => useUsage.getState().snapshot?.accounts.find((a) => a.uuid === uuid)?.email ?? uuid;

async function route({ uuid }: { uuid: string }): Promise<void> {
  if (!(await ask({ title: USAGE.routeConfirm.title(emailOf(uuid)), body: USAGE.routeConfirm.body, confirmLabel: USAGE.route, destructive: false }))) return;
  const result = await perform({ action: 'route', uuid }, null);
  if (result.ok) useUsage.getState().applyRoute(result.drainTarget ?? uuid, result.drainTargetIsManual);
}

async function remove({ uuid, email }: { uuid: string; email: string }): Promise<void> {
  if (!(await ask({ title: USAGE.removeConfirm.title(email), body: USAGE.removeConfirm.body, confirmLabel: USAGE.removeConfirm.label, destructive: true }))) return;
  await perform({ action: 'remove', uuid, confirm: true }, null);
}

const RUN = {
  route: (arg: { uuid: string }) => void route(arg),
  add: ({ email }: { email: string | null }) => void perform({ action: 'add', email }, USAGE.signInAdd),
  reconnect: ({ uuid, email }: { uuid: string; email: string }) => void perform({ action: 'reconnect', uuid }, USAGE.signInReconnect(email)),
  remove: (arg: { uuid: string; email: string }) => void remove(arg),
};

const WHY: Partial<Record<NonNullable<UsageControlsAnswer['reason']>, string>> = { bad_token: USAGE.controlsBadToken, starting: USAGE.controlsStarting };

function controlsOf({ answer, notice, busy }: ControlState): UsageControls {
  if (answer === null || !answer.available) {
    const why = answer === null ? null : (WHY[answer.reason ?? 'no_route'] ?? USAGE.controlsUnavailable);
    return { ...READ_ONLY_CONTROLS, unavailable: notice ?? why };
  }
  const ready = answer.state?.routing.ready === true; // ClaudeUsage offers Route only while it routes Claude Code
  // ClaudeUsage's word on each account; an account its state does not name yet (the files ran ahead) is left to it
  const account = (uuid: string) => answer.state?.accounts.find((a) => a.uuid === uuid);
  return {
    unavailable: notice ?? (ready ? null : USAGE.routeNotReady),
    route: { available: ({ uuid }) => ready && !busy && account(uuid)?.canRoute !== false, run: RUN.route },
    add: { available: () => !busy, run: RUN.add },
    reconnect: { available: ({ uuid }) => !busy && account(uuid)?.canReconnect !== false, run: RUN.reconnect },
    remove: { available: ({ uuid }) => !busy && account(uuid)?.canRemove !== false, run: RUN.remove },
  };
}

export function useUsageControls(): UsageControls {
  const state = useUsageControlState(useShallow((s) => ({ answer: s.answer, notice: s.notice, busy: s.busy })));
  useEffect(() => {
    void refreshUsageControls();
    const off = ipc.on('settings.usageChanged', () => void refreshUsageControls());
    return () => {
      off();
      useUsageControlState.setState({ notice: null }); // a notice lasts while the popover showing it is open
    };
  }, []);
  return controlsOf(state);
}

// Open ClaudeUsage: its own panel through the control route while that answers; false when it did not open it. The
// route toggles the panel, so a toggle that hid it (it was already up) is asked once more.
export async function openClaudeUsagePanel(): Promise<boolean> {
  if (useUsageControlState.getState().answer?.available !== true) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await ipc.invoke('settings.usageAction', { action: 'panel' });
    if (!result.ok || !result.value.ok) break;
    if (result.value.shown !== false) return true;
  }
  void refreshUsageControls();
  return false;
}
