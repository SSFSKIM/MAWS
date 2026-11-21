// The row note and the pointed-row line (the word cut, "What the cut builds"): hidden at rest and the row's accessible
// description all the time; shown on pointing after the short delay and at once on keyboard focus anywhere in the row;
// closed once the pointer and the focus have both left (G15). Acceptance 4's cases a plain row does not cover close the
// file: a greyed control, a read-only field and a native select, each revealed with the keyboard alone.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_MOTION } from './disclosure';
import { POINTING_DELAY_MS } from './pointing';
import { placeOpenNotes, RowNote, useRowNote } from './row-note';
import { accessibleText } from '../test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { UnavailableButton } from './tip';

const NOTE = 'Archived sessions can be restored from the sidebar.';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function Row({ label = 'Archive', note = NOTE }: { label?: string; note?: string }) {
  const rowNote = useRowNote();
  return (
    <div role="group" aria-label={label} {...rowNote.rowProps}>
      <span>{label}</span>
      <button type="button">Open {label}</button>
      <RowNote note={rowNote}>
        {note}
      </RowNote>
    </div>
  );
}
const row = (name = 'Archive') => screen.getByRole('group', { name });
const shown = (name = 'Archive') => accessibleText(row(name)).includes(NOTE);

describe('the row note', () => {
  it('is absent from the resting text and is the row’s accessible description', () => {
    render(<Row />);
    expect(accessibleText(row())).toBe('ArchiveOpen Archive');
    expect(screen.getByRole('group', { name: 'Archive', description: NOTE })).toBe(row());
  });

  it('shows on pointing after the short delay, and closes when the pointer leaves', async () => {
    render(<Row />);
    const pointer = user();
    await pointer.hover(row());
    wait(POINTING_DELAY_MS - 1);
    expect(shown()).toBe(false);
    wait(1);
    expect(shown()).toBe(true);
    expect(screen.getByRole('group', { name: 'Archive', description: NOTE })).toBe(row());
    await pointer.unhover(row());
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(false);
  });

  it('shows nothing for a pointer that passes over the row within the delay', async () => {
    render(<Row />);
    const pointer = user();
    await pointer.hover(row());
    wait(POINTING_DELAY_MS / 2);
    await pointer.unhover(row());
    wait(POINTING_DELAY_MS);
    expect(shown()).toBe(false);
  });

  it('shows at once on keyboard focus anywhere in the row, and stays while focus moves inside it', async () => {
    render(
      <>
        <button type="button">Before</button>
        <Row />
      </>,
    );
    const keys = user();
    await keys.tab();
    expect(shown()).toBe(false);
    await keys.tab(); // into the row's control: no delay
    expect(screen.getByRole('button', { name: 'Open Archive' })).toBe(document.activeElement);
    expect(shown()).toBe(true);
  });

  it('closes when focus leaves the row, unless the pointer is still on it', async () => {
    render(
      <>
        <Row />
        <button type="button">After</button>
      </>,
    );
    const keys = user();
    await keys.tab();
    expect(shown()).toBe(true);
    await keys.tab(); // out of the row
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(false);

    await keys.tab({ shift: true }); // back in, then the pointer comes too
    await keys.hover(row());
    wait(POINTING_DELAY_MS);
    await keys.tab(); // focus leaves; the pointer holds it open
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(true);
    await keys.unhover(row());
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(false);
  });

  it('stays open while focus is in the row after the pointer has left', async () => {
    render(<Row />);
    const keys = user();
    await keys.hover(row());
    wait(POINTING_DELAY_MS);
    await keys.tab();
    await keys.unhover(row());
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(true);
  });

  it('stays open when focus hands over to a pointer that has not yet waited out the delay, and back', async () => {
    render(
      <>
        <Row />
        <button type="button">After</button>
      </>,
    );
    const note = () => screen.getByText(NOTE).closest('[data-row-note]')!;
    const keys = user();
    await keys.tab(); // focus opens it
    await keys.hover(row());
    wait(POINTING_DELAY_MS / 3);
    await keys.tab(); // focus leaves while the pointer is inside, before its delay has run
    expect(note().hasAttribute('data-open')).toBe(true); // no close was started
    wait(POINTING_DELAY_MS);
    expect(shown()).toBe(true);
    await keys.tab({ shift: true }); // and back: the pointer leaves while focus is inside
    await keys.unhover(row());
    expect(note().hasAttribute('data-open')).toBe(true);
    await keys.tab();
    wait(CLOSE_MOTION.ms);
    expect(shown()).toBe(false); // both have left
  });

  it('moving down onto the next row closes the first row’s note and opens the next one’s after its delay', async () => {
    // happy-dom does no hit-testing: the floating note lets the pointer through (pointer-events-none), so the pointer
    // moving down lands on the next row, as here.
    render(
      <>
        <Row label="Archive" />
        <Row label="Restore" note="Restored sessions return to their project." />
      </>,
    );
    expect(screen.getByText(NOTE).closest('[data-row-note]')!.className).toContain('pointer-events-none');
    const pointer = user();
    await pointer.hover(row('Archive'));
    wait(POINTING_DELAY_MS);
    expect(shown('Archive')).toBe(true);
    await pointer.hover(row('Restore'));
    expect(screen.getByText(NOTE).closest('[data-row-note]')!.hasAttribute('data-open')).toBe(false);
    wait(POINTING_DELAY_MS);
    expect(accessibleText(row('Restore'))).toContain('Restored sessions return to their project.');
  });

  it('closes once focus lands outside the row after its focused control was removed', async () => {
    function Binary({ installed }: { installed: boolean }) {
      const rowNote = useRowNote();
      return (
        <div role="group" aria-label="Binary" {...rowNote.rowProps}>
          <span>Binary</span>
          {!installed && <button type="button">Use installed</button>}
          <RowNote note={rowNote}>{NOTE}</RowNote>
        </div>
      );
    }
    const view = render(
      <>
        <Binary installed={false} />
        <button type="button">After</button>
      </>,
    );
    const keys = user();
    await keys.tab();
    expect(shown('Binary')).toBe(true);
    view.rerender(
      <>
        <Binary installed />
        <button type="button">After</button>
      </>,
    ); // the focused control goes with its row's change, and no blur reaches the row
    await keys.tab(); // focus lands outside the row
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    wait(CLOSE_MOTION.ms);
    expect(shown('Binary')).toBe(false);
  });

  it('keyboard focus landing in another row closes this row’s note at once, pointer or not; only a new pointing reopens it', async () => {
    render(
      <>
        <Row label="Archive" />
        <Row label="Restore" note="Restored sessions return to their project." />
      </>,
    );
    const note = () => screen.getByText(NOTE).closest<HTMLElement>('[data-row-note]')!;
    const keys = user();
    await keys.hover(row('Archive'));
    wait(POINTING_DELAY_MS);
    await keys.tab(); // Archive's button
    await keys.tab(); // on to Restore's: the pointer still rests on Archive
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Restore' }));
    expect(note().hasAttribute('data-open')).toBe(false);
    expect(note().hidden).toBe(true); // no exit motion drawn over the row that took the keyboard
    wait(POINTING_DELAY_MS * 3);
    expect(shown('Archive')).toBe(false); // the resting pointer does not bring it back
    await keys.unhover(row('Archive'));
    await keys.hover(row('Archive'));
    wait(POINTING_DELAY_MS);
    expect(shown('Archive')).toBe(true);
    await keys.unhover(row('Archive'));
    await keys.tab({ shift: true }); // the keyboard alone, no pointer: Tab on into Restore again
    expect(shown('Archive')).toBe(true);
    await keys.tab();
    expect(note().hidden).toBe(true); // its close draws no exit motion over Restore either
  });

  it('gives each row its own note', async () => {
    render(
      <>
        <Row label="Archive" />
        <Row label="Restore" note="Restored sessions return to their project." />
      </>,
    );
    expect(screen.getByRole('group', { name: 'Restore', description: 'Restored sessions return to their project.' })).toBeTruthy();
    await user().tab();
    expect(shown('Archive')).toBe(true);
    expect(accessibleText(row('Restore'))).toBe('RestoreOpen Restore');
  });
});

// The note floats over the rows that follow, so no row moves; it opens upward where opening down would pass the bottom
// of the scroll area it sits in, and there is room above. happy-dom has no layout: the boxes and the note's height are
// given.
describe('where the floating note opens', () => {
  const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  const place = (row: DOMRect) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 60 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'scroller') return box(0, 400);
      if (this.getAttribute('role') === 'group') return row;
      return box(0, 0);
    });
  };
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  });
  const inScroller = () => (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <Row />
    </div>
  );
  const side = () => screen.getByText(NOTE).closest('[data-row-note]')!.getAttribute('data-side');

  it('opens down, under its row, where there is room below', async () => {
    place(box(100, 34));
    render(inScroller());
    await user().tab();
    expect(shown()).toBe(true);
    expect(side()).toBe('down');
  });

  it('opens upward near the bottom of its scroll area, over the row above, so it is not cut off', async () => {
    place(box(340, 34)); // 374 + 60 passes 400; 340 - 60 has room
    render(inScroller());
    await user().tab();
    expect(shown()).toBe(true);
    expect(side()).toBe('up');
  });

  it('follows its row while open: a scroll of the area it sits in or a resize places it again', async () => {
    let at = box(100, 34);
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 60 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'scroller') return box(0, 400);
      if (this.getAttribute('role') === 'group') return at;
      return box(0, 0);
    });
    render(inScroller());
    await user().tab();
    expect(side()).toBe('down');
    at = box(340, 34); // a search's landing scrolls the row low after its focus opened the note
    act(() => void screen.getByTestId('scroller').dispatchEvent(new Event('scroll')));
    expect(side()).toBe('up');
    at = box(100, 34);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(side()).toBe('down');
    at = box(340, 34); // a scroll set in code, placed at once, before its event (a hidden window draws no frame)
    placeOpenNotes(document.body);
    expect(side()).toBe('up');
  });

  it('opens down where there is room neither way, inside the scroll area', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 600 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'scroller') return box(0, 400);
      if (this.getAttribute('role') === 'group') return box(200, 34);
      return box(0, 0);
    });
    render(inScroller());
    await user().tab();
    expect(side()).toBe('down');
  });

  it('takes no room in its row at rest or open: it is placed out of the flow', async () => {
    render(<Row />);
    const note = screen.getByText(NOTE).closest('[data-row-note]')!;
    expect(note.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'top-full', 'pointer-events-none']));
  });
});

// Acceptance 4: the cases a plain row does not cover, each with the keyboard alone.
describe('every hidden fact has an owner that takes keyboard focus', () => {
  it('a greyed control keeps the keyboard, says why at once, and does not act', async () => {
    const commit = vi.fn();
    render(
      <UnavailableButton reason="Write a commit message">
        <button type="button" onClick={commit}>
          Commit
        </button>
      </UnavailableButton>,
    );
    const button = screen.getByRole('button', { name: 'Commit', description: 'Write a commit message' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('tooltip')).toBeNull();
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Write a commit message');
    await keys.keyboard('{Enter}');
    await keys.keyboard(' ');
    expect(commit).not.toHaveBeenCalled();
  });

  it('a read-only field’s row shows its note when the field takes focus', async () => {
    function ReadOnlyRow() {
      const rowNote = useRowNote();
      return (
        <div role="group" aria-label="Config home" {...rowNote.rowProps}>
          <input readOnly aria-label="Config home" value="~/.claude" />
          <RowNote note={rowNote}>{NOTE}</RowNote>
        </div>
      );
    }
    render(<ReadOnlyRow />);
    await user().tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Config home' }));
    expect(shown('Config home')).toBe(true);
  });

  it('a native select’s option fact shows for the selected value, on focus and as the description', async () => {
    const FACTS = { light: 'Follows the light tokens.', dark: 'Follows the dark tokens.' } as const;
    function SelectRow() {
      const rowNote = useRowNote();
      const [theme, setTheme] = useState<keyof typeof FACTS>('light');
      return (
        <div role="group" aria-label="Theme" {...rowNote.rowProps}>
          <select aria-label="Theme" aria-describedby={rowNote.id} value={theme} onChange={(event) => setTheme(event.target.value as keyof typeof FACTS)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <RowNote note={rowNote}>{FACTS[theme]}</RowNote>
        </div>
      );
    }
    render(<SelectRow />);
    const keys = user();
    await keys.tab();
    const select = screen.getByRole('combobox', { name: 'Theme', description: FACTS.light });
    expect(document.activeElement).toBe(select);
    expect(accessibleText(row('Theme'))).toContain(FACTS.light);
    await keys.selectOptions(select, 'dark');
    expect(accessibleText(row('Theme'))).toContain(FACTS.dark);
    expect(screen.getByRole('combobox', { name: 'Theme', description: FACTS.dark })).toBe(select);
  });
});
