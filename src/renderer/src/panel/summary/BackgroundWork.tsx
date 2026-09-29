// Background work (C8 spec *The summary*): a live session's background tasks by kind (agents are Subagents'); a
// disk-only session's workflow runs from `fs.workflows` (refetched on `fs.workflowChanged`, connectPanelEvents) with the
// sentence that shells and monitors are known only while the session runs here, which alone remains when the read
// fails. "Open" opens the Background work tool; a registered one's own summary replaces this baseline.
import type { AppSessionId } from '@shared/graph/ids';
import { useCommand } from '../../ipc/query';
import { useSessions } from '../../stores/sessions';
import { SUMMARY_COPY } from '../copy';
import { backgroundCounts } from './derive';
import { Row, Section, ToolButton, ToolSummary, useToolSummary } from './Section';

export function BackgroundWork({ appSessionId }: { appSessionId: AppSessionId }) {
  const custom = useToolSummary('background');
  const tasks = useSessions((s) => s.engine.get(appSessionId)?.backgroundTasks);
  const open = <ToolButton toolId="background" label={SUMMARY_COPY.open} appSessionId={appSessionId} />;
  return (
    <Section id="background">
      {custom ? (
        <ToolSummary toolId="background" appSessionId={appSessionId} component={custom} />
      ) : tasks ? (
        <Row action={open}>
          <span className="block truncate">{SUMMARY_COPY.background(backgroundCounts(tasks))}</span>
        </Row>
      ) : (
        <Row action={open}>
          <DiskOnly appSessionId={appSessionId} />
        </Row>
      )}
    </Section>
  );
}

function DiskOnly({ appSessionId }: { appSessionId: AppSessionId }) {
  const runs = useCommand('fs.workflows', { appSessionId });
  return (
    <div className="flex flex-col gap-0.5">
      {runs.data && <span>{SUMMARY_COPY.runsOnDisk(runs.data.runs.length)}</span>}
      <span className="text-ui-sm text-fg-muted">{SUMMARY_COPY.shellsUnavailable}</span>
    </div>
  );
}
