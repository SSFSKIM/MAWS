// The push-state row's PR line (E6 execution document, Design §6), pure: which state the row says from `scm.status`
// (trust, remotes, gh) and `scm.pr.state` (the PR and its checks), and a PR's state in words. gh is read from the newer
// of the two answers, since either can be the one asked last (a poll, a Refresh, a remount).
import type { ScmGhState, ScmPrState, ScmStatus } from '@shared/ipc/schema/scm';
import { SUMMARY_COPY } from '../copy';

export type PrLine =
  | { kind: 'hidden' } // nothing to say yet, or nothing to ask about (no remote; the first row hides on a detached head)
  | { kind: 'untrusted' }
  | { kind: 'gh_missing' }
  | { kind: 'gh_unauthenticated'; detail: string }
  | { kind: 'no_pr'; branch: string }
  | { kind: 'pr'; number: number; url: string; details: string }
  | { kind: 'unavailable'; reason: string };

// A query's answer as the row holds it: its data when it has any, else its failure's message.
export interface Answer<T> {
  data?: T;
  error?: string;
}

const NOTHING_TO_ASK = new Set(['no_remote', 'not_repository', 'detached']);

const newerGh = (scm: ScmStatus, pr: ScmPrState | undefined): ScmGhState => (pr && pr.checkedAt >= scm.checkedAt ? pr.gh : scm.gh);

export function prLine({ branch, scm, pr }: { branch: string; scm: Answer<ScmStatus>; pr: Answer<ScmPrState> }): PrLine {
  if (!scm.data) return scm.error === undefined ? { kind: 'hidden' } : { kind: 'unavailable', reason: scm.error };
  const answer = pr.data;
  if (!scm.data.trusted || answer?.error === 'untrusted') return { kind: 'untrusted' };
  if (scm.data.remotes.length === 0 || (answer?.error != null && NOTHING_TO_ASK.has(answer.error))) return { kind: 'hidden' };
  const gh = newerGh(scm.data, answer);
  if (gh.state === 'missing') return { kind: 'gh_missing' };
  if (gh.state === 'unauthenticated') return { kind: 'gh_unauthenticated', detail: gh.detail };
  if (!answer) return pr.error === undefined ? { kind: 'hidden' } : { kind: 'unavailable', reason: pr.error };
  // gh is ready by the newer scm.status, and the older PR state still says it was not: it is asked again (prStateBehind)
  if (answer.error === 'gh_missing' || answer.error === 'gh_unauthenticated') return { kind: 'hidden' };
  if (answer.error !== null) return { kind: 'unavailable', reason: answer.error };
  if (answer.pr === null) return { kind: 'no_pr', branch: answer.branch ?? branch };
  return { kind: 'pr', number: answer.pr.number, url: answer.pr.url, details: prDetails(answer.pr) };
}

// The PR state was answered before scm.status found gh ready, and said gh was not: an install or a sign-in happened in
// between, and the PR state is asked again rather than waiting for the next poll.
export function prStateBehind(scm: ScmStatus | undefined, pr: ScmPrState | undefined): boolean {
  return scm !== undefined && pr !== undefined && scm.gh.state === 'ready' && pr.gh.state !== 'ready' && pr.checkedAt < scm.checkedAt;
}

// `Open · Changes requested · 3 passed, 1 pending`: the state (a draft only while open), the review decision when it is
// one the owner acts on, and the checks counted by gh's buckets.
export function prDetails(pr: NonNullable<ScmPrState['pr']>): string {
  const words = SUMMARY_COPY.prState;
  const state = pr.state === 'MERGED' ? words.merged : pr.state === 'CLOSED' ? words.closed : pr.isDraft ? words.draft : words.open;
  const review = pr.reviewDecision === null ? undefined : SUMMARY_COPY.reviewDecision[pr.reviewDecision];
  return [state, review, checksText(pr.checks)].filter(Boolean).join(' · ');
}

function checksText({ summary, items }: NonNullable<ScmPrState['pr']>['checks']): string {
  if (summary === 'unknown') return SUMMARY_COPY.checksUnavailable;
  const counts = SUMMARY_COPY.checkBuckets
    .map(([bucket, word]) => [items.filter((item) => item.bucket === bucket).length, word] as const)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  return counts.length === 0 ? SUMMARY_COPY.noChecks : counts.join(', ');
}
