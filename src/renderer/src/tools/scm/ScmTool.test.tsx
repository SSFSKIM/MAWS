// The Source control tool's X5 declaration (E6 execution document, Design §5, T3.4) over C8a's host, under the React
// Compiler as the app builds it: registration and the "+" menu, `open({ target })` with a relative and an absolute
// path, and a pinned tool starting over for another session while each session keeps its commit draft.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { record } from '../../../../../test/support/builders';
import { panelHost } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { panelOf, resetPanelStores, TestHost } from '../../test-support/panel';
import { A, B, DIR, scmMain, stubCanvas } from '../../test-support/scm';
import { useViewer } from '../code/viewer/viewer-store';
import { registerScmTool, SCM_TOOL_ID, type ScmParams } from './index';
import { useScm } from './store';

vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
stubCanvas();

const offs: (() => void)[] = [];
let main: ReturnType<typeof scmMain>;

const openScm = (params?: ScmParams, pin = false) => act(() => void panelHost.addTool(SCM_TOOL_ID, { appSessionId: A, params, pin }));
const draft = () => screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement;
const selectedRow = () => document.querySelector<HTMLElement>('[data-scm-select][aria-current="true"]')?.closest<HTMLElement>('[data-scm-row]')?.dataset.path ?? null;
const fileHeader = () => document.querySelector('[data-scm-file-header]')?.textContent;

beforeEach(() => {
  resetPanelStores();
  useScm.getState().reset();
  useViewer.getState().reset();
  main = scmMain();
  useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: DIR })).set(B, record(B, { directory: '/repo-b' })) }));
  offs.push(registerScmTool());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

describe('the source control tool’s registration', () => {
  it('registers Source control as a pinnable single-instance tool offered from "+"', async () => {
    const tool = panelHost.tools().find((candidate) => candidate.id === 'source-control')!;
    expect(tool).toMatchObject({ title: 'Source control', pinnable: true, multiInstance: false });
    expect(tool.summary).toBeUndefined();
    const user = userEvent.setup();
    render(<TestHost />);
    await user.click(screen.getByRole('button', { name: 'Add a tool' }));
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
    expect(panelOf(A)!.tabs).toHaveLength(1);
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
    act(() => useLayout.getState().openSession(B));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: '/repo-b' }));
    await waitFor(() => expect(draft().value).toBe(''));
    expect(selectedRow()).toBeNull();
    act(() => useLayout.getState().openSession(A));
    act(() => panelHost.selectTab(tabId));
    await waitFor(() => expect(draft().value).toBe('Draft for A'));
    expect(selectedRow()).toBeNull(); // the selection was the other checkout's moment, as Review's
  });

  it('closes without asking: a draft is state the host drops with the tab', async () => {
    openScm();
    render(<TestHost />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unstaged' })).toBeTruthy());
    fireEvent.change(draft(), { target: { value: 'Unsaved draft' } });
    await act(() => panelHost.closeTab(panelOf(A)!.tabs[0].id));
    expect(panelOf(A)!.tabs).toEqual([]);
  });
});
