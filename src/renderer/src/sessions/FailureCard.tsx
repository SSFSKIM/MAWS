// A failed setup's card body (C10 execution document, "The unstarted session", the failure card; Rollback): the error,
// what the rollback did to each resource in words, "Retry" (`onAccept`: the same intent, its message included),
// "Discard changes and remove" (behind the acknowledgement) and "Keep the worktree" while the attempt's checkout is
// retained, and "Back to editing" (`onDecline`: the message returns to the editor and is released).
import { useState } from 'react';
import type { SetupResources } from '@shared/sessions/setup';
import type { SetupFailure } from './store';
import { CHOICE, DANGER, PRIMARY, QUIET, SECONDARY } from './ui';

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

// Which resolutions a failure's checkout offers: "Keep the worktree" while the attempt's checkout is still the intent's
// (`retained`) and was not removed; "Discard changes and remove" when its removal was refused or failed, behind an
// acknowledgement naming the changes. Shared with the empty state's note, which offers them once the card is dismissed.
export function worktreeResolutions(w: SetupResources['worktree'], retained: boolean): { keep: boolean; discard: boolean; changes: string } {
  const keep = retained && w !== null && w.state !== 'removed';
  const discard = keep && (w.state === 'remove_refused' || w.state === 'remove_failed');
  const changes = (w?.state === 'remove_refused' && w.detail?.startsWith('dirty: ') ? detailWords(w.detail) : null) ?? 'uncommitted changes';
  return { keep, discard, changes };
}

// The acknowledgement a discard waits on.
export function DiscardAcknowledgement({ changes, checked, onChange }: { changes: string; checked: boolean; onChange(checked: boolean): void }) {
  const words = `Discard ${changes}; this cannot be undone`;
  return (
    <label className="flex items-center gap-2 text-ui-sm text-fg">
      <input type="checkbox" aria-label={words} checked={checked} onChange={(e) => onChange(e.target.checked)} className={CHOICE} />
      {words}
    </label>
  );
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
  const { keep: kept, discard: discardable, changes } = worktreeResolutions(failure.resources.worktree, retainedWorktree);
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <p className="m-0 text-danger">{failure.message}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-ui-sm text-fg-muted">
        {resourceLines(failure.resources).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {discardable && <DiscardAcknowledgement changes={changes} checked={acknowledged} onChange={setAcknowledged} />}
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
