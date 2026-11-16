// The one act that opens a commit in Review (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// M9 and §H; decision 28): the panel's Review on that commit, its chip listed and pressed, and, given a file, that file's
// section brought into view. The transcript's chip of a comment that names a commit calls it (registered from App.tsx as
// the transcript's `openCommit`), and so does a commit's row on Source control's page.
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost } from '../../../panel/host';
import type { TranscriptActions } from '../../../transcript';
import { REVIEW_TOOL_ID } from './ReviewTool';

/** `commit`: a whole object id; `path`: the file as that commit's diff names it, relative to the repository. */
export function openCommit(appSessionId: AppSessionId, commit: string, path?: string): void {
  panelHost.addTool(REVIEW_TOOL_ID, { appSessionId, params: { scope: 'commit', commit, ...(path ? { path } : {}) } });
}

// How a commit's short hash is drawn where it can be pressed (UX wave U5b-2, Decision Log 37): mono, as the commit list
// draws it; the row under Review's toolbar uses it for a commit's comment, and M10's commit list is to share it.
export const COMMIT_HASH_BUTTON =
  'rounded-sm font-mono text-fg underline decoration-border underline-offset-2 outline-accent hover:decoration-fg focus-visible:outline-2';

// What Review's folder registers with the transcript (App.tsx's C8c block): the chip of a commit's comment opens it.
export const reviewTranscriptActions: Pick<TranscriptActions, 'openCommit'> = { openCommit };
