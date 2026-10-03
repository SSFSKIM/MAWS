// What the status line left behind (C7 execution document, "Status line popovers and usage"; W2: the line itself is gone,
// §5.5 as amended 2026-10-01): the app-wide connection (the shared ClaudeUsage read), the
// session window selector, and the permission-mode menu the composer's Mode chip shows. The context
// popover's body is the toolbar's context ring's; the Direct `get_usage` poll runs from Session info.
import { connectUsage } from '../stores/usage';

export { windowsFor, useSessionWindows, type SessionWindows, type Windows } from '../stores/usage';
export { ModeMenu } from './ModeMenu';
export { liveModeBinding, nextMode, autoUnavailableReason, MODE_OPTIONS, MODE_REFUSAL_WORDS, NOT_RUNNING, type ModeBinding, type ModeOption } from './mode-menu';

// Mounted once from App.tsx: keeps the usage store live.
export function connectStatusLine(): () => void {
  return connectUsage();
}
