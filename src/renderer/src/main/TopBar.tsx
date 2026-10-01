// The top bar above the tab strip (§5.2 as amended 2026-10-01, W5): MAWS's own chrome across the main area. At its left
// the Overview button, which toggles the floating Overview and carries how many sessions wait on the human (the dock
// badge's count); at its right the `topBarEnd` slot, where W6 mounts the usage pill.
import { useChordHint } from '../app/IconButton';
import { useSlot } from '../app/slots';
import { selectNeedsYou, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';

export function TopBar() {
  const open = useLayout((s) => s.overviewOpen);
  const chord = useChordHint('tab.overview');
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const waiting = useAttention((s) => selectNeedsYou(s, { records, recordsVersion }).filter((row) => row.tier === 1).length);
  const End = useSlot('topBarEnd');

  return (
    <div data-top-bar className="flex h-(--topbar-h) shrink-0 items-center gap-1 border-b border-border bg-bg-raised px-1.5">
      <button
        type="button"
        aria-pressed={open}
        aria-label={waiting > 0 ? `Overview, ${waiting} waiting` : 'Overview'}
        title={chord ? `Overview · ${chord}` : 'Overview'}
        onClick={() => useLayout.getState().setOverviewOpen(!open)}
        className="inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg"
      >
        <BoardIcon />
        Overview
        {waiting > 0 && (
          <span aria-hidden className="text-warning tabular-nums">
            ◐{waiting}
          </span>
        )}
      </button>
      {/* W6 mounts the usage pill here */}
      <div data-top-bar-end className="ml-auto flex items-center">
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        <End />
      </div>
    </div>
  );
}

const BoardIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
    <rect x="2" y="2.5" width="5" height="5" rx="1" />
    <rect x="9" y="2.5" width="5" height="5" rx="1" />
    <rect x="2" y="9.5" width="5" height="4" rx="1" />
    <rect x="9" y="9.5" width="5" height="4" rx="1" />
  </svg>
);
