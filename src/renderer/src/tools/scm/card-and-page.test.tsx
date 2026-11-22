// One fact, one value (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M10; A14's
// S7): the Environment card and Source control's page rendered from one scripted state (one `git.status`, one
// uncommitted diff, one `scm.pr.state`), each through its own derivation (`changeLine`, `prLine`), and compared: the card's
// change line with the Uncommitted line, and the card's pull-request line with the Pull request part.
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { workingFolder } from '@shared/sessions/working-folder';
import { record } from '../../../../../test/support/builders';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import { connectPanelEvents } from '../../ipc/events';
import { queryClient } from '../../ipc/query';
import { Environment } from '../../panel/summary/Environment';
import { useGit } from '../../stores/git';
import { useMachines } from '../../stores/machines';
import { ok } from '../../test-support/code';
import { resetPanelStores } from '../../test-support/panel';
import { DIR, prOf, prStateOf, scmMain, scmStatusOf, statusOf } from '../../test-support/scm';
import { useBranchReads } from '../code/review/branch-read';
import { createPageUi, SourceControlPage } from './SourceControlPage';

const A = addressOf(TEST_MACHINE, 'app-a' as AppSessionId);
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const check = (name: string, bucket: 'pass' | 'fail' | 'pending') => ({ name, bucket, state: bucket.toUpperCase(), link: null, workflow: null });

const offs: (() => void)[] = [];
beforeEach(() => {
  queryClient.clear();
  resetPanelStores();
  useGit.setState({ entries: new Map() });
  useBranchReads.getState().reset();
  useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-16T10:00:00.000Z', generation: 0, capabilities: ['rl2.git-reads'] }]);
  offs.push(connectPanelEvents());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  useBranchReads.getState().reset();
});

describe('the Environment card and Source control’s page (S7)', () => {
  it('say the same uncommitted change and the same pull request, from one scripted state', async () => {
    const file = (path: string, worktree: string, untracked = false) => ({ path, oldPath: null, index: untracked ? '?' : '.', worktree, untracked });
    const main = scmMain({
      status: statusOf({ branch: 'feature/x', upstream: 'origin/feature/x', remoteUrl: 'git@github.com:o/r.git', files: [file('src/a.ts', 'M'), file('src/b.ts', 'M'), file('notes/new.md', '?', true)] }),
      scm: scmStatusOf({ gh: { state: 'ready', path: '/usr/local/bin/gh', version: '2.97.0' } }),
    });
    main.state.diffs.worktree = {
      patch: '',
      files: [
        { path: 'src/a.ts', oldPath: null, insertions: 40, deletions: 9, binary: false },
        { path: 'src/b.ts', oldPath: null, insertions: 8, deletions: 3, binary: false },
      ],
    };
    const pr = prOf({ reviewDecision: 'CHANGES_REQUESTED', checks: { summary: 'fail', items: [check('lint', 'pass'), check('unit tests', 'fail'), check('integration', 'pending'), check('types', 'pass'), check('build', 'pass')] } });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', pr }));
    const session = record(A, { directory: DIR });

    render(
      <QueryClientProvider client={queryClient}>
        <SourceControlPage appSessionId={A} directory={DIR} ui={createPageUi(A, DIR)} visible />
        <Environment appSessionId={A} record={session} folder={workingFolder(session)} fold={{ open: true, onToggle: () => {} }} />
      </QueryClientProvider>,
    );
    const card = () => document.querySelector('section[aria-label="Environment"]')!;
    const page = () => document.querySelector('[data-scm-page]')!;
    await waitFor(() => expect(text(card().querySelector('[data-testid="change-line"]'))).toMatch(/^\+/));
    await waitFor(() => expect(text(card().querySelector('[data-testid="pr-line"]'))).toMatch(/^PR /));
    await waitFor(() => expect(page().querySelector('[data-scm-checks]')).not.toBeNull());

    // the change: the card's "+A −R · N files" (the word cut, P36) against the page's "Uncommitted N +A −R"
    const cardChange = /^\+(\d+) −(\d+) · (\d+) files?/.exec(text(card().querySelector('[data-testid="change-line"]')))!;
    const uncommitted = page().querySelector('[data-scm-part="uncommitted"]')!;
    const pageCounts = /^\+(\d+) −(\d+)$/.exec(text(uncommitted.querySelector('[data-scm-counts]')))!;
    expect({ files: text(uncommitted.querySelector('[data-scm-count]')), insertions: pageCounts[1], deletions: pageCounts[2] }).toEqual({ files: cardChange[3], insertions: cardChange[1], deletions: cardChange[2] });
    expect(cardChange.slice(1)).toEqual(['48', '12', '3']);

    // the pull request: the card's "PR #n · <decision> · <counts>" against the page's heading, state line and counts; the
    // word cut (P44): the card leaves out an open PR's state and the passed checks, which the page still says
    const [cardHead, ...cardDetails] = text(card().querySelector('[data-testid="pr-line"]')).split(' · ');
    const cardNumber = /^PR (\S+)$/.exec(cardHead!)![1];
    const part = page().querySelector('[data-scm-part="pr"]')!;
    expect(text(part.querySelector('[data-scm-pr-number]'))).toBe(cardNumber);
    const phrases = [...part.querySelectorAll('[data-scm-pr-state] [data-scm-phrase]')].map((phrase) => text(phrase).replace(/ ·$/, ''));
    expect(phrases[0]).toBe('Open');
    expect(phrases).toContain(cardDetails[0]); // the review decision
    const cardCounts = cardDetails[1]!.split(', ');
    const pageCounts2 = [...part.querySelectorAll('[data-scm-check-count]')].map(text);
    expect(pageCounts2).toEqual(['3 passed', ...cardCounts]);
    expect(cardCounts).toEqual(['1 failed', '1 pending']);
  });
});
