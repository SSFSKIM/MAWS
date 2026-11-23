// Review's section of the resting summary (X5 `summary`; C8c execution document, *Notes to C8a*): Environment renders
// it in place of the host's change line while `git.status` has answered. The host's line plus the staged count, from
// C8a's git store alone (the summary card holds the watch; this reads it), and a click opens Review at the default
// scope. UX wave U8b (l5-code-16; a named insertion in U5's file): the line is drawn as the card's control, with a
// trailing "›", named "Open changes" with its counts as its description. The word cut (P36, T364): the line reads
// "+12 −3 · 4 files", the untracked and binary counts its tooltip and part of its description; the staged count is gone.
import { useId } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useWorkingFolder } from '../../../sessions/working-folder';
import { SUMMARY_COPY } from '../../../panel/copy';
import { changeWords } from '../../../panel/summary/ChangeWords';
import { actionClass } from '../../../panel/summary/Section';
import { machineFor } from '../../../ipc/machine';
import { entryOf, useGit } from '../../../stores/git';
import { Tip } from '../../../ui/tip';
import type { ReviewParams } from './review-model';

export function ReviewSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: ReviewParams): void }) {
  const countsId = useId();
  const directory = useWorkingFolder(appSessionId)?.path ?? null;
  const entry = useGit((s) => entryOf(s, machineFor(appSessionId), directory));
  if (!entry) return null;
  const { words, uncounted } = changeWords(entry);
  return (
    <Tip content={uncounted} description={uncounted}>
      <button type="button" aria-label={SUMMARY_COPY.openChanges} aria-describedby={countsId} onClick={() => open()} className={`${actionClass} flex w-full min-w-0 items-center gap-1 text-left`}>
        <span id={countsId} data-testid="change-line" className="min-w-0 flex-1 truncate text-fg-muted">
          {words}
        </span>
        <span aria-hidden="true" className="shrink-0 text-fg-muted">›</span>
      </button>
    </Tip>
  );
}
