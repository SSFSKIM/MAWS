// UX wave U7b (O-40; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 decision 8 and
// Interfaces §H): the page's region, who takes Esc on it, and where the keyboard goes when it opens and closes.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerSlot, resetSlots } from '../app/slots';
import { pageOpen, useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import { at } from '../../../../test/support/machine';
import { DestinationPage } from './DestinationPage';

const A = at('app-a' as AppSessionId);
const page = () => document.getElementById('region-page');
const openPage = () => act(() => useLayout.getState().openDestination({ kind: 'library' }));
const escape = (target: Element, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: 'Escape', ...init });
const nextTask = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

// The library's content: a field with an Esc of its own, and an element marked as keeping its Esc.
function Library() {
  const [name, setName] = useState('kept');
  return (
    <div>
      <input aria-label="Filter" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setName('kept'); event.currentTarget.blur(); } }} />
      <button type="button" data-escape-own="">Confirm</button>
    </div>
  );
}

// What a page hides, as the shell hides it: inert while a page is open; a pane with a control and a composer in it.
function Behind() {
  const hidden = useLayout(pageOpen);
  return (
    <div data-behind-page inert={hidden}>
      <div id="pane-0"><div role="tabpanel"><button type="button">In the pane</button><textarea aria-label="Composer" /></div></div>
    </div>
  );
}

function renderShell() {
  return render(<><nav aria-label="Sidebar"><button type="button">Projects row</button><input aria-label="Search sidebar" /></nav><Behind /><DestinationPage /></>);
}

beforeEach(() => {
  resetShellStores();
  registerSlot('artifactsLibrary', Library);
});
afterEach(() => {
  cleanup();
  resetSlots();
});

describe('the page', () => {
  it('is a region named by the title bar’s heading, marked with its kind, focusable but no tab stop', () => {
    renderShell();
    expect(page()).toBeNull();
    openPage();
    expect(page()!.getAttribute('data-region')).toBe('page');
    expect(page()!.getAttribute('data-destination')).toBe('library');
    expect(page()!.getAttribute('aria-labelledby')).toBe('page-title');
    expect(page()!.tabIndex).toBe(-1);
    expect(screen.getByRole('textbox', { name: 'Filter' })).toBeTruthy();
  });

  it('opened from the sidebar, the keyboard stays on the row; Esc closes it and leaves the keyboard there', () => {
    renderShell();
    const row = screen.getByRole('button', { name: 'Projects row' });
    row.focus();
    openPage();
    expect(document.activeElement).toBe(row);
    escape(row);
    expect(useLayout.getState().destination).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('opened while the keyboard is in what it hides, the page’s region takes it; Back gives it back to the composer', () => {
    renderShell();
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    composer.focus();
    openPage();
    expect(document.activeElement).toBe(page());
    act(() => useLayout.getState().closeDestination());
    expect(document.activeElement).toBe(composer);
  });

  it('opened with the keyboard nowhere, the page’s region takes it', () => {
    renderShell();
    openPage();
    expect(document.activeElement).toBe(page());
  });

  it('left for a tab, the keyboard goes to that tab’s pane', () => {
    renderShell();
    screen.getByRole('textbox', { name: 'Composer' }).focus();
    openPage();
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: A }));
    expect(useLayout.getState().destination).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'In the pane' }));
  });

  it('row 1: an Esc an input method composes with closes nothing', () => {
    renderShell();
    openPage();
    escape(page()!, { isComposing: true });
    expect(page()).not.toBeNull();
  });

  it('row 3: an element marked to keep its Esc keeps it, and the page stays', () => {
    renderShell();
    openPage();
    escape(screen.getByRole('button', { name: 'Confirm' }));
    expect(page()).not.toBeNull();
  });

  it('row 5: a field of the page reverts and is left on the first press, to the page’s region; the second closes the page', async () => {
    renderShell();
    openPage();
    const field = screen.getByRole('textbox', { name: 'Filter' });
    field.focus();
    fireEvent.change(field, { target: { value: 'typed' } });
    escape(field);
    await nextTask();
    expect(field).toHaveProperty('value', 'kept');
    expect(document.activeElement).toBe(page());
    escape(page()!);
    expect(page()).toBeNull();
  });

  it('a text field outside the page (the sidebar’s search) keeps its Esc, and the page stays', () => {
    renderShell();
    openPage();
    const search = screen.getByRole('textbox', { name: 'Search sidebar' });
    search.focus();
    escape(search);
    expect(page()).not.toBeNull();
  });

  it('rows 6 and 7: with the Settings dialog or the Overview open, Esc is theirs and the page stays', () => {
    renderShell();
    openPage();
    act(() => useLayout.getState().openSettings());
    escape(page()!);
    expect(useLayout.getState().destination).not.toBeNull();
    act(() => useLayout.setState({ settings: null, overviewOpen: true }));
    escape(page()!);
    expect(useLayout.getState().destination).not.toBeNull();
  });

  it('an Esc another layer prevented closes nothing', () => {
    renderShell();
    openPage();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    page()!.dispatchEvent(event);
    expect(page()).not.toBeNull();
  });
});
