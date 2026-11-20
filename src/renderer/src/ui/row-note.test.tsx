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
import { RowNote, useRowNote, type RowNoteForm } from './row-note';
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

function Row({ form, label = 'Archive', note = NOTE }: { form?: RowNoteForm; label?: string; note?: string }) {
  const rowNote = useRowNote();
  return (
    <div role="group" aria-label={label} {...rowNote.rowProps}>
      <span>{label}</span>
      <button type="button">Open {label}</button>
      <RowNote note={rowNote} form={form}>
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
    // happy-dom does no hit-testing: under the overlay placement the floating note lets the pointer through
    // (note-overlay:pointer-events-none), so the pointer moving down lands on the next row, as here.
    render(
      <>
        <Row label="Archive" />
        <Row label="Restore" note="Restored sessions return to their project." />
      </>,
    );
    expect(screen.getByText(NOTE).closest('[data-row-note]')!.className).toContain('note-overlay:pointer-events-none');
    const pointer = user();
    await pointer.hover(row('Archive'));
    wait(POINTING_DELAY_MS);
    expect(shown('Archive')).toBe(true);
    await pointer.hover(row('Restore'));
    expect(screen.getByText(NOTE).closest('[data-row-note]')!.hasAttribute('data-open')).toBe(false);
    wait(POINTING_DELAY_MS);
    expect(accessibleText(row('Restore'))).toContain('Restored sessions return to their project.');
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

describe('the pointed-row line', () => {
  it('keeps its line’s place at rest without drawing it, and is the row’s description', () => {
    render(<Row form="line" />);
    expect(screen.getByText(NOTE).hasAttribute('hidden')).toBe(false); // its height stays in the row
    expect(accessibleText(row())).toBe('ArchiveOpen Archive');
    expect(screen.getByRole('group', { name: 'Archive', description: NOTE })).toBe(row());
  });

  it('shows on pointing after the short delay and at once on keyboard focus', async () => {
    render(<Row form="line" />);
    const keys = user();
    await keys.hover(row());
    wait(POINTING_DELAY_MS - 1);
    expect(shown()).toBe(false);
    wait(1);
    expect(shown()).toBe(true);
    await keys.unhover(row());
    expect(shown()).toBe(false); // a reserved line has no close motion
    await keys.tab();
    expect(shown()).toBe(true);
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
