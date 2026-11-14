// Review's section of the resting summary (X5 `summary`; C8c execution document, *Notes to C8a*): Environment renders
// it in place of the host's change line while `git.status` has answered. The host's line plus the staged count, from
// C8a's git store alone (the summary card holds the watch; this reads it), and a click opens Review at the default
// scope. UX wave U8b (l5-code-16; a named insertion in U5's file): the line is drawn as the card's control, with a
// trailing "›", named "Open changes" with its counts as its description.
import { useId } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useWorkingFolder } from '../../../sessions/working-folder';
import { SUMMARY_COPY } from '../../../panel/copy';
import { changeLine } from '../../../panel/summary/derive';
import { actionClass } from '../../../panel/summary/Section';
import { checkoutKey, machineFor } from '../../../ipc/machine';
import { useGit } from '../../../stores/git';
import { REVIEW_COPY } from '../copy';
import type { ReviewParams } from './review-model';

export function ReviewSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: ReviewParams): void }) {
  const countsId = useId();
  const directory = useWorkingFolder(appSessionId)?.path ?? null;
  const entry = useGit((s) => (directory === null ? undefined : s.entries.get(checkoutKey(machineFor(appSessionId), directory))));
  if (!entry) return null;
  const line = changeLine(entry.status, entry.uncommitted?.files ?? null);
  const staged = entry.status?.files.filter((file) => !file.untracked && file.index !== '.').length ?? 0;
  return (
    <button type="button" aria-label={SUMMARY_COPY.openChanges} aria-describedby={countsId} onClick={() => open()} className={`${actionClass} flex w-full min-w-0 items-center gap-1 text-left`}>
      <span id={countsId} data-testid="change-line" className="min-w-0 flex-1 truncate text-fg-muted">
        {line.kind === 'clean' && SUMMARY_COPY.clean}
        {line.kind === 'unknown' && (entry.error ? SUMMARY_COPY.changeUnavailable : SUMMARY_COPY.pending)}
        {line.kind === 'change' && (
          <>
            <span className="text-success">+{line.insertions}</span> <span className="text-danger">−{line.deletions}</span> {SUMMARY_COPY.across(line.files)}
            {line.untracked > 0 && SUMMARY_COPY.untracked(line.untracked)}
            {line.binary > 0 && SUMMARY_COPY.binary(line.binary)}
            {staged > 0 && REVIEW_COPY.staged(staged)}
          </>
        )}
      </span>
      <span aria-hidden="true" className="shrink-0 text-fg-muted">›</span>
    </button>
  );
}
