// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): "Search settings" at the top of the
// index. Results take the sections' place, the first preselected, with Up, Down and Enter; choosing one brings the row
// into view under its section's heading, marks it for a moment, opens the More it was found behind, and gives the row
// itself the keyboard, so a second Enter does nothing. ⌘F inside Settings focuses the field; Esc clears it.
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import type { AppMcpServer } from '@shared/engine/app-mcp-servers';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useGateway } from '../gateway/store';
import { useNotices } from '../stores/notices';
import { useLayout } from '../stores/layout';
import { useSettings } from '../stores/settings';
import { importBridge, RECORD } from '../test-support/browser-import';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { connectBrowserImport, resetBrowserImport } from '../tools/browser/import/store';
import { grantsOf, REGISTERED, VIEW } from './org/test-support';
import { scrollTopToLand } from './SettingsSearch';
import { SettingsView } from './SettingsView';

const NOTES: AppMcpServer = { name: 'notes', type: 'http', url: 'https://mcp.example.com/mcp' };
const ANSWERED = { 'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1 }) };

let b: SettingsBridge;
function renderView(initial: Settings = SETTINGS_DEFAULTS_V21, answers: SettingsBridge['answers'] = {}) {
  b = settingsBridge(initial);
  Object.assign(b.answers, ANSWERED, answers);
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <>
      <button type="button">Outside</button>
      <QueryClientProvider client={client}>
        <SettingsView section={null} />
      </QueryClientProvider>
    </>,
  );
}
const index = () => screen.getByRole('navigation', { name: 'Settings sections' });
const field = () => screen.getByRole('combobox', { name: 'Search settings' }) as HTMLInputElement;
const options = () => within(index()).queryAllByRole('option'); // the index's results, not a select's options in the body
const optionTexts = () => options().map((o) => [...o.children].map((line) => line.textContent).join(' · '));
const row = (label: string) => screen.getByRole('group', { name: label });
const type = (query: string) => fireEvent.change(field(), { target: { value: query } });
const press = (key: string, target: Element = field()) => fireEvent.keyDown(target, { key });
const commandF = (target: Element, extra: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(target, { key: 'f', code: 'KeyF', metaKey: true, ...extra });

beforeEach(() => {
  useGateway.setState({ relay: null, directLogin: new Map() });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetBrowserImport();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
  vi.restoreAllMocks();
});

describe('Search settings: the field and its results', () => {
  it('is drawn once the settings are read, with the rows', () => {
    render(<SettingsView section={null} />);
    expect(screen.getByText('Reading settings…')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Search settings' })).toBeNull();
  });

  it('stands at the top of the index; while it holds text the results take the sections’ place, the footer kept', async () => {
    renderView();
    expect(field().placeholder).toBe('Search settings');
    expect(field().hasAttribute('data-escape-clears')).toBe(true);
    expect(index().contains(field())).toBe(true);
    await userEvent.type(field(), 'mcp');
    expect(optionTexts()).toEqual(['MCP servers · Sessions', 'Stateful MCP servers · Supervisor', 'Customize · Plugins, skills and connectors']);
    const list = within(index()).getByRole('listbox');
    expect(list.closest('[data-settings-index]')).not.toBeNull(); // in the index's list, which scrolls by itself
    expect(within(index()).queryByRole('button', { name: 'Appearance' })).toBeNull();
    expect(index().querySelector('[data-settings-group]')).toBeNull();
    expect(index().textContent).toContain("Stored in MAWS's own Application Support folder.");
  });

  it('draws a result on two lines: the name, cut and whole in its tooltip, over its section', () => {
    renderView();
    type('hook');
    const [name, under] = [...options()[0]!.children] as HTMLElement[];
    expect(name!.textContent).toBe('Hooks in sessions');
    expect(name!.title).toBe('Hooks in sessions');
    expect(name!.classList.contains('truncate')).toBe(true);
    expect(under!.textContent).toBe('Sessions');
    expect(under!.classList.contains('truncate')).toBe(true);
    expect(under!.classList.contains('text-fg-muted')).toBe(true);
    expect(options()[0]!.children).toHaveLength(2);
  });

  it('reads "No matching settings" when nothing matches', () => {
    renderView();
    type('zebra crossing');
    expect(options()).toEqual([]);
    expect(within(index()).getByRole('status').textContent).toBe('No matching settings');
  });

  it('controls the listbox only while one is drawn: expanded with results, collapsed and naming none with no match', () => {
    renderView();
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);
    type('mcp');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(field().getAttribute('aria-controls')!)).toBe(within(index()).getByRole('listbox'));
    type('zebra crossing');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().hasAttribute('aria-controls')).toBe(false);
    expect(field().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('preselects the first result and moves with Down and Up, the keyboard staying in the field', () => {
    renderView();
    field().focus();
    type('mcp');
    const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(0);
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    press('ArrowDown');
    press('ArrowDown');
    expect(selected()).toBe(2);
    press('ArrowDown'); // the last stays chosen
    expect(selected()).toBe(2);
    press('ArrowUp');
    expect(selected()).toBe(1);
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    expect(document.activeElement).toBe(field());
    type('mcp servers'); // a new query preselects its first result again
    expect(selected()).toBe(0);
  });

  // The branch panel's finding 2: the selected result is always the one in view. The reveal follows every change of the
  // selection or of the results, and a query that leaves the results the same (a trailing space) keeps the selection.
  it('keeps the selection and its reveal when a query change leaves the results the same, and reveals the first when they change', () => {
    renderView();
    field().focus();
    type('session');
    const selected = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(options().length).toBeGreaterThan(4);
    for (let i = 0; i < 4; i += 1) press('ArrowDown');
    expect(selected()).toBe(4);
    const revealed = vi.mocked(HTMLElement.prototype.scrollIntoView);
    const lastRevealed = () => revealed.mock.contexts.at(-1);
    expect(lastRevealed()).toBe(options()[4]);
    revealed.mockClear();
    type('session '); // the search ignores the trailing space: the same results
    expect(selected()).toBe(4);
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[4]!.id);
    expect(revealed.mock.contexts.every((element) => element === options()[4])).toBe(true);
    type('mcp'); // other results: the first is selected and revealed, wherever the list was scrolled
    expect(selected()).toBe(0);
    expect(lastRevealed()).toBe(options()[0]);
  });
});

describe('Search settings: choosing a result', () => {
  it('Enter chooses the first: the row takes the keyboard, no control of it, and a second Enter removes nothing; the query stays', () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, mcpServers: [NOTES] } });
    field().focus();
    type('mcp');
    press('Enter');
    const servers = row('MCP servers');
    expect(document.activeElement).toBe(servers);
    expect(servers.tabIndex).toBe(-1); // a focus stop of its own, out of the Tab order
    press('Enter', servers);
    fireEvent.keyUp(servers, { key: 'Enter' });
    expect(b.sets).toEqual([]);
    expect(within(servers).getByRole('button', { name: 'Remove notes' })).toBeTruthy();
    expect(field().value).toBe('mcp');
    expect(options().length).toBeGreaterThan(0);
  });

  it('a click on a result chooses it too', () => {
    renderView();
    type('theme');
    fireEvent.click(options()[0]!);
    expect(document.activeElement).toBe(row('Theme'));
  });

  it('marks the chosen row for 1,600 ms, then clears it over 150 ms; choosing another takes the first mark away at once', () => {
    vi.useFakeTimers();
    renderView();
    type('theme');
    press('Enter');
    const theme = row('Theme');
    expect(theme.dataset.settingsMark).toBe('on');
    act(() => void vi.advanceTimersByTime(1_599));
    expect(theme.dataset.settingsMark).toBe('on');
    act(() => void vi.advanceTimersByTime(1));
    expect(theme.dataset.settingsMark).toBe('fading');
    act(() => void vi.advanceTimersByTime(150));
    expect(theme.dataset.settingsMark).toBeUndefined();

    type('theme');
    press('Enter');
    expect(theme.dataset.settingsMark).toBe('on');
    type('hook');
    press('Enter');
    expect(theme.dataset.settingsMark).toBeUndefined();
    expect(row('Hooks in sessions').dataset.settingsMark).toBe('on');
    act(() => void vi.advanceTimersByTime(2_000));
    expect(document.querySelector('[data-settings-mark]')).toBeNull();
  });

  it('draws the mark with the active background over the row and 8 px around it, at once under reduced motion', () => {
    renderView();
    const column = document.querySelector('[data-settings-column]')!;
    expect(column.className).toContain('[&_[data-settings-mark=on]]:bg-bg-active');
    expect(column.className).toContain('[&_[data-settings-mark=on]]:shadow-[0_0_0_8px_var(--bg-active)]');
    expect(column.className).toContain('[&_[data-settings-mark=fading]]:duration-150');
    expect(column.className).toContain('motion-reduce:[&_[data-settings-mark=fading]]:transition-none');
  });

  it('opens the More a row shows now when the words were found there', async () => {
    renderView();
    await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287');
    type('PATH');
    fireEvent.click(options().find((o) => o.textContent === 'BinaryEngine')!);
    const binary = row('Binary');
    expect(within(binary).getByRole('button', { name: 'Less' }).getAttribute('aria-expanded')).toBe('true');
    expect(binary.textContent).toContain("claude on your shell's PATH");
    expect(document.activeElement).toBe(binary);
    // a row found by its line leaves its More closed
    type('runs claude update');
    expect(optionTexts()).toEqual(['Update · Engine']);
    press('Enter');
    expect(within(row('Update')).getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('lands on the row that reveals a row not drawn: the memory budget off, "stateful" chooses Memory budget', () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, memoryBudget: { enabled: false } } });
    type('stateful');
    expect(optionTexts()).toEqual(['Memory budget · Supervisor']);
    press('Enter');
    expect(document.activeElement).toBe(row('Memory budget'));
  });

  it('a binding’s mark is not clipped by its table, which rounds its corner rows instead', () => {
    renderView();
    const table = screen.getByRole('table', { name: 'Key bindings' });
    expect(table.classList.contains('overflow-hidden')).toBe(false);
    expect(table.className).toContain('[&>[role=rowgroup]:first-child>[role=row]:first-child]:rounded-t-sm');
    expect(table.className).toContain('[&>[role=rowgroup]:last-child>[role=row]:last-child]:rounded-b-sm');
  });

  it('lands on a section’s heading and on a key binding’s row in the table', () => {
    renderView();
    type('voice');
    expect(optionTexts()[0]).toBe('Voice · Section');
    press('Enter');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Voice' }));
    type('next needs-you');
    expect(optionTexts()).toEqual(['Next Needs-you · Keyboard']);
    press('Enter');
    const binding = screen.getByRole('table', { name: 'Key bindings' }).querySelector('[role="row"][aria-label="Next Needs-you"]');
    expect(document.activeElement).toBe(binding);
    expect(binding!.getAttribute('data-settings-mark')).toBe('on');
  });

  it('opens the Customize page from its result', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
    renderView();
    type('marketplace');
    expect(optionTexts()).toEqual(['Customize · Plugins, skills and connectors']);
    press('Enter');
    expect(useLayout.getState().destination).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' }); // UX wave U7b: a page, no tab
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main);
    expect(b.sets).toEqual([]);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null });
  });

  it('lists an Org group the page draws and lands on it; a group it does not draw is no result', async () => {
    renderView(SETTINGS_DEFAULTS_V21, {
      'org.status': () => REGISTERED,
      'org.view': () => VIEW,
      'org.grants.view': (input) => grantsOf((input as { ref: string }).ref),
      'org.provisioningSecret.get': () => null,
    });
    await screen.findByRole('heading', { level: 4, name: 'People' });
    type('people');
    expect(optionTexts()).toEqual(['People · Org']);
    press('Enter');
    expect(document.activeElement).toBe(document.querySelector('[data-org-group="people"]'));
  });

  it('lists no Org group while this Mac is not in an org', async () => {
    renderView();
    await screen.findByText('This Mac isn’t signed in to an org.');
    type('people');
    expect(options()).toEqual([]);
  });

  it('with the page populated, a repeating row is one result by its declared label and lands on its first item', async () => {
    const bridge = importBridge(SETTINGS_DEFAULTS_V21);
    Object.assign(bridge.answers, ANSWERED, { 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false, running: null }) });
    window.maws = bridge.bridge;
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const disconnect = connectBrowserImport(undefined, queries);
    render(
      <QueryClientProvider client={queries}>
        <SettingsView section={null} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(document.querySelectorAll('[data-settings-row="browser.extension"]')).toHaveLength(RECORD.extensions.length));
    type('extensions');
    expect(optionTexts().filter((text) => text === 'Extensions · Browser')).toHaveLength(1);
    fireEvent.click(options().find((o) => o.textContent === 'ExtensionsBrowser')!);
    expect(document.activeElement).toBe(document.querySelector('[data-settings-row="browser.extension"]'));
    type('imported chrome profile');
    fireEvent.click(options().find((o) => o.textContent === 'Imported Chrome profileBrowser')!);
    expect(document.activeElement).toBe(document.querySelector('[data-settings-row="browser.importedProfile"]'));
    disconnect();
  });
});

describe('Search settings: the row under its section’s heading', () => {
  it('puts the section’s heading at the body’s top where the row is then in view, and a row farther down in the middle', () => {
    expect(scrollTopToLand({ sectionTop: 400, rowTop: 560, rowHeight: 34, viewHeight: 600 })).toBe(400);
    expect(scrollTopToLand({ sectionTop: 400, rowTop: 966, rowHeight: 34, viewHeight: 600 })).toBe(400); // its bottom on the body's last pixel
    expect(scrollTopToLand({ sectionTop: 400, rowTop: 1200, rowHeight: 40, viewHeight: 600 })).toBe(920); // 1200 - (600 - 40) / 2
  });

  it('scrolls the body by that rule when a result is chosen', () => {
    renderView();
    const body = document.querySelector<HTMLElement>('[data-settings-body]')!;
    const at = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === body) return at(100, 600);
      if (this.matches('section[aria-labelledby="settings-sessions"]')) return at(1100, 900);
      if (this.matches('[data-settings-row="sessions.archive"]')) return at(1500, 34); // 434 px under its section's top
      return at(0, 0);
    });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 600 });
    type('archive sessions');
    press('Enter');
    expect(body.scrollTop).toBe(1000); // the heading at the body's top: 1100 - 100
  });
});

describe('Search settings: the keys', () => {
  it('Esc clears the field and brings the sections back; in an empty field it does nothing', () => {
    renderView();
    type('theme');
    expect(press('Escape')).toBe(false); // taken
    expect(field().value).toBe('');
    expect(within(index()).getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(press('Escape')).toBe(true); // left alone
  });

  it('⌘F inside Settings focuses the field and goes no farther; outside Settings, or with Shift, it does nothing', () => {
    renderView();
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    try {
      const entry = within(index()).getByRole('button', { name: 'Keyboard' });
      entry.focus();
      expect(commandF(entry)).toBe(false);
      expect(document.activeElement).toBe(field());
      expect(heard).not.toHaveBeenCalled();

      const outside = screen.getByRole('button', { name: 'Outside' });
      outside.focus();
      expect(commandF(outside)).toBe(true);
      expect(document.activeElement).toBe(outside);

      entry.focus();
      commandF(entry, { shiftKey: true }); // ⇧⌘F is Files
      expect(document.activeElement).toBe(entry);
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  it('⌘F in a sheet opened from Settings stays the sheet’s', () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, keymap: { 'session.new': null } });
    const search = field(); // the modal sheet hides the page from the accessibility tree
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    const cancel = within(screen.getByRole('dialog', { name: 'Reset every key binding?' })).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    expect(commandF(cancel)).toBe(true);
    expect(document.activeElement).not.toBe(search);
  });

  it('in the narrow form the field is a first row over the links, and the results a list at most 12rem high that scrolls', () => {
    renderView();
    const label = field().closest('label')!;
    expect([...label.classList].some((c) => c.startsWith('@max-lg/settings:hidden'))).toBe(false);
    type('mcp');
    const list = index().querySelector('[data-settings-index]')!;
    expect(list.classList).toContain('@max-lg/settings:max-h-48');
    expect(list.classList).toContain('overflow-y-auto');
    expect([...list.classList].some((c) => c.includes('flex-row'))).toBe(false);
  });
});
