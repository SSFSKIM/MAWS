// The push-state row's PR line (E6 execution document, Design §6): which of its states the summary shows, from
// `scm.status` (trust, remotes, gh) and `scm.pr.state` (the PR and its checks), and the words of a PR's state.
import { describe, expect, it } from 'vitest';
import type { ScmCheck, ScmGhState, ScmPrState, ScmStatus } from '@shared/ipc/schema/scm';
import { prDetails, prLine, prStateBehind } from './pr-line';

const EARLY = '2026-10-06T10:00:00.000Z';
const LATE = '2026-10-06T10:05:00.000Z';
const READY: ScmGhState = { state: 'ready', path: '/bin/gh', version: 'gh version 2.97.0' };
const SIGNED_OUT: ScmGhState = { state: 'unauthenticated', path: '/bin/gh', version: 'gh version 2.97.0', detail: 'You are not logged into any GitHub hosts' };

const scmStatus = (over: Partial<ScmStatus> = {}): ScmStatus => ({
  directory: '/repo', repository: true, trusted: true, trustKey: '/repo', remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }],
  defaultRemote: 'origin', defaultBase: 'main', gh: READY, checkedAt: EARLY, ...over,
});
const check = (bucket: ScmCheck['bucket'], name = bucket): ScmCheck => ({ name, bucket, state: bucket.toUpperCase(), link: null, workflow: null });
type Pr = NonNullable<ScmPrState['pr']>;
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 12, url: 'https://github.com/o/r/pull/12', title: 'Panel PR', state: 'OPEN', isDraft: false, reviewDecision: null, baseRefName: 'main',
  headRefName: 'feature', mergeStateStatus: 'CLEAN', checks: { summary: 'pending', items: [check('pass'), check('pass'), check('pass'), check('pending')] }, ...over,
});
const prState = (over: Partial<ScmPrState> = {}): ScmPrState => ({ checkedAt: EARLY, branch: 'feature', gh: READY, pr: pr(), error: null, ...over });

const line = (scm: { data?: ScmStatus; error?: string }, answer: { data?: ScmPrState; error?: string } = {}) => prLine({ branch: 'feature', scm, pr: answer });

describe('the push-state row’s PR line', () => {
  it('waits for scm.status, and says why it is unavailable when scm.status fails', () => {
    expect(line({})).toEqual({ kind: 'hidden' });
    expect(line({ error: 'unknown app session: app-a' })).toEqual({ kind: 'unavailable', reason: 'unknown app session: app-a' });
  });

  it('asks for trust before anything else, also when the PR state was read before trust was withdrawn', () => {
    expect(line({ data: scmStatus({ trusted: false, gh: { state: 'missing' } }) }, { data: prState() })).toEqual({ kind: 'untrusted' });
    expect(line({ data: scmStatus() }, { data: prState({ pr: null, error: 'untrusted' }) })).toEqual({ kind: 'untrusted' });
  });

  it('says nothing for a repository without a remote', () => {
    expect(line({ data: scmStatus({ remotes: [] }) })).toEqual({ kind: 'hidden' });
    expect(line({ data: scmStatus() }, { data: prState({ pr: null, error: 'no_remote' }) })).toEqual({ kind: 'hidden' });
  });

  it('names a missing or signed-out GitHub CLI from scm.status before the PR state answers', () => {
    expect(line({ data: scmStatus({ gh: { state: 'missing' } }) })).toEqual({ kind: 'gh_missing' });
    expect(line({ data: scmStatus({ gh: SIGNED_OUT }) })).toEqual({ kind: 'gh_unauthenticated', detail: SIGNED_OUT.detail });
    expect(line({ data: scmStatus() })).toEqual({ kind: 'hidden' }); // ready, the PR state not answered yet
  });

  it('reads gh from the newer of the two answers', () => {
    // signed in since scm.status was read: the newer PR state's PR shows
    expect(line({ data: scmStatus({ gh: SIGNED_OUT, checkedAt: EARLY }) }, { data: prState({ checkedAt: LATE }) })).toMatchObject({ kind: 'pr', number: 12 });
    // signed out since: the newer PR state's gh decides
    expect(line({ data: scmStatus({ checkedAt: EARLY }) }, { data: prState({ checkedAt: LATE, gh: SIGNED_OUT, pr: null, error: 'gh_unauthenticated' }) })).toEqual({ kind: 'gh_unauthenticated', detail: SIGNED_OUT.detail });
    expect(line({ data: scmStatus({ checkedAt: EARLY }) }, { data: prState({ checkedAt: LATE, gh: { state: 'missing' }, pr: null, error: 'gh_missing' }) })).toEqual({ kind: 'gh_missing' });
  });

  it('waits, and asks the PR state again, when scm.status found gh ready after the PR state found it not', () => {
    const scm = scmStatus({ checkedAt: LATE });
    const stale = prState({ checkedAt: EARLY, gh: SIGNED_OUT, pr: null, error: 'gh_unauthenticated' });
    expect(line({ data: scm }, { data: stale })).toEqual({ kind: 'hidden' });
    expect(prStateBehind(scm, stale)).toBe(true);
    expect(prStateBehind(scm, { ...stale, checkedAt: LATE })).toBe(false); // asked again: it answered later than scm.status
    expect(prStateBehind(scmStatus({ checkedAt: LATE, gh: SIGNED_OUT }), stale)).toBe(false);
    expect(prStateBehind(scm, prState())).toBe(false);
    expect(prStateBehind(scm, undefined)).toBe(false);
  });

  it('says No PR, the PR, or why the PR state is unavailable', () => {
    expect(line({ data: scmStatus() }, { data: prState({ pr: null }) })).toEqual({ kind: 'no_pr', branch: 'feature' });
    expect(line({ data: scmStatus() }, { data: prState() })).toEqual({ kind: 'pr', number: 12, url: 'https://github.com/o/r/pull/12', details: 'Open · 3 passed, 1 pending' });
    expect(line({ data: scmStatus() }, { data: prState({ pr: null, error: 'gh pr view: HTTP 502' }) })).toEqual({ kind: 'unavailable', reason: 'gh pr view: HTTP 502' });
    expect(line({ data: scmStatus() }, { error: 'timeout' })).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  it('says nothing for an answer about a repository or branch that is gone (the first row hides then)', () => {
    expect(line({ data: scmStatus() }, { data: prState({ pr: null, error: 'detached', branch: null }) })).toEqual({ kind: 'hidden' });
    expect(line({ data: scmStatus() }, { data: prState({ pr: null, error: 'not_repository', branch: null }) })).toEqual({ kind: 'hidden' });
  });
});

describe('a PR’s state in words', () => {
  it('names the state, the review decision and the checks', () => {
    expect(prDetails(pr())).toBe('Open · 3 passed, 1 pending');
    expect(prDetails(pr({ isDraft: true }))).toBe('Draft · 3 passed, 1 pending');
    expect(prDetails(pr({ state: 'MERGED', checks: { summary: 'pass', items: [check('pass')] } }))).toBe('Merged · 1 passed');
    expect(prDetails(pr({ state: 'CLOSED', isDraft: true }))).toBe('Closed · 3 passed, 1 pending');
    expect(prDetails(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe('Open · Changes requested · 3 passed, 1 pending');
    expect(prDetails(pr({ reviewDecision: 'APPROVED' }))).toBe('Open · Approved · 3 passed, 1 pending');
    expect(prDetails(pr({ reviewDecision: 'REVIEW_REQUIRED' }))).toBe('Open · 3 passed, 1 pending');
  });

  it('counts every bucket in one order and says when there are no checks or they could not be read', () => {
    const all = [check('skipping'), check('pending'), check('cancel'), check('fail'), check('fail'), check('pass')];
    expect(prDetails(pr({ checks: { summary: 'fail', items: all } }))).toBe('Open · 1 passed, 2 failed, 1 cancelled, 1 pending, 1 skipped');
    expect(prDetails(pr({ checks: { summary: 'none', items: [] } }))).toBe('Open · No checks reported yet');
    expect(prDetails(pr({ checks: { summary: 'unknown', items: [] } }))).toBe('Open · Checks unavailable');
  });
});
