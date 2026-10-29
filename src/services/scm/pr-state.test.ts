// gh's answers read into what the PR row shows (E6 acceptance item 1): `pr view`, `pr checks`, `auth status` and
// `--version` over fixtures written by hand to gh 2.97.0's documented JSON fields and messages, and the summary rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CollectedRun } from './remote-runner';
import { checksSummary, prChecksArgv, prViewArgv, readChecks, readGhProbe, readPrView } from './pr-state';

const FIXTURES = join(__dirname, '../../../test/fixtures/scm');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const run = (over: Partial<CollectedRun>): CollectedRun => ({ exitCode: 0, signal: null, stdout: '', stderr: '', failure: null, ...over });
const GH = '/opt/homebrew/bin/gh';
const VERSION = run({ stdout: 'gh version 2.97.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.97.0\n' });

describe('scm pr state parses gh answers', () => {
  it('asks gh for the documented fields of the branch it names', () => {
    expect(prViewArgv('feature/panel')).toEqual([
      'pr', 'view', 'feature/panel', '--json', 'number,url,title,state,isDraft,reviewDecision,baseRefName,headRefName,mergeStateStatus',
    ]);
    expect(prChecksArgv('feature/panel')).toEqual(['pr', 'checks', 'feature/panel', '--json', 'name,bucket,state,link,workflow']);
  });

  describe('pr view', () => {
    it('reads an open PR with its review decision and merge state', () => {
      expect(readPrView(run({ stdout: fixture('gh-pr-view-open.json') }))).toEqual({
        pr: {
          number: 12, url: 'https://github.com/o/r/pull/12', title: 'Source control from the panel', state: 'OPEN', isDraft: false,
          reviewDecision: 'CHANGES_REQUESTED', baseRefName: 'main', headRefName: 'feature/panel', mergeStateStatus: 'BLOCKED',
        },
        error: null,
      });
    });

    it('reads a draft, an empty review decision as none', () => {
      expect(readPrView(run({ stdout: fixture('gh-pr-view-draft.json') }))).toMatchObject({ pr: { number: 13, state: 'OPEN', isDraft: true, reviewDecision: null }, error: null });
    });

    it('reads a merged PR', () => {
      expect(readPrView(run({ stdout: fixture('gh-pr-view-merged.json') }))).toMatchObject({ pr: { number: 11, state: 'MERGED', reviewDecision: 'APPROVED' }, error: null });
    });

    it('answers "no PR" for gh\'s "no pull requests found", apart from a failure', () => {
      expect(readPrView(run({ exitCode: 1, stderr: fixture('gh-pr-view-none.txt') }))).toEqual({ pr: null, error: null });
      expect(readPrView(run({ exitCode: 1, stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\nretry later\n' })))
        .toEqual({ pr: null, error: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' });
      expect(readPrView(run({ exitCode: null, failure: 'timed out after 30 s' }))).toEqual({ pr: null, error: 'timed out after 30 s' });
      expect(readPrView(run({ exitCode: 2 }))).toEqual({ pr: null, error: 'gh pr view exited with code 2' });
    });

    it('refuses an answer that is not the documented shape', () => {
      expect(readPrView(run({ stdout: 'not json' }))).toEqual({ pr: null, error: 'gh pr view answered something MAWS cannot read' });
      expect(readPrView(run({ stdout: JSON.stringify({ ...JSON.parse(fixture('gh-pr-view-open.json')), state: 'LOCKED' }) })))
        .toEqual({ pr: null, error: 'gh pr view answered something MAWS cannot read' });
    });
  });

  describe('pr checks', () => {
    it('reads a mixed set: links and workflows kept, empty ones as none, and pending wins over pass', () => {
      // gh exits 8 while any check is pending, with the JSON on stdout all the same
      expect(readChecks(run({ exitCode: 8, stdout: fixture('gh-pr-checks-mixed.json') }))).toEqual({
        summary: 'pending',
        items: [
          { name: 'typecheck', bucket: 'pass', state: 'SUCCESS', link: 'https://github.com/o/r/actions/runs/1/job/1', workflow: 'CI' },
          { name: 'lint', bucket: 'pass', state: 'SUCCESS', link: 'https://github.com/o/r/actions/runs/1/job/2', workflow: 'CI' },
          { name: 'test', bucket: 'pending', state: 'IN_PROGRESS', link: 'https://github.com/o/r/actions/runs/1/job/3', workflow: 'CI' },
          { name: 'deploy-preview', bucket: 'skipping', state: 'SKIPPED', link: null, workflow: null },
        ],
      });
    });

    it('reads no checks as none, from an empty array or gh\'s "no checks reported"', () => {
      expect(readChecks(run({ stdout: fixture('gh-pr-checks-none.json') }))).toEqual({ summary: 'none', items: [] });
      expect(readChecks(run({ exitCode: 1, stderr: "no checks reported on the 'feature/panel' branch\n" }))).toEqual({ summary: 'none', items: [] });
    });

    it('answers unknown when the checks could not be read', () => {
      expect(readChecks(run({ exitCode: 1, stderr: 'HTTP 401: Bad credentials\n' }))).toEqual({ summary: 'unknown', items: [] });
      expect(readChecks(run({ exitCode: null, failure: 'timed out after 30 s' }))).toEqual({ summary: 'unknown', items: [] });
      expect(readChecks(run({ stdout: '{"not":"an array"}' }))).toEqual({ summary: 'unknown', items: [] });
    });

    it('drops an entry whose bucket gh does not document, keeping the rest', () => {
      const stdout = JSON.stringify([{ name: 'a', bucket: 'pass', state: 'SUCCESS', link: '', workflow: '' }, { name: 'b', bucket: 'weird', state: 'X', link: '', workflow: '' }]);
      expect(readChecks(run({ stdout }))).toEqual({ summary: 'pass', items: [{ name: 'a', bucket: 'pass', state: 'SUCCESS', link: null, workflow: null }] });
    });

    it('summarises: a failure or a cancel first, then pending, then pass; skipped alone is none', () => {
      const of = (...buckets: Array<'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'>) =>
        checksSummary(buckets.map((bucket, i) => ({ name: `c${i}`, bucket, state: '', link: null, workflow: null })));
      expect(of('pass', 'pending', 'fail')).toBe('fail');
      expect(of('pass', 'cancel')).toBe('fail');
      expect(of('pass', 'pending', 'skipping')).toBe('pending');
      expect(of('pass', 'skipping')).toBe('pass');
      expect(of('skipping')).toBe('none');
      expect(of()).toBe('none');
    });
  });

  describe('gh probe', () => {
    it('is ready when auth status exits 0, carrying the version line', () => {
      expect(readGhProbe(GH, VERSION, run({ stdout: 'github.com\n  ✓ Logged in to github.com account o (keyring)\n' })))
        .toEqual({ state: 'ready', path: GH, version: 'gh version 2.97.0 (2026-09-30)' });
    });

    it('is unauthenticated with gh\'s own first line when auth status exits 1 or 4', () => {
      for (const exitCode of [1, 4]) {
        expect(readGhProbe(GH, VERSION, run({ exitCode, stderr: fixture('gh-auth-status-signed-out.txt') }))).toEqual({
          state: 'unauthenticated', path: GH, version: 'gh version 2.97.0 (2026-09-30)',
          detail: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
        });
      }
    });

    it('is unauthenticated with the reason when auth status times out or gh cannot start or answer', () => {
      expect(readGhProbe(GH, VERSION, run({ exitCode: null, failure: 'timed out after 30 s' })))
        .toMatchObject({ state: 'unauthenticated', detail: 'timed out after 30 s' });
      expect(readGhProbe(GH, VERSION, run({ exitCode: 1 }))).toMatchObject({ state: 'unauthenticated', detail: 'gh auth status exited with code 1' });
      const crashed = run({ exitCode: null, failure: `could not start ${GH}: spawn EACCES` });
      expect(readGhProbe(GH, crashed, crashed)).toEqual({ state: 'unauthenticated', path: GH, version: null, detail: `could not start ${GH}: spawn EACCES` });
      expect(readGhProbe(GH, run({ exitCode: 1, stderr: 'boom\n' }), run({}))).toEqual({ state: 'unauthenticated', path: GH, version: null, detail: 'gh --version failed: boom' });
    });
  });
});
