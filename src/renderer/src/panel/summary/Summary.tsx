// UX2 D3/D4: four quiet, initially folded cards. The shell owns their placement, not a docked column.
import { useEffect, type FunctionComponent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useGit } from '../../stores/git';
import { useSessions } from '../../stores/sessions';
import { Artifacts } from './Artifacts';
import { Connectors } from './Connectors';
import { Context } from './Context';
import { Environment } from './Environment';

export interface SummaryProps {
  appSessionId: AppSessionId | null;
}

// Existing host API, also named for the shell's new floating placement. No position or full-height reservation:
// it fits a narrow viewport and scrolls within the available height the caller gives it.
export const FloatingSummary: FunctionComponent<SummaryProps> = ({ appSessionId }) => {
  const record = useSessions((s) => (appSessionId ? s.records.get(appSessionId) : undefined));
  if (!appSessionId || !record) return null;
  return <SessionSummary key={appSessionId} appSessionId={appSessionId} record={record} />;
};

export const Summary = FloatingSummary;

function SessionSummary({ appSessionId, record }: { appSessionId: AppSessionId; record: SessionRecord }) {
  const directory = record.worktree?.path ?? record.directory;
  useEffect(() => useGit.getState().watch(directory), [directory]);
  return (
    <div aria-label="Session cards" className="flex max-h-full w-70 max-w-full flex-col gap-1.5 overflow-y-auto p-1">
      <Environment appSessionId={appSessionId} record={record} directory={directory} />
      <Context appSessionId={appSessionId} directory={directory} />
      <Connectors appSessionId={appSessionId} />
      <Artifacts key={record.projectId ?? 'no-project'} projectId={record.projectId} />
    </div>
  );
}
