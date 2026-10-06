// A Background work section (C8b execution document, M3): collapsible, its heading sticky (C8a's summary `Section`
// pattern, reimplemented because C8a's is under `panel/summary/` and not exported), with an optional muted suffix.
import type { ReactNode } from 'react';

export type BackgroundSection = 'workflows' | 'shells' | 'monitors' | 'tasks';

// `suffix` renders muted beside the heading's toggle (the checklist's `session list`). E7: `action` sits at the heading's
// right end, sticky with it (the Tasks heading's `Open`), wrapped so the heading's own button stays its one direct
// button child.
export function Group({
  id, heading, suffix, action, expanded, onToggle, children,
}: { id: BackgroundSection; heading: string; suffix?: string | null; action?: ReactNode; expanded: boolean; onToggle: (id: BackgroundSection) => void; children: ReactNode }) {
  return (
    <section data-section={id} aria-label={heading} className="flex shrink-0 flex-col border-b border-border pb-2 last:border-b-0">
      <h3 className="sticky top-0 z-10 flex h-9 items-center gap-1.5 bg-bg-raised px-3.5 text-ui font-semibold">
        <button type="button" aria-expanded={expanded} onClick={() => onToggle(id)} className="rounded-sm outline-accent focus-visible:outline-2">
          {heading}
        </button>
        {suffix && (
          <span data-part="label" className="text-ui-sm font-normal text-fg-muted">
            {suffix}
          </span>
        )}
        {action && (
          <span data-part="action" className="ml-auto flex font-normal">
            {action}
          </span>
        )}
      </h3>
      {expanded && children}
    </section>
  );
}
