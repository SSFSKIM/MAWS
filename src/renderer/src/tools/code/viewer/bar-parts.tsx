// Two of the file tab's bar controls the word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M3 task 5) drew
// as marks in place of words:
// - `ViewMenu` (T305): the view's once-set setting, Wrap, a check item in a menu behind a sliders glyph named "View",
//   that word its accessible name and its tooltip, a tip the keyboard reaches (the shared `NamedGlyph`).
// - `ArrivalRing` (T324): a long file still arriving, a ring that fills as its pieces land, named by the wait's words
//   ("Loading 1.0 MB of 5.2 MB"); it takes Tab, and its two sizes are its tooltip and its description.
import { DropdownMenu } from 'radix-ui';
import { Icon } from '../../../app/IconButton';
import { NamedGlyph } from '../../../ui/glyph';
import { Tip } from '../../../ui/tip';
import { VIEWER_COPY } from '../copy';

// The glyph's look at the bar's height; open while its menu is (`aria-expanded`: the tooltip and the menu each set their
// own `data-state` on the one button, so that attribute says neither reliably)
const TRIGGER =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-expanded:bg-bg-active aria-expanded:text-fg';
const MENU = 'z-50 min-w-36 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';

const SlidersIcon = () => (
  <Icon className="size-3.5">
    <path d="M2.5 5h6.5M12.5 5h1M2.5 11h1M7 11h6.5" />
    <circle cx="10.75" cy="5" r="1.75" />
    <circle cx="5.25" cy="11" r="1.75" />
  </Icon>
);

export function ViewMenu({ wrap, onWrap }: { wrap: boolean; onWrap(on: boolean): void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <NamedGlyph label={VIEWER_COPY.view} data-file-view="" className={TRIGGER}>
          <SlidersIcon />
        </NamedGlyph>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <DropdownMenu.CheckboxItem checked={wrap} onCheckedChange={(on) => onWrap(on === true)} data-file-view-item="wrap" className={ITEM}>
            <span aria-hidden className="inline-flex size-3.5 shrink-0 items-center justify-center text-accent">
              <DropdownMenu.ItemIndicator>
                <Icon className="size-3.5">
                  <path d="M3.5 8.5l3 3 6-7" />
                </Icon>
              </DropdownMenu.ItemIndicator>
            </span>
            {VIEWER_COPY.wrap}
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ArrivalRing({ loaded, bytes, notice }: { loaded: number; bytes: number; notice: string }) {
  const fraction = bytes > 0 ? Math.min(1, loaded / bytes) : 0;
  const sizes = VIEWER_COPY.sizes(loaded, bytes);
  return (
    <Tip content={sizes} description={sizes}>
      <span
        role="progressbar"
        tabIndex={0}
        data-notice={notice}
        aria-label={notice}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="inline-flex shrink-0 items-center rounded-sm outline-accent focus-visible:outline-2"
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5 -rotate-90" fill="none" strokeWidth={1.5}>
          <circle cx="7" cy="7" r={RADIUS} className="stroke-border-strong" />
          <circle cx="7" cy="7" r={RADIUS} className="stroke-accent" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fraction)} />
        </svg>
      </span>
    </Tip>
  );
}
