// UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, §G, scene G6's native half; acceptance
// B4; Decision Log 18): scenes of the in-app browser that read main's focused contents, which exist only while the
// app's window is the key window. They run in the foreground: this file is claimed by no group of its own, so the bare
// `pnpm e2e` runs it, under its MAWS_E2E_FOREGROUND=1 (gate-offload Decision Log 76: the foreground is opt-in per group,
// and e2e:browser, where G6's page-level reads stay, runs quiet). The product app over the replay, as e2e:browser's
// scenes (support/browser-scene.ts); its launch passes MAWS_HARNESS=0, so either build serves it.
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { address, browserScene, expectOnPane, openBrowser, pageAt, paneIn, tabAt, tabState } from './support/browser-scene';
import { invoke, value } from './support/c7-replay'; // UX wave U6b-5b: main's own read of the window's zoom
import { activateForScene } from './support/foreground-trace';
import { goToFile } from './support/go-to-file';
import { show, type Scene } from './support/maws-tools';
import { zoomAct, zoomLineOf, zoomLines, zoomOfPage } from './support/zoom'; // UX wave U6b-5b

// G6's native half. With the keyboard in Page A, the menu row's own click (what ⌘P does) moves main's focused contents
// from the page to the app's page. The window is activated first (`activateForScene`, which acts under the foreground
// alone) and waited on being focused, failing with that message when macOS does not give it the focus. Then waits on the
// page's own witness and on main's focused contents being the page's; after Go to file, on the field being the active
// element of the app's page, and on main's focused contents being the app's page. Each read of main's focused contents
// names what it found (Page A, the app's page, other contents, none), so no contents at all fails a wait.
test('G6, the native half: with the keyboard in a page of the in-app browser, Go to file moves main’s focused contents from the page to the app’s page', async () => {
  await browserScene(['U6b-3b: Go to file from a page, in the foreground'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pageA = await pageAt(s, A);
    await expectOnPane(s, t, paneIn(panel), 'panel');
    const focused = () =>
      s.maws.app.evaluate(({ BrowserWindow, webContents }, url) => {
        const contents = webContents.getFocusedWebContents();
        if (!contents) return 'no focused contents';
        if (contents.getURL() === url) return 'Page A';
        return BrowserWindow.getAllWindows().some((win) => win.webContents.id === contents.id) ? 'the app’s page' : `other contents, ${contents.getURL()}`;
      }, A);

    await activateForScene(s.maws.app, 'G6 native');
    await expect
      .poll(() => s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.isVisible())?.isFocused() ?? false), {
        message: 'the app’s window is the key window (when this fails the run is not in the foreground, or macOS did not give the window the focus, and main can have no focused contents)',
      })
      .toBe(true);
    await s.maws.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.focus(), A);
    await expect.poll(() => pageA.evaluate(() => document.hasFocus()), { message: 'the page’s own witness: its document has the keyboard' }).toBe(true);
    await expect.poll(focused, { message: 'main’s focused contents are the page’s' }).toBe('Page A');

    await goToFile(s.maws.app);
    await expect.poll(() => s.page.evaluate(() => document.hasFocus() && (document.activeElement?.matches('[data-files-filter]') ?? false)), { message: 'the field is the active element of the app’s page, which has the keyboard' }).toBe(true);
    await expect.poll(focused, { message: 'main’s focused contents are the app’s page, no longer Page A’s' }).toBe('the app’s page');
  });
});

// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, §I, ruled 2026-11-20 in its Decision Log
// 22; B10): with the keyboard in a page of the in-app browser, the zoom's keys zoom that page alone. The keyboard is
// put in Page A as G6 puts it (the window activated and key, the page's contents focused, the page's own witness), and
// the chords are pressed as the system delivers them (`sendInputEvent`, which the view's `before-input-event` hears;
// Playwright's keys arrive over CDP, which that hook never sees). The page's chords are those `keyAction` binds
// (src/main/browser/keys.ts): ⌘= (Zoom In's own chord; ⌘+ is the same action) and ⌘- to come back. It binds no reset:
// ⌘0 passes the page to the menu, where it is View › Overview. After each: the tab's zoom as main records it moved,
// then returned; the app's factor stayed at 100 %, both the root's `--app-zoom` and main's own `layout.zoom
// { to: 'current' }`; and no zoom line is drawn. The control: View's Zoom In clicked afterwards, and the same read finds
// its line; then Actual Size. Every read is polled; no time is asserted.
async function pageKey(s: Scene, url: string, keyCode: string): Promise<void> {
  await s.maws.app.evaluate(
    ({ webContents }, { url, keyCode }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)!;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['meta'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['meta'] });
    },
    { url, keyCode },
  );
}

test('zoom (B10): with the keyboard in a page of the in-app browser, ⌘= and ⌘- zoom the page alone, and draw no zoom line', async () => {
  await browserScene(['U6b-5b: the zoom keys in a page, in the foreground'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const panel = await openBrowser(s);
    const A = s.server.url('/a.html');
    await address(panel, A);
    const t = await tabAt(s, id, A);
    const pageA = await pageAt(s, A);
    await expectOnPane(s, t, paneIn(panel), 'panel');
    await expect.poll(async () => (await tabState(s, t)).tab?.zoom, { message: 'the tab opens at its own 100 %' }).toBe(1);

    await activateForScene(s.maws.app, 'U6b-5b page zoom keys');
    await expect
      .poll(() => s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.isVisible())?.isFocused() ?? false), {
        message: 'the app’s window is the key window (when this fails the run is not in the foreground, or macOS did not give the window the focus)',
      })
      .toBe(true);
    await s.maws.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.focus(), A);
    await expect.poll(() => pageA.evaluate(() => document.hasFocus()), { message: 'the page’s own witness: its document has the keyboard' }).toBe(true);

    // the app's factor at 100 %, as the root and main both read it, and no zoom line drawn
    const appAtActual = async (after: string) => {
      await expect.poll(() => zoomOfPage(s.page), { message: `${after}: the root’s --app-zoom` }).toBe(1);
      await expect.poll(async () => value(await invoke(s.page, 'layout.zoom', { to: 'current' })).factor, { message: `${after}: main’s layout.zoom { to: 'current' }` }).toBe(1);
      await expect(zoomLines(s.page), `${after}: no zoom line`).toHaveCount(0);
    };
    await appAtActual('before the keys');
    await pageKey(s, A, '=');
    await expect.poll(async () => (await tabState(s, t)).tab?.zoom ?? 1, { message: 'after ⌘= in the page: the tab’s zoom moved up' }).toBeGreaterThan(1);
    await appAtActual('after ⌘= in the page');
    await pageKey(s, A, '-');
    await expect.poll(async () => (await tabState(s, t)).tab?.zoom, { message: 'after ⌘- in the page: the tab’s zoom back at 100 %' }).toBe(1);
    await appAtActual('after ⌘- in the page');

    // the control: View's Zoom In draws the line the reads above did not find
    expect(await zoomAct(s.maws.app, s.page, 'zoom.in')).toBe(1.1);
    await expect(zoomLines(s.page), 'View’s Zoom In draws its line').toHaveText([zoomLineOf(1.1)]);
    expect(await zoomAct(s.maws.app, s.page, 'zoom.reset')).toBe(1);
    expect((await tabState(s, t)).tab?.zoom, 'the window’s zoom leaves the tab’s own').toBe(1);
  });
});
