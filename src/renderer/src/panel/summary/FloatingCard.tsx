import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '../../app/IconButton';

// A disclosure mounts its detail only on demand. These temporary cards start folded for each session;
// the old summary.sections preference remains untouched for tools that still use Section.
export function FloatingCard({ title, summary, children }: { title: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section aria-label={title} className="shrink-0 overflow-hidden rounded-md border border-border bg-bg-raised text-ui text-fg shadow-strip">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={open ? contentId : undefined} onClick={() => setOpen(!open)} className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md px-3 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2">
          <span className="shrink-0 font-medium">{title}</span>
          <ChevronDownIcon className={`size-3 shrink-0 text-fg-muted ${open ? '' : '-rotate-90'}`} />
          <span className="ml-auto min-w-0 truncate text-ui-sm font-normal text-fg-muted">{summary}</span>
        </button>
      </h3>
      {open && <div id={contentId} className="flex min-w-0 flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}
