// The header's remote actions and what the PR sheet and the Output read from git's answers (E6 execution document,
// M4's local decisions and Design §8). Pure. Main decides every refusal again when it plans (Design §4); these only
// label the buttons and say why one is off, so a click is not a round trip to a refusal the header could have named.
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmPrState } from '@shared/ipc/schema/scm';
import { SCM_COPY } from './copy';

export interface HeaderAction {
  label: string;
  title: string; // the button's title: what it will do, or why it is off ('' while the trust is read)
  disabled: boolean;
}

// The branch tracks a branch of its own name on one of the checkout's remotes, task 3's rule for "own" (main compares
// `%(upstream:remoteref)`; the status's short upstream `<remote>/<branch>` says the same for a remote name the checkout
// has). Before `scm.status` names the remotes, the upstream's branch part alone decides.
export function ownUpstream(status: GitStatus, remotes: readonly string[] | null): boolean {
  const { branch, upstream } = status;
  if (branch === null || upstream === null) return false;
  if (remotes === null) return upstream.endsWith(`/${branch}`);
  return remotes.some((remote) => upstream === `${remote}/${branch}`);
}

interface ActionInput {
  status: GitStatus;
  remotes: readonly string[] | null;
  trusted: boolean | null; // null while `scm.status` is read
}

// Push the commits ahead of the branch's own upstream (off when there are none), or Publish a branch that has no
// upstream of its own name: main's plan carries `--set-upstream` for both, re-pointing a branch that tracks another.
export function pushAction({ status, remotes, trusted }: ActionInput): HeaderAction {
  const off = (title: string, label: string = SCM_COPY.push): HeaderAction => ({ label, title, disabled: true });
  if (trusted !== true) return off(trusted === false ? SCM_COPY.trustToPush : '');
  if (status.branch === null) return off(SCM_COPY.checkOutToPush);
  if (!ownUpstream(status, remotes)) return { label: SCM_COPY.publish, title: SCM_COPY.publishBranch(status.branch), disabled: false };
  if (status.ahead === 0) return off(SCM_COPY.nothingToPush);
  return { label: SCM_COPY.push, title: SCM_COPY.pushCommits(status.ahead, status.upstream!), disabled: false };
}

// Open PR once the branch is pushed to its own upstream and even with it; "Push first" until then (main's `not_pushed`).
export function prAction({ status, remotes, trusted }: ActionInput): HeaderAction {
  const off = (title: string): HeaderAction => ({ label: SCM_COPY.openPr, title, disabled: true });
  if (trusted !== true) return off(trusted === false ? SCM_COPY.trustToOpenPr : '');
  if (status.branch === null) return off(SCM_COPY.checkOutToOpenPr);
  if (!ownUpstream(status, remotes) || status.ahead > 0 || status.behind > 0) return off(SCM_COPY.pushFirst);
  return { label: SCM_COPY.openPr, title: SCM_COPY.openPrFor(status.branch), disabled: false };
}

// The PR the header links to in place of Open PR: the branch's open one, a draft included. A closed or merged PR leaves
// the button, since the branch may be opened again.
export function openPrOf(state: ScmPrState | undefined): NonNullable<ScmPrState['pr']> | null {
  const pr = state?.pr ?? null;
  return pr !== null && pr.state === 'OPEN' ? pr : null;
}

// The PR sheet's title (Design §8): HEAD's subject when the branch is one commit past the default base, else the branch
// name with `-` and `_` as spaces. The distance is C10's `git.worktree.branch` count against the main worktree's branch,
// which is only the default base's when the two names agree; otherwise the branch name stands.
export function prTitleDefault(input: {
  branch: string;
  defaultBase: string | null;
  branchStatus: { base: string; ahead: number } | null;
  subject: string | null;
}): string {
  const { branch, defaultBase, branchStatus, subject } = input;
  if (subject && defaultBase !== null && branchStatus?.base === defaultBase && branchStatus.ahead === 1) return subject;
  return branch.replace(/[-_]+/g, ' ').trim() || branch;
}

// The pull request `gh pr create` printed: the first `…/pull/<n>` URL in its output (main's rule, Design §4).
export function prUrlOf(lines: readonly string[]): { url: string; number: number } | null {
  for (const line of lines) {
    const match = /https?:\/\/\S+\/pull\/(\d+)/.exec(line);
    if (match) return { url: match[0], number: Number(match[1]) };
  }
  return null;
}
