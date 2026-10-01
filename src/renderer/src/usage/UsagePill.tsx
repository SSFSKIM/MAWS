// The top bar's usage pill (W6, E1; charter §5.2 and D-17 as amended 2026-10-01), ClaudeUsage's status item in MAWS's
// own chrome (MenuBarLabelView.swift): a dot in the severity's colour and one bare number, the routing account's most
// binding percent (`usagePill`); dimmed while that account needs reauthentication; a muted `--` without ClaudeUsage's
// data. A click opens the popover, the copy of ClaudeUsage's panel (`UsagePanel`); Esc or a click outside closes it.
// The open state is a store so the menu's and palette's Usage action can open it too. Tokens only.
import { Popover } from 'radix-ui';
import { create } from 'zustand';
import { USAGE } from '../accounts/copy';
import { SEVERITY_BG } from '../accounts/LimitRow';
import { accountsViewModel, usagePill } from '../accounts/model';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useUsage } from '../stores/usage';
import { UsagePanel } from './UsagePanel';

export const useUsagePopover = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const CONTENT =
  'z-50 max-h-[min(700px,var(--radix-popover-content-available-height))] overflow-y-auto rounded-md border border-border-strong bg-bg-overlay shadow-float outline-none';

export function UsagePill() {
  const snapshot = useUsage((s) => s.snapshot);
  const open = useUsagePopover((s) => s.open);
  const now = useNow(POPOVER_TICK_MS); // a reset that passes changes the reading
  const pill = usagePill(snapshot ? accountsViewModel(snapshot, null, now) : null);
  const label =
    pill.percent !== null && pill.limit !== null && pill.account !== null ? USAGE.pill(pill.percent, pill.limit, pill.account) : pill.account !== null ? USAGE.pillNoReading(pill.account) : USAGE.pillNoData;

  return (
    <Popover.Root open={open} onOpenChange={(next) => useUsagePopover.getState().setOpen(next)}>
      <Popover.Trigger
        data-usage-pill={pill.percent ?? ''}
        data-severity={pill.severity ?? 'none'}
        aria-label={label}
        title={label}
        className="inline-flex h-6 items-center gap-[5px] rounded-sm px-2 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-expanded:bg-bg-active"
      >
        <span aria-hidden data-dot className={`size-[7px] shrink-0 rounded-full ${pill.severity === null ? 'bg-fg-muted' : SEVERITY_BG[pill.severity]} ${pill.dimmed ? 'opacity-50' : ''}`} />
        <span aria-hidden className={`font-medium tabular-nums ${pill.percent === null ? 'text-fg-muted' : 'text-fg'}`}>
          {pill.percent ?? '--'}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label={USAGE.title} side="bottom" align="end" sideOffset={4} collisionPadding={8} className={CONTENT}>
          <UsagePanel />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
