// UX wave U7b (O-40; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 decision 9 and
// Interfaces §H): the Settings dialog, its frame and who takes Esc in it, first to last.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView, type SettingsSection } from '../settings-tab/SettingsView';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { settingsBridge } from '../test-support/settings-bridge';
import { registerSlot, resetSlots } from '../app/slots';
import { Sheet } from '../sessions/Sheet';
import { useLayout } from '../stores/layout';
import { installResizeObserver } from '../test-support/resize';
import { resetShellStores } from '../test-support/shell-stores';
import { SettingsDialog } from './SettingsDialog';

const dialog = () => screen.queryByRole('dialog', { name: 'Settings' });
const open = (section?: SettingsSection) => act(() => useLayout.getState().openSettings(section));
const nextTask = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
// Tailwind's spacing scale: 4 px a step.
const px = (className: string, utility: string): number => Number(new RegExp(`(?:^|\\s)${utility.replace(/[[\]]/g, '\\$&')}-([\\d.]+)(?:\\s|$)`).exec(className)?.[1]) * 4;

// A stand-in for U11's view: its scrolling body's mark, a section, and the controls each row of §H needs.
function View({ section }: { section: SettingsSection | null }) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('kept');
  const [sheet, setSheet] = useState(false);
  return (
    <div data-settings-body="">
      <p>section {String(section)}</p>
      <input aria-label="Search settings" data-escape-clears value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setQuery('')} />
      <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setName('kept'); event.currentTarget.blur(); } }} />
      <button type="button" data-chord-capture="">Record shortcut</button>
      <button type="button" data-escape-own="">Stop all</button>
      <button type="button" onClick={() => setSheet(true)}>Enroll</button>
      {sheet && <Sheet title="Enroll" onClose={() => setSheet(false)}><p>enroll</p></Sheet>}
    </div>
  );
}

beforeEach(() => {
  resetShellStores();
  registerSlot('settingsTab', View);
});
afterEach(() => {
  cleanup();
  resetSlots();
  vi.unstubAllGlobals();
});

describe('the Settings dialog', () => {
  it('draws the settingsTab slot at the store’s section, named Settings, and follows a section given while it is open', () => {
    render(<SettingsDialog />);
    expect(dialog()).toBeNull();
    open('voice');
    expect(dialog()!.textContent).toContain('section voice');
    open('engine');
    expect(dialog()!.textContent).toContain('section engine');
  });

  it('has the library dialogs’ box and no padding of its own; the body’s right inset is 30 px with its scroll bar, and Close lies wholly inside it', () => {
    render(<SettingsDialog />);
    open();
    const content = dialog()!;
    expect(content.className).toContain('w-[min(960px,calc(100vw-48px))]');
    expect(content.className).toContain('h-[min(85vh,800px)]');
    expect(content.className).not.toMatch(/(?:^|\s)p[xytrbl]?-/);
    expect(content.className).toContain('[&_[data-settings-body]]:pr-[calc(30px_-_var(--settings-bar,0px))]'); // less the body's own bar
    const inset = 30;
    const close = screen.getByRole('button', { name: 'Close' });
    expect(px(close.className, 'right') + px(close.className, 'size')).toBeLessThanOrEqual(inset); // 6 px in, 22 px wide
    expect(px(close.className, 'size')).toBe(22);
    expect(content.contains(close) && !close.closest('[data-settings-body]')).toBe(true);
  });

  it('takes the body’s own scroll bar out of the inset: the bar’s width, read again as the body resizes, at most the 30 px', () => {
    const observer = installResizeObserver();
    render(<SettingsDialog />);
    open();
    const content = dialog()!;
    const body = content.querySelector<HTMLElement>('[data-settings-body]')!;
    const bar = (width: number) => {
      Object.defineProperty(body, 'offsetWidth', { configurable: true, value: 810 });
      Object.defineProperty(body, 'clientWidth', { configurable: true, value: 810 - width });
      observer.resize(body, { width: 810 - width - 50, height: 600 });
      return content.style.getPropertyValue('--settings-bar');
    };
    expect(bar(15), 'a classic bar').toBe('15px');
    expect(bar(0), 'an overlay bar').toBe('0px');
    expect(bar(15), 'the mode changed while open').toBe('15px');
    expect(bar(40), 'never more than the inset').toBe('30px');
  });

  it('Close closes it, and the strip is not touched', async () => {
    render(<SettingsDialog />);
    const strip = useLayout.getState().main;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(useLayout.getState().settings).toBeNull();
    expect(useLayout.getState().main).toBe(strip);
  });

  it('row 1: an Esc an input method composes with keeps the dialog', () => {
    render(<SettingsDialog />);
    open();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape', isComposing: true });
    expect(dialog()).not.toBeNull();
  });

  it('row 2: a sheet opened inside takes Esc alone, and the dialog stays', async () => {
    render(<SettingsDialog />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    const sheet = screen.getByRole('dialog', { name: 'Enroll' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Enroll' })).toBeNull());
    expect(dialog()).not.toBeNull();
    expect(useLayout.getState().settings).not.toBeNull();
  });

  // The second Mac run: a sheet is drawn a few frames before Radix makes it the top layer (its layer registers in an
  // effect, then the layers re-render), and an Esc in those frames reached the dialog, which closed with the sheet in it.
  // Stood in for by a dialog drawn over Settings that is no Radix layer: the dialog's Esc listener is still the top one.
  it('row 2, before the sheet is the top layer: a dialog drawn over it keeps the Esc from closing Settings', () => {
    render(<SettingsDialog />);
    open();
    const late = document.createElement('div');
    late.setAttribute('role', 'dialog');
    late.setAttribute('data-state', 'open');
    late.setAttribute('aria-label', 'A sheet not yet the top layer');
    late.innerHTML = '<button type="button">Cancel</button>';
    document.body.append(late);
    const cancel = late.querySelector('button')!;
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(dialog()).not.toBeNull();
    expect(useLayout.getState().settings).not.toBeNull();
    late.remove();
  });

  it('row 3: the shortcut recorder and a marked element keep their Esc, and the dialog stays', () => {
    render(<SettingsDialog />);
    open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Record shortcut' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Stop all' }), { key: 'Escape' });
    expect(dialog()).not.toBeNull();
  });

  it('row 4: a search field that holds text clears itself, and the dialog stays; the next Esc, in the empty field, closes it', async () => {
    render(<SettingsDialog />);
    open();
    const search = screen.getByRole('textbox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'voice' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveProperty('value', '');
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('row 5: a field with an Esc of its own reverts and is left on the first press; the second closes the dialog', async () => {
    render(<SettingsDialog />);
    open();
    const field = screen.getByRole('textbox', { name: 'Name' });
    field.focus();
    fireEvent.change(field, { target: { value: 'typed' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await nextTask();
    expect(field).toHaveProperty('value', 'kept');
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(dialog());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  // The Esc is pressed where the keyboard is after the open: the dialog's first field, its empty search (the wave
  // architect's ruling on the first Mac run: an empty search field gives its Esc to the dialog).
  it('row 6: opened with the keyboard in the composer, it lands in the empty search; one Esc closes it, and the keyboard is back on the composer', async () => {
    render(<><textarea aria-label="Composer" /><SettingsDialog /></>);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    composer.focus();
    open();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search settings' })));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(composer);
  });
});

// The branch review: an explicit request for a section lands on it even when it is the section the dialog was opened
// at and the person has moved in the index since (U11's view, drawn as the app draws it).
describe('a request for a section', () => {
  it('opened at Usage, Appearance picked in the index, a second request for Usage lands on Usage', () => {
    const bridge = settingsBridge();
    bridge.answers['machineSettings.get'] = () => ({ settings: machineSettingsDefaults(), version: 1 }); // the Gateway section's read
    window.maws = bridge.bridge; // left installed: the sections' reads may answer after the test
    registerSlot('settingsTab', SettingsView);
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('aria-labelledby') ?? '');
    });
    try {
      render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SettingsDialog /></QueryClientProvider>);
      const entry = (name: string) => within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name });
      open('usage');
      expect(entry('Usage').getAttribute('aria-current')).toBe('true');
      fireEvent.click(entry('Appearance'));
      expect(entry('Appearance').getAttribute('aria-current')).toBe('true');
      expect(scrolled.at(-1)).toBe('settings-appearance');
      open('usage');
      expect(entry('Usage').getAttribute('aria-current')).toBe('true');
      expect(scrolled.at(-1)).toBe('settings-usage');
    } finally {
      spy.mockRestore();
    }
  });
});
