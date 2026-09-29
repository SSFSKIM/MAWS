// A failed attempt's checkout, above the composer of an unstarted session once the card that resolves it is gone
// ("Back to editing" on the failure card, or Cancel on the relay card C3's own relay answer docked). While the checkout
// is still the intent's (`progress.worktree.createdHere`), main refuses every location change (`retained_worktree`),
// so its two resolutions, "Keep the worktree" and "Discard changes and remove", stay offered here with the failure
// card's own rules. A note rather than an undismissable card: the card takes the composer's place, and "Back to
// editing" exists to give the composer back (Send reuses the checkout).
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import { DiscardAcknowledgement, resourceLines, worktreeResolutions } from './FailureCard';
import { resolveWorktree, type WorktreeResource } from './setup-actions';
import { failureOf, isStarting, useSetup } from './store';
import { DANGER, SECONDARY } from './ui';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// The retained checkout as the last failure reported it (every failure that keeps one records it), else as kept.
function retainedResource(intent: SetupIntent): WorktreeResource | null {
  const w = intent.progress.worktree;
  if (w === null || !w.createdHere) return null;
  return intent.progress.lastFailure?.resources.worktree ?? { path: w.path, branch: w.branch, createdHere: true, state: 'kept', detail: null, branchState: 'none' };
}

export function RetainedWorktreeNote({ appSessionId }: { appSessionId: AppSessionId }) {
  const intent = useSetup((s) => {
    const held = s.intents.get(appSessionId);
    // the card offers the resolutions itself while it shows; a start in flight owns the checkout
    if (held === undefined || isStarting(s, appSessionId) || s.cards.has(appSessionId) || failureOf(s, appSessionId) !== null) return null;
    return held;
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string[]>([]);
  const resource = intent === null ? null : retainedResource(intent);
  if (resource === null) return null;

  const { keep, discard, changes } = worktreeResolutions(resource, true);
  const resolve = async (resolution: 'discard' | 'keep') => {
    setBusy(true);
    const worktree = await resolveWorktree(appSessionId, resolution);
    setBusy(false);
    // a resolution that went through clears the retained checkout and this note with it; a refused discard says why
    setOutcome(worktree !== null && worktree.state !== 'removed' && resolution === 'discard' ? resourceLines({ worktree, record: 'none', transcript: 'none' }) : []);
  };

  return (
    <div role="note" aria-label="Worktree from the failed attempt" className="flex flex-col gap-2 rounded-lg border border-l-2 border-border border-l-warning bg-bg-raised px-3 py-2.5 text-ui-sm">
      <p className="m-0 text-fg">
        {`Worktree ${basename(resource.path)} from the failed attempt is still this session’s: Send reuses it, and the location cannot change until you keep or discard it.`}
      </p>
      {outcome.length > 0 && <p className="m-0 text-danger">{outcome.join('; ')}</p>}
      {discard && <DiscardAcknowledgement changes={changes} checked={acknowledged} onChange={setAcknowledged} />}
      <div className="flex gap-2">
        {keep && (
          <button type="button" disabled={busy} onClick={() => void resolve('keep')} className={SECONDARY}>
            Keep the worktree
          </button>
        )}
        {discard && (
          <button type="button" disabled={busy || !acknowledged} onClick={() => void resolve('discard')} className={DANGER}>
            Discard changes and remove
          </button>
        )}
      </div>
    </div>
  );
}
