// The Open PR sheet (E6 execution document, Design §8): the fields, main's plan re-asked 300 ms after the last edit with
// the submit off until the plan shown is the one for the fields shown, gh's repository and the exact command, and the
// refusals that offer their way out (Push first, Install, Sign in). Main is a fake bridge.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { deferred, ok } from '../../test-support/code';
import { A, DIR, OTHER_TOKEN, prPlanOf, refusal, scmMain, scmStatusOf, statusOf, TOKEN } from '../../test-support/scm';
import { PR_REPLAN_MS, PrSheet } from './PrSheet';
import { useScm } from './store';
import { createScmUi, type ScmUi } from './view-state';

const openTerminal = vi.hoisted(() => vi.fn(() => 'terminal-1'));
vi.mock('../terminal', () => ({ openTerminal }));

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;
let release: () => void = () => {};

function open(status: GitStatus = statusOf(), scm: ScmStatus = scmStatusOf()) {
  ui.setState({ sheet: { kind: 'pr' } });
  render(<PrSheet appSessionId={A} ui={ui} status={status} scm={scm} directory={DIR} />);
  return screen.getByRole('dialog', { name: 'Open pull request' });
}
const submitOf = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Create pull request' }) as HTMLButtonElement;
const commandOf = (sheet: HTMLElement) => sheet.querySelector('[data-scm-plan-command]')?.textContent;
const field = (sheet: HTMLElement, name: string) => within(sheet).getByRole('textbox', { name }) as HTMLInputElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const planInput = (over: Record<string, unknown> = {}) => ({ appSessionId: A, title: 'main', body: '', base: 'main', draft: false, ...over });

beforeEach(() => {
  useScm.getState().reset();
  openTerminal.mockClear();
  main = scmMain();
  ui = createScmUi({ session: A });
  release = useScm.getState().resume(A);
});
afterEach(() => {
  release();
  cleanup();
});

describe('push and PR sheets show the plan’s command and destination and run only its token: Open PR', () => {
  it('plans on open with the defaults, shows gh’s repository, the head and the exact command, and creates with only its token', async () => {
    const sheet = open();
    await waitFor(() => expect(commandOf(sheet)).toBe("/opt/homebrew/bin/gh pr create --repo o/r --head main --base main --title=main --body="));
    expect(main.callsOf('scm.pr.plan')).toEqual([planInput()]);
    expect(field(sheet, 'Title').value).toBe('main');
    expect(field(sheet, 'Body').value).toBe(''); // the owner's open question: no prefill
    expect(field(sheet, 'Base').value).toBe('main');
    expect((within(sheet).getByRole('checkbox', { name: 'Draft' }) as HTMLInputElement).checked).toBe(false);
    expect(sheet.querySelector('[data-scm-plan-row="repository"]')?.textContent).toContain('o/r');
    expect(sheet.querySelector('[data-scm-plan-row="head"]')?.textContent).toContain('main');

    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.pr.create')).toEqual([{ appSessionId: A, token: TOKEN }]));
    await waitFor(() => expect(ui.getState().sheet).toBeNull());
    expect(useScm.getState().runs.get(A)).toMatchObject({ token: TOKEN, kind: 'pr', running: true });
  });

  it('defaults the title to HEAD’s subject when the branch is one commit past the default base', async () => {
    main.state.answers['git.log'] = () => ok({ commits: [{ sha: 'a'.repeat(40), shortSha: 'aaaaaaa', author: 'o', authoredAt: '2026-10-06T10:00:00Z', subject: 'Fix the login flow', parents: [] }] });
    main.state.answers['git.worktree.branch'] = () => ok({ repoRoot: DIR, branch: 'fix-login', head: 'a'.repeat(40), checkedOutAt: DIR, base: 'main', ahead: 1, merged: false });
    const sheet = open(statusOf({ branch: 'fix-login', upstream: 'origin/fix-login' }));
    await waitFor(() => expect(field(sheet, 'Title').value).toBe('Fix the login flow'));
    expect(main.callsOf('git.log')).toEqual([{ directory: DIR, limit: 1 }]);
    expect(main.callsOf('git.worktree.branch')).toEqual([{ repoRoot: DIR, branch: 'fix-login' }]);
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toEqual([planInput({ title: 'Fix the login flow' })]));
  });

  it('defaults the title to the branch name in words otherwise', async () => {
    const sheet = open(statusOf({ branch: 'fix-login_flow', upstream: 'origin/fix-login_flow' }));
    await waitFor(() => expect(field(sheet, 'Title').value).toBe('fix login flow'));
  });

  it('re-plans 300 ms after the last edit, once, with Create off from the first keystroke until that plan is shown', async () => {
    const sheet = open();
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Panel' } });
    expect(submitOf(sheet).disabled).toBe(true); // the plan shown is for the old title
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Panel PR' } });
    fireEvent.change(field(sheet, 'Body'), { target: { value: 'Why' } });
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Draft' }));
    await wait(PR_REPLAN_MS / 2);
    expect(main.callsOf('scm.pr.plan')).toHaveLength(1);
    fireEvent.submit(submitOf(sheet).closest('form')!);
    expect(main.callsOf('scm.pr.create')).toEqual([]);

    const answer = deferred<ReturnType<typeof ok>>();
    main.state.answers['scm.pr.plan'] = () => answer.promise;
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toEqual([planInput(), planInput({ title: 'Panel PR', body: 'Why', draft: true })]));
    expect(submitOf(sheet).disabled).toBe(true); // in flight
    answer.resolve(ok(prPlanOf({ token: OTHER_TOKEN, argv: ['pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body=Why', '--draft'] })));
    await waitFor(() => expect(commandOf(sheet)).toBe("/opt/homebrew/bin/gh pr create --repo o/r --head main --base main '--title=Panel PR' --body=Why --draft"));
    expect(submitOf(sheet).disabled).toBe(false);
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.pr.create')).toEqual([{ appSessionId: A, token: OTHER_TOKEN }]));
  });

  it('keeps Create off for a plan answered for fields since edited, and drops an answer a newer ask superseded', async () => {
    const answers = [deferred<ReturnType<typeof ok>>(), deferred<ReturnType<typeof ok>>(), deferred<ReturnType<typeof ok>>()];
    main.state.answers['scm.pr.plan'] = () => answers[main.callsOf('scm.pr.plan').length - 1]!.promise;
    const sheet = open();
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toHaveLength(1));
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Newer' } });
    answers[0]!.resolve(ok(prPlanOf())); // for the title "main", while "Newer" waits out its 300 ms
    await waitFor(() => expect(commandOf(sheet)).toContain('--title=main'));
    expect(sheet.querySelector('[data-scm-plan-stale]')).not.toBeNull(); // shown dimmed, not confirmable
    expect(submitOf(sheet).disabled).toBe(true);

    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toHaveLength(2));
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Newest' } });
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toHaveLength(3));
    answers[2]!.resolve(ok(prPlanOf({ token: OTHER_TOKEN, argv: ['pr', 'create', '--title=Newest'] })));
    await waitFor(() => expect(commandOf(sheet)).toBe('/opt/homebrew/bin/gh pr create --title=Newest'));
    expect(sheet.querySelector('[data-scm-plan-stale]')).toBeNull();
    answers[1]!.resolve(ok(prPlanOf({ argv: ['pr', 'create', '--title=Newer'] }))); // superseded: dropped
    await wait(10);
    expect(commandOf(sheet)).toBe('/opt/homebrew/bin/gh pr create --title=Newest');
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.pr.create')).toEqual([{ appSessionId: A, token: OTHER_TOKEN }]));
  });

  it('asks for a title and a base before planning', async () => {
    const sheet = open(statusOf(), scmStatusOf({ defaultBase: null }));
    await waitFor(() => expect(within(sheet).getByText('Name the base branch')).toBeTruthy());
    expect(main.callsOf('scm.pr.plan')).toEqual([]);
    fireEvent.change(field(sheet, 'Base'), { target: { value: 'develop' } });
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toEqual([planInput({ base: 'develop' })]));
    fireEvent.change(field(sheet, 'Title'), { target: { value: '   ' } });
    await waitFor(() => expect(within(sheet).getByText('Write a title')).toBeTruthy());
    expect(main.callsOf('scm.pr.plan')).toHaveLength(1);
    expect(submitOf(sheet).disabled).toBe(true);
  });

  it('offers Push first on not_pushed, which swaps to the Push sheet', async () => {
    main.state.answers['scm.pr.plan'] = () => ok(refusal('not_pushed', 'main has 1 commit not pushed; push first'));
    const sheet = open();
    await waitFor(() => expect(within(sheet).getByText('main has 1 commit not pushed; push first')).toBeTruthy());
    expect(submitOf(sheet).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Push first' }));
    expect(ui.getState().sheet).toEqual({ kind: 'push' });
  });

  it('offers the install page when gh is missing and a terminal signed in to gh when it is signed out', async () => {
    main.state.answers['scm.pr.plan'] = () => ok(refusal('gh_missing', 'The GitHub CLI (gh) is not installed'));
    let sheet = open();
    await waitFor(() => expect(within(sheet).getByText('The GitHub CLI (gh) is not installed')).toBeTruthy());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Install the GitHub CLI ↗' }));
    await waitFor(() => expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://cli.github.com' }]));
    expect(submitOf(sheet).disabled).toBe(true);
    cleanup();

    main.state.answers['scm.pr.plan'] = () => ok(refusal('gh_unauthenticated', 'You are not logged into any GitHub hosts. To log in, run: gh auth login'));
    sheet = open();
    await waitFor(() => expect(within(sheet).getByText('You are not logged into any GitHub hosts. To log in, run: gh auth login')).toBeTruthy());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign in' }));
    expect(openTerminal).toHaveBeenCalledWith({ appSessionId: A, cwd: DIR, command: 'gh auth login' });
    expect(ui.getState().sheet).toBeNull();
    expect(main.callsOf('scm.pr.create')).toEqual([]);
  });

  it('re-plans with the sentence of what changed when the create answers changed', async () => {
    main.state.answers['scm.pr.create'] = () => ok(refusal('changed', 'upstream changed since the sheet opened; review it again'));
    const sheet = open();
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    main.state.answers['scm.pr.plan'] = () => ok(prPlanOf({ token: OTHER_TOKEN }));
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(within(sheet).getByText('upstream changed since the sheet opened; review it again')).toBeTruthy());
    await waitFor(() => expect(main.callsOf('scm.pr.plan')).toEqual([planInput(), planInput()]));
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    delete main.state.answers['scm.pr.create'];
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.pr.create')).toEqual([
      { appSessionId: A, token: TOKEN },
      { appSessionId: A, token: OTHER_TOKEN },
    ]));
  });
});
