// The header's Push and Open PR buttons, the PR sheet's title default and the PR a run printed (E6 execution
// document, M4's local decisions and Design §8). Pure.
import { describe, expect, it } from 'vitest';
import { prOf, prStateOf, statusOf } from '../../test-support/scm';
import { openPrOf, ownUpstream, prAction, prTitleDefault, prUrlOf, pushAction } from './remote-actions';

const remotes = ['origin', 'upstream'];

describe('ownUpstream: the branch tracks a branch of its own name on one of the remotes', () => {
  it('holds for <remote>/<branch> and not for another branch’s upstream', () => {
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'origin/feature' }), remotes)).toBe(true);
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'upstream/feature' }), remotes)).toBe(true);
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'origin/main' }), remotes)).toBe(false);
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: null }), remotes)).toBe(false);
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'fork/feature' }), remotes)).toBe(false); // not a remote of the checkout
  });

  it('reads the upstream’s branch part while the remotes are not known yet', () => {
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'origin/feature' }), null)).toBe(true);
    expect(ownUpstream(statusOf({ branch: 'feature', upstream: 'origin/main' }), null)).toBe(false);
  });
});

describe('pushAction: Push, or Publish for a branch with no upstream of its own', () => {
  it('pushes the commits ahead of an own upstream', () => {
    expect(pushAction({ status: statusOf({ ahead: 3 }), remotes, trusted: true })).toEqual({ label: 'Push', title: 'Push 3 commits to origin/main', disabled: false });
  });

  it('is disabled with a title when nothing is ahead of an own upstream', () => {
    expect(pushAction({ status: statusOf({ ahead: 0 }), remotes, trusted: true })).toEqual({ label: 'Push', title: 'Nothing to push', disabled: true });
  });

  it('says to pull first when the branch is behind its own upstream (main never force-pushes)', () => {
    expect(pushAction({ status: statusOf({ ahead: 2, behind: 1 }), remotes, trusted: true })).toEqual({ label: 'Push', title: 'Pull in a terminal first', disabled: true });
    expect(pushAction({ status: statusOf({ ahead: 0, behind: 1 }), remotes, trusted: true })).toEqual({ label: 'Push', title: 'Pull in a terminal first', disabled: true });
    // behind another branch's upstream is not main's refusal: Publish re-points it
    expect(pushAction({ status: statusOf({ branch: 'feature', upstream: 'origin/main', behind: 3 }), remotes, trusted: true })).toMatchObject({ label: 'Publish', disabled: false });
  });

  it('is disabled with a reason when the checkout has no remote', () => {
    expect(pushAction({ status: statusOf({ branch: 'feature', upstream: null }), remotes: [], trusted: true })).toEqual({ label: 'Publish', title: 'No remote to push to', disabled: true });
    expect(pushAction({ status: statusOf({ upstream: null }), remotes: [], trusted: true })).toMatchObject({ disabled: true, title: 'No remote to push to' });
    expect(prAction({ status: statusOf({ upstream: null }), remotes: [], trusted: true })).toMatchObject({ disabled: true, title: 'No remote to push to' });
  });

  it('publishes a branch with no upstream, or one tracking another branch', () => {
    expect(pushAction({ status: statusOf({ branch: 'feature', upstream: null, ahead: 0 }), remotes, trusted: true })).toEqual({ label: 'Publish', title: 'Publish feature', disabled: false });
    expect(pushAction({ status: statusOf({ branch: 'feature', upstream: 'origin/main', ahead: 0 }), remotes, trusted: true })).toMatchObject({ label: 'Publish', disabled: false });
  });

  it('is disabled untrusted, while the trust is read, and on a detached head', () => {
    expect(pushAction({ status: statusOf({ ahead: 3 }), remotes, trusted: false })).toEqual({ label: 'Push', title: 'Trust the folder to push', disabled: true });
    expect(pushAction({ status: statusOf({ ahead: 3 }), remotes, trusted: null })).toEqual({ label: 'Push', title: '', disabled: true });
    expect(pushAction({ status: statusOf({ branch: null, upstream: null }), remotes, trusted: true })).toEqual({ label: 'Push', title: 'Check out a branch to push', disabled: true });
  });
});

describe('prAction: Open PR once the branch is pushed and even', () => {
  it('opens the sheet for a branch even with its own upstream', () => {
    expect(prAction({ status: statusOf(), remotes, trusted: true })).toEqual({ label: 'Open PR', title: 'Open a pull request for main', disabled: false });
  });

  it('says Push first until then', () => {
    for (const status of [statusOf({ ahead: 1 }), statusOf({ behind: 1 }), statusOf({ branch: 'feature', upstream: null }), statusOf({ branch: 'feature', upstream: 'origin/main' })]) {
      expect(prAction({ status, remotes, trusted: true })).toEqual({ label: 'Open PR', title: 'Push first', disabled: true });
    }
  });

  it('is disabled untrusted and on a detached head', () => {
    expect(prAction({ status: statusOf(), remotes, trusted: false })).toMatchObject({ title: 'Trust the folder to open a pull request', disabled: true });
    expect(prAction({ status: statusOf({ branch: null }), remotes, trusted: true })).toMatchObject({ disabled: true });
  });
});

describe('openPrOf: the PR the header links to instead of Open PR', () => {
  it('is the branch’s open PR, drafts included, and nothing for a closed or merged one', () => {
    expect(openPrOf(prStateOf({ pr: prOf() }))).toMatchObject({ number: 7 });
    expect(openPrOf(prStateOf({ pr: prOf({ isDraft: true }) }))).toMatchObject({ number: 7 });
    expect(openPrOf(prStateOf({ pr: prOf({ state: 'MERGED' }) }))).toBeNull();
    expect(openPrOf(prStateOf({ pr: prOf({ state: 'CLOSED' }) }))).toBeNull();
    expect(openPrOf(prStateOf())).toBeNull();
    expect(openPrOf(undefined)).toBeNull();
  });
});

describe('prTitleDefault: the one new commit’s subject, else the branch name in words', () => {
  const one = { base: 'main', ahead: 1 };
  it('takes HEAD’s subject when the branch is one commit past the default base', () => {
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: 'main', branchStatus: one, subject: 'Fix the login flow' })).toBe('Fix the login flow');
  });

  it('takes the branch name with - and _ as spaces otherwise', () => {
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: 'main', branchStatus: { base: 'main', ahead: 2 }, subject: 'Fix' })).toBe('fix login flow');
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: 'main', branchStatus: { base: 'develop', ahead: 1 }, subject: 'Fix' })).toBe('fix login flow');
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: null, branchStatus: one, subject: 'Fix' })).toBe('fix login flow');
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: 'main', branchStatus: null, subject: null })).toBe('fix login flow');
    expect(prTitleDefault({ branch: 'fix-login_flow', defaultBase: 'main', branchStatus: one, subject: '' })).toBe('fix login flow');
  });

  it('keeps the branch name when it is only dashes', () => {
    expect(prTitleDefault({ branch: '__', defaultBase: null, branchStatus: null, subject: null })).toBe('__');
  });
});

describe('prUrlOf: the pull request gh pr create printed', () => {
  it('is the first …/pull/<n> URL in the output', () => {
    expect(prUrlOf(['Creating pull request for main into main in o/r', '', 'https://github.com/o/r/pull/7', ''])).toEqual({ url: 'https://github.com/o/r/pull/7', number: 7 });
    expect(prUrlOf(['see https://ghe.example.com/o/r/pull/12.'])).toEqual({ url: 'https://ghe.example.com/o/r/pull/12', number: 12 });
    expect(prUrlOf(['https://github.com/o/r/issues/7', 'nothing'])).toBeNull();
  });
});
