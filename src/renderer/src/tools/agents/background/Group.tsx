// A Background tasks section (C8b execution document, M3): collapsible, its heading sticky (C8a's summary `Section`
// pattern, reimplemented because C8a's is under `panel/summary/` and not exported), with an optional muted suffix. The
// UX wave's U8b (M7): the sections are by state, Running, Scheduled, Tasks and Done, and a heading is a label in the
// heading's weight with its count and the parts after it muted (Interfaces §F), both inside the toggle, so the
// toggle's accessible name is the whole heading.
import type { ReactNode } from 'react';
import type { PanelHeading } from '../copy';

export type BackgroundSection = 'running' | 'scheduled' | 'tasks' | 'done';

export const headingText = (heading: PanelHeading): string => (heading.detail === null ? heading.label : `${heading.label} ${heading.detail}`);

// A heading's label and its muted detail, for the Subagents panel's sections too.
export function HeadingParts({ heading }: { heading: PanelHeading }) {
  return (
    <>
      {heading.label}
      {heading.detail !== null && (
        <>
          {' '}
          <span data-part="detail" className="font-normal text-fg-muted">
            {heading.detail}
          </span>
        </>
      )}
    </>
  );
}

// `suffix` renders muted beside the heading's toggle (the checklist's `session list`). E7: `action` sits at the heading's
// right end, sticky with it (the Tasks heading's `Open`), outside the `h3` so the heading's accessible name stays its
// own text; the `h3` keeps its toggle as its one button.
export function Group({
  id, heading, suffix, action, expanded, onToggle, children,
}: { id: BackgroundSection; heading: PanelHeading; suffix?: string | null; action?: ReactNode; expanded: boolean; onToggle: (id: BackgroundSection) => void; children: ReactNode }) {
  return (
    <section data-section={id} aria-label={headingText(heading)} className="flex shrink-0 flex-col border-b border-border pb-2 last:border-b-0">
      <div className="sticky top-0 z-10 flex h-9 items-center gap-1.5 bg-bg-raised px-3.5">
        <h3 className="flex min-w-0 items-center gap-1.5 text-ui font-semibold">
          <button type="button" aria-expanded={expanded} onClick={() => onToggle(id)} className="rounded-sm outline-accent focus-visible:outline-2">
            <HeadingParts heading={heading} />
          </button>
          {suffix && (
            <span data-part="label" className="text-ui-sm font-normal text-fg-muted">
              {suffix}
            </span>
          )}
        </h3>
        {action && (
          <span data-part="action" className="ml-auto flex">
            {action}
          </span>
        )}
      </div>
      {expanded && children}
    </section>
  );
}
