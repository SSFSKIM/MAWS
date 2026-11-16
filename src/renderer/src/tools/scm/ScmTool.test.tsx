// The Source control tool's X5 declaration over C8a's host, under the React Compiler as the app builds it (E6 execution
// document, Design §5; UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M10 and §H):
// registration and the surface overflow; the tool mounts Source control's page, takes no params, and its state is the
// page's own two folds (the commit list shown whole, the passed checks listed), reset when the session or its working
// folder changes. Nothing of the acting pane is mounted.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { record } from '../../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../../test/support/machine'; // P5 O6 M2: the page's ids; scm's A and B are main's
import { connectPanelEvents } from '../../ipc/events';
import { panelHost } from '../../panel/host';
import { SurfaceRow } from '../../panel/SurfaceRow';
import { useLayout } from '../../stores/layout';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { ok } from '../../test-support/code';
import { panelOf, resetPanelStores, TestHost } from '../../test-support/panel';
import { A, B, branchCommitsOf, DIR, prOf, prStateOf, scmMain, scmStatusOf, statusOf } from '../../test-support/scm';
import { useBranchReads } from '../code/review/branch-read';
import { registerScmTool, SCM_TOOL_ID } from './index';

const offs: (() => void)[] = [];
let main: ReturnType<typeof scmMain>;

const openScm = (pin = false) => act(() => void panelHost.addTool(SCM_TOOL_ID, { appSessionId: at(A), pin }));
const rows = () => document.querySelectorAll('[data-scm-commit]').length;
const showAll = () => fireEvent.click(screen.getByRole('button', { name: 'Show all 12 commits' }));
const passed = () => screen.queryByRole('button', { name: '2 passed' });

beforeEach(() => {
  resetPanelStores();
  useBranchReads.getState().reset();
  main = scmMain({ status: statusOf({ branch: 'feature/x', upstream: 'origin/feature/x' }), scm: scmStatusOf({ gh: { state: 'ready', path: '/usr/local/bin/gh', version: '2.97.0' } }) });
  main.state.branch = branchCommitsOf({ all: 12, notPushed: 2 });
  const check = (name: string) => ({ name, bucket: 'pass' as const, state: 'SUCCESS', link: null, workflow: null });
  main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', pr: prOf({ checks: { summary: 'pass', items: [check('lint'), check('build')] } }) }));
  useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-16T10:00:00.000Z', generation: 0, capabilities: ['rl2.git-reads'] }]);
  useSessions.setState((s) => ({ records: new Map(s.records).set(at(A), record(at(A), { directory: DIR })).set(at(B), record(at(B), { directory: '/repo-b' })) }));
  offs.push(connectPanelEvents(), registerScmTool());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  useBranchReads.getState().reset();
});

describe('the source control tool’s registration', () => {
  it('registers Source control as a pinnable single-instance tool offered from More surfaces, which mounts the page', async () => {
    const tool = panelHost.tools().find((candidate) => candidate.id === 'source-control')!;
    expect(tool).toMatchObject({ title: 'Source control', pinnable: true, multiInstance: false });
    expect(tool.summary).toBeUndefined();
    expect(tool.open).toBeUndefined(); // the tool takes no params
    const user = userEvent.setup();
    render(<><SurfaceRow /><TestHost /></>);
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Source control' }));
    await waitFor(() => expect(rows()).toBe(8));
    expect(main.callsOf('git.watch')).toContainEqual({ directory: DIR });
    // only the page's reads are asked of the scm service: nothing of the acting pane runs (its markers and commands are
    // held out of the source by test/source-control-reads-only.test.ts)
    expect(main.calls.map((call) => call.name).filter((name) => name.startsWith('scm.') && name !== 'scm.status' && name !== 'scm.pr.state')).toEqual([]);
  });

  it('closes without asking', async () => {
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(rows()).toBe(8));
    await act(() => panelHost.closeTab(panelOf(at(A))!.tabs[0].id));
    expect(panelOf(at(A))!.tabs).toEqual([]);
  });
});

describe('the page’s two folds', () => {
  it('keeps the list shown whole and the passed checks listed while the session is shown, and folds both for another session and on return', async () => {
    openScm(true);
    render(<TestHost />);
    const tabId = useLayout.getState().panelPinned[0].id;
    await waitFor(() => expect(rows()).toBe(8));
    showAll();
    await waitFor(() => expect(passed()).not.toBeNull());
    fireEvent.click(passed()!);
    expect(rows()).toBe(12);
    expect(passed()!.getAttribute('aria-expanded')).toBe('true');
    act(() => useLayout.getState().openSession(at(B)));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: '/repo-b' }));
    await waitFor(() => expect(rows()).toBe(8));
    expect(passed()?.getAttribute('aria-expanded')).not.toBe('true');
    act(() => useLayout.getState().openSession(at(A)));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(rows()).toBe(8));
    await waitFor(() => expect(passed()?.getAttribute('aria-expanded')).toBe('false'));
  });

  it('folds both when the session’s working folder changes', async () => {
    const WT = `${DIR}/.claude/worktrees/w1`;
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(rows()).toBe(8));
    showAll();
    expect(rows()).toBe(12);
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(at(A), record(at(A), { directory: DIR, agentFolder: { checkout: WT, cwd: WT, branch: 'w1', linked: true } })) })));
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: WT }));
    await waitFor(() => expect(rows()).toBe(8));
  });
});
