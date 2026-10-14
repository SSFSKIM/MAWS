// The resting card shown when no tab is selected (mockup 01's "Session overview", under rulings 2 and 5): Environment,
// Plugins while the session loaded any or a plugin pins a status line (R1, E8 D-9), Push state, Subagents, Background
// work and Sources, then the footer; with no session shown, the footer alone. The card holds the git watch on the session's directory for as long as it is
// mounted (a selected tab unmounts it, so a session with a tool open costs no watcher of the card's), and shows its
// sections once their persisted expansion is read, so a collapsed section never opens for a frame.
import { useEffect, type FunctionComponent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useGit } from '../../stores/git';
import { useSessions } from '../../stores/sessions';
import { useSummary } from '../../stores/summary';
import { COPY, SUMMARY_COPY } from '../copy';
import { BackgroundWork } from './BackgroundWork';
import { Environment } from './Environment';
import { Plugins } from './Plugins';
import { PushState } from './PushState';
import { Sources } from './Sources';
import { Subagents } from './Subagents';
import { displayTitle } from '../../sessions/title';
// E2 start
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { Section, ToolSummary, useToolSummary } from './Section';
// E2 end

export interface SummaryProps {
  appSessionId: AppSessionId | null;
}

export const Summary: FunctionComponent<SummaryProps> = ({ appSessionId }) => {
  const record = useSessions((s) => (appSessionId ? s.records.get(appSessionId) : undefined));
  return (
    <div className="flex h-full flex-col overflow-auto">
      {appSessionId && record ? (
        <>
          <SessionSummary appSessionId={appSessionId} record={record} />
          <p className="px-4 py-3 text-ui-sm text-fg-faint">{COPY.footer}</p>
        </>
      ) : (
        <p className="mt-auto px-4 py-3 text-ui-sm text-fg-muted">{COPY.footer}</p>
      )}
    </div>
  );
};

function SessionSummary({ appSessionId, record }: { appSessionId: AppSessionId; record: SessionRecord }) {
  const loaded = useSummary((s) => s.loaded);
  const directory = record.worktree?.path ?? record.directory;
  useEffect(() => void useSummary.getState().load(), []);
  useEffect(() => useGit.getState().watch(directory), [directory]);
  if (!loaded) return null;
  return (
    <div className="px-4 pt-3">
      <h2 className="flex items-baseline justify-between gap-3 pb-1 text-ui font-medium text-fg">
        {SUMMARY_COPY.title}
        <span className="min-w-0 truncate text-ui-sm font-normal text-fg-muted">{displayTitle(record)}</span>
      </h2>
      <Environment appSessionId={appSessionId} record={record} directory={directory} />
      <Plugins appSessionId={appSessionId} />
      <PushState directory={directory} appSessionId={appSessionId} />
      <Subagents appSessionId={appSessionId} />
      <BackgroundWork appSessionId={appSessionId} />
      <Sources appSessionId={appSessionId} directory={directory} />
      {/* E2 start */}
      <Artifacts appSessionId={appSessionId} />
      {/* E2 end */}
    </div>
  );
}

// E2 start: Artifacts (E2 execution document, Design §4 "The summary": Deliverables until P3-L's cutover), after
// Sources: the tool's own summary fills it; a build without the tool shows no section (there is nothing to open).
function Artifacts({ appSessionId }: { appSessionId: AppSessionId }) {
  const custom = useToolSummary(ARTIFACTS_TOOL_ID);
  if (!custom) return null;
  return (
    <Section id="artifacts">
      <ToolSummary toolId={ARTIFACTS_TOOL_ID} appSessionId={appSessionId} component={custom} />
    </Section>
  );
}
// E2 end
