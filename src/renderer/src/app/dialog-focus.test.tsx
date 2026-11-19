// Where the keyboard goes when a dialog that uses `useDialogFocus` closes (UX wave U11a M3, fix wave 3: e2e run
// 43359967651's stacked dialogs). To the opener it remembered while that is still in the document, as before; when it
// is gone (a menu item, removed with its menu) and nothing else took the keyboard, to the topmost dialog still open under
// the closing one, so a sheet over the Plugins dialog hands the keyboard back to the dialog; with no dialog under it,
// where it was before.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef } from 'react';
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

type Seen = { before: Element | null; after: Element | null }[];

/** The palette's case: a triggerless dialog with the hook, opened from an opener, and a sidebar row outside it that
 * takes the keyboard in the effect after the render that closes the dialog, as the reveal's row does
 * (`sidebar/Sidebar.tsx`'s pending focus). Where the keyboard was when the close's autofocus ran, and after it. */
function Revealing({ open, reveal, seen }: { open: boolean; reveal: boolean; seen: Seen }) {
  const focus = useDialogFocus();
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (reveal) row.current?.focus();
  }, [reveal]);
  return (
    <>
      <button type="button">Opener</button>
      <button type="button" ref={row}>Project row</button>
      <Dialog.Root open={open}>
        <Dialog.Portal>
          <Dialog.Content
            {...focus}
            onCloseAutoFocus={(event) => {
              const before = document.activeElement;
              focus.onCloseAutoFocus(event);
              seen.push({ before, after: document.activeElement });
            }}
            aria-describedby={undefined}
          >
            <Dialog.Title>Palette</Dialog.Title>
            <input aria-label="Query" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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

  // UX wave U6b-5a M5's re-review: the late restore's order, pinned here rather than by a forced frame order in
  // e2e/palette.spec.ts, since nothing on the palette's close asks for a frame.
  it('runs the close’s autofocus after a row the closing press focused has the keyboard, and leaves it there; a close that moved nothing gives it back to the opener', async () => {
    const seen: Seen = [];
    const view = render(<Revealing open={false} reveal={false} seen={seen} />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    const row = screen.getByRole('button', { name: 'Project row' });
    const query = () => screen.getByRole('textbox', { name: 'Query' });

    // the control: opened from the opener, closed with nothing moved, the opener has the keyboard back
    act(() => opener.focus());
    view.rerender(<Revealing open reveal={false} seen={seen} />);
    await waitFor(() => expect(document.activeElement).toBe(query()));
    view.rerender(<Revealing open={false} reveal={false} seen={seen} />);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.after).toBe(opener);
    expect(document.activeElement).toBe(opener);

    // the reveal: the same opening, closed by a render that gives the row the keyboard
    view.rerender(<Revealing open reveal={false} seen={seen} />);
    await waitFor(() => expect(document.activeElement).toBe(query()));
    view.rerender(<Revealing open={false} reveal seen={seen} />);
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]!.before, 'the row had the keyboard when the close’s autofocus ran').toBe(row);
    expect(seen[1]!.after, 'and keeps it').toBe(row);
    expect(document.activeElement).toBe(row);
  });
});
