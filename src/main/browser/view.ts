// The browser's views (E4a execution document, Design §3): one `WebContentsView` per loaded tab, created in the tab's
// partition with the browser preload (sandboxed, isolated, no Node), and added to a window's contentView only when a pane
// places it.
import { join } from 'node:path';
import { WebContentsView } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import type { Partitions } from './partition';

// out/preload/browser.js beside the app window's out/preload/index.js (main is bundled into out/main/index.js).
export const BROWSER_PRELOAD = join(__dirname, '../preload/browser.js');

export function createTabView(partitions: Pick<Partitions, 'session'>, preload = BROWSER_PRELOAD): (tab: BrowserTab) => WebContentsView {
  return (tab) => {
    partitions.session(tab.partition); // prepared before its first page loads
    return new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: true,
      },
    });
  };
}
