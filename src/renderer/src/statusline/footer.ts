// C11's seam in the usage popover's footer (C11's Ask of C7): routing facts, `Open ClaudeUsage`, Accounts, Switch…
// render where mockup 04 vignette 5 places `Open ClaudeUsage`, beside C7's `Updated <ago>`. One component at a time;
// the latest registration wins and its disposer removes only itself.
import type React from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';

export type UsagePopoverFooter = React.ComponentType<{ appSessionId: AppSessionId }>;

const useFooterStore = create<{ footer: UsagePopoverFooter | null }>()(() => ({ footer: null }));

export function registerUsagePopoverFooter(component: UsagePopoverFooter): () => void {
  useFooterStore.setState({ footer: component });
  return () => {
    if (useFooterStore.getState().footer === component) useFooterStore.setState({ footer: null });
  };
}

export const useUsagePopoverFooter = (): UsagePopoverFooter | null => useFooterStore((s) => s.footer);
