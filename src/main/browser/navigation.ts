// A tab's navigation (E4a execution document, Design §4, §5, §7, §8 and §14): the commands the chrome sends
// (`browser.tabs.navigate`, `zoom`, `find`, `dismiss`, `devtools`), and the view's own events read into the tab.
//
// Tab state comes from the view's events alone: every `loadURL` is voided (it rejects on every failure, superseded
// navigations included), and the load-error lifecycle is the store's transitions (`beginNavigation`,
// `navigationCommitted`, `loadFailed`, `rendererGone`; Decision Log 23) driven from here: a main-frame `did-fail-load`
// that is not -3 sets the error and hides the view; the next main-frame `did-navigate`, which Electron emits only for a
// committed non-error document, clears it, as does any navigation command. Reload after a failure loads the failed URL
// again, since the committed entry is then Chromium's error page; after a crash it loads the tab's URL, reviving the
// renderer.
//
// Visits feed the history (Decision Log 14: in-page navigations count; the address field's own navigation counts as
// typed), and titles name the visited row. A page's own top-level navigation leaves http(s) only for `mailto:`, which goes
// out through `openExternalUrl` (Decision Log 27) under the `window.open` gate (a recent activation, three per 5 s), so a
// script cannot launch the mail client in a loop; anything else is refused with the seam line and the chrome's notice,
// told once per burst of refusals (cua board #90: an internal tab, an extension's options page, admits its own
// extension's pages, and its links to the web open as a new tab of its session after an activation, the tab staying
// the extension's; it keeps the extension's title and icon through its page's own). A page that closes itself (`window.close()`) takes its tab with it. A certificate
// error is never overridden, no client certificate is ever chosen, and `beforeunload` never blocks (Decision Log 26).
import type { Certificate, WebContents } from 'electron';
import { isExtensionPage } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { BrowserHistoryStore } from '../index/browser-history';
import type { Favicons } from './favicon';
import type { BrowserSeam } from './seam';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';
import { activationAllows, WINDOW_OPEN_INPUT_MS } from './window-open';

// Chrome's zoom presets (Design §4).
export const ZOOM_PRESETS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const ZOOM_EPSILON = 0.005; // a factor read back through Chromium's zoom levels lands near, not on, its preset

export function stepZoom(current: number, action: 'in' | 'out' | 'reset'): number {
  if (action === 'reset') return 1;
  if (action === 'in') return ZOOM_PRESETS.find((preset) => preset > current + ZOOM_EPSILON) ?? ZOOM_PRESETS[ZOOM_PRESETS.length - 1];
  return [...ZOOM_PRESETS].reverse().find((preset) => preset < current - ZOOM_EPSILON) ?? ZOOM_PRESETS[0];
}

const roundZoom = (factor: number) => Math.round(factor * 100) / 100;

// What a subframe may never load (the main frame's navigations are `will-navigate`'s).
const SUBFRAME_REFUSED = /^(?:file|maws-deliverable|chrome|devtools):/i;

export type NavigateTo = { url: string; typed?: boolean } | 'back' | 'forward' | 'reload' | 'stop';
export type FindRequest = { text: string | null; forward?: boolean; findNext?: boolean; matchCase?: boolean };
export type DismissedNotice = 'denied' | 'download' | 'unresponsive' | 'popups' | 'failed';

export interface NavigatorDeps {
  store: TabStore;
  history: Pick<BrowserHistoryStore, 'visit' | 'setTitle'>;
  favicons: Pick<Favicons, 'resolve'>;
  emit: BrowserEmit;
  seam: Pick<BrowserSeam, 'line' | 'openExternal'>;
  now?(): number;
}

export class Navigator {
  private readonly typed = new WeakMap<TabEntry, string>(); // the address field's navigation (its URL), until it lands
  private readonly killing = new WeakSet<TabEntry>(); // Stop page killed the renderer: its exit is not a crash
  private readonly faviconRequests = new WeakMap<TabEntry, number>();
  private readonly mailOpens = new WeakMap<TabEntry, number[]>(); // when the page's mailto: navigations went out
  private readonly lastRefusedAt = new WeakMap<TabEntry, number>(); // the page's last refused navigation
  private readonly webLinks = new WeakMap<TabEntry, number[]>(); // cua #90: when an internal tab's web links opened
  private readonly now: () => number;

  constructor(private readonly deps: NavigatorDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ---- commands -------------------------------------------------------------------------------------------------------

  // `browser.tabs.navigate`: false when there was nothing to do (no history that way, no page to stop or reload) or the
  // tab could not be loaded (left suspended by the cap; its view could not be created).
  //
  // Every caller is the person (the chrome's buttons and address field over IPC, the page's context menu, keys.ts's
  // chords); an agent navigates through CDP under its lease and never comes here. So the command is stamped on the tab's
  // input seam as the person's input, as a click in the page would be: `personHolds` then reads the navigation it starts
  // as theirs, not as the agent's activity (cua board #98: a Reload from the chrome on a leased idle tab passed through
  // no hook of the page's and was told as "Navigated to …"). No activation, so neither the `window.open` gate nor the
  // clipboard carve-out opens for the page; a chord's key is also counted by the page's own hook.
  navigate(tabId: string, to: NavigateTo): boolean {
    const { store } = this.deps;
    const entry = store.require(tabId);
    entry.input.emit({ kind: 'chrome', source: 'human', at: this.now(), activation: false });
    const wc = entry.view?.webContents ?? null;
    if (typeof to === 'object') {
      const checked = validateBrowserUrl(to.url);
      if (!checked.ok) return false;
      this.typed.delete(entry);
      if (!store.load(tabId, checked.url)) return false;
      if (to.typed) this.typed.set(entry, checked.url);
      return true;
    }
    switch (to) {
      case 'back':
      case 'forward': {
        const history = wc?.navigationHistory;
        if (!history || !(to === 'back' ? history.canGoBack() : history.canGoForward())) return false;
        this.typed.delete(entry);
        store.beginNavigation(tabId);
        if (to === 'back') history.goBack();
        else history.goForward();
        return true;
      }
      case 'reload': {
        const { loadError, crashed, url } = entry.tab;
        // the failed URL, or the tab's own when there is no live document to reload (crashed, or no view at all)
        const again = loadError?.url ?? (crashed !== null || !wc ? url : null);
        if (again !== null) {
          const checked = validateBrowserUrl(again);
          if (checked.ok) {
            this.typed.delete(entry);
            return store.load(tabId, checked.url);
          }
          if (!wc) return false;
        }
        this.typed.delete(entry);
        store.beginNavigation(tabId);
        wc!.reload();
        return true;
      }
      case 'stop': {
        if (!wc) return false;
        if (entry.tab.unresponsive) {
          // Stop page: a hung renderer cannot stop itself; it is killed and the page reloaded in a fresh one
          this.killing.add(entry);
          store.beginNavigation(tabId, { unresponsive: false });
          wc.forcefullyCrashRenderer();
          wc.reload();
          return true;
        }
        wc.stop();
        return true;
      }
    }
  }

  // `browser.tabs.zoom`: Chrome's next preset. Chromium keeps zoom per host within a partition, so the partition's other
  // loaded tabs are read back too. A tab with no page answers its own value.
  zoom(tabId: string, action: 'in' | 'out' | 'reset'): number {
    const { store } = this.deps;
    const entry = store.require(tabId);
    const wc = entry.view?.webContents;
    if (!wc) return entry.tab.zoom;
    const zoom = stepZoom(roundZoom(wc.getZoomFactor()), action);
    wc.setZoomFactor(zoom);
    store.update(tabId, { zoom });
    for (const other of store.all()) {
      if (other === entry || !other.view || other.tab.partition !== entry.tab.partition) continue;
      const read = roundZoom(other.view.webContents.getZoomFactor());
      if (read !== other.tab.zoom) store.update(other.tab.tabId, { zoom: read });
    }
    return zoom;
  }

  // `browser.tabs.find`: a keystroke (`findNext` false) starts a session, Enter or an arrow (`findNext` true) moves within
  // it (Electron's `findNext` means the opposite: "begin a new session"); empty text clears the results with the bar
  // still open; `null` closes the bar.
  find(tabId: string, { text, forward = true, findNext = false, matchCase = false }: FindRequest): void {
    const { store } = this.deps;
    const entry = store.require(tabId);
    entry.findOpen = text !== null;
    const wc = entry.view?.webContents;
    if (text === null || text === '') {
      wc?.stopFindInPage('clearSelection');
      if (entry.tab.find !== null) store.update(tabId, { find: null });
      return;
    }
    wc?.findInPage(text, { forward, findNext: !findNext, matchCase });
  }

  // `browser.tabs.dismiss`: a notice's line closed. A download still in progress keeps its line (and keeps the tab out of
  // the cap's reach), so its progress is not lost.
  dismiss(tabId: string, notice: DismissedNotice): void {
    const { store } = this.deps;
    const { tab } = store.require(tabId);
    switch (notice) {
      case 'denied':
        return void store.update(tabId, { denied: [] });
      case 'download':
        if (tab.download?.state !== 'progressing') store.update(tabId, { download: null });
        return;
      case 'unresponsive':
        return void store.update(tabId, { unresponsive: false });
      case 'popups':
        return void store.update(tabId, { blockedPopups: 0 });
      case 'failed':
        return void store.update(tabId, { failed: null });
    }
  }

  // `browser.tabs.devtools`: the human's Inspect, detached.
  devtools(tabId: string): void {
    this.deps.store.require(tabId).view?.webContents.openDevTools({ mode: 'detach' });
  }

  // ---- the view's events ----------------------------------------------------------------------------------------------

  // Wires a new view's webContents (the store's `onViewCreated`). Every listener acts only while the view is still the
  // tab's: a suspended or closed tab's late events change nothing.
  attach(entry: TabEntry): void {
    const { store } = this.deps;
    const view = entry.view!;
    const wc = view.webContents;
    const { tabId } = entry.tab;
    const live = () => store.entry(tabId) === entry && entry.view === view;

    wc.on('did-start-loading', () => {
      if (live()) store.update(tabId, { loading: true });
    });
    wc.on('did-stop-loading', () => {
      if (!live()) return;
      this.typed.delete(entry); // a typed navigation that never landed
      store.loadStopped(tabId, historyFlags(wc)); // one that neither committed nor failed: the tab returns to what it showed
    });
    wc.on('did-navigate', (_event, url) => {
      if (!live()) return;
      const typed = this.typed.delete(entry); // after redirects the URL is not the typed one, but the navigation is
      store.navigationCommitted(tabId, { url: ownUrl(url), ...historyFlags(wc) });
      const internal = entry.tab.internal; // cua #90: still an internal tab once committed: the extension's title
      store.update(tabId, { title: internal ? internal.title : committedTitle(wc, url), zoom: roundZoom(wc.getZoomFactor()) });
      this.visit(entry, url, typed);
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!live() || !isMainFrame) return;
      // the typed navigation only when this is it (a fragment typed on the same page), not a page's own pushState
      const typed = this.typed.get(entry) === normalisedUrl(url) && this.typed.delete(entry);
      store.navigatedInPage(tabId, { url: ownUrl(url), ...historyFlags(wc), loading: wc.isLoading() });
      this.visit(entry, url, typed);
    });
    wc.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      if (!live() || !isMainFrame) return;
      if (code !== -3) this.typed.delete(entry); // -3: replaced by another navigation, perhaps the typed one
      store.loadFailed(tabId, { url: validatedURL || entry.tab.url, code, description, ...historyFlags(wc) });
    });
    wc.on('page-title-updated', (_event, title) => {
      if (!live() || entry.tab.internal) return; // cua #90: an internal tab is titled by MAWS
      store.update(tabId, { title });
      // the title is the committed document's, never a pending navigation's target (whose row it would mislabel), nor
      // an error page's raised after a failed load (`committed` false), which would relabel the last good page's row
      const { partition } = entry.tab;
      const url = entry.committedUrl;
      if (entry.committed && url !== null && validateBrowserUrl(url).ok) this.safely(() => this.deps.history.setTitle(partition, url, title));
    });
    wc.on('page-favicon-updated', (_event, favicons) => {
      if (!live() || entry.tab.internal) return; // cua #90: an internal tab shows its extension's icon
      const request = (this.faviconRequests.get(entry) ?? 0) + 1;
      this.faviconRequests.set(entry, request);
      void this.deps.favicons.resolve(entry.tab.partition, favicons, entry.committedUrl /* cua #90: the bar's icons */).then((favicon) => {
        if (live() && this.faviconRequests.get(entry) === request) store.update(tabId, { favicon });
      });
    });
    wc.on('render-process-gone', (_event, details) => {
      if (!live()) return;
      if (this.killing.delete(entry)) return; // Stop page's own kill; the reload is already under way
      store.rendererGone(tabId, details.reason);
    });
    wc.on('unresponsive', () => {
      if (live()) store.update(tabId, { unresponsive: true });
    });
    wc.on('responsive', () => {
      if (live()) store.update(tabId, { unresponsive: false });
    });
    wc.on('zoom-changed', (_event, direction) => {
      if (live()) this.zoom(tabId, direction);
    });
    wc.on('found-in-page', (_event, result) => {
      if (!live()) return;
      const was = entry.tab.find;
      // Chromium reports -1 for a field an interim update leaves unchanged
      const active = result.activeMatchOrdinal >= 0 ? result.activeMatchOrdinal : (was?.active ?? 0);
      const matches = result.matches >= 0 ? result.matches : (was?.matches ?? 0);
      store.update(tabId, { find: { active, matches } });
    });

    wc.on('will-navigate', (event) => {
      const { url } = event;
      const internal = entry.tab.internal; // cua #90
      if (internal && isExtensionPage(url, internal.extensionId)) return;
      if (!internal && validateBrowserUrl(url).ok) return;
      event.preventDefault();
      if (!live()) return;
      const at = this.now();
      if (internal && validateBrowserUrl(url).ok) return this.openWebLink(entry, url, at); // cua #90
      if (/^mailto:/i.test(url)) {
        const sent = (this.mailOpens.get(entry) ?? []).filter((when) => at - when < WINDOW_OPEN_INPUT_MS);
        this.mailOpens.set(entry, sent);
        if (activationAllows(at, entry.input.lastActivationAt, sent)) {
          sent.push(at);
          return this.deps.seam.openExternal(url);
        }
      }
      this.deps.seam.line(`browser-blocked-navigation ${url}`);
      // a script's loop of refusals is one burst, told once: a notice only after WINDOW_OPEN_INPUT_MS without a refusal
      const last = this.lastRefusedAt.get(entry);
      this.lastRefusedAt.set(entry, at);
      if (last !== undefined && at - last <= WINDOW_OPEN_INPUT_MS) return;
      this.deps.emit('browser.notice', { appSessionId: entry.tab.appSessionId, tabId, kind: 'refusedScheme', name: schemeOf(url) });
    });
    wc.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && SUBFRAME_REFUSED.test(event.url)) event.preventDefault();
    });
    wc.on('certificate-error', (event, _url, _error, _certificate, callback) => {
      event.preventDefault();
      callback(false); // never "proceed anyway" in P1; the load fails with its ERR_CERT_*
    });
    wc.on('select-client-certificate', (event, _url, _certificates, callback) => {
      event.preventDefault(); // Electron's default hands the site the keychain's first certificate
      // no certificate: the webContents event forwards the app's callback, whose argument is optional (`electron.d.ts:821`)
      (callback as (certificate?: Certificate) => void)();
    });
    wc.on('will-prevent-unload', (event) => event.preventDefault());
    // `window.close()` (Chromium allows it to a page a script opened, so every adopted popup): the webContents is
    // destroyed under the tab, which is dropped as a close drops it. The store's own closing and suspending let go of
    // the view first, so their late `destroyed` finds it no longer the tab's.
    wc.once('destroyed', () => {
      if (live()) store.pageClosed(tabId);
    });
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  // cua #90: a link from an internal tab to the web: a new selected tab of its session and partition after an activation
  // in the page (the `window.open` gate's rule), so the extension's page stays where it is; without one, a blocked pop-up.
  private openWebLink(entry: TabEntry, url: string, at: number): void {
    const { store } = this.deps;
    const recent = (this.webLinks.get(entry) ?? []).filter((when) => at - when < WINDOW_OPEN_INPUT_MS);
    this.webLinks.set(entry, recent);
    if (!activationAllows(at, entry.input.lastActivationAt, recent)) {
      store.update(entry.tab.tabId, { blockedPopups: entry.tab.blockedPopups + 1 });
      return this.deps.seam.line(`browser-blocked-popup ${url}`);
    }
    recent.push(at);
    const { appSessionId, partition } = entry.tab;
    store.open({ appSessionId, url, select: true, partition, opener: entry });
  }

  private visit(entry: TabEntry, url: string, typed: boolean): void {
    if (!validateBrowserUrl(url).ok) return; // about:blank never reaches the history
    const { partition } = entry.tab;
    this.safely(() => this.deps.history.visit(partition, url, { typed, at: this.now() }));
  }

  // History is a convenience: a failing index drops the write, never the navigation that fed it (Design §15).
  private safely(write: () => void): void {
    try {
      write();
    } catch (error) {
      console.warn('[browser] a history write failed:', error instanceof Error ? error.message : error);
    }
  }
}

const historyFlags = (wc: WebContents) => ({ canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });

// A URL as `validateBrowserUrl` writes it (what a typed navigation's target was recorded as).
const normalisedUrl = (url: string) => {
  const checked = validateBrowserUrl(url);
  return checked.ok ? checked.url : url;
};

// The URL a tab records: `about:blank` (an adopted child's empty document) is the empty tab's ''.
const ownUrl = (url: string) => (url === 'about:blank' ? '' : url);

// The committed entry's own title: empty for a new document until its <title> arrives (`page-title-updated`); kept by an
// entry Back or Forward returns to. An entry titled with its own URL is Chromium's fallback, read as untitled.
function committedTitle(wc: WebContents, url: string): string {
  try {
    const history = wc.navigationHistory;
    const title = history.getEntryAtIndex(history.getActiveIndex())?.title ?? '';
    return isUrlTitle(title, url) ? '' : title;
  } catch {
    return '';
  }
}

// Whether a title is Chromium's fallback for an untitled entry: the URL itself, or the URL as `url_formatter::FormatUrl`
// shows it by default (Electron 44.4.5's entries carry this form: no "http://", no trailing slash on a bare host,
// unescaped), so the chrome falls back to the host as for any untitled page.
function isUrlTitle(title: string, url: string): boolean {
  if (title === url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const bare = parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  const shown = `${parsed.protocol === 'http:' ? '' : `${parsed.protocol}//`}${parsed.host}${bare ? '' : `${parsed.pathname}${parsed.search}${parsed.hash}`}`;
  if (title === shown) return true;
  try {
    return title === decodeURI(shown);
  } catch {
    return false;
  }
}

function schemeOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(url);
  return match ? match[1]!.toLowerCase() : '';
}
