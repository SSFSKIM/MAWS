// The title bar's usage control (W6, E1; UX wave U7b, O-47): the ring in the `topBarEnd` slot, opening its compact
// popover, and the Usage action (View › Usage and the palette) that opens the same popover; while the Settings dialog
// is open, which would cover the popover, the action shows Settings › Usage instead (the U7b execution document, M7
// decision 5). The action keeps the retired Accounts tab's id, `accounts.open`, because the settings' keymap overrides
// are keyed by it. The whole panel is Settings › Usage's (`settings-tab/UsageSection.tsx`).
import { registerSlot } from '../app/slots';
import { registerAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useUsagePopover } from './popover';
import { UsageRing } from './UsageRing';

export { useUsagePopover } from './popover';
export { UsageRing } from './UsageRing';
export { UsagePanel } from './UsagePanel';
export { READ_ONLY_CONTROLS, useUsageControls, type UsageControl, type UsageControls } from './controls';

export function registerUsage(): () => void {
  registerSlot('topBarEnd', UsageRing);
  return registerAction('accounts.open', () => {
    const layout = useLayout.getState();
    if (layout.settings !== null) layout.openSettings('usage');
    else useUsagePopover.getState().setOpen(true);
  });
}
