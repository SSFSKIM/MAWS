// E4a: the `browserTab` slot (X14): one of a session's browser tabs as a main tab, with the same chrome as the panel
// (its tab strip lists the session's tabs; Decision Log 17). It restores to the tab main kept, suspended, offering its
// last URL; a tab main no longer knows shows the session's browser headed "That tab was closed" (Decision Log 21).
import type { TabRef } from '@shared/ipc/schema/layout';
import { BrowserView } from './View';

export function BrowserTab({ tab }: { tab: Extract<TabRef, { kind: 'browser' }> }) {
  return <BrowserView appSessionId={tab.appSessionId} surface="main" browserTabId={tab.browserTabId} />;
}
