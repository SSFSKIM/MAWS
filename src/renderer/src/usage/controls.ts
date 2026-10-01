// The usage popover's account actions (W6, E1): ClaudeUsage's Route requests here, Add, Reconnect and Remove (not Switch
// this Mac, which signs out running sessions). ClaudeUsage exposes no control route yet, and MAWS never writes its files
// (its relay rewrites pins.json from memory, r4-usage §4.3), so every action is unavailable, with one reason the popover
// shows once. When ClaudeUsage's relay answers a loopback control API (`GET /claudeusage/state`, `POST /claudeusage/route
// { uuid }`), `useUsageControls` returns actions that main runs through it; the popover renders whatever this layer
// answers and does not change.
import { USAGE } from '../accounts/copy';

export interface UsageControl<A> {
  available: boolean;
  run(arg: A): void;
}

export interface UsageControls {
  unavailable: string | null; // why the unavailable actions are, shown once; null when every action is available
  route: UsageControl<{ uuid: string }>;
  add: UsageControl<{ email: string | null }>;
  reconnect: UsageControl<{ uuid: string; email: string }>;
  remove: UsageControl<{ uuid: string; email: string }>;
}

const UNAVAILABLE: UsageControl<never> = { available: false, run: () => {} };

export const READ_ONLY_CONTROLS: UsageControls = { unavailable: USAGE.controlsUnavailable, route: UNAVAILABLE, add: UNAVAILABLE, reconnect: UNAVAILABLE, remove: UNAVAILABLE };

export function useUsageControls(): UsageControls {
  return READ_ONLY_CONTROLS;
}
