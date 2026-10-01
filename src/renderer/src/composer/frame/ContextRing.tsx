// The toolbar's context ring (W2, C3; §5.4 and §5.5 as amended 2026-10-01, after Claude Desktop's chin): how much of the
// model's window the session fills, from the digest's `get_context_usage` sample (C3 takes one at ready and after every
// turn), amber once it reaches the autocompact threshold. Its popover is the context window's own: the engine's full
// reading on open, the threshold, and Compact. Per session only: no account windows and no cost (those are the top
// bar's, W6, and Session info's). A session with no record yet has no ring.
import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ContextPopoverBody } from '../../statusline/ContextPopover';
import { tokens } from '../../statusline/format';
import { useSessions } from '../../stores/sessions';
import { CHIP } from './chip-style';

const CONTENT = 'z-50 w-80 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-md border border-border-strong bg-bg-overlay text-ui text-fg';
const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

type Context = { percent: number; maxTokens: number; autoCompactThreshold: number | null };

// The ring's words: the percent of the window, and whether the autocompact threshold is reached.
export function contextRingOf(context: Context | null): { percent: number | null; near: boolean; label: string } {
  if (!context) return { percent: null, near: false, label: 'Context window · no reading yet' };
  const percent = Math.max(0, Math.min(100, Math.round(context.percent)));
  const threshold = context.autoCompactThreshold;
  const near = threshold !== null && context.maxTokens > 0 && context.percent >= (threshold / context.maxTokens) * 100;
  return { percent, near, label: `Context window ${percent}% full of ${tokens(context.maxTokens)}${near ? ' · autocompacts soon' : ''}` };
}

export function ContextRing({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const context = useSessions((s) => s.digests.get(appSessionId)?.context ?? null);
  const [open, setOpen] = useState(false);
  if (!record) return null;
  const ring = contextRingOf(context);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={ring.label} title={ring.label} data-context-ring={ring.percent ?? ''} className={`${CHIP} size-7 justify-center`}>
        <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
          <circle cx="8" cy="8" r={R} fill="none" className="stroke-border-strong" strokeWidth="2" />
          {ring.percent !== null && ring.percent > 0 && (
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              className={ring.near ? 'stroke-warning' : 'stroke-fg-muted'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${(ring.percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            />
          )}
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Context window" side="top" align="end" sideOffset={6} collisionPadding={8} className={CONTENT}>
          <ContextPopoverBody record={record} close={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
