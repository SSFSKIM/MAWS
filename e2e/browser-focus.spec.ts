// UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, §G, scene G6's native half; acceptance
// B4; Decision Log 18): scenes of the in-app browser that read main's focused contents, which exist only while the
// app's window is the key window. They run in the foreground: this file is claimed by no group of its own, so the bare
// `pnpm e2e` runs it, under its MAWS_E2E_FOREGROUND=1 (gate-offload Decision Log 76: the foreground is opt-in per group,
// and e2e:browser, where G6's page-level reads stay, runs quiet). The product app over the replay, as e2e:browser's
// scenes (support/browser-scene.ts); its launch passes MAWS_HARNESS=0, so either build serves it.
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { address, browserScene, expectOnPane, openBrowser, pageAt, paneIn, tabAt } from './support/browser-scene';
import { activateForScene } from './support/foreground-trace';
import { goToFile } from './support/go-to-file';
import { show } from './support/maws-tools';

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
