// E4a's `browser` group (docs/doperpowers/plans/2026-10-06-e4a-browser-view.md, Acceptance G1 to G5): the in-app browser
// on the real Electron, against a local server on loopback (support/browser-server.ts), in the product app over the
// replay (no engine). The first live run of main's browser code: views laid over panes, the cover, adoption of a page's
// window.open, the attribution seams behind the pop-up gate and the clipboard carve-out, errors, persistence.
//
// (1) show_pane, links and window.open, the browser preload once per page and never in a subframe, a main tab and the one
// owner, a popup closing itself; (2) error pages; (3) refused addresses; (4) the cover; (5) placement under resizes;
// (6) a relaunch restores tabs suspended; (7) permissions, the clipboard, a download, find, Esc; (8) the chrome in both
// themes (shots under MAWS_E4A_SHOTS=1).
// Runs under `pnpm e2e:browser` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch passes
// MAWS_HARNESS=0, so the window is the product app.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { connectFakeHost } from '../test/support/cua-fake-host';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './support/c7-replay';
import { closedPort, startBrowserServer } from './support/browser-server';
import { closeScene, scratchProject, seamLines, show, type Scene } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';
import { withNativeClipboard } from './support/clipboard';
import {
  address, browserIn, browserScene, chipOf, chipsIn, expectOnPane, hiddenAfter, launchBrowserScene, metrics, noticesIn, offPaneAfterFrames, openBrowser, overflow, pageAt, paneIn, preloadRuns,
  preloadRunsAt, resizeWindow, shootBrowser, showPane, tabAt, tabState, tabsOf, viewOf,
} from './support/browser-scene';

test.describe.configure({ timeout: 180_000 });

// ---- (1) G1 -----------------------------------------------------------------------------------------------------------

test('show_pane opens one tab for two windows’ worth of one request; links and window.open open tabs, gated without input; a main tab owns the view until Show here', async () => {
  await browserScene(['E4a: browse'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    const A = s.server.url('/a.html');
    await show(s, id);
    for (let k = 0; k < 2; k++) await showPane(s, { appSessionId: id, requestId: 'e4a-show-1', target: A });
    const panel = browserIn(s, 'panel');
    await expect(panel).toBeVisible();
    const a = await tabAt(s, id, A);
    await expect(chipsIn(panel)).toHaveCount(1);
    const pageA = await pageAt(s, A);
    await expect(pageA.locator('#heading')).toHaveText('Page A');
    await expectOnPane(s, a, paneIn(panel), 'panel');
    expect(await tabsOf(s, id)).toMatchObject({ selected: a });
    // the chip reads the page's title, beside the favicon main fetched on the partition and handed over as data
    await expect(chipOf(panel, a).getByRole('tab')).toHaveText('Page A');
    await expect.poll(async () => (await tabState(s, a)).tab?.favicon?.slice(0, 22)).toBe('data:image/png;base64,');
    await expect(chipOf(panel, a).locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    expect(s.server.hits('/favicon.ico')).toBeGreaterThan(0);

    // The chrome's layout.openExternal hand-off stays in the scratch seam log, never the real system browser.
    await overflow(s, panel, 'Open in external browser');
    await expect.poll(() => seamLines(s)).toContain(`openExternal ${A}`);
    await expectOnPane(s, a, paneIn(panel), 'panel');
    expect((await tabState(s, a)).tab?.url).toBe(A);

    // ten window.open calls on a timer with no input to the page: none honoured, each counted, the line shown
    await pageA.evaluate(() => (window as unknown as { popupLoop(): void }).popupLoop());
    await expect.poll(async () => (await tabState(s, a)).tab?.blockedPopups).toBe(10);
    await expect(chipsIn(panel)).toHaveCount(1);
    await expect(noticesIn(panel).filter({ hasText: '10 pop-ups blocked' })).toBeVisible();
    expect(seamLines(s).filter((line) => line.startsWith('browser-blocked-popup '))).toHaveLength(10);

    // a target="_blank" link: a second tab, selected, with no opener (Chromium's noopener for _blank)
    await pageA.locator('#blank').click();
    await expect(chipsIn(panel)).toHaveCount(2);
    const B = s.server.url('/b.html');
    const b = await tabAt(s, id, B);
    expect((await tabsOf(s, id)).selected).toBe(b);
    await expect((await pageAt(s, B)).locator('#opener')).toHaveText('false');
    await expectOnPane(s, b, paneIn(panel), 'panel');
    expect((await viewOf(s, a))?.visible).toBe(false);

    // the window.open button: a third tab, selected (a click's disposition is foreground-tab), its opener set
    await chipOf(panel, a).getByRole('tab').click();
    await expectOnPane(s, a, paneIn(panel), 'panel');
    await pageA.locator('#open-c').click();
    const C = s.server.url('/c.html');
    const c = await tabAt(s, id, C);
    expect((await tabsOf(s, id)).selected).toBe(c);
    const pageC = await pageAt(s, C);
    await expect(pageC.locator('#opener')).toHaveText('true');
    // safeDialogs: a tab's own page reports it; Electron 44.4.5 reports an adopted child's as false (a control run's
    // override of nodeIntegrationInSubFrames was not reported on the child either, while a probe's defaultFontSize did
    // apply), and a per-page preference has no session-level route, so the child's is recorded only; E4c's dialog wrap
    // (A-42) is the lever (Decision Log 56)
    const [ownDialogs, childDialogs] = await s.maws.app.evaluate(({ webContents }, urls) =>
      urls.map((url) => (webContents.getAllWebContents().find((w) => w.getURL() === url) as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences().safeDialogs), [A, C]);
    expect(ownDialogs).toBe(true);
    test.info().annotations.push({ type: 'adopted child safeDialogs as reported', description: String(childDialogs) });

    // a ⌘-click on the link: a fourth tab in the background, the selection unmoved
    await chipOf(panel, a).getByRole('tab').click();
    await expectOnPane(s, a, paneIn(panel), 'panel');
    await pageA.locator('#blank').click({ modifiers: ['Meta'] });
    await expect(chipsIn(panel)).toHaveCount(4);
    expect((await tabsOf(s, id)).selected).toBe(a);
    expect((await viewOf(s, a))?.visible).toBe(true);

    // the browser preload ran exactly once in each page's document: the tab's own (A), the target="_blank" and ⌘-click
    // tabs (both at B) and the window.open child (C); the page's own world cannot see its count (Decision Log 56)
    const pagesAtB = () => s.maws.app.windows().filter((p) => !p.isClosed() && p.url() === B);
    await expect.poll(() => pagesAtB().length).toBe(2);
    for (const page of pagesAtB()) await expect(page.locator('#heading')).toHaveText('Page B');
    const once = { main: 1, subframes: [] };
    expect({ A: await preloadRunsAt(s, A), B: await preloadRunsAt(s, B), C: await preloadRunsAt(s, C) }).toEqual({ A: [once], B: [once, once], C: [once] });
    expect(await pageA.evaluate(() => '__mawsBrowserPreloadRuns' in globalThis)).toBe(false);
    // it is the partition session's, named in no page's preferences, which keep MAWS's sandbox and isolation with Node in
    // no frame, adopted children included, all in the opener's partition
    expect(
      await s.maws.app.evaluate(
        ({ webContents }, urls) =>
          webContents
            .getAllWebContents()
            .filter((wc) => urls.includes(wc.getURL()))
            .map((wc) => {
              const prefs = (wc as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences(); // not in the typings
              return {
                url: wc.getURL(),
                sandbox: prefs.sandbox,
                contextIsolation: prefs.contextIsolation,
                nodeIntegration: prefs.nodeIntegration,
                nodeIntegrationInSubFrames: prefs.nodeIntegrationInSubFrames,
                webSecurity: prefs.webSecurity,
                storage: wc.session.storagePath?.split('/').pop(),
                sessionPreloads: wc.session.getPreloadScripts().map(({ id, type, filePath }) => `${id} ${type} ${filePath.split('/').slice(-3).join('/')}`),
              };
            })
            .sort((x, y) => x.url.localeCompare(y.url)),
        [A, B, C],
      ),
    ).toEqual(
      [A, B, B, C].map((url) => ({
        url,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        storage: 'maws-browser',
        sessionPreloads: ['maws-browser frame out/preload/browser.js'],
      })),
    );

    // Open in tab: a browser main tab shows the same tab; the panel's pane says where it went
    await overflow(s, panel, 'Open in tab');
    const main = browserIn(s, 'main');
    await expect(main).toBeVisible();
    await expect(paneIn(panel).locator('[data-browser-page="elsewhere"]')).toHaveText(/Shown in another pane/);
    await expectOnPane(s, a, paneIn(main), 'main');
    // a window resize moves the view with the main tab's pane, not the panel's
    await resizeWindow(s, paneIn(main), 100, 60);
    await expectOnPane(s, a, paneIn(main), 'main');
    // Show here takes it back into the panel
    await paneIn(panel).getByRole('button', { name: 'Show here' }).click();
    await expectOnPane(s, a, paneIn(panel), 'panel');
    await expect(paneIn(main).locator('[data-browser-page="elsewhere"]')).toBeVisible();
    // the menu's round trip moves the page though both panes stay mounted on the tab: Open in tab, Show in panel, again
    for (let round = 0; round < 2; round++) {
      await overflow(s, panel, 'Open in tab');
      await expectOnPane(s, a, paneIn(main), 'main');
      await expect(paneIn(panel).locator('[data-browser-page="elsewhere"]')).toBeVisible();
      await overflow(s, main, 'Show in panel');
      await expectOnPane(s, a, paneIn(panel), 'panel');
      await expect(paneIn(main).locator('[data-browser-page="elsewhere"]')).toBeVisible();
    }
    // another panel tab selected: the Browser tool's pane unmounts and the main tab takes the view back
    await s.panel.getByRole('button', { name: 'Add a tool' }).click();
    await s.page.getByRole('menuitem', { name: 'Deliverables' }).click();
    await expectOnPane(s, a, paneIn(main), 'main');
    expect((await viewOf(s, a))?.owner?.surface).toBe('main');

    // the opener closed: its window.open child lives on as its own tab (outlivesOpener)
    await s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Browser/ }).click();
    await expect(panel).toBeVisible();
    await chipOf(panel, a).getByRole('button', { name: /^Close / }).click();
    await expect.poll(async () => (await tabsOf(s, id)).tabs.map((tab) => tab.tabId)).toEqual([b, c, expect.any(String)]);
    await expect(paneIn(main).locator('[data-browser-page="empty"]')).toContainText('That tab was closed');
    expect(pageC.isClosed()).toBe(false);
    await expect(pageC.locator('#heading')).toHaveText('Page C');
    expect((await tabState(s, c)).tab).toMatchObject({ crashed: null, suspended: false, url: C });

    // a popup that closes itself (an OAuth sign-in once it has posted back): its tab goes, its opener is selected again,
    // and the window's cover still hides and restores the page
    await chipOf(panel, c).getByRole('tab').click();
    await expectOnPane(s, c, paneIn(panel), 'panel');
    await pageC.locator('#open-popup').click();
    const P = s.server.url('/c.html?popup=1');
    const popup = await tabAt(s, id, P);
    expect((await tabsOf(s, id)).selected).toBe(popup);
    const pagePopup = await pageAt(s, P);
    await expectOnPane(s, popup, paneIn(panel), 'panel');
    await pagePopup.locator('#close').click({ noWaitAfter: true });
    await expect.poll(async () => (await tabsOf(s, id)).tabs.map((tab) => tab.tabId)).toEqual([b, c, expect.any(String)]);
    expect((await tabsOf(s, id)).selected).toBe(c);
    await expect(chipsIn(panel)).toHaveCount(3);
    await expectOnPane(s, c, paneIn(panel), 'panel');
    expect(await hiddenAfter(s, c, 'palette')).not.toBeNull();
    await expect(s.page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expectOnPane(s, c, paneIn(panel), 'panel');

    // a subframe runs no preload (nodeIntegrationInSubFrames stays off): a page with a same-origin frame runs it once, in
    // its main frame
    const F = s.server.url('/framed.html');
    const PLAIN = s.server.url('/plain.html');
    await showPane(s, { appSessionId: id, requestId: 'e4a-show-framed', target: F });
    await tabAt(s, id, F);
    const framed = await pageAt(s, F);
    await expect(framed.frameLocator('#sub').locator('#plain')).toHaveText('A page with no title');
    expect(await preloadRuns(framed)).toEqual({ main: 1, subframes: [{ url: PLAIN, runs: 0 }] });
  });
});

// ---- (2) G2: error pages -------------------------------------------------------------------------------------------

const errorPage = (view: Locator) => paneIn(view).locator('[data-browser-page^="error-"]');

test('error pages: refused, dns, generic, each with Codex’s summary and Reload; Back from an error commits the page and shows the view; a second failure replaces the first', async () => {
  await browserScene(['E4a: errors'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    await expect(paneIn(panel).locator('[data-browser-page="empty"]')).toContainText('Start browsing');

    // an untitled page's chip reads its host, whatever title Electron gives the entry
    const PLAIN = s.server.url('/plain.html');
    await address(panel, PLAIN);
    const t = await tabAt(s, id, PLAIN);
    await expect((await pageAt(s, PLAIN)).locator('#plain')).toBeVisible();
    await expect(chipOf(panel, t).getByRole('tab')).toHaveText('127.0.0.1');

    const A = s.server.url('/a.html');
    await address(panel, A);
    await expect.poll(async () => (await tabState(s, t)).tab?.url).toBe(A);
    await expectOnPane(s, t, paneIn(panel), 'panel');

    // refused: the error page with its summary and Reload, the failed URL in the address field, the view hidden
    const REFUSED = `http://127.0.0.1:${await closedPort()}/`;
    const REFUSED_TOO = `http://localhost:${await closedPort()}/`;
    await address(panel, REFUSED);
    await expect(errorPage(panel)).toHaveAttribute('data-browser-page', 'error-refused');
    await expect(errorPage(panel)).toContainText("This site can't be reached");
    await expect(errorPage(panel)).toContainText('127.0.0.1 refused to connect');
    await expect(errorPage(panel)).toContainText('ERR_CONNECTION_REFUSED');
    await expect(errorPage(panel).getByRole('button', { name: 'Reload' })).toBeVisible();
    let state = await tabState(s, t);
    expect(state.tab).toMatchObject({ url: REFUSED, loading: false, canGoBack: true, loadError: { kind: 'refused', host: '127.0.0.1' } });
    expect(state.view?.visible).toBe(false);

    // Back commits /a.html again: no error, the view visible on the pane
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(errorPage(panel)).toHaveCount(0);
    await expect.poll(async () => (await tabState(s, t)).tab).toMatchObject({ url: A, loadError: null });
    await expectOnPane(s, t, paneIn(panel), 'panel');

    // a failure after a failure: the second's summary
    await address(panel, REFUSED);
    await expect(errorPage(panel)).toContainText('127.0.0.1 refused to connect');
    await address(panel, REFUSED_TOO);
    await expect(errorPage(panel)).toContainText('localhost refused to connect');
    await expect.poll(async () => (await tabState(s, t)).tab?.loadError).toMatchObject({ kind: 'refused', host: 'localhost', url: REFUSED_TOO });

    // a name that does not resolve: dns (or offline, on a Mac with no network)
    await address(panel, 'http://e4a.invalid/');
    await expect(errorPage(panel)).toHaveAttribute('data-browser-page', /^error-(dns|offline)$/);
    await expect(errorPage(panel).getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(errorPage(panel)).toContainText(/e4a\.invalid('s server IP address could not be found| could not be loaded because the computer is offline)/);

    // an empty response: generic, and Reload asks the server again
    const DROP = s.server.url('/drop');
    await address(panel, DROP);
    await expect(errorPage(panel)).toHaveAttribute('data-browser-page', 'error-generic');
    await expect(errorPage(panel)).toContainText('127.0.0.1 could not be loaded');
    await expect(errorPage(panel)).toContainText('ERR_EMPTY_RESPONSE');
    const hits = s.server.hits('/drop');
    await errorPage(panel).getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => s.server.hits('/drop')).toBeGreaterThan(hits);
    await expect(errorPage(panel)).toHaveAttribute('data-browser-page', 'error-generic');
    state = await tabState(s, t);
    expect(state.tab).toMatchObject({ url: DROP, loading: false, loadError: { kind: 'generic' } });
    expect(state.view?.visible).toBe(false);
  });
});

// ---- (3) G2: refused addresses ------------------------------------------------------------------------------------

test('refused addresses: file:, the app’s own scheme and javascript: are refused in the address field; the page’s file:, app-link and mailto: links navigate nothing', async () => {
  await browserScene(['E4a: refused'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pageA = await pageAt(s, A);
    await expectOnPane(s, t, paneIn(panel), 'panel');
    const hits = s.server.hits('/a.html');

    for (const [typed, scheme] of [['file:///etc/hosts', 'file:'], ['maws-deliverable://x', 'maws-deliverable:'], ['javascript:1', 'javascript:']] as const) {
      await address(panel, typed, { refused: true });
      await expect(noticesIn(panel).filter({ hasText: `Can’t open ${scheme} addresses here` })).toBeVisible();
      expect((await tabState(s, t)).tab).toMatchObject({ url: A, loading: false, loadError: null });
    }
    expect(s.server.hits('/a.html')).toBe(hits);
    await expect(chipsIn(panel)).toHaveCount(1);

    // the page's file: link: Chromium refuses it in the renderer; the URL stays, no tab opens
    await pageA.locator('#file-link').click({ noWaitAfter: true });
    await pageA.waitForTimeout(300);
    expect((await tabState(s, t)).tab).toMatchObject({ url: A, loadError: null });
    await expect(chipsIn(panel)).toHaveCount(1);
    // an app link (zoommtg:): main refuses the navigation, says so in the chrome, and writes the seam line
    await pageA.locator('#app-link').click({ noWaitAfter: true }); // the navigation main refuses never finishes
    await expect.poll(() => seamLines(s)).toContain('browser-blocked-navigation zoommtg://x');
    await expect(noticesIn(panel).filter({ hasText: 'Can’t open zoommtg: addresses here' })).toBeVisible();
    // The page is idle (main and the page agree), but Playwright's locators keep waiting on the navigation main refused,
    // which never finishes for them: the next link is clicked with the mouse at its own coordinates (a real click still).
    await expect.poll(async () => (await tabState(s, t)).tab).toMatchObject({ url: A, loading: false, loadError: null });
    expect(await pageA.evaluate(() => document.readyState)).toBe('complete');
    // mailto: goes out (the seam's openExternal line under the e2e) and navigates nothing
    const box = await pageA.evaluate(() => {
      const r = document.getElementById('mailto-link')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await pageA.mouse.click(box.x, box.y);
    await expect.poll(() => seamLines(s)).toContain('openExternal mailto:e4a@example.test');
    expect((await tabState(s, t)).tab).toMatchObject({ url: A, loadError: null });
    expect(await pageA.evaluate(() => document.getElementById('heading')?.textContent)).toBe('Page A');
    await expect(chipsIn(panel)).toHaveCount(1);
    await expectOnPane(s, t, paneIn(panel), 'panel');
  });
});

// ---- (4) G3: the cover -------------------------------------------------------------------------------------------

test('the cover: the palette hides the view within 200 ms behind its picture and Esc restores it; menus, popovers, a sheet and a toast over the pane cover, a popover elsewhere does not; the Overview; the app window’s reload', async () => {
  await browserScene(['E4a: cover'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pane = paneIn(panel);
    await expectOnPane(s, t, pane, 'panel');
    const placeholder = pane.locator('img');
    const covered = async (yes: boolean, what: string) => {
      await expect.poll(async () => (await tabState(s, t)).tab?.covered, { message: `covered under ${what}` }).toBe(yes);
      // cua #90: a covered page stays on screen until its still is in the pane, then hides
      await expect.poll(async () => (await viewOf(s, t))?.visible, { message: `visible under ${what}`, timeout: 1_000 }).toBe(!yes);
    };

    // the palette (a modal dialog): hidden within 200 ms, the page's picture in the pane; Esc: back, picture gone
    const ms = await hiddenAfter(s, t, 'palette');
    expect(ms, 'the view is hidden after the palette opens').not.toBeNull();
    expect(ms!).toBeLessThan(200);
    test.info().annotations.push({ type: 'palette hides the view (ms)', description: ms!.toFixed(1) });
    await expect(s.page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await expect(placeholder).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await covered(true, 'palette');
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await covered(false, 'palette closed');
    await expect(placeholder).toHaveCount(0);
    await expectOnPane(s, t, pane, 'panel');

    // the panel's "+" menu drops over the Browser tool's pane: covers
    await s.panel.getByRole('button', { name: 'Add a tool' }).click();
    await expect(s.page.getByRole('menuitem', { name: 'Deliverables' })).toBeVisible();
    await covered(true, 'the + menu');
    await s.page.keyboard.press('Escape');
    await covered(false, 'the + menu closed');

    // a composer chip's popover opens over the composer, away from the pane: no cover
    await s.pane.getByRole('button', { name: /^Model / }).click();
    await expect(s.page.getByRole('dialog', { name: 'Model and effort' })).toBeVisible();
    await s.page.waitForTimeout(300); // past the popper's two-frame measure
    expect((await tabState(s, t)).tab?.covered).toBe(false);
    expect((await viewOf(s, t))?.visible).toBe(true);
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByRole('dialog', { name: 'Model and effort' })).toHaveCount(0);

    // a popover opened over the pane (the top bar's usage popover drops along the window's right edge): covers
    await s.page.locator('[data-usage-pill]').click();
    await covered(true, 'the usage popover');
    await s.page.keyboard.press('Escape');
    await covered(false, 'the usage popover closed');

    // the Rename sheet
    await (await sidebarRow(s.page, { appSessionId: id })).click({ button: 'right' });
    await s.page.getByRole('menuitem', { name: 'Rename…' }).click();
    await expect(s.page.getByRole('dialog', { name: 'Rename' })).toBeVisible();
    await covered(true, 'the Rename sheet');
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByRole('dialog', { name: 'Rename' })).toHaveCount(0);
    await covered(false, 'the Rename sheet closed');

    // a toast at the window's bottom right, over the panel's pane: covers until it is dismissed. The toast is a plugin's
    // (`plugin.toast` in the session's event batch, as the engine host sends it; the session is shown, so it toasts),
    // sent to the window directly since the e2e runs no engine. Any toast the app raises with the session shown would do.
    await s.maws.app.evaluate(
      ({ BrowserWindow }, { appSessionId, sessionId }) => {
        const event = { id: 'e4a-toast', sessionId, at: new Date().toISOString(), seq: null, agentId: null, parentToolUseId: null, kind: 'plugin.toast', plugin: 'e4a', text: 'A toast over the pane', timeoutMs: 60_000 };
        for (const win of BrowserWindow.getAllWindows()) if (win.isVisible()) win.webContents.send('maws:evt:session.eventBatch', { appSessionId, events: [event] });
      },
      { appSessionId: id, sessionId: s.scratch.engineIds[0]! },
    );
    const toast = s.page.getByRole('region', { name: /^Notifications/ }).locator('li').filter({ hasText: 'A toast over the pane' });
    await expect(toast).toBeVisible();
    await covered(true, 'a toast');
    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toHaveCount(0);
    await covered(false, 'the toast dismissed');

    // the Overview floats over the main area: it covers a browser main tab
    await overflow(s, panel, 'Open in tab');
    const main = browserIn(s, 'main');
    await expectOnPane(s, t, paneIn(main), 'main');
    expect(await hiddenAfter(s, t, 'overview')).not.toBeNull();
    await covered(true, 'the Overview');
    await s.page.getByRole('dialog', { name: 'Overview' }).getByRole('button', { name: 'Close Overview' }).click();
    await covered(false, 'the Overview closed');
    await expectOnPane(s, t, paneIn(main), 'main');

    // the app window's own page reloads: main lets go of its views at once (hidden where they are), and a pane of the
    // fresh page places the view again; both surfaces mount and claim, and the last claim holds it
    const released = s.maws.app.evaluate(
      ({ BrowserWindow }, tabId) =>
        new Promise<boolean>((resolve) => {
          const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())!;
          const browser = (globalThis as unknown as { __maws_browser: { tab(id: string): { visible: boolean; owner: unknown } | null } }).__maws_browser;
          win.webContents.once('did-start-navigation', () => setImmediate(() => resolve(browser.tab(tabId)?.visible === false && browser.tab(tabId)?.owner === null)));
        }),
      t,
    );
    await s.page.reload();
    expect(await released, 'hidden and released as the reload starts').toBe(true);
    let surface: 'panel' | 'main' | undefined;
    await expect.poll(async () => (surface = (await viewOf(s, t))?.owner?.surface), { timeout: 2_000 }).toBeDefined();
    await expectOnPane(s, t, paneIn(browserIn(s, surface!)), surface!, 2_000);
    expect((await tabState(s, t)).tab?.covered).toBe(false);
  });
});

// ---- (5) G3: placement under resizes ------------------------------------------------------------------------------

test('placement: the panel resized by the keyboard and by a 40-step drag, and the window resized, keep the view on the pane within 1 px two frames after the last step', async () => {
  await browserScene(['E4a: placement'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pane = paneIn(panel);
    await expectOnPane(s, t, pane, 'panel');
    const resizer = s.page.getByRole('separator', { name: 'Resize right panel' });
    const width = async () => Number(await resizer.getAttribute('aria-valuenow'));
    // room for the panel to grow by 160 px past the main column's 480 px floor
    await resizeWindow(s, pane, 200, 0);
    await expect(resizer).toHaveAttribute('aria-valuemax', '640');
    await expectOnPane(s, t, pane, 'panel');

    // the keyboard: five big steps of 32 px, 160 px wider
    const before = await width();
    await resizer.focus();
    for (let k = 0; k < 5; k++) await s.page.keyboard.press('Shift+ArrowLeft');
    expect(await offPaneAfterFrames(s, t, pane)).toBeNull();
    expect(Math.abs((await width()) - before)).toBe(160);

    // a pointer drag of 40 steps back to the right, checked after each fifth step and after the release
    const box = (await resizer.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await s.page.mouse.move(x, y);
    await s.page.mouse.down();
    for (let k = 1; k <= 40; k++) {
      await s.page.mouse.move(x + 4 * k, y);
      if (k % 5 === 0) expect(await offPaneAfterFrames(s, t, pane), `step ${k}`).toBeNull();
    }
    await s.page.mouse.up();
    expect(await offPaneAfterFrames(s, t, pane)).toBeNull();
    expect(await width()).toBeLessThan(before + 160);

    // the window resized by 100 × 60
    await resizeWindow(s, pane, 100, 60);
    await expectOnPane(s, t, pane, 'panel', 1_000);
    expect(await offPaneAfterFrames(s, t, pane)).toBeNull();
  });
});

// ---- (6) G4: persistence ------------------------------------------------------------------------------------------

test('a relaunch restores the tabs suspended: both chips muted, the selected one offering its last URL, nothing loaded until Open', async () => {
  const scratch = scratchProject({ titles: ['E4a: relaunch'] });
  const server = await startBrowserServer();
  const A = server.url('/a.html');
  const B = server.url('/b.html');
  try {
    const first = await launchBrowserScene(scratch, server);
    const [id] = first.ids as [AppSessionId];
    let a: string;
    let b: string;
    try {
      await show(first, id);
      const panel = await openBrowser(first);
      await address(panel, A);
      a = await tabAt(first, id, A);
      await panel.getByRole('button', { name: 'New tab', exact: true }).click();
      await expect(chipsIn(panel)).toHaveCount(2);
      await address(panel, B);
      b = await tabAt(first, id, B);
      await chipOf(panel, a).getByRole('tab').click();
      await expectOnPane(first, a, paneIn(panel), 'panel');
      expect(await tabsOf(first, id)).toMatchObject({ selected: a });
      expect((await metrics(first)).loaded).toBe(2);
    } catch (error) {
      await first.maws.cleanup();
      throw error;
    }
    await closeScene(first);

    const second = await launchBrowserScene(scratch, server, first.ids);
    try {
      await show(second, id);
      const panel = browserIn(second, 'panel');
      // the panel comes back as it was (the Browser tool), or the tool is added afresh
      await expect(panel.or(second.panel.getByRole('button', { name: 'Add a tool' })).first()).toBeVisible();
      if (!(await panel.isVisible())) await openBrowser(second);
      await expect(chipsIn(panel)).toHaveCount(2);
      for (const tabId of [a, b]) await expect(chipOf(panel, tabId)).toHaveAttribute('data-suspended', 'true');
      await expect(chipOf(panel, a).getByRole('tab')).toHaveText('Page A');
      const suspended = paneIn(panel).locator('[data-browser-page="suspended"]');
      await expect(suspended.getByRole('button', { name: `Open ${A}` })).toBeVisible();
      await expect(suspended).toContainText('Tabs are restored unloaded');
      expect(await tabsOf(second, id)).toMatchObject({ selected: a });
      expect((await tabState(second, a)).tab).toMatchObject({ suspended: true, url: A, loading: false });
      expect(await metrics(second)).toMatchObject({ loaded: 0 });
      expect(second.maws.app.windows().some((page) => page.url() === A || page.url() === B)).toBe(false);

      // Open loads it, alone
      await suspended.getByRole('button', { name: `Open ${A}` }).click();
      await expect((await pageAt(second, A)).locator('#heading')).toHaveText('Page A');
      await expectOnPane(second, a, paneIn(panel), 'panel');
      await expect(chipOf(panel, a)).not.toHaveAttribute('data-suspended', 'true');
      await expect(chipOf(panel, b)).toHaveAttribute('data-suspended', 'true');
      expect(await metrics(second)).toMatchObject({ loaded: 1 });
    } catch (error) {
      await second.maws.cleanup();
      throw error;
    }
    await closeScene(second);
  } finally {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

// ---- (7) G5: permissions, the clipboard, a download, find, Esc -----------------------------------------------------

// A key pressed as the system delivers it (`sendInputEvent`), which passes the view's `before-input-event` as a person's
// keystroke does; Playwright's keys arrive over CDP, which that hook never sees.
async function nativeKey(s: Scene, url: string, keyCode: string, modifiers: ('meta' | 'shift')[] = []): Promise<void> {
  await s.maws.app.evaluate(
    ({ webContents }, { url, keyCode, modifiers }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)!;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    },
    { url, keyCode, modifiers },
  );
}

const findBar = (view: Locator) => view.getByRole('search', { name: 'Find in page' });

test('the page’s guards: a permission request denied with the line; the clipboard written only on a real click; a download to the save path with Reveal; find in page; Esc reaches the page when the find bar is closed', async () => {
  await browserScene(['E4a: guards'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pageA = await pageAt(s, A);
    await expectOnPane(s, t, paneIn(panel), 'panel');
    const clipboardLine = pageA.locator('#clipboard');

    // the clipboard: a write from a timer with no input is refused; the page's Copy button, really clicked, writes
    await withNativeClipboard(s.maws.app, ['e4a'], async () => {
      await pageA.evaluate(() => (window as unknown as { copyLater(): void }).copyLater());
      // Chromium's own refusal when the permission is denied (MAWS's carve-out), not a focus or availability failure
      await expect(clipboardLine).toHaveText(/^refused: NotAllowedError: .*Write permission denied\.$/);
      await pageA.locator('#copy').click();
      await expect(clipboardLine).toHaveText('copied', { timeout: 2_000 });
      expect(await s.maws.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('e4a');
    });

    // a notification request: denied in the page, the line in the chrome
    await pageA.locator('#notify').click();
    await expect(pageA.locator('#notification')).toHaveText('denied');
    expect(await pageA.evaluate(() => Notification.permission)).toBe('denied');
    await expect(noticesIn(panel).filter({ hasText: '127.0.0.1 asked to show notifications · blocked' })).toBeVisible();
    await expect.poll(async () => (await tabState(s, t)).tab?.denied).toContainEqual({ host: '127.0.0.1', permission: 'notifications' });

    // a download: saved where MAWS_E2E_SAVE_PATH says (the dialog under the e2e), the done line, Reveal through the seam
    await pageA.locator('#download').click({ noWaitAfter: true });
    const saved = join(s.saveDir, 'file.bin');
    const line = noticesIn(panel).filter({ hasText: 'Downloaded file.bin' });
    await expect(line).toBeVisible();
    expect((await tabState(s, t)).tab?.download).toMatchObject({ name: 'file.bin', state: 'done', received: 4096, total: 4096, path: saved });
    expect(existsSync(saved) && readFileSync(saved).length).toBe(4096);
    await line.getByRole('button', { name: 'Reveal in Finder' }).click();
    await expect.poll(() => seamLines(s)).toContain(`reveal ${saved}`);
    expect((await tabState(s, t)).tab).toMatchObject({ url: A, loadError: null });

    // find in page: three needles, the first then the second
    await overflow(s, panel, 'Find in page');
    const bar = findBar(panel);
    await expect(bar.getByRole('textbox', { name: 'Find in page' })).toBeFocused();
    await bar.getByRole('textbox', { name: 'Find in page' }).fill('needle');
    await expect(bar.getByRole('status')).toHaveText('1 / 3 results');
    await bar.getByRole('button', { name: 'Next result' }).click();
    await expect(bar.getByRole('status')).toHaveText('2 / 3 results');
    await bar.getByRole('button', { name: 'Close find' }).click();
    await expect(bar).toHaveCount(0);

    // Esc with the find bar closed is the page's; ⌘F pressed in the page opens the find bar, and Esc then closes it
    await nativeKey(s, A, 'Escape');
    await expect(pageA.locator('#keys')).toHaveText('Escape');
    await nativeKey(s, A, 'F', ['meta']);
    await expect(findBar(panel)).toBeVisible();
    await nativeKey(s, A, 'Escape');
    await expect(findBar(panel)).toHaveCount(0);
    await expect(pageA.locator('#keys')).toHaveText('Escape');
  });
});

// ---- (8) G5: the chrome in both themes ------------------------------------------------------------------------------

test('the chrome in both themes: the empty state, a loaded page, the zoom banner at 125%, the find bar, the permission line, the error page (shots under MAWS_E4A_SHOTS=1)', async () => {
  await browserScene(['E4a: the chrome'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const pane = paneIn(panel);
    await expect(pane.locator('[data-browser-page="empty"]')).toBeVisible();
    await shootBrowser(s, 'empty');

    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pageA: Page = await pageAt(s, A);
    await expectOnPane(s, t, pane, 'panel');
    await expect(chipOf(panel, t).locator('img')).toHaveAttribute('src', /^data:image\/png/);
    await shootBrowser(s, 'page', { pane, page: pageA });

    await overflow(s, panel, 'Zoom in');
    await overflow(s, panel, 'Zoom in');
    const zoom = panel.getByRole('group', { name: 'Page zoom' });
    await expect(zoom).toContainText('125%');
    await expect.poll(async () => (await tabState(s, t)).tab?.zoom).toBe(1.25);
    await expectOnPane(s, t, pane, 'panel');
    await shootBrowser(s, 'zoom', { pane, page: pageA });
    await zoom.getByRole('button', { name: 'Reset' }).click();
    await expect(zoom).toHaveCount(0);

    await overflow(s, panel, 'Find in page');
    await findBar(panel).getByRole('textbox', { name: 'Find in page' }).fill('needle');
    await expect(findBar(panel).getByRole('status')).toHaveText('1 / 3 results');
    await expectOnPane(s, t, pane, 'panel');
    await shootBrowser(s, 'find', { pane, page: pageA });
    await findBar(panel).getByRole('button', { name: 'Close find' }).click();

    await pageA.locator('#notify').click();
    await expect(noticesIn(panel).filter({ hasText: 'asked to show notifications' })).toBeVisible();
    await expectOnPane(s, t, pane, 'panel');
    await shootBrowser(s, 'permission', { pane, page: pageA });

    await address(panel, `http://127.0.0.1:${await closedPort()}/`);
    await expect(pane.locator('[data-browser-page="error-refused"]')).toBeVisible();
    await shootBrowser(s, 'error');
  });
});

// cua #103: the human control slot must not push the trailing controls out of the 380 px panel.
test('cua #103: human control in a 380 px panel keeps the icon, Hand back and every toolbar control in bounds', async () => {
  const scratch = scratchProject({ titles: ['cua #103: control chrome'] });
  scratch.userData = mkdtempSync('/tmp/m103-'); // a short Unix socket path for cua's real lease
  const server = await startBrowserServer();
  const s = await launchBrowserScene(scratch, server);
  try {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const url = s.server.url('/a.html');
    await address(panel, url);
    const tab = await tabAt(s, id, url);
    interface ControlSeam {
      __maws_browser: {
        cua: { socketPathFor(id: string): string };
        agent: { sendInput(tab: string, input: Record<string, unknown>): boolean };
      };
    }
    const socket = await s.maws.app.evaluate((_electron, id) => (globalThis as unknown as ControlSeam).__maws_browser.cua.socketPathFor(id), id);
    const host = await connectFakeHost(socket);
    try {
      const native = (await host.request<{ id: number; url: string }[]>('tabs.query')).find((t) => t.url === url)!;
      await host.request('debugger.attach', { tabId: native.id });
      await s.page.waitForTimeout(3_100); // the address navigation is a human touch; let its takeover grace expire
      await host.request('debugger.sendCommand', { debuggee: { tabId: native.id }, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 10 } });
      await s.maws.app.evaluate((_electron, tab) => (globalThis as unknown as ControlSeam).__maws_browser.agent.sendInput(tab, { type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 }), tab);
      const slot = panel.locator('[data-browser-control="human"]');
      await expect(slot).toBeVisible();
      await expect(slot.locator('svg')).toBeVisible();
      await expect(slot).not.toContainText('You have the page');
      const chrome = panel.locator('[data-browser-chrome]');
      const bounds = (await chrome.boundingBox())!;
      expect(Math.round(bounds.width)).toBe(379); // one panel border pixel
      const controls = chrome.locator('button:visible');
      let right = bounds.x;
      for (const button of await controls.all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        // Only compare buttons sharing the navigation row; tab-strip buttons live above it.
        if (await button.evaluate((el) => el.closest('[data-browser-nav]') !== null)) {
          expect(box.x).toBeGreaterThanOrEqual(right);
          right = box.x + box.width;
        }
      }
      await s.page.waitForTimeout(4_000); // ownership is still visible after the former 3 s timeout
      await expect(slot).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        value(await invoke(s.page, 'settings.set', { theme }));
        await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(slot).toBeVisible();
        await test.info().attach(`human-control-380-${theme}`, { body: await chrome.screenshot(), contentType: 'image/png' });
      }
      value(await invoke(s.page, 'settings.set', { theme: 'light' }));
      await host.request('debugger.sendCommand', { debuggee: { tabId: native.id }, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10, y: 10 } });
      await expect(slot).toHaveCount(0); // the agent resumed
      await s.maws.app.evaluate((_electron, tab) => (globalThis as unknown as ControlSeam).__maws_browser.agent.sendInput(tab, { type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 }), tab);
      await expect(slot).toBeVisible();
      await overflow(s, panel, 'Open in tab');
      const main = browserIn(s, 'main');
      const wide = main.locator('[data-browser-control="human"]');
      for (const theme of ['light', 'dark'] as const) {
        value(await invoke(s.page, 'settings.set', { theme }));
        await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(wide).toContainText('You have the page');
        expect((await wide.boundingBox())!.width).toBeGreaterThan(480);
        await test.info().attach(`human-control-wide-${theme}`, { body: await main.locator('[data-browser-chrome]').screenshot(), contentType: 'image/png' });
      }
      await wide.getByRole('button', { name: 'Hand back' }).click();
      await expect(wide).toHaveCount(0);
      await expect(slot).toHaveCount(0); // both surfaces follow the same ownership transition
    } finally {
      await host.close();
    }
  } finally {
    await closeScene(s);
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
    rmSync(scratch.userData, { recursive: true, force: true });
  }
});
