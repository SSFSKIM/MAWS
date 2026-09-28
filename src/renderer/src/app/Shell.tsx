import type { ReactNode } from 'react';
import { Diagnostics } from './Diagnostics';

// The three regions of the shell at the mockups' widths. C5 builds the real regions (and their resizers) on the
// `data-region` elements; the top strip of each is the window's drag area under the hidden-inset title bar.
export function Shell() {
  return (
    <div className="grid h-full grid-cols-[var(--sidebar-w)_minmax(0,1fr)_var(--panel-w)] bg-bg text-fg">
      <Region name="sidebar" label="Sidebar" className="border-r border-border bg-bg-raised" />
      <Region name="main" label="Main">
        <Diagnostics />
      </Region>
      <Region name="panel" label="Panel" className="border-l border-border bg-bg-raised" />
    </div>
  );
}

function Region({ name, label, className = '', children }: { name: string; label: string; className?: string; children?: ReactNode }) {
  return (
    <section data-region={name} aria-label={label} className={`flex min-w-0 flex-col ${className}`}>
      <header className="flex h-(--toolbar-h) shrink-0 items-center justify-center text-ui-sm text-fg-faint [app-region:drag]">
        {label}
      </header>
      {children}
    </section>
  );
}
