// A confirm sheet's Details (the owner's ruling of 2026-10-25, the Discover spec): the exact engine commands and the
// files they write, behind a disclosure closed at every opening, so the sheet leads with what the person decides on.
// The trigger is the summary panel's section button (panel/summary/Section.tsx: aria-expanded, aria-controls while
// the region is rendered, the chevron turned while closed); the body opens with the shared disclosure motion
// (ui/disclosure.tsx) and is a region named by the button.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '../../app/IconButton';
import { DisclosureBody } from '../../ui/disclosure';
import { PLUGIN_MANAGEMENT as W } from '../copy';

export function SheetDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useId();
  const region = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        id={button}
        type="button"
        data-plugins-details
        aria-expanded={open}
        aria-controls={open ? region : undefined}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2"
      >
        <ChevronDownIcon className={`size-3.5 ${open ? '' : '-rotate-90'}`} />
        {W.details}
      </button>
      <DisclosureBody open={open} id={region} role="region" aria-labelledby={button}>
        <div className="flex flex-col gap-3">{children}</div>
      </DisclosureBody>
    </div>
  );
}
