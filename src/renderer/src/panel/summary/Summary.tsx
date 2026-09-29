// The resting card shown when no tab is selected (mockup 01's "Session overview"). M1 reserves its place with the
// footer alone; M2 adds the sections above it (Environment, Push state, Subagents, Background work, Sources), which
// show only while a session is shown.
import type { FunctionComponent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { COPY } from '../copy';

export interface SummaryProps {
  appSessionId: AppSessionId | null;
}

export const Summary: FunctionComponent<SummaryProps> = () => (
  <div className="flex h-full flex-col overflow-auto">
    <p className="mt-auto px-4 py-3 text-ui-sm text-fg-muted">{COPY.footer}</p>
  </div>
);
