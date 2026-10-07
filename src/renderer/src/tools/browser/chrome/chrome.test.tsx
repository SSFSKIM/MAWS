// E4a (Task 3.3): the chrome (Design §4): the control slot's three states, the zoom banner's presence rule, the address
// field's display and its suggestions under the keyboard (the typed address first, history after it, the newest query's
// answer only, a refused scheme's line, the cover held while the list shows), the find bar's messages and its session
// with main, the notice lines and their dismissal, the tab strip per surface, the overflow menu, main's chrome commands
// for the owning chrome only, and the extras slot.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { useLayout } from '../../../stores/layout';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { installFakeMain, ok, type Handler } from '../../../test-support/code';
import { BROWSER_COPY } from '../copy';
import { coverPane, resetCovering } from '../covering';
import { registerChromeExtra, type ChromeExtraProps } from '../extras';
import { browser, connectBrowser, raiseNotice, resetBrowser } from '../store';
import { Chrome, type ChromeProps } from './Chrome';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const SEARCH = SETTINGS_DEFAULTS_V11.browser.searchUrl;

let main: ReturnType<typeof installFakeMain>;
let disconnect: () => void;
let suggest: Handler = () => ok({ suggestions: [] });
const calls = (name: Parameters<typeof main.callsOf>[0]) => main.callsOf(name);
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeEach(() => {
  resetBrowser();
  resetCovering();
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, overviewOpen: false });
  suggest = () => ok({ suggestions: [] });
  main = installFakeMain((name, input) => {
    switch (name) {
      case 'browser.tabs.list':
        return ok({ tabs: [], selected: {} });
      case 'browser.history.suggest':
        return suggest(name, input);
      case 'browser.tabs.navigate':
        return ok({ accepted: true });
      case 'browser.tabs.zoom':
        return ok({ zoom: 1 });
      case 'browser.tabs.open':
        return ok({ tab: browserTab(T2, A, { url: '' }), reused: false });
      case 'browser.profiles.list':
        return ok({ profiles: [{ profileDir: 'Profile1', name: 'Work' }] });
      case 'browser.tabs.revealDownload':
        return ok({ revealed: true });
      default:
        return ok();
    }
  });
  disconnect = connectBrowser(main.bridge); // relays main's chrome commands
});
afterEach(() => {
  disconnect();
  cleanup();
  resetCovering();
  vi.restoreAllMocks();
});

const tab = (over: Partial<BrowserTab> = {}) => browserTab(T1, A, over);
const show = (props: Partial<ChromeProps> & { tab: BrowserTab | null }) =>
  render(<Chrome appSessionId={A} surface="panel" tabs={props.tab ? [props.tab] : []} {...props} />);

describe('the control slot', () => {
  it('is empty while idle, says the agent is browsing, and offers Hand back while the human has the page', async () => {
    const { rerender } = show({ tab: tab() });
    expect(document.querySelector('[data-browser-control]')).toBeNull();
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ control: 'agent' })} tabs={[]} />);
    expect(screen.getByText(BROWSER_COPY.control.agentBrowsing)).toBeTruthy();
    expect(screen.queryByRole('button', { name: BROWSER_COPY.control.handBack })).toBeNull();
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ control: 'human' })} tabs={[]} />);
    expect(screen.getByText(BROWSER_COPY.control.humanHasPage)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.control.handBack }));
    await wait(0);
    expect(calls('browser.control.handBack')).toEqual([{ tabId: T1 }]);
  });
});

describe('the partition pill', () => {
  it('names the default profile, or the imported one as listed, and opens Settings › Browser', async () => {
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => {});
    const pill = () => document.querySelector<HTMLButtonElement>('[data-browser-partition]')!;
    const { rerender } = show({ tab: tab() });
    expect([pill().textContent, pill().title]).toEqual(['Default', 'Browsing as Default']);
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queries}>
        <Chrome appSessionId={A} surface="panel" tab={tab({ partition: 'persist:maws-chrome-Profile1' })} tabs={[]} />
      </QueryClientProvider>,
    );
    expect(pill().textContent).toBe('Profile1'); // its directory until the list answers
    await vi.waitFor(() => expect([pill().textContent, pill().title]).toEqual(['Work', 'Browsing as Work']));
    fireEvent.click(pill());
    expect(openTab).toHaveBeenCalledWith({ kind: 'settings', section: 'browser' });
  });
});

describe('the zoom banner', () => {
  it('is absent at 100% and shows the level with Zoom out, Zoom in and Reset otherwise', async () => {
    const { rerender } = show({ tab: tab() });
    expect(screen.queryByRole('group', { name: BROWSER_COPY.zoom.label })).toBeNull();
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ zoom: 1.25 })} tabs={[]} />);
    const banner = screen.getByRole('group', { name: BROWSER_COPY.zoom.label });
    expect(within(banner).getByText('125%')).toBeTruthy();
    for (const name of ['Zoom out', 'Zoom in', 'Reset']) fireEvent.click(within(banner).getByRole('button', { name }));
    await wait(0);
    expect(calls('browser.tabs.zoom')).toEqual([
      { tabId: T1, action: 'out' },
      { tabId: T1, action: 'in' },
      { tabId: T1, action: 'reset' },
    ]);
  });
});

describe('the address field', () => {
  const field = () => screen.getByRole<HTMLInputElement>('combobox', { name: BROWSER_COPY.address });
  const display = () => document.querySelector('[data-address-display]');

  it('unfocused: the host apart from the rest behind a lock; http is struck; an empty tab shows the placeholder', () => {
    const { rerender } = show({ tab: tab({ url: 'https://user:pw@example.com/a/b?c=1' }) });
    expect(display()!.querySelector('[data-lock]')!.getAttribute('data-lock')).toBe('secure');
    expect(display()!.querySelector('.text-fg')!.textContent).toBe('example.com');
    expect(display()!.querySelector('.text-fg-muted:not(svg)')!.textContent).toBe('/a/b?c=1');
    expect(display()!.textContent).not.toContain('user');
    expect(field().value).toBe('');
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ url: 'http://example.com/' })} tabs={[]} />);
    expect(display()!.querySelector('[data-lock]')!.getAttribute('data-lock')).toBe('insecure');
    expect(field().getAttribute('aria-description')).toBe(BROWSER_COPY.notSecure);
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ url: '' })} tabs={[]} />);
    expect(display()).toBeNull();
    expect(field().placeholder).toBe(BROWSER_COPY.addressPlaceholder);
  });

  it('focused, it holds the whole URL selected; Esc puts it back and leaves', async () => {
    const user = userEvent.setup();
    show({ tab: tab({ url: 'https://example.com/a' }) });
    await user.click(field());
    expect(field().value).toBe('https://example.com/a');
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'https://example.com/a'.length]);
    await user.keyboard('zzz');
    expect(field().value).toBe('zzz');
    await user.keyboard('{Escape}');
    expect(document.activeElement).not.toBe(field());
    expect(field().value).toBe('');
    expect(display()!.textContent).toContain('example.com');
  });

  it('typing lists the typed address, then the partition’s history; the arrows move; Enter runs the row as typed', async () => {
    const user = userEvent.setup();
    suggest = () => ok({ suggestions: [{ url: 'https://wikipedia.org/wiki/A', title: 'A' }] });
    show({ tab: tab() });
    await user.click(field());
    await user.keyboard('wikipedia.org');
    await wait(80);
    expect(calls('browser.history.suggest')).toEqual([{ partition: 'persist:maws-browser', query: 'wikipedia.org' }]);
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([BROWSER_COPY.goTo('https://wikipedia.org/'), BROWSER_COPY.searchFor('wikipedia.org'), 'Ahttps://wikipedia.org/wiki/A']);
    const selected = () => field().getAttribute('aria-activedescendant');
    expect(selected()).toBe(screen.getAllByRole('option')[0]!.id);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(selected()).toBe(screen.getAllByRole('option')[2]!.id);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(screen.getAllByRole('option')[1]!.id);
    await user.keyboard('{Enter}');
    await wait(0);
    expect(calls('browser.tabs.navigate')).toEqual([{ tabId: T1, to: { url: `${SEARCH.replace('%s', 'wikipedia.org')}`, typed: true } }]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter with no arrow goes to the typed address as main’s check parses it, and a click runs a row', async () => {
    const user = userEvent.setup();
    suggest = () => ok({ suggestions: [{ url: 'https://b.test/x', title: null }] });
    show({ tab: tab() });
    await user.click(field());
    await user.keyboard('localhost:3000{Enter}');
    await wait(0);
    expect(calls('browser.tabs.navigate').at(-1)).toEqual({ tabId: T1, to: { url: 'http://localhost:3000/', typed: true } });
    await user.click(field());
    await user.keyboard('b.t');
    await wait(80);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'https://b.test/x' }));
    await wait(0);
    expect(calls('browser.tabs.navigate').at(-1)).toEqual({ tabId: T1, to: { url: 'https://b.test/x', typed: true } });
  });

  it('only the newest query’s answer is listed', async () => {
    const user = userEvent.setup();
    const answers: ((value: ReturnType<Handler>) => void)[] = [];
    suggest = () => new Promise((resolve) => answers.push(resolve));
    show({ tab: tab() });
    await user.click(field());
    await user.keyboard('a');
    await wait(80);
    await user.keyboard('b');
    await wait(80);
    expect(answers).toHaveLength(2);
    await act(async () => answers[1]!(ok({ suggestions: [{ url: 'https://new.test/', title: 'new' }] })));
    await act(async () => answers[0]!(ok({ suggestions: [{ url: 'https://old.test/', title: 'old' }] })));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options.some((text) => text?.includes('new.test'))).toBe(true);
    expect(options.some((text) => text?.includes('old.test'))).toBe(false);
  });

  it('a refused scheme loads nothing, keeps the text, and raises the refused-scheme line for the session', async () => {
    const user = userEvent.setup();
    show({ tab: tab() });
    await user.click(field());
    await user.keyboard('file:///etc/hosts{Enter}');
    await wait(0);
    expect(calls('browser.tabs.navigate')).toEqual([]);
    expect(field().value).toBe('file:///etc/hosts');
    expect(browser.getState().notices).toEqual([{ id: expect.any(Number), appSessionId: A, tabId: T1, kind: 'refusedScheme', name: 'file:' }]);
    expect(screen.getByText(BROWSER_COPY.refusedScheme('file:'))).toBeTruthy();
  });

  it('with no tab, the address opens an empty tab of the session and navigates it as typed', async () => {
    const user = userEvent.setup();
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => {});
    show({ tab: null });
    await user.click(field());
    await user.keyboard('example.com{Enter}');
    await wait(0);
    expect(calls('browser.tabs.open')).toEqual([{ appSessionId: A, url: null, select: true }]);
    expect(calls('browser.tabs.navigate')).toEqual([{ tabId: T2, to: { url: 'https://example.com/', typed: true } }]);
    expect(openTab).not.toHaveBeenCalled(); // the panel shows the session's selected tab
  });

  it('a main tab with no tab of its own ("That tab was closed") moves to the opened tab’s main tab', async () => {
    const user = userEvent.setup();
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => {});
    render(<Chrome appSessionId={A} surface="main" tab={null} tabs={[]} />);
    await user.click(field());
    await user.keyboard('example.com{Enter}');
    await wait(0);
    expect(calls('browser.tabs.navigate')).toEqual([{ tabId: T2, to: { url: 'https://example.com/', typed: true } }]);
    expect(openTab).toHaveBeenCalledWith({ kind: 'browser', appSessionId: A, browserTabId: T2 });
  });

  it('the list holds the window’s cover while it shows', async () => {
    const user = userEvent.setup();
    const pane = coverPane(() => null);
    show({ tab: tab() });
    await user.click(field());
    await user.keyboard('x');
    expect(calls('browser.view.cover')).toEqual([{ covered: true }]);
    await user.keyboard('{Escape}');
    await wait(0);
    expect(calls('browser.view.cover')).toEqual([{ covered: true }, { covered: false }]);
    pane.release();
  });

  it('main’s focusAddress focuses the owning chrome’s field alone', () => {
    const { rerender } = show({ tab: tab(), owns: false });
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'focusAddress' }));
    expect(document.activeElement).not.toBe(field());
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab()} tabs={[]} owns />);
    act(() => main.emit('browser.chrome.command', { tabId: T2, command: 'focusAddress' }));
    expect(document.activeElement).not.toBe(field());
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'focusAddress' }));
    expect(document.activeElement).toBe(field());
  });
});

describe('the find bar', () => {
  const bar = () => screen.queryByRole('search', { name: BROWSER_COPY.find.label });
  const open = () => act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'openFind' }));

  it('opens on main’s openFind with an empty search, searches each keystroke, steps, and closes with null', async () => {
    const user = userEvent.setup();
    const { rerender } = show({ tab: tab(), owns: true });
    open();
    await wait(0);
    expect(bar()).toBeTruthy();
    expect(document.activeElement).toBe(within(bar()!).getByRole('textbox'));
    await user.keyboard('ne');
    await user.keyboard('{Enter}');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await wait(0);
    expect(calls('browser.tabs.find')).toEqual([
      { tabId: T1, text: '' },
      { tabId: T1, text: 'n', forward: true, findNext: false, matchCase: false },
      { tabId: T1, text: 'ne', forward: true, findNext: false, matchCase: false },
      { tabId: T1, text: 'ne', forward: true, findNext: true, matchCase: false },
      { tabId: T1, text: 'ne', forward: false, findNext: true, matchCase: false },
    ]);
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ find: { active: 2, matches: 7 } })} tabs={[]} owns />);
    expect(within(bar()!).getByRole('status').textContent).toBe('2 / 7 results');
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ find: { active: 0, matches: 0 } })} tabs={[]} owns />);
    expect(within(bar()!).getByRole('status').textContent).toBe('0 results');
    await user.keyboard('{Escape}');
    await wait(0);
    expect(bar()).toBeNull();
    expect(calls('browser.tabs.find').at(-1)).toEqual({ tabId: T1, text: null });
  });

  it('closes on main’s closeFind, and says a page with nothing to search cannot be searched', async () => {
    const { rerender } = show({ tab: tab({ suspended: true }), owns: true });
    open();
    expect(within(bar()!).getByRole('status').textContent).toBe(BROWSER_COPY.find.unavailable);
    act(() => main.emit('browser.chrome.command', { tabId: T1, command: 'closeFind' }));
    expect(bar()).toBeNull();
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab()} tabs={[]} owns={false} />);
    open();
    expect(bar()).toBeNull(); // not this chrome's page
  });
});

describe('the notice lines', () => {
  const line = (kind: string) => document.querySelector(`[data-browser-notice="${kind}"]`) as HTMLElement | null;
  const dismissIn = (kind: string) => fireEvent.click(within(line(kind)!).getByRole('button', { name: BROWSER_COPY.dismiss }));

  it('the tab’s denied permissions, download, unresponsive page and blocked pop-ups, each dismissed through main', async () => {
    show({
      tab: tab({
        denied: [
          { host: 'a.test', permission: 'notifications' },
          { host: 'a.test', permission: 'idle-weird' },
        ],
        download: { name: 'f.bin', state: 'done', received: 4096, total: 4096, path: '/tmp/f.bin' },
        unresponsive: true,
        blockedPopups: 10,
      }),
    });
    expect(line('denied')!.textContent).toContain('a.test asked to show notifications · blocked');
    expect(line('denied')!.textContent).toContain('a.test asked to use idle-weird · blocked');
    expect(line('download')!.textContent).toContain(BROWSER_COPY.downloadDone('f.bin'));
    expect(line('popups')!.textContent).toContain('10 pop-ups blocked');
    fireEvent.click(within(line('download')!).getByRole('button', { name: BROWSER_COPY.revealInFinder }));
    fireEvent.click(within(line('unresponsive')!).getByRole('button', { name: BROWSER_COPY.stopPage }));
    for (const kind of ['denied', 'download', 'unresponsive', 'popups']) dismissIn(kind);
    await wait(0);
    expect(calls('browser.tabs.revealDownload')).toEqual([{ tabId: T1 }]);
    expect(calls('browser.tabs.navigate')).toEqual([{ tabId: T1, to: 'stop' }]);
    expect(calls('browser.tabs.dismiss').map((input) => input.notice)).toEqual(['denied', 'download', 'unresponsive', 'popups']);
  });

  it('a download in progress shows its percent and cannot be dismissed', () => {
    show({ tab: tab({ download: { name: 'f.bin', state: 'progressing', received: 1024, total: 4096, path: null } }) });
    expect(line('download')!.textContent).toContain('Downloading f.bin · 25%');
    expect(within(line('download')!).queryByRole('button')).toBeNull();
  });

  it('the session’s transient notices, routed by session, each with its sentence and Dismiss', () => {
    show({ tab: tab() });
    act(() => {
      raiseNotice({ appSessionId: A, tabId: T2, kind: 'tabsCap', count: 12 });
      raiseNotice({ appSessionId: A, tabId: T2, kind: 'tabsCap' });
      raiseNotice({ appSessionId: A, tabId: null, kind: 'urlCopied' });
      raiseNotice({ appSessionId: A, tabId: null, kind: 'partitionFallback', name: 'Work' });
      raiseNotice({ appSessionId: B, tabId: null, kind: 'tabsFileBroken' });
    });
    const texts = [...document.querySelectorAll('[data-browser-notice]')].map((element) => element.textContent);
    expect(texts).toEqual([BROWSER_COPY.tabsCap(12), BROWSER_COPY.tabsCapMemory, BROWSER_COPY.urlCopied, BROWSER_COPY.partitionFallback('Work')]);
    fireEvent.click(within(line('urlCopied')!).getByRole('button', { name: BROWSER_COPY.dismiss }));
    expect(line('urlCopied')).toBeNull();
    expect(browser.getState().notices.map((notice) => notice.kind)).toEqual(['tabsCap', 'tabsCap', 'partitionFallback', 'tabsFileBroken']);
  });
});

describe('the tab strip', () => {
  const tabs = () => [tab({ title: 'Page A' }), browserTab(T2, A, { title: '', url: 'https://b.test/x', suspended: true })];

  it('in the panel a chip selects its tab; a closed chip closes its tab; "+" opens an empty one', async () => {
    render(<Chrome appSessionId={A} surface="panel" tab={tabs()[0]!} tabs={tabs()} />);
    const chips = screen.getAllByRole('tab');
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute('aria-selected')])).toEqual([
      ['Page A', 'true'],
      ['b.test', 'false'],
    ]);
    expect(document.querySelector(`[data-browser-chip="${T2}"]`)!.hasAttribute('data-suspended')).toBe(true);
    fireEvent.click(chips[1]!);
    fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.closeTabNamed('b.test') }));
    fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.newTabAction }));
    await wait(0);
    expect(calls('browser.tabs.select')).toEqual([{ appSessionId: A, tabId: T2 }]);
    expect(calls('browser.tabs.close')).toEqual([{ tabId: T2 }]);
    expect(calls('browser.tabs.open')).toEqual([{ appSessionId: A, url: null, select: true }]);
  });

  it('after a failed load a chip names the failed host, not the last page’s title', () => {
    const failed = tab({ title: 'Page A', url: 'http://127.0.0.1:1/', loadError: { url: 'http://127.0.0.1:1/', host: '127.0.0.1', kind: 'refused', code: -102, description: 'ERR_CONNECTION_REFUSED' } });
    render(<Chrome appSessionId={A} surface="panel" tab={failed} tabs={[failed]} />);
    expect(screen.getByRole('tab').textContent).toBe('127.0.0.1');
  });

  it('in a main tab a chip opens that tab’s own main tab, and "+" moves to the new tab’s', async () => {
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => {});
    render(<Chrome appSessionId={A} surface="main" tab={tabs()[0]!} tabs={tabs()} />);
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.newTabAction }));
    await wait(0);
    expect(calls('browser.tabs.select')).toEqual([]);
    expect(openTab.mock.calls.map(([ref]) => ref)).toEqual([
      { kind: 'browser', appSessionId: A, browserTabId: T2 },
      { kind: 'browser', appSessionId: A, browserTabId: T2 },
    ]);
  });
});

describe('the overflow menu', () => {
  const menu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: BROWSER_COPY.options }));
    return screen.findAllByRole('menuitem');
  };

  it('Copy URL writes the address and raises the chrome’s own notice; Open in tab opens the main tab', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    onTestFinished(() => {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    });
    const openTab = vi.spyOn(useLayout.getState(), 'openTab').mockImplementation(() => {});
    show({ tab: tab({ url: 'https://example.com/a' }) });
    await menu(user);
    await user.click(screen.getByRole('menuitem', { name: BROWSER_COPY.menu.copyUrl }));
    await wait(0);
    expect(writeText).toHaveBeenCalledWith('https://example.com/a');
    expect(browser.getState().notices.map((notice) => notice.kind)).toEqual(['urlCopied']);
    await menu(user);
    await user.click(screen.getByRole('menuitem', { name: BROWSER_COPY.menu.openInTab }));
    expect(openTab).toHaveBeenCalledWith({ kind: 'browser', appSessionId: A, browserTabId: T1 });
  });

  const disabledItems = async (user: ReturnType<typeof userEvent.setup>) =>
    (await menu(user)).filter((item) => item.getAttribute('aria-disabled') === 'true').map((item) => item.textContent);

  it('a chrome whose pane does not hold the view offers neither find nor zoom (they act on the page it does not show)', async () => {
    const user = userEvent.setup();
    const { rerender } = show({ tab: tab({ zoom: 1.25 }), owns: false });
    expect(await disabledItems(user)).toEqual([BROWSER_COPY.menu.find, BROWSER_COPY.menu.zoomIn, BROWSER_COPY.menu.zoomOut, BROWSER_COPY.menu.resetZoom]);
    await user.keyboard('{Escape}');
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab({ zoom: 1.25 })} tabs={[]} owns />);
    expect(await disabledItems(user)).toEqual([]);
  });

  it('a suspended tab offers no page actions; Find in page opens the bar on a live one', async () => {
    const user = userEvent.setup();
    const { rerender } = show({ tab: tab({ suspended: true }), owns: true });
    expect(await disabledItems(user)).toEqual([BROWSER_COPY.menu.find, BROWSER_COPY.menu.zoomIn, BROWSER_COPY.menu.zoomOut, BROWSER_COPY.menu.resetZoom, BROWSER_COPY.menu.inspect]);
    await user.keyboard('{Escape}');
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab()} tabs={[]} owns />);
    await menu(user);
    await user.click(screen.getByRole('menuitem', { name: BROWSER_COPY.menu.find }));
    await wait(10);
    expect(screen.getByRole('search', { name: BROWSER_COPY.find.label })).toBeTruthy();
    expect(calls('browser.tabs.find')).toEqual([{ tabId: T1, text: '' }]);
  });
});

describe('the extras slot', () => {
  it('renders each registered extra with the shown tab, before the overflow menu, until it is removed', () => {
    const seen: ChromeExtraProps[] = [];
    const Extra = (props: ChromeExtraProps) => {
      seen.push(props);
      return <button type="button">Comment</button>;
    };
    const remove = registerChromeExtra(Extra);
    const { rerender } = show({ tab: tab() });
    const buttons = screen.getAllByRole('button').map((button) => button.textContent || button.getAttribute('aria-label'));
    expect(buttons.indexOf('Comment')).toBe(buttons.indexOf(BROWSER_COPY.options) - 1);
    expect(seen.at(-1)).toEqual({ tab: tab(), appSessionId: A, surface: 'panel' });
    act(() => remove());
    rerender(<Chrome appSessionId={A} surface="panel" tab={tab()} tabs={[]} />);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });
});
