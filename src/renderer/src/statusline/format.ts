// The status line's time copy (C7 execution document, "Status line popovers and usage"; mockup 04 vignette 5): a
// window's reset countdown (`resets in 2h 37m` in popovers and banners, `↻2h37m` in the line) and a reading's age.
import type { UsageWindow } from '@shared/usage/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parts(ms: number): [string, string] | [string] | null {
  if (ms < MINUTE) return null;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return [`${days}d`, `${hours}h`];
  if (hours > 0) return [`${hours}h`, `${minutes}m`];
  return [`${minutes}m`];
}

export const resetsIn = (ms: number): string => parts(ms)?.join(' ') ?? 'under a minute';
export const resetsInCompact = (ms: number): string => parts(ms)?.join('') ?? '<1m';

export function ago(ms: number): string {
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

// What a window shows at `now`: once its reset time has passed, ClaudeUsage has not recorded the new window yet, so
// the value reads 0% with no countdown (the popover adds `no reading since the window reset`).
export function windowShown(window: UsageWindow, now: number): { percent: number; resetInMs: number | null; reset: boolean } {
  const resetInMs = Date.parse(window.resetsAt) - now;
  if (!(resetInMs > 0)) return { percent: 0, resetInMs: null, reset: true };
  return { percent: window.percent, resetInMs, reset: false };
}
