// Review's section of the resting summary (X5 `summary`; C8c execution document, *Notes to C8a*): Environment renders
// it in place of the host's change line while `git.status` has answered. The host's line plus the staged count, from
// C8a's git store alone (the summary card holds the watch; this reads it), and a click opens Review at the default
// scope.
import type { AppSessionId } from '@shared/graph/ids';
import { SUMMARY_COPY } from '../../../panel/copy';
import { changeLine } from '../../../panel/summary/derive';
import { useGit } from '../../../stores/git';
import { useSessions } from '../../../stores/sessions';
import { REVIEW_COPY } from '../copy';
import type { ReviewParams } from './review-model';

export function ReviewSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: ReviewParams): void }) {
  const directory = useSessions((s) => {
    const record = s.records.get(appSessionId);
    return record ? (record.worktree?.path ?? record.directory) : null;
  });
  const entry = useGit((s) => (directory === null ? undefined : s.entries.get(directory)));
  if (!entry) return null;
  const line = changeLine(entry.status, entry.uncommitted?.files ?? null);
  const staged = entry.status?.files.filter((file) => !file.untracked && file.index !== '.').length ?? 0;
  return (
    <button type="button" data-testid="change-line" onClick={() => open()} className="block w-full truncate rounded-sm text-left text-ui-sm text-fg-muted hover:text-fg">
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
    </button>
  );
}
