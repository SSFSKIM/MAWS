// The status line's time copy (C7 execution document, "Status line popovers and usage"; mockup 04 vignette 5): a
// window's reset countdown (`resets in 2h 37m` in popovers and banners, `↻2h37m` in the line) and a reading's age.
import type { UsageWindow } from '@shared/usage/types';
import { dateFormats, formatAgo } from '@shared/app/date-format';

// A token count as the status line and the context popover write it: `412`, `46k`, `1.2M`.
export const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The countdown's numbers and units are the display locale's, compact (2h 37m; `@shared/app/date-format`). Under a
// minute it reads as the other sub-minute forms do (<1m), never in words (P3-F L125).
function parts(ms: number): [string, string] | [string] | null {
  if (ms < MINUTE) return null;
  const { amount } = dateFormats();
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return [amount(days, 'day'), amount(hours, 'hour')];
  if (hours > 0) return [amount(hours, 'hour'), amount(minutes, 'minute')];
  return [amount(minutes, 'minute')];
}

const underAMinute = () => `<${dateFormats().amount(1, 'minute')}`;
export const resetsIn = (ms: number): string => parts(ms)?.join(' ') ?? underAMinute();
export const resetsInCompact = (ms: number): string => parts(ms)?.join('') ?? underAMinute();

// A reading's age, compact and in the display locale (`@shared/app/date-format`): "3m ago"; "now" under a minute.
export const ago = (ms: number): string => formatAgo(ms, { narrow: true });

// What a window shows at `now`: once its reset time has passed, ClaudeUsage has not recorded the new window yet, so
// the value reads 0% with no countdown (the popover adds `no reading since the window reset`).
export function windowShown(window: UsageWindow, now: number): { percent: number; resetInMs: number | null; reset: boolean } {
  const resetInMs = Date.parse(window.resetsAt) - now;
  if (!(resetInMs > 0)) return { percent: 0, resetInMs: null, reset: true };
  return { percent: window.percent, resetInMs, reset: false };
}
