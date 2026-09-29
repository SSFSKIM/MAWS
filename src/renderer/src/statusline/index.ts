// The status line's public surface (C7 execution document, "Status line popovers and usage"): the app-wide connection
// (the shared ClaudeUsage read and the near-limit banner), C11's footer seam and banner rule, the session window
// selector, and the permission-mode menu the composer's Mode chip shares with the status line's mode popover.
import { connectUsage } from '../stores/usage';
import { connectNearLimitBanners } from './near-limit';

export { registerUsagePopoverFooter, type UsagePopoverFooter } from './footer';
export { nearLimitBanners, nearLimitWindows, thresholdFrom, bannerKey, type NearLimitBanner } from './near-limit';
export { windowsFor, useSessionWindows, type SessionWindows, type Windows } from '../stores/usage';
export { ModeMenu, useLiveModeBinding } from './ModeMenu';
export { liveModeBinding, nextMode, autoUnavailableReason, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING, type ModeBinding, type ModeOption } from './mode-menu';

// Mounted once from App.tsx: keeps the usage store live and posts the near-limit banners.
export function connectStatusLine(): () => void {
  const offs = [connectUsage(), connectNearLimitBanners()];
  return () => offs.forEach((off) => off());
}
