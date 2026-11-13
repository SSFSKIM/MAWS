// The Source control tool's X5 declaration (E6 execution document, Design §5, T3.4) over C8a's host, under the React
// Compiler as the app builds it: registration and the surface overflow, `open({ target })` with a relative and an absolute
// path, and a pinned tool starting over for another session while each session keeps its commit draft.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { record } from '../../../../../test/support/builders';
import { panelHost } from '../../panel/host';
import { SurfaceRow } from '../../panel/SurfaceRow';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { panelOf, resetPanelStores, TestHost } from '../../test-support/panel';
import { A, B, DIR, scmMain, stubCanvas } from '../../test-support/scm';
import { at } from '../../../../../test/support/machine'; // P5 O6 M2: the page's ids; scm's A and B are main's
import { useViewer } from '../code/viewer/viewer-store';
import { registerScmTool, SCM_TOOL_ID, type ScmParams } from './index';
import { useScm } from './store';

vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
stubCanvas();

const offs: (() => void)[] = [];
let main: ReturnType<typeof scmMain>;

const openScm = (params?: ScmParams, pin = false) => act(() => void panelHost.addTool(SCM_TOOL_ID, { appSessionId: at(A), params, pin }));
const draft = () => screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement;
const selectedRow = () => document.querySelector<HTMLElement>('[data-scm-select][aria-current="true"]')?.closest<HTMLElement>('[data-scm-row]')?.dataset.path ?? null;
const fileHeader = () => document.querySelector('[data-scm-file-header]')?.textContent;

beforeEach(() => {
  resetPanelStores();
  useScm.getState().reset();
  useViewer.getState().reset();
  main = scmMain();
  useSessions.setState((s) => ({ records: new Map(s.records).set(at(A), record(at(A), { directory: DIR })).set(at(B), record(at(B), { directory: '/repo-b' })) }));
  offs.push(registerScmTool());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

describe('the source control tool’s registration', () => {
  it('registers Source control as a pinnable single-instance tool offered from More surfaces', async () => {
    const tool = panelHost.tools().find((candidate) => candidate.id === 'source-control')!;
    expect(tool).toMatchObject({ title: 'Source control', pinnable: true, multiInstance: false });
    expect(tool.summary).toBeUndefined();
    const user = userEvent.setup();
    render(<><SurfaceRow /><TestHost /></>);
    await user.click(screen.getByRole('button', { name: 'More surfaces' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Source control' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unstaged' })).toBeTruthy());
    expect(main.callsOf('git.watch')).toContainEqual({ directory: DIR });
  });

  it('selects an open() target, a relative path or an absolute one inside the checkout, in whichever group lists it', async () => {
    openScm({ target: 'src/app.ts' });
    render(<TestHost />);
    await waitFor(() => expect(fileHeader()).toBe('src/app.ts · Modified'));
    openScm({ target: `${DIR}/src/staged.ts` }); // re-targets the open tab (single instance)
    await waitFor(() => expect(fileHeader()).toBe('src/staged.ts · Added'));
    expect(panelOf(at(A))!.tabs).toHaveLength(1);
    expect(selectedRow()).toBe('src/staged.ts');
  });

  it('starts a pinned tool over for another session, and gives each session its own commit draft back', async () => {
    openScm(undefined, true);
    render(<TestHost />);
    const tabId = useLayout.getState().panelPinned[0].id;
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unstaged' })).toBeTruthy());
    fireEvent.change(draft(), { target: { value: 'Draft for A' } });
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-scm-row][data-path="src/app.ts"] [data-scm-select]')!);
    expect(selectedRow()).toBe('src/app.ts');
    act(() => useLayout.getState().openSession(at(B)));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: '/repo-b' }));
    await waitFor(() => expect(draft().value).toBe(''));
    expect(selectedRow()).toBeNull();
    act(() => useLayout.getState().openSession(at(A)));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(draft().value).toBe('Draft for A'));
    expect(selectedRow()).toBeNull(); // the selection was the other checkout's moment, as Review's
  });

  it('closes without asking: a draft is state the host drops with the tab', async () => {
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unstaged' })).toBeTruthy());
    fireEvent.change(draft(), { target: { value: 'Unsaved draft' } });
    await act(() => panelHost.closeTab(panelOf(at(A))!.tabs[0].id));
    expect(panelOf(at(A))!.tabs).toEqual([]);
  });
});

// UX wave U8c-2 (M4 decision 6, §I): the page starts over in the agent's new folder as it does for another session, the
// commit message kept; while the session is away from its launch folder it draws its reads and none of its acts.
describe('the agent away from the launch folder', () => {
  const WT = `${DIR}/.claude/worktrees/w1`;
  const moveTo = (checkout: string | null) =>
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(at(A), record(at(A), { directory: DIR, ...(checkout ? { agentFolder: { checkout, cwd: checkout, branch: 'w1', linked: true } } : {}) })) })));
  const acts = () => document.querySelectorAll('[data-scm-action], [data-scm-remote-action="push"], [data-scm-remote-action="pr"], [data-scm-sheet]').length;
  const unstaged = () => screen.getByRole('region', { name: 'Unstaged' });

  it('draws the page’s reads and no act while the session is moved, and every act again at the launch folder, the commit message kept', async () => {
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(unstaged()).toBeTruthy());
    fireEvent.change(draft(), { target: { value: 'Keep me' } });
    expect(acts()).toBeGreaterThan(0);
    moveTo(WT);
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: WT }));
    await waitFor(() => expect(unstaged()).toBeTruthy());
    expect(document.querySelector('[data-scm-header]')?.textContent).toContain('main'); // the branch line
    expect(acts()).toBe(0); // no Push or Open PR, no button on a row or a group, no sheet
    expect(screen.queryByRole('textbox', { name: 'Commit message' })).toBeNull(); // no commit form
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-scm-row][data-path="src/app.ts"] [data-scm-select]')!);
    await waitFor(() => expect(fileHeader()).toBe('src/app.ts · Modified')); // its diff is a read
    moveTo(null);
    await waitFor(() => expect(draft().value).toBe('Keep me'));
    expect(acts()).toBeGreaterThan(0);
  });

  // Held open: a Discard sheet is open on the launch folder's page when the agent moves.
  it('closes a sheet open at a move and clears the selection, leaving no control to confirm it', async () => {
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(unstaged()).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-scm-row][data-path="src/app.ts"] [data-scm-select]')!);
    expect(selectedRow()).toBe('src/app.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes to src/app.ts' }));
    await waitFor(() => expect(document.querySelector('[data-scm-sheet="discard"]')).not.toBeNull());
    moveTo(WT);
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: WT }));
    await waitFor(() => expect(unstaged()).toBeTruthy());
    expect(document.querySelector('[data-scm-sheet]')).toBeNull();
    expect(selectedRow()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Discard/ })).toBeNull();
    moveTo(null);
    await waitFor(() => expect(draft()).toBeTruthy());
    expect(document.querySelector('[data-scm-sheet]')).toBeNull(); // the sheet is not opened again on return
    expect(selectedRow()).toBeNull();
  });
});
