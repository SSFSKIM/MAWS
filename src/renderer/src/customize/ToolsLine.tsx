// The tools of Customize's head, one line of them (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §D "The head"; the architect's ruling of 2026-11-15 on the tools line): the search, then the actions as one group, in
// reading order. While the tools share the Show choices' line the search keeps its width (14rem) and the tools stand at
// the line's right end; once they take a line of their own (./CustomizeHead.tsx gives them the whole of it) the search
// grows to fill that line and the actions stand at its right end; where the actions no longer fit beside the search at
// its width, the search takes the line and the actions go to the next one, from its left edge. Under the `customize`
// container's 24rem the search is the line's full width.
import type { ReactNode } from 'react';
import { SearchField } from '../widgets/plugins/LibraryHeader';

export function ToolsLine({ search, actions }: { search: { label: string; value: string; onChange(value: string): void }; actions: ReactNode }) {
  return (
    <span data-customize-tools-line className="flex min-w-0 grow flex-wrap items-center gap-1">
      {/* its width is its basis: it grows with the line it stands on, and wraps the actions away before it shrinks */}
      <SearchField label={search.label} value={search.value} onChange={search.onChange} className="grow @max-sm/customize:w-full" />
      <span data-customize-actions className="flex min-w-0 flex-wrap items-center gap-1">
        {actions}
      </span>
    </span>
  );
}
