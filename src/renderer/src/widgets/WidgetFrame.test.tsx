import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerFocusTarget } from '../stores/composer';
import { NOT_RUNNING } from '../statusline';
import { WidgetFrame } from './WidgetFrame';

afterEach(cleanup);
const ID = 'app-1' as AppSessionId;

describe('WidgetFrame', () => {
  // E11's sitting (owner-notes 00-consolidated-plan §2.2): no provenance foot; what a change writes is said in its sheet.
  it('shows the head and the body when ready, and no foot', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(frame.querySelector('h3')?.textContent).toBe('Hooks');
    expect(screen.getByText('/hooks')).toBeTruthy();
    expect(screen.getByText('the body')).toBeTruthy();
    expect(frame.querySelector('footer')).toBeNull();
    expect(frame.textContent).not.toContain('Read with');
  });

  it('shows the loading line, the error, and C7’s not-running sentence in place of the body', () => {
    const { rerender } = render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="loading" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText('Reading…')).toBeTruthy();
    rerender(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="error" error="get_hooks_listing refused" close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('alert').textContent).toBe('get_hooks_listing refused');
    rerender(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="not_running" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText(NOT_RUNNING)).toBeTruthy();
    expect(screen.queryByText('the body')).toBeNull();
  });

  it('keeps the body of a ready read and says, in one line above it, that a later read failed', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error="The engine did not answer · showing the last value it reported" close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    expect(screen.getByText('the body')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('The engine did not answer · showing the last value it reported');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes focus when it opens; Esc closes it and hands the keyboard back to the composer', () => {
    const close = vi.fn();
    const focusEditor = vi.fn();
    const off = registerFocusTarget(ID, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error={null} close={close}>
        <button type="button">inside</button>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(document.activeElement).toBe(frame);
    fireEvent.keyDown(screen.getByText('inside'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close Hooks' }));
    expect(close).toHaveBeenCalledTimes(2);
    off();
  });
});

// P2-B (X19; the execution document §5.2): the library size, its head slots and the Escape rule.
describe('WidgetFrame: the library size', () => {
  function Search() {
    const [value, setValue] = useState('');
    // as the library's search field does: Escape in it clears a non-empty value and marks the event handled
    return (
      <input
        aria-label="Search plugins"
        data-widget-search
        data-escape-clears
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || value === '') return;
          event.preventDefault();
          setValue('');
        }}
      />
    );
  }
  function Menu() {
    return (
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger>Show</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item>All plugins</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  }
  const library = (close: () => void) =>
    render(
      <WidgetFrame appSessionId={ID} title="Plugins" command="plugins" state="ready" error={null} close={close} size="library" heading={<span>the switch</span>} toolbar={<><Search /><Menu /></>}>
        <button type="button">a row</button>
      </WidgetFrame>,
    );

  it('draws the title once, the heading after it and the toolbar before the /name and the close button', () => {
    library(() => {});
    const frame = document.querySelector<HTMLElement>('[data-widget="plugins"]')!;
    expect(frame.querySelectorAll('h3')).toHaveLength(1);
    const head = frame.querySelector('header')!;
    const order = ['Plugins', 'the switch', 'Search plugins', 'Show', '/plugins', 'Close Plugins'].map((text) => [...head.querySelectorAll('*')].findIndex((el) => el.textContent === text || el.getAttribute('aria-label') === text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(frame.getAttribute('data-widget-size')).toBe('library');
    // the library body takes the remaining height and does not scroll itself: the list pane inside it does
    expect(frame.querySelector('[data-widget-body]')!.className).not.toContain('overflow-y-auto');
  });

  it('Escape in a non-empty search clears it and keeps the widget; then Escape closes and hands the keyboard back', () => {
    const close = vi.fn();
    const focusEditor = vi.fn();
    const off = registerFocusTarget(ID, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    library(close);
    const field = screen.getByRole('textbox', { name: 'Search plugins' });
    fireEvent.change(field, { target: { value: 'review' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveProperty('value', '');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledTimes(1);
    off();
  });

  it('Escape from a menu portalled out of the frame closes only the menu', () => {
    const close = vi.fn();
    library(close);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Show' }), { key: 'Enter' });
    const item = screen.getByRole('menuitem', { name: 'All plugins' });
    expect(document.querySelector('[data-widget="plugins"]')!.contains(item)).toBe(false);
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'All plugins' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('/ focuses the search field, but not while a text field has the keyboard', () => {
    library(() => {});
    const field = screen.getByRole('textbox', { name: 'Search plugins' });
    const row = screen.getByRole('button', { name: 'a row' });
    row.focus();
    fireEvent.keyDown(row, { key: '/' });
    expect(document.activeElement).toBe(field);
    row.focus();
    fireEvent.keyDown(row, { key: '/', metaKey: true });
    expect(document.activeElement).toBe(row);
    field.focus();
    const typed = fireEvent.keyDown(field, { key: '/' });
    expect(typed).toBe(true); // not prevented: the slash is typed into the field
  });

  it('keeps the utility size’s scrolling body by default', () => {
    render(
      <WidgetFrame appSessionId={ID} title="Hooks" command="hooks" state="ready" error={null} close={() => {}}>
        <p>the body</p>
      </WidgetFrame>,
    );
    const frame = document.querySelector<HTMLElement>('[data-widget="hooks"]')!;
    expect(frame.getAttribute('data-widget-size')).toBe('utility');
    expect(frame.querySelector('[data-widget-body]')!.className).toContain('max-h-[60vh]');
  });
});
