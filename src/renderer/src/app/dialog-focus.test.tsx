// Where the keyboard goes when a dialog that uses `useDialogFocus` closes (UX wave U11a M3, fix wave 3: e2e run
// 43359967651's stacked dialogs). To the opener it remembered while that is still in the document, as before; when it
// is gone (a menu item, removed with its menu) and nothing else took the keyboard, to the topmost dialog still open under
// the closing one, so a sheet over the Plugins dialog hands the keyboard back to the dialog; with no dialog under it,
// where it was before.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Dialog } from 'radix-ui';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogFocus } from './dialog-focus';

/** A sheet as `Sheet` draws one: mounted open, its focus from the hook. */
function Over() {
  const focus = useDialogFocus();
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Content {...focus} aria-describedby={undefined} data-over="">
          <Dialog.Title>Over</Dialog.Title>
          <button type="button">Confirm</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A dialog open under the sheet (the Plugins dialog), holding the opener the sheet remembers. */
function Under({ opener }: { opener: boolean }) {
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined} data-under="">
          <Dialog.Title>Under</Dialog.Title>
          {opener && <button type="button">Uninstall…</button>}
          <button type="button">Back</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Window({ under, opener, over, outside = false }: { under: boolean; opener: boolean; over: boolean; outside?: boolean }) {
  return (
    <>
      {outside && opener && <button type="button">Uninstall…</button>}
      {under && <Under opener={opener && !outside} />}
      {over && <Over />}
    </>
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
const opener = () => screen.getByRole('button', { name: 'Uninstall…', hidden: true });

afterEach(cleanup);

describe('useDialogFocus, as a dialog closes', () => {
  it('hands the keyboard to the dialog still open under it when its opener has left the document', async () => {
    const view = render(<Window under opener over={false} />);
    await settle();
    act(() => opener().focus());
    view.rerender(<Window under opener over />); // the sheet mounts on the opener's press, remembering it
    await settle();
    view.rerender(<Window under opener={false} over />); // the opener leaves, as a menu's item does with its menu
    await settle();
    view.rerender(<Window under opener={false} over={false} />);
    await waitFor(() => expect(document.querySelector('[data-under]')!.contains(document.activeElement)).toBe(true));
  });

  it('leaves the keyboard where it was before when no dialog is under it', async () => {
    const view = render(<Window under={false} opener outside over={false} />);
    act(() => opener().focus());
    view.rerender(<Window under={false} opener outside over />);
    await settle();
    view.rerender(<Window under={false} opener={false} outside over />);
    await settle();
    view.rerender(<Window under={false} opener={false} outside over={false} />);
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('returns the keyboard to its opener while that is still in the document, as before', async () => {
    const view = render(<Window under opener over={false} />);
    await settle();
    act(() => opener().focus());
    view.rerender(<Window under opener over />);
    await settle();
    expect(document.querySelector('[data-over]')!.contains(document.activeElement)).toBe(true);
    view.rerender(<Window under opener over={false} />);
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });
});
