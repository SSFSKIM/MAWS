import { useId, type ReactNode } from 'react';
import { ChevronDownIcon } from '../../app/IconButton';

// A card's fold, which is the layout store's (`cards.open`, UX wave U8b): remembered per device, across sessions and
// relaunches. `Summary.tsx` hands each card its own.
export interface CardFold { open: boolean; onToggle(): void }

// A disclosure mounts its detail only while open, so a folded card makes no read of its detail.
export function FloatingCard({ title, summary, open, onToggle, children }: { title: string; summary: ReactNode; children: ReactNode } & CardFold) {
  const contentId = useId();
  return (
    <section aria-label={title} className="shrink-0 overflow-hidden rounded-md border border-border bg-bg-raised text-ui text-fg shadow-strip">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={open ? contentId : undefined} onClick={onToggle} className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md px-3 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2">
          <span className="shrink-0 font-medium">{title}</span>
          <ChevronDownIcon className={`size-3 shrink-0 text-fg-muted ${open ? '' : '-rotate-90'}`} />
          <span className="ml-auto min-w-0 truncate text-ui-sm font-normal text-fg-muted">{summary}</span>
        </button>
      </h3>
      {open && <div id={contentId} className="flex min-w-0 flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}
