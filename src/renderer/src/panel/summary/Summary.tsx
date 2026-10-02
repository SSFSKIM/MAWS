// The resting card shown when no tab is selected (mockup 01's "Session overview", under rulings 2 and 5): Environment,
// Push state, Subagents, Background work and Sources, then the footer; with no session shown, the footer alone. The
// card holds the git watch on the session's directory for as long as it is mounted (a selected tab unmounts it, so a
// session with a tool open costs no watcher of the card's), and shows its sections once their persisted expansion is
// read, so a collapsed section never opens for a frame.
import { useEffect, type FunctionComponent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useGit } from '../../stores/git';
import { useSessions } from '../../stores/sessions';
import { useSummary } from '../../stores/summary';
import { COPY, SUMMARY_COPY } from '../copy';
import { BackgroundWork } from './BackgroundWork';
import { Environment } from './Environment';
import { PushState } from './PushState';
import { Sources } from './Sources';
import { Subagents } from './Subagents';
import { displayTitle } from '../../sessions/title';

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
      <PushState directory={directory} />
      <Subagents appSessionId={appSessionId} />
      <BackgroundWork appSessionId={appSessionId} />
      <Sources appSessionId={appSessionId} directory={directory} />
    </div>
  );
}
