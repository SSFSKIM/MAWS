// `/resume` (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1; replacing C11's list of
// twenty): the resume chooser the sidebar's Resume… opens too, scoped to this session's project (owner decision 5; a
// session without one opens on every project) and listing the other sessions. Registered `library` (X19), so the
// widget dialog gives it the library box; Esc closes it and returns the keyboard to this session's composer.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ResumeChooser } from '../resume/ResumeChooser';
import { useSessions } from '../stores/sessions';

export function ResumeWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const projectId = useSessions((s) => s.records.get(appSessionId)?.projectId ?? null);
  const context = useMemo(() => ({ projectId, exclude: appSessionId }), [projectId, appSessionId]);
  return (
    <div data-widget="resume" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ResumeChooser context={context} close={close} />
    </div>
  );
}
