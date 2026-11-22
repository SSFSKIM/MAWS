// E4a (Task 3.3): the page's zoom (Design §4 "Zoom banner"; Codex's `browserSidebar.zoomBanner`). Main steps the factor
// through Chrome's presets and reads a pinch or ⌘-wheel in the page back into the tab, so the level follows either way.
// ⌘0 stays the Overview's (Design §4 "Keyboard"), so Reset is how zoom returns to 100%. The word cut (T444, T452): no
// banner row under the navigation row; while the page is not at 100% a chip in the navigation row shows the level and
// opens − Reset +, and Browser options' zoom is one row of the same steps, its level the reset. A step keeps its menu
// open, so the level can be stepped. In a chrome whose pane does not hold the view the level still shows and the steps
// are disabled: they would act on a page this surface does not show.
import { DropdownMenu } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { Tip } from '../../../ui/tip';
import { zoom } from '../actions';
import { BROWSER_COPY } from '../copy';

const STEP = 'flex h-7 min-w-7 cursor-default items-center justify-center rounded-sm px-1.5 tabular-nums outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';
const MENU = 'z-50 flex items-center gap-0.5 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';

// Browser options' trigger in the chip's navigation row.
const focusOptions = (from: Element | null) => from?.closest('[data-browser-nav]')?.querySelector<HTMLElement>('[data-browser-options]')?.focus({ preventScroll: true });

export const zoomPercent = (factor: number) => Math.round(factor * 100);

/** −, the reset (drawn as `reset`, named `resetName`) and +, as menu items that keep their menu open. */
export function ZoomSteps({ tab, enabled, reset, resetName }: { tab: BrowserTab | null; enabled: boolean; reset: ReactNode; resetName: string }) {
  const copy = BROWSER_COPY.menu;
  const on = enabled && tab !== null;
  const step = (action: 'in' | 'out' | 'reset') => (event: Event) => {
    event.preventDefault();
    if (tab) zoom(tab.tabId, action);
  };
  return (
    <>
      <DropdownMenu.Item aria-label={copy.zoomOut} disabled={!on} onSelect={step('out')} className={STEP}>
        −
      </DropdownMenu.Item>
      <DropdownMenu.Item aria-label={resetName} disabled={!on || tab?.zoom === 1} onSelect={step('reset')} className={STEP}>
        {reset}
      </DropdownMenu.Item>
      <DropdownMenu.Item aria-label={copy.zoomIn} disabled={!on} onSelect={step('in')} className={STEP}>
        +
      </DropdownMenu.Item>
    </>
  );
}

// Drawn while the page is not at 100%, and while its steps are open, so a step that reaches 100% (a Reset, or one step
// from 90% or 110%) keeps the open steps and their trigger in place; once they close at 100% the chip goes and focus
// moves to Browser options, the row's next stop that is always there. So does a focused chip whose page reaches 100%
// by another way (a pinch, a ⌘-wheel).
export function ZoomChip({ tab, owns }: { tab: BrowserTab; owns: boolean }) {
  const copy = BROWSER_COPY.zoom;
  const level = copy.level(zoomPercent(tab.zoom));
  const [open, setOpen] = useState(false);
  const slot = useRef<HTMLSpanElement>(null);
  const focused = useRef(false); // the chip itself holds focus
  const drawn = tab.zoom !== 1 || open;
  useLayoutEffect(() => {
    if (drawn || !focused.current) return;
    focused.current = false;
    focusOptions(slot.current);
  }, [drawn]);
  return (
    <span ref={slot} data-browser-zoom-slot="" className="contents">
      {drawn && (
        <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
          <Tip content={copy.label}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                data-browser-zoom=""
                aria-label={copy.chip(level)}
                onFocus={() => (focused.current = true)}
                onBlur={() => (focused.current = false)}
                className="h-6 shrink-0 rounded-sm px-1.5 text-ui-sm text-fg-muted tabular-nums outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
              >
                {level}
              </button>
            </DropdownMenu.Trigger>
          </Tip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                if (tab.zoom !== 1) return; // back to the chip
                event.preventDefault();
                focusOptions(slot.current);
              }}
              className={MENU}
            >
              <ZoomSteps tab={tab} enabled={owns} reset={copy.reset} resetName={BROWSER_COPY.menu.resetZoom} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </span>
  );
}
