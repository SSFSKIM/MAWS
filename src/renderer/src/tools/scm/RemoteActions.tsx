// The header's remote actions (E6 execution document, Design §5 and §8; M4's decisions): Push (Publish for a branch
// with no upstream of its own; off with a title when nothing is ahead), and Open PR (off with "Push first" until the
// branch is pushed and even) or, once the branch has an open PR, a link "PR #n ↗" to it. Each opens its sheet in the
// tool. The PR comes from the PR-state query the summary's push-state row shares (one poll for both surfaces).
import { useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { queryClient } from '../../ipc/query';
import { SCM_COPY } from './copy';
import { openPrOf, prAction, pushAction, type HeaderAction } from './remote-actions';
import { openLink, prStateEnabled, usePrState } from './store';
import type { ScmUi } from './view-state';

const BUTTON = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm whitespace-nowrap text-fg hover:bg-bg-hover disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent';

export function RemoteActions({ appSessionId, ui, status, scm, trusted }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; status: GitStatus; scm: ScmStatus | undefined; trusted: boolean | null }) {
  const prState = usePrState(appSessionId, prStateEnabled(status, scm));
  // A push from anywhere (a terminal, the agent) or a new upstream moves the PR state; a worktree edit does not.
  const root = status.repoRoot;
  useEffect(
    () =>
      ipc.on('git.changed', (event) => {
        if (event.repoRoot === root && (event.reason === 'head' || event.reason === 'refs')) void queryClient.invalidateQueries({ queryKey: ['maws', 'scm.pr.state', { appSessionId, refresh: false }] });
      }),
    [root, appSessionId],
  );
  const remotes = scm ? scm.remotes.map((remote) => remote.name) : null;
  const input = { status, remotes, trusted };
  const pr = openPrOf(prState.data);
  const action = (name: string, { label, title, disabled }: HeaderAction, onClick: () => void) => (
    <button type="button" data-scm-remote-action={name} title={title} disabled={disabled} onClick={onClick} className={BUTTON}>
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      {action('push', pushAction(input), () => ui.setState({ sheet: { kind: 'push' } }))}
      {pr !== null ? (
        <button type="button" data-scm-remote-action="pr-link" aria-label={SCM_COPY.prLinkLabel(pr.number)} title={pr.url} onClick={() => openLink(pr.url)} className={BUTTON}>
          {SCM_COPY.prLink(pr.number)}
        </button>
      ) : (
        action('pr', prAction(input), () => ui.setState({ sheet: { kind: 'pr' } }))
      )}
    </div>
  );
}
