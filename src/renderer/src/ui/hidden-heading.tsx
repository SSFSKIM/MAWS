// The hidden heading (the word cut, "What the cut builds"): a heading cut from view because the tab or the sidebar row
// already names the place stays in the document for assistive technology, where it names and outlines the region.
import type { ReactNode } from 'react';

export function HiddenHeading({ level, id, children }: { level: 1 | 2 | 3 | 4 | 5 | 6; id?: string; children: ReactNode }) {
  const Heading = `h${level}` as const;
  return (
    <Heading id={id} className="sr-only">
      {children}
    </Heading>
  );
}
