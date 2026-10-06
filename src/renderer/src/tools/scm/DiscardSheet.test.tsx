// The Discard sheet (E6 execution document, Design §8): every path it will touch, the sentence of what happens, and
// the acknowledgement that alone enables the destructive submit (Enter never destroys anything). Main is a fake bridge.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { fail, ok } from '../../test-support/code';
import { A, refusal, scmMain } from '../../test-support/scm';
import { DiscardSheet } from './DiscardSheet';
import { useScm } from './store';
import { createScmUi, type ScmSheet, type ScmUi } from './view-state';

type Entries = Extract<ScmSheet, { kind: 'discard' }>['entries'];

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;

function open(entries: Entries) {
  ui.setState({ sheet: { kind: 'discard', entries } });
  return render(<DiscardSheet appSessionId={A} ui={ui} entries={entries} />);
}
const paths = (sheet: HTMLElement) => [...sheet.querySelectorAll('[data-scm-sheet-path]')].map((el) => el.textContent);

beforeEach(() => {
  useScm.getState().reset();
  main = scmMain();
  ui = createScmUi({ session: A });
});
afterEach(() => cleanup());

describe('discard sheet names every file and needs the acknowledgement', () => {
  it('lists every unstaged path, says what happens, and keeps Discard disabled until the acknowledgement', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ path: `src/file-${i}.ts`, group: 'unstaged' as const }));
    open(entries);
    const sheet = screen.getByRole('dialog', { name: 'Discard changes' });
    expect(paths(sheet)).toEqual(entries.map((entry) => entry.path)); // every one; no "and N more"
    expect(within(sheet).getByText('Restores 12 files to their staged content')).toBeTruthy();
    const submit = within(sheet).getByRole('button', { name: 'Discard' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!); // Enter alone
    expect(main.callsOf('scm.discard')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Discard 12 changes; this cannot be undone' }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(main.callsOf('scm.discard')).toEqual([{ appSessionId: A, entries }]));
    await waitFor(() => expect(ui.getState().sheet).toBeNull());
  });

  it('names the untracked case as a deletion, with its own sentence and acknowledgement', () => {
    open([{ path: 'untracked.txt', group: 'untracked' }]);
    const sheet = screen.getByRole('dialog', { name: 'Delete untracked files' });
    expect(paths(sheet)).toEqual(['untracked.txt']);
    expect(within(sheet).getByText('Deletes 1 file git has never tracked')).toBeTruthy();
    expect(within(sheet).getByRole('checkbox', { name: 'Delete 1 file; this cannot be undone' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('says both sentences when the entries hold both groups', () => {
    open([
      { path: 'a.ts', group: 'unstaged' },
      { path: 'b.txt', group: 'untracked' },
    ]);
    const sheet = screen.getByRole('dialog', { name: 'Discard changes' });
    expect(within(sheet).getByText('Restores 1 file to their staged content')).toBeTruthy();
    expect(within(sheet).getByText('Deletes 1 file git has never tracked')).toBeTruthy();
    expect(within(sheet).getByRole('checkbox', { name: 'Discard 2 changes; this cannot be undone' })).toBeTruthy();
  });

  it('shows a refusal in the sheet with what git printed and stays open; a failed call too', async () => {
    main.state.answers['scm.discard'] = () => ok(refusal('unmerged', '"a.ts" has a merge conflict; resolve it in the file or a terminal'));
    open([{ path: 'a.ts', group: 'unstaged' }]);
    const sheet = screen.getByRole('dialog', { name: 'Discard changes' });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(within(sheet).getByText('"a.ts" has a merge conflict; resolve it in the file or a terminal')).toBeTruthy());
    expect(ui.getState().sheet).not.toBeNull();

    main.state.answers['scm.discard'] = () => fail('unknown app session: app-a');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(within(sheet).getByText('Failed: unknown app session: app-a')).toBeTruthy());
    expect(ui.getState().sheet).not.toBeNull();
  });

  it('closes on Cancel without discarding anything', () => {
    open([{ path: 'a.ts', group: 'unstaged' }]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(ui.getState().sheet).toBeNull();
    expect(main.callsOf('scm.discard')).toEqual([]);
  });
});
