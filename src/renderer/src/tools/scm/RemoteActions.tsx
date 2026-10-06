// The header's remote actions (E6 execution document, Design §5 and §8; M4's decisions): Push (Publish for a branch
// with no upstream of its own; off with the reason when nothing is ahead, the branch is behind or there is no remote),
// and Open PR (off with "Push first" until the branch is pushed and even) or, once the branch has an open PR, a link
// "PR #n ↗" to it. Each opens its sheet in the tool. The PR comes from the PR-state query the summary's push-state row
// shares; when gh is missing or signed out the PR cannot be read, and the header says so in the row's words (with
// Install or Sign in), since the row is not on screen while the tool is.
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { SUMMARY_COPY } from '../../panel/copy';
import { prLine } from '../../panel/summary/pr-line';
import { openTerminal } from '../terminal';
import { SCM_COPY } from './copy';
import { prStateEnabled, usePrState } from './queries';
import { openPrOf, prAction, pushAction, type HeaderAction } from './remote-actions';
import { openLink } from './store';
import type { ScmUi } from './view-state';

const BUTTON = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm whitespace-nowrap text-fg hover:bg-bg-hover disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent';
const LINK = 'rounded-sm text-accent outline-accent hover:underline focus-visible:outline-2';

interface Props {
  appSessionId: AppSessionId;
  ui: StoreApi<ScmUi>;
  status: GitStatus;
  directory: string;
  scm: { data: ScmStatus | undefined; error: string | undefined };
  trusted: boolean | null;
}

export function RemoteActions({ appSessionId, ui, status, directory, scm, trusted }: Props) {
  const prState = usePrState(appSessionId, { root: status.repoRoot, enabled: prStateEnabled(status.branch, scm.data) });
  const remotes = scm.data ? scm.data.remotes.map((remote) => remote.name) : null;
  const input = { status, remotes, trusted };
  const pr = openPrOf(prState.data);
  // gh's state as the row reads it (the newer of the two answers): only its gh states are said here.
  const line = status.branch === null ? null : prLine({ branch: status.branch, scm, pr: { data: prState.data, error: prState.error?.message } });
  const action = (name: string, { label, title, disabled }: HeaderAction, onClick: () => void) => (
    <button type="button" data-scm-remote-action={name} title={title} disabled={disabled} onClick={onClick} className={BUTTON}>
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      {line?.kind === 'gh_missing' ? (
        <span data-scm-gh-note className="mr-1 text-ui-sm whitespace-nowrap text-fg-muted">
          {`${SUMMARY_COPY.ghMissing} · `}
          <button type="button" className={LINK} onClick={() => openLink(SCM_COPY.ghInstallUrl)}>
            {SUMMARY_COPY.install}
          </button>
        </span>
      ) : line?.kind === 'gh_unauthenticated' ? (
        <span data-scm-gh-note title={line.detail} className="mr-1 text-ui-sm whitespace-nowrap text-fg-muted">
          {`${SUMMARY_COPY.ghSignedOut} · `}
          <button type="button" className={LINK} onClick={() => openTerminal({ appSessionId, cwd: directory, command: SCM_COPY.ghLoginCommand })}>
            {SUMMARY_COPY.signIn}
          </button>
        </span>
      ) : null}
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
