// `/resume` (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1; replacing C11's list of
// twenty): the resume chooser the sidebar's Resume… opens too, scoped to this session's project (owner decision 5; a
// session without one opens on every project) and listing the other sessions. Registered `library` (X19), so the
// widget dialog gives it the library box; Esc closes it and returns the keyboard to this session's composer.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { ResumeChooser } from '../resume/ResumeChooser';
import { rowOfSession, selectOrgIndex } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';

// P5 O6 M5: scoped to the session's sidebar row (its org project's, else its machine's own), as the row's Resume… is.
export function ResumeWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const projectId = useSessions((s) => s.records.get(appSessionId)?.projectId ?? null);
  const row = useSessions((s) => {
    const record = s.records.get(appSessionId);
    return record === undefined ? undefined : (rowOfSession(selectOrgIndex(s, ipc.localMachine), s.projects, record) ?? undefined);
  });
  const context = useMemo(() => ({ projectId, row, exclude: appSessionId }), [projectId, row, appSessionId]);
  return (
    <div data-widget="resume" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ResumeChooser context={context} close={close} />
    </div>
  );
}
