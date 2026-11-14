// The title bar's usage ring (UX wave U7b, O-47; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M7 decisions 1 to 3), in the `topBarEnd` slot at the title bar's own right end. ClaudeUsage's status item in MAWS's
// own chrome, drawn as Claude Desktop draws its usage ring (a 14 px circle of a 2 px stroke from twelve o'clock,
// readable/app-5.1231.2/web/app/v1/shared-8-BNzaQaMo.js:39281-39345): the arc is the routed account's most binding
// percent (`usagePill`), in MAWS's severity colours at ClaudeUsage's thresholds; a muted empty track with no reading;
// half opacity while that account must sign in again. No number: the tooltip and the accessible name carry today's
// sentence. A click opens the compact popover below it, at its right edge; the open state is a store, so the menu's and
// the palette's Usage action open it too. Tokens only.
import { Popover } from 'radix-ui';
import { useRef } from 'react';
import { USAGE } from '../accounts/copy';
import { accountsViewModel, usagePill, type Severity } from '../accounts/model';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useUsage } from '../stores/usage';
import { useUsagePopover } from './popover';
import { UsagePopover } from './UsagePopover';

const SIZE = 14;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;
const SEVERITY_STROKE: Record<Severity, string> = { normal: 'stroke-success', warning: 'stroke-warning', critical: 'stroke-danger' };
const CONTENT =
  'z-50 w-80 max-w-[var(--radix-popover-content-available-width)] max-h-[min(640px,var(--radix-popover-content-available-height))] overflow-y-auto rounded-md border border-border-strong bg-bg-overlay shadow-float outline-none';

export function UsageRing() {
  const snapshot = useUsage((s) => s.snapshot);
  const open = useUsagePopover((s) => s.open);
  const now = useNow(POPOVER_TICK_MS); // a reset that passes changes the reading
  const pill = usagePill(snapshot ? accountsViewModel(snapshot, null, now) : null);
  const label =
    pill.percent !== null && pill.limit !== null && pill.account !== null ? USAGE.pill(pill.percent, pill.limit, pill.account) : pill.account !== null ? USAGE.pillNoReading(pill.account) : USAGE.pillNoData;
  const setOpen = (next: boolean) => useUsagePopover.getState().setOpen(next);
  const trigger = useRef<HTMLButtonElement>(null);
  const percent = pill.percent === null ? null : Math.max(0, Math.min(100, pill.percent));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={trigger}
        data-usage-ring={pill.percent ?? ''}
        data-severity={pill.severity ?? 'none'}
        aria-label={label}
        title={label}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover focus-visible:outline-2 aria-expanded:bg-bg-active"
      >
        <svg aria-hidden viewBox={`0 0 ${SIZE} ${SIZE}`} className={`size-3.5 -rotate-90 ${pill.dimmed ? 'opacity-50' : ''}`}>
          <circle data-ring-track cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className={percent === null ? 'stroke-fg-muted' : 'stroke-border-strong'} />
          {percent !== null && percent > 0 && (
            <circle
              data-ring-arc
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
              className={SEVERITY_STROKE[pill.severity ?? 'normal']}
            />
          )}
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label={USAGE.popoverTitle} side="bottom" align="end" sideOffset={4} collisionPadding={8} className={CONTENT}>
          {/* The ring takes the keyboard before the popover closes: its link opens Settings, which remembers the element that
              holds the keyboard as the one to return to, and the link's button goes with the popover. */}
          <UsagePopover close={() => { trigger.current?.focus({ preventScroll: true }); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
