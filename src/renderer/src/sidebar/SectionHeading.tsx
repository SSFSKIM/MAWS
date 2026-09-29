// A sidebar section heading (mockup 01 `.section-heading`): small caps text, a disclosure when the section collapses
// (Pinned, Other sessions; Needs you never does, residue *Sidebar scale*), and room for the section's own controls
// beside it, outside the heading so its text stays the section's name.
import type { ReactNode } from 'react';
import { ChevronDownIcon } from '../app/IconButton';

export interface SectionHeadingProps {
  title: string;
  tone?: 'muted' | 'warning';
  collapse?: { expanded: boolean; onToggle(): void; controls: string };
  children?: ReactNode; // the section's controls, at the right
}

export function SectionHeading({ title, tone = 'muted', collapse, children }: SectionHeadingProps) {
  const text = `text-ui-sm font-semibold tracking-[0.08em] uppercase ${tone === 'warning' ? 'text-warning' : 'text-fg-muted'}`;
  return (
    <div className="mt-1.5 mb-0.5 flex h-[22px] items-center gap-1 pr-1 pl-2.5">
      <h2 className={`m-0 flex min-w-0 items-center ${text}`}>
        {collapse ? (
          <button
            type="button"
            aria-expanded={collapse.expanded}
            aria-controls={collapse.controls}
            onClick={collapse.onToggle}
            className={`-ml-1 flex items-center gap-1 rounded-sm px-1 outline-accent hover:text-fg focus-visible:outline-2 ${text}`}
          >
            {title}
            <ChevronDownIcon className={`size-[11px] ${collapse.expanded ? '' : '-rotate-90'}`} />
          </button>
        ) : (
          title
        )}
      </h2>
      {children && <div className="ml-auto flex items-center gap-0.5">{children}</div>}
    </div>
  );
}
