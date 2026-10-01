// A sidebar section heading (mockup 01 `.section-heading`): small caps text with room for the section's own controls
// beside it, outside the heading so its text stays the section's name.
import type { ReactNode } from 'react';

export function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mt-1.5 mb-0.5 flex h-[22px] items-center gap-1 pr-1 pl-2.5">
      <h2 className="m-0 flex min-w-0 items-center text-ui-sm font-semibold tracking-[0.08em] text-fg-muted uppercase">{title}</h2>
      {children && <div className="ml-auto flex items-center gap-0.5">{children}</div>}
    </div>
  );
}
