// The stack's toolbar (UX wave U5b, M3; the execution document's §F): the totals, the unsent-comments chip's place (the
// card host, M5), Collapse all, the hunk counter with ↑ and ↓, and one menu, View, holding Unified, Split and Wrap,
// which are the stack's. It wraps by measure, not by a width (D1): one line when everything fits; otherwise the totals
// on the first line and the controls on the next, the chip beside the totals while it fits there and on a line of its
// own when it does not; the counter shortens to "n of m" last, where "Showing hunk n of m" does not fit the controls'
// line. Card 1 ("Wrap, drop scope word", the owner's answer at its recommended option) is built here and in
// `totalsWords`: the second answer would be one edit of `totalsWords`.
import { DropdownMenu } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { REVIEW_COPY } from '../copy';
import { reviewLayout } from './measure';
import type { ReviewMode } from './view-state';

// The totals' words (card 1): without the scope's name, which the pressed chip directly above them says. UX wave U5b-2
// (§I): then the new files whose lines are not counted, where there are any (when that is said: its caller in ReviewShell).
export const totalsWords = (sum: { files: number; added: number; removed: number }, uncounted = 0): string =>
  `${REVIEW_COPY.totals(sum.files, sum.added, sum.removed)}${uncounted > 0 ? REVIEW_COPY.uncounted(uncounted) : ''}`;

// The gap between the toolbar's parts (`gap-x-2`).
const GAP = 8;

// How the toolbar lays its parts out, from their natural widths and its room (all 0 before a layout: one line).
export interface ToolbarWidths {
  room: number;
  totals: number;
  chip: number; // 0: no chip
  collapse: number;
  nav: number; // the counter (in the form drawn), ↑, ↓ and View
  counterShown: number; // the counter as drawn
  counterLong: number; // "Showing hunk n of m"
  counterShort: number; // "n of m"
}
export interface ToolbarFit {
  lines: 1 | 2 | 3; // 2: the totals (and the chip), then the controls; 3: the totals, the chip, the controls
  counter: 'long' | 'short';
}

export function toolbarFit(w: ToolbarWidths): ToolbarFit {
  if (w.room <= 0) return { lines: 1, counter: 'long' };
  const navLong = w.nav - w.counterShown + w.counterLong;
  const controls = w.collapse + GAP + navLong;
  const head = w.totals + (w.chip > 0 ? GAP + w.chip : 0);
  if (head + GAP + controls <= w.room) return { lines: 1, counter: 'long' };
  return { lines: w.chip > 0 && head > w.room ? 3 : 2, counter: controls <= w.room ? 'long' : 'short' };
}

const sameFit = (a: ToolbarFit, b: ToolbarFit) => a.lines === b.lines && a.counter === b.counter;

const quiet = 'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
const MENU = 'z-50 min-w-40 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';
const LINE_BREAK = 'h-0 basis-full';

export interface ToolbarProps {
  totals: string; // `totalsWords`
  chip?: ReactNode; // the card host's chip and place line (M5)
  allFolded: boolean; // the button reads Expand all
  onFoldAll(): void;
  counter: { index: number; count: number } | null; // `index` 0-based; null while no hunk is loaded: no counter, no arrows
  onHunk(index: number): void;
  mode: ReviewMode; // the stored choice
  splitRoom: boolean; // the stack is wide enough for Split
  onMode(mode: ReviewMode): void;
  wrap: boolean;
  onWrap(): void;
}

export function Toolbar({ totals, chip, allFolded, onFoldAll, counter, onHunk, mode, splitRoom, onMode, wrap, onWrap }: ToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<ToolbarFit>({ lines: 1, counter: 'long' });
  const hasChip = chip !== undefined && chip !== null;
  const long = counter ? REVIEW_COPY.hunkOf(counter.index + 1, counter.count) : '';
  const short = counter ? REVIEW_COPY.hunkOfShort(counter.index + 1, counter.count) : '';

  // Measured at every change of what the parts say and of the room or a part's size (a chip that appears or grows).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const part = (selector: string) => {
      const found = el.querySelector(selector);
      return found ? reviewLayout.width(found) : 0;
    };
    const measure = () => {
      const next = toolbarFit({
        room: reviewLayout.contentWidth(el), // inside its padding and border
        totals: part('[data-review-header]'),
        chip: part('[data-review-toolbar-chip]'),
        collapse: part('[data-review-collapse]'),
        nav: part('[data-review-nav]'),
        counterShown: part('[data-review-hunk]'),
        counterLong: part('[data-review-counter="long"]'),
        counterShort: part('[data-review-counter="short"]'),
      });
      setFit((prev) => (sameFit(prev, next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const selector of ['[data-review-header]', '[data-review-toolbar-chip]']) {
      const found = el.querySelector(selector);
      if (found) observer.observe(found);
    }
    return () => observer.disconnect();
  }, [totals, hasChip, long, allFolded]);

  const drawn: ReviewMode = mode === 'split' && splitRoom ? 'split' : 'unified';
  return (
    <div ref={root} data-review-toolbar data-lines={fit.lines} className="relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
      <p data-review-header className="m-0 min-w-0 max-w-full truncate text-ui font-medium text-fg">
        {totals}
      </p>
      {fit.lines === 3 && <div aria-hidden className={LINE_BREAK} />}
      {hasChip && (
        <div data-review-toolbar-chip className="flex min-w-0 max-w-full shrink-0 items-center">
          {chip}
        </div>
      )}
      {fit.lines > 1 && <div aria-hidden className={LINE_BREAK} />}
      <button type="button" data-review-collapse className={`${quiet} ${fit.lines === 1 ? 'ml-auto' : ''}`} onClick={onFoldAll}>
        {allFolded ? REVIEW_COPY.expandAll : REVIEW_COPY.collapseAll}
      </button>
      <div data-review-nav className={`flex shrink-0 items-center gap-1 ${fit.lines === 1 ? '' : 'ml-auto'}`}>
        {counter && (
          <>
            <span data-review-hunk className="whitespace-nowrap text-ui-sm text-fg-muted">
              {fit.counter === 'long' ? long : short}
            </span>
            <button type="button" className={quiet} aria-label={REVIEW_COPY.previousHunk} title={REVIEW_COPY.previousHunk} disabled={counter.index === 0} onClick={() => onHunk(counter.index - 1)}>
              ↑
            </button>
            <button type="button" className={quiet} aria-label={REVIEW_COPY.nextHunk} title={REVIEW_COPY.nextHunk} disabled={counter.index >= counter.count - 1} onClick={() => onHunk(counter.index + 1)}>
              ↓
            </button>
          </>
        )}
        <ViewMenu drawn={drawn} splitRoom={splitRoom} onMode={onMode} wrap={wrap} onWrap={onWrap} />
      </div>
      {counter && (
        <>
          <span aria-hidden data-review-counter="long" className="invisible absolute top-0 left-0 whitespace-nowrap text-ui-sm">
            {long}
          </span>
          <span aria-hidden data-review-counter="short" className="invisible absolute top-0 left-0 whitespace-nowrap text-ui-sm">
            {short}
          </span>
        </>
      )}
    </div>
  );
}

// Unified, Split and Wrap: the stack's, so they apply to every section. The radio reads what is drawn: Unified where the
// stack is too narrow for Split, whose item is then disabled with its reason (D9); the stored choice is not changed.
function ViewMenu({ drawn, splitRoom, onMode, wrap, onWrap }: { drawn: ReviewMode; splitRoom: boolean; onMode(mode: ReviewMode): void; wrap: boolean; onWrap(): void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-review-view className={`${quiet} gap-1 data-[state=open]:bg-bg-active`}>
          {REVIEW_COPY.view}
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <DropdownMenu.RadioGroup value={drawn} onValueChange={(value) => onMode(value === 'split' ? 'split' : 'unified')}>
            <DropdownMenu.RadioItem value="unified" data-review-view-item="unified" className={ITEM}>
              <Check />
              {REVIEW_COPY.unified}
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="split" data-review-view-item="split" disabled={!splitRoom} title={splitRoom ? undefined : REVIEW_COPY.splitNeedsRoom} className={ITEM}>
              <Check />
              {REVIEW_COPY.split}
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.CheckboxItem checked={wrap} onCheckedChange={() => onWrap()} data-review-view-item="wrap" className={ITEM}>
            <Check />
            {REVIEW_COPY.wrap}
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Check() {
  return (
    <span aria-hidden className="inline-flex size-3.5 shrink-0 items-center justify-center text-accent">
      <DropdownMenu.ItemIndicator>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </DropdownMenu.ItemIndicator>
    </span>
  );
}
