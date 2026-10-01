// What the status line left behind (C7 execution document, "Status line popovers and usage"; W2: the line itself is gone,
// §5.5 as amended 2026-10-01): the app-wide connection (the shared ClaudeUsage read and the near-limit banner), the
// banner rule, the session window selector, and the permission-mode menu the composer's Mode chip shows. The context
// popover's body is the toolbar's context ring's; the Direct `get_usage` poll runs from Session info.
import { connectUsage } from '../stores/usage';
import { connectNearLimitBanners } from './near-limit';

export { nearLimitBanners, nearLimitWindows, thresholdFrom, bannerKey, type NearLimitBanner } from './near-limit';
export { windowsFor, useSessionWindows, type SessionWindows, type Windows } from '../stores/usage';
export { ModeMenu } from './ModeMenu';
export { liveModeBinding, nextMode, autoUnavailableReason, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING, type ModeBinding, type ModeOption } from './mode-menu';

// Mounted once from App.tsx: keeps the usage store live and posts the near-limit banners.
export function connectStatusLine(): () => void {
  const offs = [connectUsage(), connectNearLimitBanners()];
  return () => offs.forEach((off) => off());
}
