// The top bar's usage control (W6, E1): the pill in W5's `topBarEnd` slot, opening the copy of ClaudeUsage's panel.
import { registerSlot } from '../app/slots';
import { UsagePill } from './UsagePill';

export { UsagePill, useUsagePopover } from './UsagePill';
export { UsagePanel } from './UsagePanel';
export { READ_ONLY_CONTROLS, useUsageControls, type UsageControl, type UsageControls } from './controls';

export function registerUsagePill(): void {
  registerSlot('topBarEnd', UsagePill);
}
