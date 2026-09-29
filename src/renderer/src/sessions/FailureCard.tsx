// A failed setup's card body (C10 execution document, "The unstarted session", the failure card; Rollback): the error,
// what the rollback did to each resource in words, "Retry" (`onAccept`: the same intent, its message included),
// "Discard changes and remove" (behind the acknowledgement) and "Keep the worktree" while the attempt's checkout is
// retained, and "Back to editing" (`onDecline`: the message returns to the editor and is released).
import { useState } from 'react';
import type { SetupResources } from '@shared/sessions/setup';
import type { SetupFailure } from './store';
import { DANGER, PRIMARY, QUIET, SECONDARY } from './ui';

export const FAILURE_CARD_TITLE = 'The session did not start';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
// `dirty: 1 uncommitted change` → `1 uncommitted change`: a cleanup refusal's code is for code, the rest is for people;
// any other message is shown as it came.
const detailWords = (detail: string | null) => (detail === null ? null : detail.replace(/^(busy|dirty|locked|changed|missing|checked_out|unmerged): /, ''));

export function resourceLines(resources: SetupResources): string[] {
  const lines: string[] = [];
  const w = resources.worktree;
  if (w !== null) {
    const name = `Worktree ${basename(w.path)}`;
    const detail = detailWords(w.detail);
    if (w.state === 'removed') lines.push(`${name} removed`);
    else if (w.state === 'kept') lines.push(`${name} kept`);
    else if (w.state === 'remove_refused') lines.push(detail ? `${name} kept: ${detail}` : `${name} kept`);
    else lines.push(`${name} could not be removed${detail ? `: ${detail}` : ''}`);
    if (w.branch !== null) {
      const branch = `Branch ${w.branch}`;
      if (w.branchState === 'deleted') lines.push(`${branch} deleted`);
      else if (w.branchState === 'kept') lines.push(`${branch} kept`);
      else if (w.branchState === 'delete_refused') lines.push(detail && w.state === 'removed' ? `${branch} kept: ${detail}` : `${branch} kept`);
      else if (w.branchState === 'delete_failed') lines.push(`${branch} could not be deleted${detail && w.state === 'removed' ? `: ${detail}` : ''}`);
    }
  }
  if (resources.record === 'removed') lines.push('Record removed');
  else if (resources.record === 'kept') lines.push(resources.transcript === 'kept' ? 'Session kept with its transcript' : 'Session kept');
  return lines;
}

export function FailureCard({
  failure,
  busy,
  retainedWorktree,
  onAccept,
  onDecline,
  onDiscard,
  onKeep,
}: {
  failure: SetupFailure;
  busy: boolean;
  retainedWorktree: boolean; // the attempt's checkout is still the intent's (`progress.worktree.createdHere`)
  onAccept(): void;
  onDecline(): void;
  onDiscard(): void;
  onKeep(): void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const w = failure.resources.worktree;
  const kept = retainedWorktree && w !== null && w.state !== 'removed';
  const discardable = kept && (w.state === 'remove_refused' || w.state === 'remove_failed');
  const changes = w?.state === 'remove_refused' && w.detail?.startsWith('dirty: ') ? detailWords(w.detail) : 'uncommitted changes';
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <p className="m-0 text-danger">{failure.message}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-ui-sm text-fg-muted">
        {resourceLines(failure.resources).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {discardable && (
        <label className="flex items-center gap-2 text-ui-sm text-fg">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          {`Discard ${changes}; this cannot be undone`}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onAccept} className={PRIMARY}>
          Retry
        </button>
        {discardable && (
          <button type="button" disabled={busy || !acknowledged} onClick={onDiscard} className={DANGER}>
            Discard changes and remove
          </button>
        )}
        {kept && (
          <button type="button" disabled={busy} onClick={onKeep} className={SECONDARY}>
            Keep the worktree
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDecline} className={`${QUIET} ml-auto`}>
          Back to editing
        </button>
      </div>
    </div>
  );
}
