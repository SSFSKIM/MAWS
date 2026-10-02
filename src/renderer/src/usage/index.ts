// The title-bar toolbar's usage control (W6, E1): the pill in W5's `topBarEnd` slot, opening the copy of ClaudeUsage's panel, and
// the Usage action (View › Usage and the palette) that opens the same popover. The action keeps the retired Accounts
// tab's id, `accounts.open`, because the settings' keymap overrides are keyed by it.
import { registerSlot } from '../app/slots';
import { registerAction } from '../keymap/actions-runtime';
import { UsagePill, useUsagePopover } from './UsagePill';

export { UsagePill, useUsagePopover } from './UsagePill';
export { UsagePanel } from './UsagePanel';
export { READ_ONLY_CONTROLS, useUsageControls, type UsageControl, type UsageControls } from './controls';

export function registerUsage(): () => void {
  registerSlot('topBarEnd', UsagePill);
  return registerAction('accounts.open', () => useUsagePopover.getState().setOpen(true));
}
