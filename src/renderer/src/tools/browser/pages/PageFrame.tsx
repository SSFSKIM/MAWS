// E4a: the frame every renderer-drawn page in the pane shares (Design §4 and §5): Codex's error-page layout (a column of
// at most 600 px, a fifth of the way down, heading, summary, then what the page offers) drawn in the app's tokens so it
// follows the theme. The page's view is hidden while one of these shows.
import type { ReactNode } from 'react';

export const PAGE_BUTTON =
  'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
export const PAGE_PRIMARY_BUTTON = 'max-w-full truncate rounded-sm bg-accent px-2.5 py-1 text-ui-sm text-bg outline-accent hover:opacity-90 focus-visible:outline-2';

export function PageFrame({ page, heading, summary, children }: { page: string; heading: ReactNode; summary?: ReactNode; children?: ReactNode }) {
  return (
    <div data-browser-page={page} className="absolute inset-0 overflow-auto bg-bg">
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3 px-6 pt-[20vh] pb-8 text-ui text-fg-muted">
        <h2 className="m-0 text-prose font-medium text-fg">{heading}</h2>
        {summary !== undefined && <p className="m-0 break-words">{summary}</p>}
        {children}
      </div>
    </div>
  );
}
