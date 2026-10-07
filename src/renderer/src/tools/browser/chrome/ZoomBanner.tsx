// E4a (Task 3.3): the zoom banner (Design §4 "Zoom banner"; Codex's `browserSidebar.zoomBanner`): present while the page
// is not at 100%, with the level and Codex's three words. Main steps the factor through Chrome's presets and reads a
// pinch or ⌘-wheel in the page back into the tab, so the banner follows either way. ⌘0 stays the Overview's (Design §4
// "Keyboard"), so Reset is how zoom returns to 100%. In a chrome whose pane does not hold the view the level still shows
// and the buttons are disabled, as the overflow menu's zoom items are: they would act on a page this surface does not show.
import type { BrowserTab } from '@shared/browser/tab';
import { zoom } from '../actions';
import { BROWSER_COPY } from '../copy';

const BUTTON = 'h-6 rounded-sm px-2 text-ui-sm text-fg-muted outline-accent enabled:hover:bg-bg-hover enabled:hover:text-fg focus-visible:outline-2 disabled:text-fg-faint';

export const zoomPercent = (factor: number) => Math.round(factor * 100);

export function ZoomBanner({ tab, owns }: { tab: BrowserTab; owns: boolean }) {
  const copy = BROWSER_COPY.zoom;
  return (
    <div role="group" aria-label={copy.label} data-browser-zoom="" className="flex h-8 shrink-0 items-center gap-1 border-t border-border px-2">
      <span className="min-w-0 flex-1 truncate text-ui-sm text-fg">{copy.level(zoomPercent(tab.zoom))}</span>
      <button type="button" className={BUTTON} disabled={!owns} onClick={() => zoom(tab.tabId, 'out')}>
        {copy.out}
      </button>
      <button type="button" className={BUTTON} disabled={!owns} onClick={() => zoom(tab.tabId, 'in')}>
        {copy.in}
      </button>
      <button type="button" className={BUTTON} disabled={!owns} onClick={() => zoom(tab.tabId, 'reset')}>
        {copy.reset}
      </button>
    </div>
  );
}
