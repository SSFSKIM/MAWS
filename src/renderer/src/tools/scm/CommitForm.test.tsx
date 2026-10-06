// The commit form (E6 execution document, Design §5, T3.3): the message, ⌘Enter, Skip hooks, why Commit is disabled,
// the last commit's line, and a failing hook's words in the notice's output disclosure. Main is a fake bridge.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { GitStatus } from '@shared/ipc/schema/git';
import { ok } from '../../test-support/code';
import { A, refusal, SCRATCH_FILES, scmFile, scmMain, statusOf } from '../../test-support/scm';
import { CommitForm } from './CommitForm';
import { groupsOf } from './groups';
import { Notice } from './Notice';
import { useScm } from './store';
import { createScmUi, type ScmUi } from './view-state';

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;

function renderForm(status: GitStatus = statusOf({ files: SCRATCH_FILES }), trusted: boolean | null = true) {
  return render(
    <>
      <Notice ui={ui} />
      <CommitForm appSessionId={A} ui={ui} groups={groupsOf(status)} trusted={trusted} />
    </>,
  );
}
const message = () => screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement;
const commit = () => screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
const reason = () => document.querySelector('[data-scm-commit-reason]')?.textContent ?? null;

beforeEach(() => {
  useScm.getState().reset();
  main = scmMain();
  ui = createScmUi({ session: A });
});
afterEach(() => cleanup());

describe('the commit form', () => {
  it('says why Commit is disabled: untrusted, conflicts, nothing staged, then an empty message', () => {
    const { rerender } = renderForm(statusOf({ files: SCRATCH_FILES }), null);
    expect(commit().disabled).toBe(true);
    expect(reason()).toBeNull(); // the trust is still being read: disabled, nothing to say yet
    rerender(<CommitForm appSessionId={A} ui={ui} groups={groupsOf(statusOf({ files: SCRATCH_FILES }))} trusted={false} />);
    expect(commit().disabled).toBe(true);
    expect(reason()).toBe('Trust the folder to commit');
    rerender(<CommitForm appSessionId={A} ui={ui} groups={groupsOf(statusOf({ files: [scmFile('f.txt', 'U', 'U'), ...SCRATCH_FILES] }))} trusted />);
    expect(reason()).toBe('Resolve the conflicts first');
    rerender(<CommitForm appSessionId={A} ui={ui} groups={groupsOf(statusOf({ files: [scmFile('a.ts', '.', 'M')] }))} trusted />);
    expect(reason()).toBe('Nothing staged');
    rerender(<CommitForm appSessionId={A} ui={ui} groups={groupsOf(statusOf({ files: SCRATCH_FILES }))} trusted />);
    expect(reason()).toBe('Write a commit message');
    fireEvent.change(message(), { target: { value: '   ' } });
    expect(commit().disabled).toBe(true);
    fireEvent.change(message(), { target: { value: 'From the panel' } });
    expect(commit().disabled).toBe(false);
    expect(reason()).toBeNull();
  });

  it('keeps the draft in the tool’s state and commits it with ⌘Enter, Skip hooks included', async () => {
    main.state.answers['scm.commit'] = () => ok({ ok: true, status: statusOf(), output: '', commit: { sha: 'abc1234def5678', subject: 'From the panel' } });
    renderForm();
    fireEvent.change(message(), { target: { value: 'From the panel\n\nThe body.' } });
    expect(ui.getState().message).toBe('From the panel\n\nThe body.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Skip hooks/ }));
    expect(ui.getState().noVerify).toBe(true);
    fireEvent.keyDown(message(), { key: 'Enter' }); // Enter alone is a newline
    expect(main.callsOf('scm.commit')).toEqual([]);
    fireEvent.keyDown(message(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(main.callsOf('scm.commit')).toEqual([{ appSessionId: A, message: 'From the panel\n\nThe body.', noVerify: true }]));
    await waitFor(() => expect(document.querySelector('[data-scm-last-commit]')?.textContent).toBe('abc1234 · From the panel'));
    expect(message().value).toBe('');
    expect((screen.getByRole('checkbox', { name: /Skip hooks/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('commits from the button, and refuses ⌘Enter while Commit is disabled', async () => {
    renderForm(statusOf({ files: [scmFile('a.ts', '.', 'M')] }));
    fireEvent.change(message(), { target: { value: 'Nothing staged yet' } });
    fireEvent.keyDown(message(), { key: 'Enter', metaKey: true });
    expect(main.callsOf('scm.commit')).toEqual([]);
    cleanup();
    renderForm();
    fireEvent.click(commit());
    await waitFor(() => expect(main.callsOf('scm.commit')).toEqual([{ appSessionId: A, message: 'Nothing staged yet', noVerify: false }]));
  });

  it('shows a failing hook’s words in the notice’s output and keeps the draft', async () => {
    main.state.answers['scm.commit'] = () => ok(refusal('git_failed', 'nope', 'nope\n'));
    renderForm();
    fireEvent.change(message(), { target: { value: 'Will fail' } });
    fireEvent.click(commit());
    const notice = await screen.findByRole('alert');
    expect(notice.querySelector('[data-scm-notice-text]')?.textContent).toBe('git failed: nope');
    fireEvent.click(within(notice).getByText('Output'));
    expect(notice.querySelector('pre')?.textContent).toBe('nope\n');
    expect(message().value).toBe('Will fail');
    expect(document.querySelector('[data-scm-last-commit]')).toBeNull();
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Committing… and disables the button while the commit runs', async () => {
    let release!: () => void;
    main.state.answers['scm.commit'] = () => new Promise((resolve) => (release = () => resolve(ok({ ok: true, status: statusOf(), output: '' }))));
    renderForm();
    fireEvent.change(message(), { target: { value: 'Slow hooks' } });
    fireEvent.click(commit());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Committing…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Committing…' }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(commit()).toBeTruthy());
  });
});
