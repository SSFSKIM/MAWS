// The page's context menu gains Comment (E4d execution document, Design §7; Decision Log 16): a one-shot pick at the
// point the person right-clicked, with no mode to arm, since they have already pointed at the element. Registered
// through E4a's `registerContextMenuExtras`, consulted per right-click with the tab as it is at popup time.
import { COMMENT_WORDS } from '@shared/browser/comment-protocol';
import type { ContextMenuExtra } from '../context-menu';

// `pickAt` takes CSS px of the viewport; Electron's `params.x/y` are the view's DIP, which the page's zoom scales.
export function commentMenuExtra(pickAt: (tabId: string, x: number, y: number) => void): ContextMenuExtra {
  return (params, tab) => [
    {
      label: COMMENT_WORDS.menu,
      enabled: tab.control !== 'agent' && !tab.suspended && tab.loadError === null && tab.crashed === null,
      click: () => pickAt(tab.tabId, params.x / tab.zoom, params.y / tab.zoom),
    },
  ];
}
