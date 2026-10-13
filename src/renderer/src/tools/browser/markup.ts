// P3-G (§D4.1): the Browser tool's mark-up surface. A pane that holds its tab's view in the panel registers the page's
// element under its panel tab's scope; `begin` asks main for the still of the view (`browser.view.capture`) and then
// holds the window's cover, answering once main acknowledged it, so main hides the page behind its picture while the
// overlay draws over the still, and `end` lets the cover go (the page live again). The page itself is never touched. A
// main tab registers nothing (§H6).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import type { MawsBridge } from '@shared/ipc/schema';
import { registerMarkupSurface, type MarkupSurface } from '../../markup/surface';
import { ipc } from '../../ipc/client';
import { useEditorHostScope } from '../../panel/editor-host';
import { coverAcknowledged, holdCover } from './covering';

// The anchor's label: `"<title>" — <url>`, the title left out when the page has none.
export const browserMarkupLabel = ({ title, url }: Pick<BrowserTab, 'title' | 'url'>): string => (title.trim() === '' ? url : `"${title}" — ${url}`);

export function browserMarkupSurface(tabId: string, element: () => HTMLElement | null, label: () => string, client: MawsBridge = ipc): MarkupSurface {
  let release: (() => void) | null = null;
  return {
    element,
    label,
    begin: async () => {
      const result = await client.invoke('browser.view.capture', { tabId });
      if (!result.ok) console.warn(`[browser] the mark-up still was refused: ${result.error.message}`);
      const image = result.ok ? result.value.image : null;
      if (image !== null && release === null) {
        release = holdCover();
        await coverAcknowledged(); // the overlay draws once main has the cover request (the M4 review's ruling 4)
      }
      return image;
    },
    end: () => {
      release?.();
      release = null;
    },
  };
}

// Registered while `owns` (the pane holds the view) and the pane is in a panel tab. The scope is read by its tab id: the
// context's object is a new one on every render of the tool body, and re-registering would end a session drawing here.
export function useBrowserMarkupSurface(tab: BrowserTab, page: RefObject<HTMLElement | null>, owns: boolean): void {
  const scope = useEditorHostScope();
  const panelTab = scope?.surface === 'panel' ? scope.tabId : null;
  const latest = useRef(tab);
  useLayoutEffect(() => {
    latest.current = tab;
  });
  const { tabId } = tab;
  useEffect(() => {
    if (!owns || panelTab === null) return;
    return registerMarkupSurface(
      { surface: 'panel', tabId: panelTab },
      browserMarkupSurface(
        tabId,
        () => page.current,
        () => browserMarkupLabel(latest.current),
      ),
    );
  }, [owns, panelTab, tabId, page]);
}
