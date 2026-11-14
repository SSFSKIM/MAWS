// C5's end-to-end smoke (C5 execution document, M6 and Acceptance items 1 to 9): the built app on the stub scenario
// `nine-sessions.json` with a manual clock, so every timed transition happens when the test says (`advanceTo`), never in
// a race with the wall clock. Menu-sink actions are clicked by menu item id in main (Playwright's keyboard never reaches
// a macOS menu accelerator); renderer-sink chords go through `page.keyboard`; events are captured through
// `window.maws.on`; themes are checked by computed token colours; persistence by relaunching over the same profile; the
// quit guard by its stderr line, whose count is the one the driven engine state implies. Never `setViewportSize`: the
// window's own bounds are what the test drives (it shifted hover coordinates in M3's live check). This spec is the
// template for C7's and C8's end-to-end tests.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ACTIONS, type ActionId, type ActionTable } from '../src/shared/keymap/actions';
import type { EventPayload } from '../src/shared/ipc/schema';
import { formatChord } from '../src/shared/keymap/chord';
import { addressed, localName, localRef } from './support/address';
import { invoke, value } from './support/c7-replay'; // P5 O6 M2: the upgrade scene's raw-bridge calls
import { activateForScene, traceForeground } from './support/foreground-trace';
import { clickRevealed } from './support/hover'; // UX wave U7: the row's own Hide, shown on hover
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { scratchProject } from './support/maws-tools'; // P5 O6 M2: the upgrade scene's indexed sessions
import { slashPaletteMovesNothing } from './support/palette-geometry';
import { closeProject, openProject, projectLine, projectRow, showProjectList, sidebarRow } from './support/sidebar';
import { activeMainTab, backToTabs, mainTabById, mainTabs, openAppDestination, openSettings, openSurface, pageRegion, pageTitle, settingsDialog, sidebarFooter, surfaceRow as shellSurfaceRow, usageRing } from './support/shell';

const SHELL_ENV = {
  MAWS_HARNESS: '0',
  MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json',
  MAWS_SCENARIO_CLOCK: 'manual',
  MAWS_E2E_QUIT_ANSWER: 'quit',
};

// The scenario's sessions (test/fixtures/shell/nine-sessions.json).
// UX2 l7-05, as U13a draws it: a strip of one place names no place on its tabs; the title-bar chip names the project of
// the session in front.
const CHARTER = 'app-9a1d4262';
const FIX = 'Fix sidebar drag';
const SIP = 'Sidebar interaction pass';
const QUOTA = 'Quota reset recovery';
const NORTH = 'Workstation north star';
const USAGE_PROJECT = 'claude-usage-menubar';

interface Captured {
  notified: (EventPayload<'attention.notified'> & { receivedAt: number })[];
  navigate: unknown[];
}
declare global {
  interface Window {
    __maws_e2e?: Captured;
  }
}

test('shell: sidebar, overview, hover approve, tabs and split, persistence, themes, notification, quit guard', async () => {
  test.setTimeout(180_000);
  const first = await launchMaws({ env: SHELL_ENV });
  try {
    const firstStderr = collectStderr(first.app);
    const saved = await firstInstance(first, test.info());
    // P5 O3-D (Q1): on the daemon shape the sessions outlive the app, so the quit asks nothing and says what it left
    const daemon = value(await invoke(first.page, 'host.status', undefined)).transport === 'daemon';
    const quitLine = (parts: string) => `quit-guard: ${parts}, ${daemon ? 'not asked: they outlive the app' : 'auto-answered quit'}`;
    await first.app.close();
    expect(quitLines(firstStderr()), 'the quit guard counts four mid-turn after the 8 s entry').toEqual([quitLine('4 mid-turn')]);

    const second = await launchMaws({ env: SHELL_ENV, userData: first.userData });
    try {
      const secondStderr = collectStderr(second.app);
      await relaunchedInstance(second, saved);
      await second.app.close();
      expect(quitLines(secondStderr()), 'the relaunched clock is back at 0: five mid-turn').toEqual([quitLine('5 mid-turn')]);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup(); // removes the profile both launches used
  }
});

// P5 O6 M2 (acceptance 4; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Proves"): a profile written
// before O6 holds bare ids. Its layout is written as such a build wrote it, through the raw bridge (which speaks bare
// ids): a version-2 `main.tabs` with a session tab and a file tab, a bare `panel.<id>` key, and a draft. After the upgrade
// launch the tabs, the panel tab and the draft are back, `main.tabs` is version 3 with addresses and the panel key is the
// address's; a third launch rewrites nothing. Indexed sessions, since a stub scenario keeps its drafts in memory.
test('a layout from before O6 comes back after the upgrade, addressed, and a third launch rewrites nothing', async () => {
  test.setTimeout(150_000);
  const scratch = scratchProject({ titles: ['Upgrade alpha', 'Upgrade beta'], label: 'o6-upgrade' });
  const launch = () => launchMaws({ userData: scratch.userData, env: { MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config } });
  const notes = join(scratch.repo, 'notes.md');
  writeFileSync(notes, '# Notes\n');
  const DRAFT = 'kept across the upgrade';
  const PANEL = { tabs: [{ id: 'artifacts:upgrade1', toolId: 'artifacts', pinned: false }], activeTabId: 'artifacts:upgrade1' };
  const get = async (page: Page, key: string) => value(await invoke(page, 'layout.get', { key: key as never })).value;
  const keys = async (page: Page) => value(await invoke(page, 'layout.list', undefined)).keys.sort();
  const held = async (page: Page) => Object.fromEntries(await Promise.all((await keys(page)).filter((key) => key !== 'window.main').map(async (key) => [key, await get(page, key)] as const)));
  try {
    // First launch: the seeded session's bare id, and the old build's layout and draft
    const first = await launch();
    let id = '';
    let project = '';
    try {
      const { page } = first;
      await expect
        .poll(
          async () => {
            const { sessions } = value(await invoke(page, 'session.list', {}));
            const record = sessions.find((s) => s.engineSessionId === scratch.engineIds[0]);
            id = record?.appId ?? '';
            project = record?.projectId ?? '';
            return id !== '' && project !== '';
          },
          { timeout: 20_000, message: 'the seeded sessions are indexed with their project' },
        )
        .toBe(true);
      await expect.poll(() => keys(page), { message: 'hydration wrote its defaults' }).toContain('main.tabs');
      const session = { id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false };
      const file = { id: `file:${notes}`, kind: 'file', path: notes, line: null, appSessionId: id, pinned: false };
      const set = { panes: [{ tabs: [session, file], activeTabId: session.id }], focusedPane: 0, splitRatio: 0.5 };
      value(await invoke(page, 'layout.set', { key: 'main.tabs', value: { version: 2, current: project, sets: { [project]: set }, closedTabs: [] } }));
      value(await invoke(page, 'layout.set', { key: `panel.${id}` as never, value: PANEL }));
      const doc = { type: 'doc', attrs: { attachments: [] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: DRAFT }] }] };
      value(await invoke(page, 'session.drafts.set', { appSessionId: id, draft: { doc, attachments: [], updatedAt: new Date().toISOString() } }));
      await first.app.close();
    } finally {
      await first.cleanup();
    }

    // The upgrade: everything is back, addressed, and written back once
    const second = await launch();
    let written: Record<string, unknown> = {};
    try {
      const { page } = second;
      const ref = await localRef(page);
      const address = await addressed(page, id);
      await expect(mainTabById(page, `session:${address}`), 'the session tab is back').toBeVisible({ timeout: 20_000 });
      await expect(mainTabById(page, `file:${ref}:${notes}`), 'the file tab is back, on this machine').toBeAttached();
      await expect(page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' }), 'the draft is back in its session’s composer').toHaveText(DRAFT);
      await expect.poll(() => keys(page), { message: 'the bare panel key is renamed to the address’s' }).toContain(`panel.${address}`);
      expect(await keys(page)).not.toContain(`panel.${id}`);
      expect(await get(page, `panel.${address}`), 'the panel tab is back').toEqual(PANEL);
      // U13a (UC-14): the version-2 value's one set, keyed by the project, is read as the one strip and written back in the
      // stored form: version 3, `current` none, the one set `none`
      await expect
        .poll(async () => ((await get(page, 'main.tabs')) as { current: string }).current, { message: 'the strip is written back under none' })
        .toBe('none');
      const main = (await get(page, 'main.tabs')) as { version: number; current: string; sets: Record<string, { panes: { tabs: { id: string; appSessionId?: string; machine?: string }[] }[] }> };
      expect(main.version).toBe(3);
      expect(Object.keys(main.sets), 'the one set none, none left at the project’s address').toEqual(['none']);
      expect(main.sets[main.current]!.panes[0]!.tabs.map((tab) => ({ id: tab.id, appSessionId: tab.appSessionId, machine: tab.machine }))).toEqual([
        { id: `session:${address}`, appSessionId: address, machine: undefined },
        { id: `file:${ref}:${notes}`, appSessionId: address, machine: ref },
      ]);
      await page.waitForTimeout(1000); // past the write delay: whatever this launch writes is written
      written = await held(page);
      expect(second.consoleErrors()).toEqual([]);
      await second.app.close();
    } finally {
      await second.cleanup();
    }

    // A third launch reads what the upgrade wrote as it is
    const third = await launch();
    try {
      const { page } = third;
      await expect(mainTabById(page, `session:${await addressed(page, id)}`)).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      expect(await held(page), 'nothing rewritten').toEqual(written);
      expect(third.consoleErrors()).toEqual([]);
      await third.app.close();
    } finally {
      await third.cleanup();
    }
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

// U13a (O-01, A1, A8, A9; the UX wave's U13, which amends I3 and W12 of 2026-10-01 and P3-F wave S's F17, 2026-11-12):
// one strip for everything open. Sessions of two projects sit in one strip; a click on a project's row or on the
// machine's own row opens or closes the row and changes no tab; a plain click on a session of the other project still
// replaces the tab in front (I2) and ⌘⇧T brings it back beside the one that took its place; ⌘1–9 count over the whole
// pane. In a strip of one place no tab names it; once places mix, every session tab names its place after its title.
// The title bar's chip names the row of the session in front and a click on it reveals that row, creating nothing. The
// stored `main.tabs` is version 3 with the one set `none` (UC-14). Two screenshots for the owner's look: the title bar
// with the mixed strip and the chip, and the same strip at a narrow window, where each tab's place gives way before its
// title (CSS only: no unit test can measure it, so the scene also holds that a truncated title has no place drawn).
test('one strip: a project or machine row changes no tab, ⌘1 counts over the pane, tabs name their place once places mix, the chip reveals its row', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    const chip = page.getByRole('banner').locator('[data-toolbar-project]');
    const toggleRow = async (name: string) => {
      await showProjectList(page);
      const row = projectRow(page, name);
      const expanded = await row.getAttribute('aria-expanded');
      await projectLine(row).click();
      await expect(row, `the click opens or closes ${name}'s row`).toHaveAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true');
    };
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });

    // one project's sessions: no tab names its place, and the chip names the project
    await (await sidebarRow(page, FIX)).click();
    await (await sidebarRow(page, SIP)).click({ modifiers: ['Meta'] });
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([FIX, SIP]);
    await expect(chip).toHaveText('MAWS');
    await expect(chip).toHaveCSS('-webkit-app-region', 'no-drag');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Reveal MAWS in sidebar' })).toBeVisible();
    await expect(mainTabs(page).locator('[data-tab-place]'), 'a strip of one place names none').toHaveCount(0);

    // a session of another project opens in the same strip, and every session tab now names its place
    await (await sidebarRow(page, QUOTA)).click({ modifiers: ['Meta'] });
    const MAWS_ = (title: string) => `${title} · MAWS`;
    const CODEX_ = (title: string) => `${title} · codex_somersault`;
    const mixed = [MAWS_(FIX), MAWS_(SIP), CODEX_(QUOTA)];
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'one strip, each session tab naming its place' }).toEqual(mixed);
    await expect(chip).toHaveText('codex_somersault');

    // a click on either project's row and on the machine's own row opens or closes the row and changes no tab
    for (const name of ['MAWS', 'codex_somersault', await localName(page)]) {
      await toggleRow(name);
      expect(await tabLabels(page, 'Open tabs'), `${name}'s row changed no tab`).toEqual(mixed);
      expect(await selectedTab(page, 'Open tabs'), `${name}'s row changed no tab in front`).toBe(CODEX_(QUOTA));
    }
    await expect(chip, 'the chip follows the session in front, not the row clicked').toHaveText('codex_somersault');

    // I2 stands: a plain click on a session of the other project replaces the tab in front, and ⌘⇧T brings it back
    await menu(app, 'tab.select:1');
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(MAWS_(FIX));
    await expect(chip).toHaveText('MAWS');
    await (await sidebarRow(page, 'Trace stream reconnects')).click();
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the plain click took the place of the tab in front' }).toEqual([CODEX_('Trace stream reconnects'), MAWS_(SIP), CODEX_(QUOTA)]);
    await menu(app, 'tab.reopen');
    const four = [CODEX_('Trace stream reconnects'), MAWS_(FIX), MAWS_(SIP), CODEX_(QUOTA)];
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T: the replaced tab back beside the one that took its place' }).toEqual(four);
    expect(await selectedTab(page, 'Open tabs')).toBe(MAWS_(FIX));

    // ⌘1–9 count over the whole pane, whatever project a tab is of; the chip follows the session in front
    for (const [n, name] of [[3, MAWS_(SIP)], [4, CODEX_(QUOTA)], [1, CODEX_('Trace stream reconnects')]] as const) {
      await menu(app, `tab.select:${n}`);
      await expect.poll(() => selectedTab(page, 'Open tabs'), { message: `⌘${n}` }).toBe(name);
      await expect(chip).toHaveText(n === 3 ? 'MAWS' : 'codex_somersault');
    }
    await menu(app, 'tab.select:5'); // no fifth tab
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(CODEX_('Trace stream reconnects'));

    const banner = page.getByRole('banner');
    await test.info().attach('one-strip-title-bar', { body: await banner.screenshot(), contentType: 'image/png' });

    // a click on the chip reveals the project's row, expanded and focused, and creates nothing
    await closeProject(page, 'codex_somersault');
    await banner.getByRole('button', { name: 'Reveal codex_somersault in sidebar' }).click();
    await expect(projectRow(page, 'codex_somersault')).toHaveAttribute('aria-expanded', 'true');
    await expect(projectRow(page, 'codex_somersault')).toBeFocused();
    await page.waitForTimeout(500); // a New chat would have answered by now
    expect(await tabLabels(page, 'Open tabs'), 'the chip created no tab').toEqual(four);
    await expect(chip).toHaveText('codex_somersault');

    // a narrow window: each tab's place gives way before its title. The window steps down from 900 px (at most to its
    // 600 px minimum) until a place is cut or gone, so the narrow screenshot shows the give-way it is taken for
    const measure = () =>
      page
        .getByRole('tablist', { name: 'Open tabs' })
        .locator('[role="tab"]')
        .evaluateAll((tabs) =>
          tabs.map((tab) => {
            const place = tab.querySelector<HTMLElement>('[data-tab-place]');
            const title = place?.previousElementSibling as HTMLElement | null;
            // the architect's ruling of 2026-11-13: a place is drawn on the box's first line, the title's, inside the box's
            // visible rect, or it is wrapped out of sight below a box that clips; one that is drawn is its whole text or at
            // least its first four characters and the ellipsis
            const boxElement = place?.parentElement ?? null;
            const box = boxElement?.getBoundingClientRect();
            const at = place?.getBoundingClientRect();
            const line = title?.getBoundingClientRect();
            const shown = at !== undefined && box !== undefined && line !== undefined && at.width > 0 && at.top < line.bottom - 1
              && at.top >= box.top - 1 && at.top < box.bottom - 1 && at.left >= box.left - 1 && at.right <= box.right + 1;
            const outOfSight = at !== undefined && box !== undefined && boxElement !== null && at.top >= box.bottom - 1 && getComputedStyle(boxElement).overflowY !== 'visible';
            let readable = 0;
            if (place !== null) {
              const text = Array.from(place.textContent ?? '');
              const probe = document.createElement('small');
              probe.className = place.className;
              probe.style.cssText = 'position:absolute;visibility:hidden;max-width:none;width:auto;flex:none';
              probe.textContent = text.length > 4 ? `${text.slice(0, 4).join('')}…` : text.join('');
              place.parentElement!.appendChild(probe);
              readable = probe.getBoundingClientRect().width;
              probe.remove();
            }
            return {
              tab: Math.round(tab.getBoundingClientRect().width),
              titleCut: title !== null && title.scrollWidth > title.clientWidth + 1,
              place: place === null ? null : shown ? Math.round(place.getBoundingClientRect().width) : 0,
              placeCut: place !== null && shown && place.scrollWidth > place.clientWidth + 1,
              placeReadable: place === null || !shown || place.getBoundingClientRect().width + 1 >= readable,
              placeDrawnOrHidden: place === null || shown || outOfSight,
            };
          }),
        );
    type Squeezed = Awaited<ReturnType<typeof measure>>;
    const givesWay = (tabs: Squeezed) => tabs.some((t) => t.place !== null && (t.placeCut || t.place === 0));
    // every width step is visited, down to the 600 px minimum, where the ruling bites; the first step at which a place
    // gives way is the one the give-way assertion and the narrow screenshot are taken for
    let squeezed: Squeezed = [];
    let width = 0;
    const visited: Squeezed[] = [];
    const tried: string[] = [];
    for (const step of [900, 800, 700, 600]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width, height: 700 }), step);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width)).toBe(step);
      await page.waitForTimeout(300); // the strip lays out at the new width
      const measured = await measure();
      visited.push(measured);
      tried.push(`${step}px ${JSON.stringify(measured)}`);
      if (width === 0 && givesWay(measured)) {
        [squeezed, width] = [measured, step];
        await test.info().attach('one-strip-narrow-title-bar', { body: await banner.screenshot(), contentType: 'image/png' });
      }
    }
    test.info().annotations.push({ type: 'one-strip narrow', description: tried.join('\n') });
    expect(width, 'a place gave way by 600 px').toBeGreaterThan(0);
    expect(givesWay(squeezed), `a place gave way by ${width} px`).toBe(true);
    expect(squeezed.map((t) => t.place !== null), 'every session tab still has its place').toEqual([true, true, true, true]);
    // at every width step: each place is drawn readable or not drawn, and no title is cut while its place is drawn
    expect(visited.flat().filter((t) => !t.placeDrawnOrHidden), 'a place is drawn on the first line or wrapped out of sight').toEqual([]);
    expect(visited.flat().filter((t) => t.titleCut && (t.place ?? 0) > 0), 'no title is cut while its place still shows').toEqual([]);
    expect(visited.flat().filter((t) => !t.placeReadable), 'a place that shows is whole, or four characters and the ellipsis').toEqual([]);

    // what is stored is one strip, in the envelope build F reads (UC-14)
    await expect
      .poll(async () => {
        const value = (await layoutGet(page, 'main.tabs')) as { version: number; current: string; sets: Record<string, unknown> };
        return [value.version, value.current, Object.keys(value.sets)];
      }, { message: 'version 3, current none, the one set none' })
      .toEqual([3, 'none', ['none']]);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// E11 F2b (plan 2.5; owner decision 2): opening a session replaces the main tab whatever it shows (Diagnostics), the
// replaced one back on ⌘⇧T; UX wave U7b (O-40): Settings is a dialog and takes no place in the strip, so a click on the
// dimmed window closes it, goes nowhere, and leaves the strip as it was; a pinned tab shows a pin saying what it does and stays; the session's
// right-click menu "Open in new tab" is the explicit way to a tab of its own, ⌘-click its shortcut.
test('a session opens in place of Settings or Diagnostics; a pin keeps its tab; Open in new tab adds one', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    const strip = 'Open tabs';
    const labels = () => tabLabels(page, strip);
    const tabNamed = (name: string) => page.getByRole('tablist', { name: strip }).getByRole('tab', { name, exact: true });
    const CHARTER_ROW = 'Charter + research';
    await (await sidebarRow(page, NORTH)).click();
    await expect.poll(labels).toEqual([NORTH]);

    // Settings over the strip: a click on the dimmed window closes it and the strip is as it was
    const dialog = await openSettings(app, page);
    await expect.poll(labels, { message: 'Settings adds no tab' }).toEqual([NORTH]);
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const box = (await dialog.boundingBox())!;
    expect(box.x, 'the dimmed window shows left of the dialog').toBeGreaterThan(16);
    await page.mouse.click(8, Math.round(size.height / 2)); // the scrim over the sidebar's rows
    await expect(dialog).toHaveCount(0);
    await expect.poll(labels, { message: 'the strip is as it was' }).toEqual([NORTH]);
    await expect.poll(() => selectedTab(page, strip)).toBe(NORTH);

    // a tab of no session gives its place to the session clicked
    await menu(app, 'diagnostics.open');
    await expect.poll(labels).toEqual([NORTH, 'Diagnostics']);
    await (await sidebarRow(page, FIX)).click();
    await expect.poll(labels, { message: 'Diagnostics gave its place' }).toEqual([NORTH, FIX]);

    // the session's right-click menu: Open in new tab keeps what is shown (Diagnostics here) and adds a tab
    await menu(app, 'diagnostics.open');
    await expect.poll(labels).toEqual([NORTH, FIX, 'Diagnostics']);
    await (await sidebarRow(page, SIP)).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
    await expect.poll(labels, { message: 'Open in new tab added one' }).toEqual([NORTH, FIX, 'Diagnostics', SIP]);

    // a plain click on Diagnostics' place replaces it; ⌘⇧T brings it back
    await tabNamed('Diagnostics').click();
    await (await sidebarRow(page, CHARTER_ROW)).click();
    await expect.poll(labels, { message: 'Diagnostics gave its place' }).toEqual([NORTH, FIX, CHARTER_ROW, SIP]);
    await menu(app, 'tab.reopen');
    await expect.poll(labels, { message: '⌘⇧T brings Diagnostics back' }).toContain('Diagnostics');

    // pinned: the pin shows, says what it does, and keeps its tab; the session opens after it
    await tabNamed(CHARTER_ROW).click({ button: 'middle' }); // a middle-click closes it
    await expect.poll(labels).not.toContain(CHARTER_ROW);
    await tabNamed(FIX).click();
    await tabNamed(FIX).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin tab' }).click();
    const pin = tabNamed(FIX).getByRole('img', { name: 'Pinned' });
    await expect(pin).toBeVisible();
    await expect(pin).toHaveAttribute('title', 'Pinned: stays open when you open another session');
    await (await sidebarRow(page, CHARTER_ROW)).click();
    await expect.poll(labels, { message: 'the pinned tab stayed, the session opened after it' }).toEqual(expect.arrayContaining([FIX, CHARTER_ROW]));
    await expect.poll(() => selectedTab(page, strip)).toBe(CHARTER_ROW);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// P3-F wave S (F6, candidate 58; the owner: "a defect, not taste"): the floating card draws the session in front, so with
// none in front (an artifact, Diagnostics) Float is disabled and says why, the menu action floats nothing, and a float that
// meets such a tab docks: main and its tab strip never vanish behind a panel with no card. UX wave U7b (O-40): Settings is
// a dialog, no tab, so Diagnostics stands for the tab of no session, and Settings over the floating card leaves it floating.
test('Float with no session in front: disabled with its reason, the action floats nothing, Settings over the card leaves it, and Diagnostics docks it', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    const NO_SESSION = 'Select a session’s tab to float it';
    const main = page.locator('[data-region="main"]');
    const panel = page.locator('[data-region="panel"]');
    const strip = page.getByRole('tablist', { name: 'Open tabs' });
    const card = panel.getByRole('region', { name: 'Session card' });
    const mainShown = async (message: string) => {
      await expect(main, message).toHaveJSProperty('inert', false);
      await expect.poll(async () => (await main.boundingBox())?.width ?? 0, { message }).toBeGreaterThan(0);
      await expect(strip, message).toBeVisible();
    };
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, NORTH)).click();
    // UX2 owner ruling: surfaces are optional; Float's controls exist only over an explicitly opened surface.
    await page.locator('[data-surface-row]').getByRole('button', { name: 'Files', exact: true }).click();
    await expect(panel.locator('[data-surface="files"]')).toBeVisible();
    // Keep the pre-UX2 regression coverage: opening Overview must restore main from an actual maximized surface.
    const overviewButton = page.getByRole('banner').getByRole('button', { name: /^Overview/ });
    const overview = main.getByRole('dialog', { name: 'Overview' });
    await panel.getByRole('button', { name: 'Expand surface' }).click();
    await expect(main).toHaveJSProperty('inert', true);
    await expect(main).toHaveCSS('width', '0px');
    await overviewButton.click();
    await mainShown('the Overview toggle restores main from a maximized surface');
    await expect(overview).toBeVisible();
    await expect(overview).toBeFocused();
    // Opening via the menu is not a toggle: restore and refocus an Overview hidden by maximize.
    await panel.getByRole('button', { name: 'Expand surface' }).click();
    await expect(main).toHaveJSProperty('inert', true);
    await menu(app, 'tab.overview');
    await mainShown('the Overview menu restores main from a maximized surface');
    await expect(overview).toBeVisible();
    await expect(overview).toBeFocused();
    await overview.getByRole('button', { name: 'Close Overview' }).click();
    await menu(app, 'diagnostics.open');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([NORTH, 'Diagnostics']);

    await expect(panel.getByRole('button', { name: NO_SESSION })).toBeDisabled();
    await menu(app, 'panel.float');
    await expect(page.getByText(NO_SESSION, { exact: true })).toBeVisible(); // the toast says why
    await mainShown('the action floats nothing with Diagnostics in front');
    await expect(card).toHaveCount(0);

    await strip.getByRole('tab', { name: NORTH, exact: true }).click();
    await panel.getByRole('button', { name: 'Float conversation over surface' }).click();
    await expect(card).toBeVisible();
    await expect(main).toHaveJSProperty('inert', true);
    // Settings is drawn over the floating card, which stays floating under it and after it
    const dialog = await openSettings(app, page);
    // under the modal dialog the card is hidden from accessibility, so it is found with its hidden kin; it stays drawn
    await expect(panel.getByRole('region', { name: 'Session card', includeHidden: true })).toBeVisible();
    await expect(main).toHaveJSProperty('inert', true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card, 'Settings leaves the card floating').toBeVisible();
    await menu(app, 'diagnostics.open'); // Diagnostics comes in front of the floating card
    await expect(card).toHaveCount(0);
    await mainShown('a float that meets Diagnostics docks');
    await expect(panel.getByRole('button', { name: NO_SESSION })).toBeDisabled();
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// E11 F2b (plan 2.1): a started session's composer, docked at the pane's foot, in a window too short for the palette's
// 384px cap above it: the palette opens above the editor, capped by the room there, and moves nothing
// (support/palette-geometry.ts; sessions.spec.ts runs the same over an unstarted New chat's centred composer).
test('the slash palette opens above a started session’s composer and moves nothing', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1200, height: 440 }));
    await (await sidebarRow(page, NORTH)).click();
    const composer = page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
    await expect(composer).toBeVisible();
    // The pointer leaves the row it clicked: resting there, it opens the row's hover card 300 ms later, which on a slow
    // runner stands over the composer when the palette's check clicks it, and never closes while the pointer stays. It
    // goes to the composer's far end: a card already open stands beside the sidebar, 342 px wide, and a pointer on the
    // card holds it open (at this window's 440 px a session's card reaches down over the composer's middle).
    const box = (await composer.boundingBox())!;
    await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
    await expect(page.locator('[data-hover-card]')).toHaveCount(0);
    await slashPaletteMovesNothing(page, 'a started session');
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// W11 at scale (many-sessions.json: three projects of 120 sessions, a third of MAWS's in a managed and a sibling
// worktree): Codex's flat tree, 36px project rows expanding in place to 30px session rows, five and then eight at most,
// one flat list with a worktree mark at left; only the hover card names its branch and folder; ArrowLeft
// steps out to the project.
test('sidebar at scale: the flat tree, 36px project rows, 30px session rows, five then eight', async () => {
  const maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/many-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { app, page } = maws;
    const sidebar = page.locator('[data-region="sidebar"]');
    await expect(sidebar.locator('[data-kind="project"]')).toHaveCount(3, { timeout: 15_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 860 }));
    const heights = (scope: Locator) => scope.evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))]);
    expect(await heights(sidebar.locator('[data-project-line]')), 'project rows are 36px').toEqual([36]);

    await openProject(page, 'MAWS');
    const maWS = projectRow(page, 'MAWS');
    const rows = maWS.locator('[data-kind="session"]');
    await expect(rows, 'five sessions first').toHaveCount(5);
    expect(await heights(rows), 'session rows are 30px').toEqual([30]);
    await expect(maWS.getByRole('group'), 'one flat list: no Main or worktree groups').toHaveCount(1);
    await maWS.getByRole('treeitem', { name: 'Show more' }).click();
    await expect(rows, 'eight at most').toHaveCount(8);
    await expect(maWS.getByRole('treeitem', { name: 'Show more' })).toHaveCount(0);

    // A worktree session, found through the search (which lists the project open on its matches).
    await sidebar.getByRole('searchbox', { name: 'Search projects and sessions' }).fill('scale-alpha');
    const alpha = maWS.locator('[data-kind="session"]').first();
    await expect(alpha.getByRole('img', { name: 'Worktree', exact: true })).toHaveText('⎇');
    await expect(alpha, 'branch names belong only in the hover card').not.toContainText('worktree-scale-alpha');
    const title = (await alpha.getAttribute('aria-label'))!;
    const card = page.getByRole('dialog', { name: title });
    await expect(async () => {
      await page.mouse.move(700, 400);
      await alpha.hover();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(card.getByTestId('hover-place')).toHaveText('⎇ worktree-scale-alpha · worktree scale-alpha');

    await alpha.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(maWS).toBeFocused();
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// UX wave U7a, O-03 (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M4; A5): the title
// bar's project chip owns 96 px. With a session of a project whose name is forty characters (invented here) in front,
// the chip's button stays inside that box and left of the strip, its name ends cut by its ellipsis, and its tooltip
// still names the whole project.
test('a long project name stays inside the chip’s box', async () => {
  const LONG = 'meridian-lighthouse-survey-archive-tools';
  expect(LONG).toHaveLength(40);
  const scratch = mkdtempSync(join(tmpdir(), 'maws-u7-chip-'));
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { projects: { id: string; name: string }[] };
  scenario.projects.find((project) => project.id === 'proj-codex-somersault')!.name = LONG;
  const source = join(scratch, 'scenario.json');
  writeFileSync(source, JSON.stringify(scenario));
  try {
    const maws = await launchMaws({ env: { ...SHELL_ENV, MAWS_SESSION_SOURCE: `stub:${source}` } });
    try {
      const { app, page } = maws;
      await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 860 }));
      await (await sidebarRow(page, 'Trace stream reconnects')).click();
      await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'a session of the long-named project in front' }).toEqual(['Trace stream reconnects']);
      const chip = page.getByRole('banner').locator('[data-toolbar-project]');
      // U13a's chip: it names the row of the session in front, and a click reveals that row
      await expect(chip).toHaveAccessibleName(`Reveal ${LONG} in sidebar`);
      await expect(chip, 'the tooltip holds the whole name').toHaveAttribute('title', `Reveal ${LONG} in sidebar`);
      const name = chip.locator('.truncate');
      await expect(name).toHaveText(LONG);
      const box = (await chip.boundingBox())!;
      const strip = (await mainTabs(page).boundingBox())!;
      expect(box.width, 'the chip is at most its 96 px').toBeLessThanOrEqual(96);
      expect(box.x + box.width, 'the chip ends where the strip begins (half a pixel for rounding), never under the first tab').toBeLessThanOrEqual(strip.x + 0.5);
      expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), 'the name is cut inside the chip').toBe(true);
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
      // the owner's look: more tabs open beside the long name's, at the wide width and at a narrow one
      // (the long name's project last, so the chip still names it with a mixed strip of four behind it)
      for (const title of [FIX, QUOTA, 'Somersault terminal run']) await (await sidebarRow(page, title)).click({ modifiers: ['Meta'] });
      await page.mouse.move(700, 400); // off the sidebar: no hover card in the pictures
      await attachWindowShot(maws, 'u7a-title-bar-long-name', 1280, 820);
      await attachWindowShot(maws, 'u7a-title-bar-narrow', 700, 820);
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// UX wave U7a, O-16 (the same document, M4; A2). Hide from a row's context menu takes the row out of its project's list
// at once, and "Hidden · 1" stands at the project's end, closed; open, it holds the hidden row, indented one step. A
// relaunch shows the same. Unhide puts the row at the project's head, and `sidebar.hidden` in layout.json is left with no
// entry. Then the row's own button (M3, decision 9; the owner's answer, "Button on the row"): one click hides, opening
// nothing, and the hidden row's button unhides. The session is one at rest (no holder, exited), so no look returns it
// by itself while the scene runs.
test('hide and unhide', async () => {
  const SDK = 'SDK wire inventory';
  const shown = ['Usage reset countdown', 'Settings idle probe'];
  const parts = (page: Page) => {
    const project = projectRow(page, USAGE_PROJECT);
    return { project, row: project.getByRole('treeitem', { name: SDK, exact: true }), hidden: project.locator('[data-kind="hidden"]') };
  };
  const closedHiddenRow = async ({ project, row, hidden }: ReturnType<typeof parts>, message: string) => {
    await expect(row, message).toHaveCount(0);
    expect(await treeRows(project), `${message}: the rest of the list`).toEqual(shown);
    await expect(hidden, message).toHaveText('Hidden · 1');
    await expect(hidden).toHaveAccessibleName('Hidden, 1 session');
    await expect(hidden, `${message}: closed`).toHaveAttribute('aria-expanded', 'false');
    await expect(project.locator('[role="treeitem"]').last(), `${message}: the project's last row`).toHaveAttribute('data-kind', 'hidden');
  };
  const openHiddenRow = async ({ project, row, hidden }: ReturnType<typeof parts>) => {
    await hidden.click();
    await expect(hidden).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toBeVisible();
    await expect(row, 'the hidden row is the Hidden row’s contents').toHaveAttribute('data-indented', 'true');
    await expect(row, 'indented one step, the inset of a nested row').toHaveCSS('padding-left', '30px');
    await expect(project.getByRole('treeitem', { name: shown[0], exact: true }), 'a shown row keeps its inset').toHaveCSS('padding-left', '7px');
  };
  const unhidden = async ({ project, row, hidden }: ReturnType<typeof parts>, userData: string, message: string) => {
    await expect(hidden, message).toHaveCount(0);
    await expect.poll(() => treeRows(project), { message: `${message}: the row first, the pointer still in the sidebar` }).toEqual([SDK, ...shown]);
    await expect(row).not.toHaveAttribute('data-indented', 'true');
    await expect.poll(() => storedKey(userData, 'sidebar.hidden'), { message: `${message}: sidebar.hidden in layout.json, with no entry` }).toEqual({ version: 1, hidden: {} });
  };

  const first = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = first;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    const at = parts(page);
    await openProject(page, USAGE_PROJECT);
    expect(await treeRows(at.project)).toEqual([...shown, SDK]);
    await at.row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await closedHiddenRow(at, 'hidden from its menu');
    const address = await addressed(page, 'app-1238089b');
    await expect.poll(async () => Object.keys(((await layoutGet(page, 'sidebar.hidden')) as { hidden: Record<string, unknown> } | null)?.hidden ?? {}), { message: 'the hide is stored' }).toEqual([address]);
    await openHiddenRow(at);
    await attachWindowShot(first, 'u7a-hidden-list', 1280, 820);
    expect(first.consoleErrors(), 'the console stays free of errors').toEqual([]);
    await first.app.close();

    const second = await launchMaws({ env: SHELL_ENV, userData: first.userData });
    try {
      const { page } = second;
      const again = parts(page);
      await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
      await openProject(page, USAGE_PROJECT);
      await closedHiddenRow(again, 'after the relaunch');
      await openHiddenRow(again);
      await again.row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Unhide', exact: true }).click();
      await unhidden(again, second.userData, 'unhidden from its menu');

      // the row's own button: one click hides and opens nothing; in the Hidden list it reads Unhide
      const tabs = await tabLabels(page, 'Open tabs');
      await clickRevealed(again.row, again.row.getByRole('button', { name: 'Hide', exact: true }));
      await closedHiddenRow(again, 'hidden by its button');
      expect(await tabLabels(page, 'Open tabs'), 'the button opened no session').toEqual(tabs);
      await openHiddenRow(again);
      await clickRevealed(again.row, again.row.getByRole('button', { name: 'Unhide', exact: true }));
      await unhidden(again, second.userData, 'unhidden by its button');
      expect(second.consoleErrors(), 'the relaunched console stays free of errors').toEqual([]);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup(); // removes the profile both launches used
  }
});

// UX wave U7b, O-40 (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M8; A7 and §H):
// Settings is a dialog over the window. Opened over a session with a draft typed, the strip, the sidebar and the
// transcript stay drawn behind it and no tab is added; Esc closes it and the composer has the keyboard and the draft
// again; ⌘W closes the dialog, not the tab behind it; a sheet opened from Settings takes the first Esc alone.
test('Settings is a dialog', async () => {
  const DRAFT = 'A draft that waits behind Settings';
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, FIX)).click();
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([FIX]);
    const main = page.locator('[data-region="main"]');
    // read under the dialog too, where everything outside it is hidden from accessibility
    const composer = main.getByRole('textbox', { name: 'Message', includeHidden: true });
    await composer.click();
    await page.keyboard.type(DRAFT);
    await expect(composer).toHaveText(DRAFT);
    await expect(composer).toBeFocused();
    const tabs = await tabLabels(page, 'Open tabs');

    // ⌘, over the session: what was showing stays drawn behind the dialog, and the strip gains no tab
    const dialog = await openSettings(app, page);
    await expect(mainTabs(page)).toBeVisible();
    await expect(page.locator('[data-region="sidebar"]')).toBeVisible();
    await expect(main.locator('[data-transcript-scroller]')).toBeVisible();
    await expect(composer).toHaveText(DRAFT);
    expect(await tabLabels(page, 'Open tabs'), 'no tab is added').toEqual(tabs);

    // Esc closes it, and the keyboard is back in the composer with its draft (§H, row 6)
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveText(DRAFT);

    // ⌘, again; ⌘W closes the dialog and not the tab behind it
    await openSettings(app, page);
    await menu(app, 'tab.close');
    await expect(dialog).toHaveCount(0);
    expect(await tabLabels(page, 'Open tabs'), '⌘W closed the dialog, not the tab').toEqual(tabs);
    await expect(composer).toHaveText(DRAFT);

    // a sheet opened from Settings takes the first Esc alone (§H, row 2): a binding is changed so that Reset asks
    await openSettings(app, page);
    const next = dialog.getByRole('table', { name: 'Key bindings' }).getByRole('row', { name: 'Next Needs-you', exact: true });
    await next.getByRole('button', { name: 'Change Next Needs-you' }).click();
    await page.keyboard.press('Meta+Shift+KeyU');
    await expect(next.locator('kbd')).toHaveText('⌘⇧U');
    await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reset every key binding?' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(dialog, 'the dialog stays under the sheet it opened').toBeVisible();
    await expect(next.locator('kbd'), 'the sheet closed without resetting').toHaveText('⌘⇧U');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// UX wave U7b, O-40 (the same document, M8; A7 and A9; M5, decisions 2 and 5): a page takes everything right of the
// sidebar. With a transcript scrolled up, a draft typed and a side surface open, Customize opens as a page: the side
// column is not drawn, the title bar spans to the window's right edge with the ring at its end, Back and "Customize"
// stand where the strip was, and the sidebar's row is current. ⌘, opens the dialog over the page and Esc shows the page
// again. Back returns to the same tab at the same scroll offset with its draft, and to the side surface as it was, with
// nothing of the side column written by the visit. A session's row leaves the page. A request raised while a page is
// open shows under Needs you and on the Overview button, and the page stays. A relaunch with the page open shows the
// page; with the dialog open over it, the page without the dialog.
test('a page beside the sidebar', async () => {
  test.setTimeout(150_000);
  const DRAFT = 'A draft that waits behind the page';
  const first = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page, userData } = first;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 760 }));
    await page.waitForFunction(() => innerWidth === 1360);
    const labels = () => tabLabels(page, 'Open tabs');
    const main = page.locator('[data-region="main"]');
    const behind = main.locator('[data-behind-page]');
    const scroller = main.locator('[data-transcript-scroller]');
    const composer = main.getByRole('textbox', { name: 'Message' });
    const panel = page.locator('[data-region="panel"]');
    const files = panel.locator('[data-surface="files"]');
    const bar = page.getByRole('banner');
    const region = pageRegion(page);
    await (await sidebarRow(page, FIX)).click();
    await expect.poll(labels).toEqual([FIX]);

    // the tab as the person leaves it: a side surface open, a draft typed, the transcript scrolled up from its end
    await openSurface(page, 'Files');
    await composer.click();
    await page.keyboard.type(DRAFT);
    await expect(composer).toHaveText(DRAFT);
    const scrollBox = (await scroller.boundingBox())!;
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop), { message: 'the transcript scrolled up from its end' }).toBeGreaterThan(0);
    let offset = -1;
    await expect.poll(async () => {
      const now = await scroller.evaluate((el) => el.scrollTop);
      const settled = now === offset;
      offset = now;
      return settled;
    }, { message: 'the scroll has settled', intervals: [250] }).toBe(true);
    // layout.json settled on what is drawn: the side surface stored, and two reads in a row the same (the store writes a
    // key 250 ms after its last change; typing and scrolling change neither key)
    const sides = () => JSON.stringify({ regions: storedKey(userData, 'regions'), surfaces: storedKey(userData, 'panelTools.surfaces') });
    let read = '';
    await expect.poll(() => {
      const now = sides();
      const settled = now === read && now.includes('"files"');
      read = now;
      return settled;
    }, { message: 'layout.json holds the side surface, settled', intervals: [400] }).toBe(true);

    // the page: everything right of the sidebar
    await openAppDestination(page, 'Customize');
    await expect(region).toHaveAttribute('data-destination', 'customize');
    await expect(panel, 'the side column is not drawn').toHaveCSS('visibility', 'hidden');
    await expect(panel).toHaveJSProperty('inert', true);
    const width = await page.evaluate(() => innerWidth);
    const barBox = (await bar.boundingBox())!;
    expect(Math.round(barBox.x + barBox.width), 'the title bar spans to the window’s right edge').toBe(width);
    const regionBox = (await region.boundingBox())!;
    expect(Math.round(regionBox.x + regionBox.width), 'the page takes the side column’s place').toBe(width);
    const ring = (await usageRing(page).boundingBox())!;
    expect(ring.x + ring.width, 'the ring at the title bar’s end').toBeGreaterThan(width - 48);
    await expect(mainTabs(page), 'no strip').toHaveCSS('visibility', 'hidden');
    await expect(pageTitle(page).getByRole('button', { name: 'Back', exact: true })).toHaveAttribute('title', 'Back · Esc');
    await expect(page.getByRole('navigation', { name: 'App destinations' }).getByRole('button', { name: 'Customize', exact: true })).toHaveAttribute('aria-current', 'page');
    // what the page hides stays mounted, invisible and inert
    await expect(behind).toHaveJSProperty('inert', true);
    await expect(behind).toHaveCSS('visibility', 'hidden');
    await expect(scroller).toBeAttached();
    await expect(files).toBeAttached();

    // ⌘, opens the dialog over the page; Esc shows the page again
    const dialog = await openSettings(app, page);
    await expect(region).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(region).toHaveAttribute('data-destination', 'customize');

    // Back: the same tab at the same scroll offset with its draft, the side surface as it was, nothing written
    await expect.poll(() => storedKey(userData, 'destination'), { message: 'the page is stored before Back' }).toMatchObject({ version: 1, destination: { kind: 'customize' } });
    await backToTabs(page);
    await expect(behind).toHaveJSProperty('inert', false);
    await expect(files).toBeVisible();
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(FIX);
    expect(await scroller.evaluate((el) => el.scrollTop), 'the transcript kept its scroll offset').toBe(offset);
    await expect(composer).toHaveText(DRAFT);
    // Back's own write: the page's key deleted. The store schedules every key a change touches in one pass, `regions` and
    // `panelTools.surfaces` before `destination` (persistedKeys' order), so once the key is gone a write of either made
    // by the visit or by Back has landed; four more reads then hold the two keys as they were.
    await expect.poll(() => 'destination' in (JSON.parse(readFileSync(join(userData, 'layout.json'), 'utf8')) as object), { message: 'Back wrote the page closed' }).toBe(false);
    let held = 0;
    await expect.poll(() => {
      if (sides() !== read) return `changed: ${sides()}`;
      held += 1;
      return held >= 4 ? 'held' : 'reading';
    }, { message: 'regions and the side surfaces unchanged by the visit', intervals: [250], timeout: 5_000 }).toBe('held');

    // a session's row leaves the page and shows that session
    await openAppDestination(page, 'Projects');
    await (await sidebarRow(page, NORTH)).click();
    await expect(region).toHaveCount(0);
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(NORTH);

    // a request raised while a page is open shows under Needs you and on the Overview button; the page stays
    await openAppDestination(page, 'Customize');
    const sidebar = page.locator('[data-region="sidebar"]');
    const overviewButton = bar.getByRole('button', { name: /^Overview/ });
    const waitingBefore = await overviewButton.getAttribute('aria-label');
    await expect(sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button').filter({ hasText: 'Charter + research' })).toHaveCount(0);
    await advanceTo(app, 3000); // the scenario's read-only request for Charter + research
    await expect(sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button').filter({ hasText: 'Charter + research' }), 'under Needs you').toHaveCount(1);
    await expect.poll(() => overviewButton.getAttribute('aria-label'), { message: 'on the Overview button' }).not.toBe(waitingBefore);
    await expect(overviewButton).toHaveAccessibleName(/^Overview, \d+ waiting$/);
    await expect(region, 'nothing of the request took the page away').toHaveAttribute('data-destination', 'customize');

    // a relaunch with the page open shows the page
    await expect.poll(() => storedKey(userData, 'destination'), { message: 'the page is stored' }).toMatchObject({ version: 1, destination: { kind: 'customize' } });
    expect(first.consoleErrors(), 'the console stays free of errors').toEqual([]);
    await first.app.close();
    const second = await launchMaws({ env: SHELL_ENV, userData });
    try {
      await expect(pageRegion(second.page), 'the page comes back').toHaveAttribute('data-destination', 'customize', { timeout: 20_000 });
      await expect(pageTitle(second.page).getByRole('heading', { level: 1, name: 'Customize', exact: true })).toBeVisible();
      // the dialog opened over it, then the window quit
      await openSettings(second.app, second.page);
      await second.app.close();
    } finally {
      await second.cleanup();
    }
    const third = await launchMaws({ env: SHELL_ENV, userData });
    try {
      await expect(pageRegion(third.page), 'the page, without the dialog').toHaveAttribute('data-destination', 'customize', { timeout: 20_000 });
      await expect(settingsDialog(third.page)).toHaveCount(0);
      expect(third.consoleErrors(), 'the relaunched console stays free of errors').toEqual([]);
    } finally {
      await third.cleanup();
    }
  } finally {
    await first.cleanup(); // removes the profile the three launches used
  }
});

// UX wave U7b, O-40 (the same document, M8; A10): with a split and a page open, ⇧⌘\ (`pane.focusOther`) closes the page
// and leaves the other pane's tab in front; the split stays as it was.
test('⌘⇧\\ under a page', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    const main = page.locator('[data-region="main"]');
    await (await sidebarRow(page, NORTH)).click();
    await (await sidebarRow(page, FIX)).click({ modifiers: ['Meta'] }); // a tab of its own
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([NORTH, FIX]);
    await menu(app, 'pane.split');
    await expect(main.locator('[data-pane="1"]')).toBeVisible();
    const front = () => activeMainTab(page).getAttribute('aria-label');
    const before = await front();
    expect([NORTH, FIX]).toContain(before);
    const other = before === NORTH ? FIX : NORTH;

    await openAppDestination(page, 'Customize');
    await menu(app, 'pane.focusOther');
    await expect(pageRegion(page), 'the page closes').toHaveCount(0);
    await expect.poll(front, { message: 'the other pane’s tab in front' }).toBe(other);
    await expect(main.locator('[data-pane="1"]'), 'the split stays').toBeVisible();
    expect(await tabLabels(page, 'Open tabs'), 'no tab added or lost').toEqual(expect.arrayContaining([NORTH, FIX]));
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// UX wave U7b, O-40 (the same document, M8; the architect's word at M5's review; M5's decision on the Overview's host):
// the Overview is drawn over a page. With the side surface maximized, and again with the conversation floating over
// it, the main track is 0 px wide, so the Overview's one host is placed at the page's box: the two boxes are equal, and
// equal again after one window resize; when the page closes under the open Overview, the side column is docked, since
// the Overview is never drawn over a main region the side column covers. Boxes and states only.
test('the Overview over a page', async () => {
  test.setTimeout(120_000);
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    const main = page.locator('[data-region="main"]');
    const panel = page.locator('[data-region="panel"]');
    const card = panel.getByRole('region', { name: 'Session card' });
    const overviewButton = page.getByRole('banner').getByRole('button', { name: /^Overview/ });
    const overview = page.getByRole('dialog', { name: 'Overview' });
    const layer = page.locator('[data-overview-host] [data-overview-area]');
    const region = pageRegion(page);
    const boxOf = async (element: Locator) => {
      const box = (await element.boundingBox())!;
      return [box.x, box.y, box.width, box.height].map((n) => Math.round(n));
    };
    const sameBox = async () => JSON.stringify(await boxOf(layer)) === JSON.stringify(await boxOf(region));
    const resize = async (width: number, height: number) => {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height] as const);
      await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height] as const);
    };
    const mainHidden = async (message: string) => {
      await expect(main, message).toHaveJSProperty('inert', true);
      await expect.poll(async () => (await main.boundingBox())?.width ?? 0, { message }).toBe(0);
    };
    const docked = async (message: string) => {
      await expect(main, message).toHaveJSProperty('inert', false);
      await expect.poll(async () => (await main.boundingBox())?.width ?? 0, { message }).toBeGreaterThan(0);
      await expect(card, message).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Expand surface' }), message).toBeVisible();
    };
    await resize(1360, 860);
    await (await sidebarRow(page, NORTH)).click();
    await openSurface(page, 'Files');

    for (const [state, to] of [['maximized', [1200, 780]], ['floating', [1360, 860]]] as const) {
      if (state === 'maximized') await panel.getByRole('button', { name: 'Expand surface' }).click();
      else {
        await panel.getByRole('button', { name: 'Float conversation over surface' }).click();
        await expect(card).toBeVisible();
      }
      await mainHidden(`the side column ${state}: the main track is 0 px`);
      await openAppDestination(page, 'Customize');
      await overviewButton.click();
      await expect(overview).toBeVisible();
      await expect(region, 'the Overview opens over the page, which stays').toBeVisible();
      expect(await overview.evaluate((el) => el.closest('[inert]') === null), 'the Overview is inside no inert element').toBe(true);
      await expect.poll(sameBox, { message: `${state}: the Overview's box is the page's` }).toBe(true);
      const before = await boxOf(region);
      await resize(to[0], to[1]);
      await expect.poll(async () => JSON.stringify(await boxOf(region)), { message: 'the page took the new window’s box' }).not.toBe(JSON.stringify(before));
      await expect.poll(sameBox, { message: `${state}: after a resize the Overview's box is the page's new box` }).toBe(true);
      // the page closes under the Overview: the side column is docked
      await pageTitle(page).getByRole('button', { name: 'Back', exact: true }).click();
      await expect(region).toHaveCount(0);
      await expect(overview, 'the Overview stays open').toBeVisible();
      await docked(`${state}: the page closed under the Overview`);
      await overview.getByRole('button', { name: 'Close Overview' }).click();
      await expect(overview).toBeHidden();
    }
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// UX2 owner rulings: one chrome row (tabs inside it). UX wave U7b (O-47): usage is a ring at the title bar's own right
// end, after the surface icons, and the sidebar's foot holds no usage control.
async function assertToolbarPlacement(page: Page): Promise<void> {
  const toolbar = page.getByRole('banner');
  const overview = toolbar.getByRole('button', { name: /^Overview/ });
  const sidebar = toolbar.getByRole('button', { name: 'Toggle sidebar' });
  const usage = usageRing(page);
  const surfaceRow = shellSurfaceRow(page);
  const wordmark = page.locator('[data-sidebar-wordmark]');
  const newChat = page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true });
  const search = page.locator('[data-region="sidebar"]').getByRole('searchbox');
  // The compact destination header has no wordmark. MAWS may still be the project chip's name (P3-F wave S, F17).
  const marks = toolbar.getByText('MAWS', { exact: true });
  await expect.poll(() => marks.evaluateAll((els) => els.filter((el) => !el.closest('[data-toolbar-project]')).length), { message: 'no wordmark in the title bar' }).toBe(0);
  await expect(wordmark).toHaveCount(0);
  const destinations = page.getByRole('navigation', { name: 'App destinations' });
  const ordered = [search, newChat, ...['Projects', 'Artifacts', 'Customize'].map((name) => destinations.getByRole('button', { name, exact: true }))];
  const boxes = await Promise.all(ordered.map((element) => element.boundingBox()));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height);
  await expect(newChat.locator('svg')).toHaveCSS('color', await newChat.evaluate((el) => getComputedStyle(el).color));
  await sidebar.click();
  await expect(page.locator('[data-region="sidebar"]')).toHaveAttribute('inert', '');
  await expect(overview).toBeVisible();
  await expect(sidebar).toBeVisible();
  const collapsedToggle = (await sidebar.boundingBox())!;
  expect(collapsedToggle.x).toBeGreaterThanOrEqual(78);
  await sidebar.click();
  await expect(toolbar).toHaveCSS('height', '44px');
  await expect(overview).toHaveCSS('width', '28px');
  await expect(overview).toHaveCSS('height', '28px');
  await expect(overview).toHaveCSS('-webkit-app-region', 'no-drag');
  await expect(usage).toHaveCSS('-webkit-app-region', 'no-drag');
  await expect(usage).toBeVisible();
  await expect(usage).toHaveAttribute('aria-label', /^Usage · /); // no visible text: today's sentence is its name
  await expect(usage).toHaveText('');
  await expect(sidebarFooter(page).locator('[data-usage-ring], [data-usage-pill]')).toHaveCount(0);
  const [bar, toggle, board, surface, strip, ring] = await Promise.all([
    toolbar, sidebar, overview, surfaceRow, mainTabs(page).locator('[data-pane-strip]').first(), usage,
  ].map((el) => el.boundingBox()));
  expect(board!.x).toBe(toggle!.x + toggle!.width + 4);
  expect(ring!.x, 'the ring after the surface icons').toBeGreaterThanOrEqual(surface!.x + surface!.width);
  expect(ring!.y).toBeGreaterThanOrEqual(bar!.y);
  expect(ring!.y + ring!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
  expect(strip!.y).toBeGreaterThanOrEqual(bar!.y);
  expect(strip!.y + strip!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
  expect(strip!.x + strip!.width).toBeLessThanOrEqual(surface!.x);
  await expect(page.locator('[data-region="main"] [data-pane-strip]')).toHaveCount(0);
}

interface Saved {
  regions: unknown;
  main: unknown;
  panelPinned: unknown;
  surfaces: unknown;
  side: { groups: unknown; widths: unknown; cards: unknown }; // UX wave U8b's three keys
  keys: string[];
  bounds: { x: number; y: number; width: number; height: number };
  left: string[];
  right: string[];
}

async function firstInstance(maws: MawsLaunch, testInfo: TestInfo): Promise<Saved> {
  const { app, page } = maws;
  const sidebar = page.locator('[data-region="sidebar"]');
  const main = page.locator('[data-region="main"]');
  // W5: the Overview floats over the main area, opened from the toolbar's button (or ⌘0); it is no tab.
  const overview = main.getByRole('dialog', { name: 'Overview' });
  const overviewButton = page.getByRole('banner').getByRole('button', { name: /^Overview/ });
  const board = overview.getByRole('list', { name: 'Overview' });
  const usageCard = board.getByRole('article', { name: 'Usage reset countdown' });
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const badge = () => app.evaluate(({ app }) => app.dock?.getBadge());
  // One project's sessions: a strip of one place, so no tab names it (U13a) and the labels are the titles alone
  const three = [FIX, SIP, NORTH];

  // UX2 optional-surfaces ruling: an empty main has no full-height summary/panel column.
  for (const name of ['sidebar', 'main']) await expect(page.locator(`[data-region="${name}"]`)).toBeVisible({ timeout: 10_000 });
  const tokens = await themeTokens(page); // once the stylesheet is in
  // The window's own bounds, so the relaunch has something specific to restore.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 860 }));

  await test.step('Item 1: frame, light theme, sidebar', async () => {
    // UX2 optional-surfaces ruling: an empty main has no full-height summary/panel column.
    for (const name of ['sidebar', 'main']) await expect(page.locator(`[data-region="${name}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // UX2 approved mockup mock.css:84: the sidebar shares main's base tone. The approved sidebar is 240px;
    // the optional-surfaces ruling leaves no summary column beside empty main.
    expect(await regionBackground(page)).toBe(tokens.light['--bg']);
    const separators = page.locator('[role="separator"][aria-orientation="vertical"]');
    await expect(separators).toHaveCount(1);
    expect(await separators.evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label'), el.getAttribute('aria-valuenow')]))).toEqual([
      ['Resize sidebar', '240'],
    ]);
    await expect(page.locator('[data-region="panel"]')).toHaveJSProperty('inert', true);
    await expect.poll(async () => (await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0).toBe(0);

    // W11: the project list, most recently active first, with each collapsed project's waiting and working counts; no
    // Pinned section. M2 restores cross-project Needs you above it, independent of expansions.
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 3' })).toBeVisible();
    const needsYou = sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button');
    await expect(needsYou).toHaveText([`◐${FIX}MAWS`, `◐${SIP}MAWS`, `◐${QUOTA}codex_somersault`]);
    for (const [index, label] of [`MAWS · ${FIX} · Approval needed`, `MAWS · ${SIP} · Question`, `codex_somersault · ${QUOTA} · Plan review`].entries()) {
      await expect(needsYou.nth(index), 'compact rows retain their attention reason for assistive technology').toHaveAccessibleName(label);
    }
    await sidebar.getByRole('searchbox').focus();
    // K moved Search above the app destinations; L's old Search -> Needs you Tab adjacency no longer applies.
    for (const name of ['New chat', 'Projects', 'Artifacts', 'Customize']) {
      await page.keyboard.press('Tab');
      await expect(sidebar.getByRole('navigation', { name: 'App destinations' }).getByRole('button', { name, exact: true })).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(needsYou.nth(0)).toBeFocused();
    await sidebar.getByRole('searchbox').focus();
    await page.keyboard.press('ArrowDown');
    await expect(needsYou.nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(needsYou.nth(2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(needsYou.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sidebar.getByRole('button', { name: 'Filter projects' })).toBeFocused();
    await sidebar.getByRole('searchbox').focus();
    await expect(page.locator('[data-hover-card]')).toHaveCount(0);
    const here = await localName(page); // P5 O6 M5 (T3): the machine's own row, in place of "Other sessions"
    expect(await projectRows(sidebar)).toEqual([USAGE_PROJECT, 'codex_somersault', 'MAWS', here]);
    expect(await rollups(sidebar)).toEqual({ [USAGE_PROJECT]: '●1', codex_somersault: '◐1', MAWS: '◐2●1', [here]: '' });
    const pages: Record<string, string[]> = {
      MAWS: ['Workstation north star', FIX, SIP, 'Charter + research'],
      codex_somersault: [QUOTA, 'Somersault terminal run', 'Trace stream reconnects'],
      [USAGE_PROJECT]: ['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory'],
      [here]: ['Terminal workflow notes'],
    };
    const glyphs: Record<string, string | null | undefined> = {};
    const unread: string[] = [];
    for (const [project, rows] of Object.entries(pages)) {
      await openProject(page, project);
      expect(await treeRows(projectRow(page, project)), `${project}'s sessions`).toEqual(rows);
      Object.assign(glyphs, await rowGlyphs(projectRow(page, project)));
      unread.push(...(await unreadRows(projectRow(page, project))).filter((title): title is string => title !== null));
      await closeProject(page, project);
    }
    expect(glyphs, 'every glyph as the glyph table labels it').toEqual({
      'Workstation north star': 'Done',
      [FIX]: 'Needs approval',
      [SIP]: 'Question',
      'Charter + research': 'Working',
      [QUOTA]: 'Plan review',
      'Somersault terminal run': 'Live in terminal',
      'Trace stream reconnects': 'Done',
      'Usage reset countdown': 'Working',
      'Settings idle probe': 'Idle',
      'SDK wire inventory': 'Done',
      'Terminal workflow notes': 'Idle, unread',
    });
    expect(unread.sort(), 'unread dots on exactly the unread records').toEqual([FIX, QUOTA, 'Terminal workflow notes'].sort());

    const foreignCard = await hoverRow(page, 'Somersault terminal run'); // W5: the row is one line; its holder is in the hover card
    await expect(foreignCard.getByTestId('hover-activity')).toHaveText('Terminal · pid 7135');
    await unhover(page, foreignCard);
    const foreign = await sidebarRow(page, 'Somersault terminal run');
    expect((await foreign.boundingBox())!.height, 'a 30px row').toBe(30);
    await foreign.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.getByRole('menuitem').allTextContents(), 'a foreign-live session offers only the opens (I2), then Hide (UX wave U7, O-16)').toEqual(['Open', 'Open in new tab', 'Hide']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await noLeftovers(page, tokens.dark), 'no dark colour in the light theme').toEqual([]);
  });

  await test.step('Item 2: the Overview board, floating over the main area', async () => {
    expect(await tabLabels(page, 'Open tabs'), 'no tab: the Overview is not one').toEqual([]);
    await expect(main.getByText('No open tabs')).toBeVisible();
    await assertToolbarPlacement(page);
    await page.screenshot({ path: testInfo.outputPath('toolbar-light.png') });
    await expect(overviewButton).toHaveAccessibleName('Overview, 3 waiting');
    // UX2 owner ruling: empty main has no surface to maximize. The real-surface maximize/Overview checks now live in
    // the Float case above, which explicitly opens Files before driving those controls.
    await expect(page.locator('[data-region="panel"]')).toHaveJSProperty('inert', true);
    await expect(overviewButton).toBeEnabled();
    await overviewButton.click();
    await expect(main).toHaveJSProperty('inert', false);
    await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(0);
    await expect(overview).toBeVisible();
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'true');
    await expect(overview, 'focus moves onto the panel, not a card (Esc on a card declines its request)').toBeFocused();
    await overview.getByRole('button', { name: 'Close Overview' }).click(); // usable, not merely mounted
    await expect(overview).toHaveCount(0);
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'false');
    await overviewButton.click();

    // Opening an already-open Overview from its menu remains idempotent (the maximized-surface case is above).
    await menu(app, 'tab.overview');
    await expect(main).toHaveJSProperty('inert', false);
    await expect(overview).toBeVisible();
    await expect(overview).toBeFocused();
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'true');
    // Dragged by its header (a real pointer), it moves and its rect persists in `regions`.
    const header = overview.locator('[data-overview-header]');
    const before = (await overview.boundingBox())!;
    const grip = (await header.boundingBox())!;
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await overview.boundingBox())!.y - before.y), { message: 'the header drags the panel' }).toBe(30);
    await expect.poll(async () => ((await layoutGet(page, 'regions')) as { overview: unknown }).overview, { message: 'the rect persists' }).not.toBeNull();
    expect(await overviewGroups(board)).toEqual({
      'Needs you': [FIX, SIP, QUOTA],
      MAWS: ['Charter + research'],
      codex_somersault: ['Somersault terminal run'],
      [USAGE_PROJECT]: ['Usage reset countdown', 'Settings idle probe'],
      [await localName(page)]: ['Terminal workflow notes'], // P5 O6 M5 (T3): its machine's, in place of "Other sessions"
    });
    const fixCard = board.getByRole('article', { name: FIX });
    await expect(fixCard.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(fixCard.getByRole('heading', { name: 'Run a command' })).toBeVisible(); // U1a §D: what is asked, in place of the tool's name
    const charterCard = board.getByRole('article', { name: 'Charter + research' });
    await expect(charterCard.getByTestId('card-activity')).toHaveText('Running bun test');
    await expect(charterCard).toContainText('ctx 41%');
    await expect(charterCard).toContainText('$0.00 since seen');
    await expect(charterCard).toContainText('2 agents');
    await expect(usageCard.getByTestId('card-activity')).toHaveText('Running curl -sI https://example.com | head -1');
    await expect(usageCard.getByTestId('card-answer')).toHaveText(/^The request succeeded/);
    const idleCard = board.getByRole('listitem', { name: USAGE_PROJECT }).getByRole('article', { name: 'Settings idle probe' });
    await expect(idleCard.getByTestId('card-activity')).toHaveText('Idle');
    await expect(idleCard.getByTestId('card-answer')).toHaveText(/^Settings loaded from user/);
    const foreignCard = board.getByRole('article', { name: 'Somersault terminal run' });
    await expect(foreignCard.getByTestId('card-activity')).toHaveText('Terminal · pid 7135');
    await expect(foreignCard.getByRole('button'), 'a foreign-live card holds no control').toHaveCount(0);
  });

  await test.step('Item 3 (U1a §H): the hover card on a shell command offers Allow once and Deny', async () => {
    const fixHover = await hoverRow(page, FIX);
    await expect(fixHover.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(fixHover).toContainText('/private/tmp/maws-probe-qqboLh');
    await expect(fixHover.getByRole('button', { name: 'Open session' })).toBeVisible();
    // a shell command the hover card shows whole may be allowed once from it, and any permission denied; neither pressed here
    await expect(fixHover.getByRole('button', { name: 'Allow once', exact: true }), 'a command shown whole').toBeVisible();
    await expect(fixHover.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await unhover(page, fixHover);
  });

  await test.step('Item 7: dark switches the whole shell', async () => {
    await menu(app, 'theme.dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => regionBackground(page)).toBe(tokens.dark['--bg']);
    await assertToolbarPlacement(page);
    await page.screenshot({ path: testInfo.outputPath('toolbar-dark.png') });
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (regions, rows, cards)').toEqual([]);
  });

  await test.step('Item 4: the read-only request arrives while the window is unfocused', async () => {
    await captureEvents(page);
    expect(await badge()).toBe('3');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isFocused())), 'the blur took').toBe(false);
    const blurredAt = Date.now();
    expect((await captured(page)).notified, 'nothing is announced before the blur and the 3 s entry').toEqual([]);
    await advanceTo(app, 3000);
    await expect.poll(async () => (await captured(page)).notified.length, { timeout: 5_000, message: 'attention.notified within 5 s' }).toBe(1);
    const [notified] = (await captured(page)).notified;
    expect(notified).toMatchObject({ appSessionId: CHARTER });
    expect(notified.receivedAt).toBeGreaterThanOrEqual(blurredAt);
    // The unsigned packaged app cannot post; the dev build posts only where macOS lets Electron (not on the owner's Mac yet).
    if (maws.packaged) expect(notified.delivery, 'the unsigned build falls back').toBe('fallback');
    else expect(['os', 'fallback']).toContain(notified.delivery);
    test.info().annotations.push({ type: 'notification delivery', description: `${notified.delivery} (${maws.packaged ? 'packaged' : 'dev build'})` });
    console.log(`[shell] attention.notified delivery: ${notified.delivery} (${maws.packaged ? 'packaged' : 'dev build'})`);
    if (notified.delivery === 'fallback') {
      // The toast's text, not the live region's announcement of it (F12 moved ToastHost out of the main region).
      await expect(page.getByText('Charter + research needs you · Read: docs/charter.md', { exact: true })).toBeVisible();
    }
    expect(await badge()).toBe('4');
    await closeProject(page, 'MAWS'); // W11: a project's counts show while it is collapsed
    await expect(projectRow(page, 'MAWS').getByLabel('3 waiting'), 'the new request counts on its project').toBeVisible();
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (toast)').toEqual([]);
  });

  await test.step('Item 3: approve the read-only request from its hover card, by pointer only', async () => {
    // Keyboard first: arrowing onto the session's row opens its hover card (W5: every session row has one), and Enter
    // on a focused Allow once answers nothing (§5.1: approval from the hover card is an explicit click).
    const charterDialog = page.getByRole('dialog', { name: 'Charter + research' });
    await (await sidebarRow(page, SIP)).focus();
    await page.keyboard.press('ArrowDown');
    await expect(await sidebarRow(page, 'Charter + research')).toBeFocused();
    await expect(charterDialog.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
    await charterDialog.getByRole('button', { name: 'Allow once', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(await badge(), 'Enter answered nothing').toBe('4');
    await (await sidebarRow(page, SIP)).focus();
    await page.locator('[data-region="main"]').hover({ position: { x: 400, y: 300 } });
    await expect(charterDialog).toHaveCount(0);

    const charterHover = await hoverRow(page, 'Charter + research');
    await expect(charterHover.getByTestId('request-input')).toHaveText(/\/docs\/charter\.md$/);
    await expect(charterHover.getByRole('button', { name: 'Deny' })).toBeVisible();
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (hover card)').toEqual([]);
    await charterHover.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(charterHover.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
    await closeProject(page, 'MAWS');
    await expect(projectRow(page, 'MAWS').getByLabel('2 waiting')).toBeVisible();
    await expect(board.getByRole('article', { name: 'Charter + research' }).getByTestId('card-activity')).toHaveText('Continuing');
    await expect.poll(badge).toBe('3');
  });

  await test.step('The 8 s entry: Usage reset countdown ends its turn while nobody looks at it', async () => {
    await advanceTo(app, 8000);
    const usageRow = await sidebarRow(page, 'Usage reset countdown');
    await expect(usageRow.getByRole('img', { name: 'Idle, unread' })).toBeVisible();
    await expect(usageRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
    await expect(usageCard.getByTestId('card-activity')).toHaveText('Idle');
    await expect(usageCard.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
    await overviewButton.click(); // the button closes it too
    await expect(overview).toHaveCount(0);
  });

  await test.step('Item 2: ⌘⇧J lands on the oldest Needs-you session', async () => {
    await menu(app, 'attention.next');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([FIX]);
    const fixTab = page.getByRole('tab', { name: FIX, exact: true });
    await expect(fixTab).toHaveAttribute('aria-selected', 'true');
    await expect(fixTab.getByRole('img', { name: 'Needs approval' })).toHaveText('◐');
    const panel = main.getByRole('tabpanel');
    // C6 registers the transcript slot: the session's transcript is mounted in place of C5's fallback.
    await expect(panel.locator('.transcript')).toHaveCount(1);
    await expect(panel.getByText('Transcript unavailable')).toHaveCount(0);
    await expect(panel.getByText('Approval needed')).toBeVisible();
    await expect(panel.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(panel.locator('[data-composer-frame]')).toBeAttached(); // C7: the composer fills its slot; its frame waits behind the docked card
    await expect(panel.getByRole('group', { name: 'Session status' })).toHaveCount(0); // W2: nothing sits under the composer

    await menu(app, 'theme.light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => regionBackground(page)).toBe(tokens.light['--bg']);
  });

  await test.step('Item 5: tabs, the split, drags', async () => {
    // I2: a plain click replaces the focused pane's session; ⌘-click opens a tab of its own
    await (await sidebarRow(page, SIP)).click({ modifiers: ['Meta'] });
    await (await sidebarRow(page, NORTH)).click({ modifiers: ['Meta'] });
    expect(await tabLabels(page, 'Open tabs')).toEqual(three);
    for (const n of [1, 2, 3]) {
      await menu(app, `tab.select:${n}`);
      await expect.poll(() => selectedTab(page, 'Open tabs'), { message: `⌘${n}` }).toBe(three[n - 1]);
    }
    await page.getByRole('tab', { name: three[2] }).focus();
    await page.keyboard.press('Control+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃Tab wraps' }).toBe(three[0]);
    await page.keyboard.press('Control+Shift+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃⇧Tab' }).toBe(three[2]);

    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(three.slice(0, 2));
    await menu(app, 'tab.reopen');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T restores the tab where it was' }).toEqual(three);
    expect(await selectedTab(page, 'Open tabs')).toBe(three[2]);

    await page.getByRole('tab', { name: three[1] }).click({ button: 'middle' });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'middle-click closes' }).toEqual([three[0], three[2]]);

    // ⌘0 floats the Overview over the session, which stays mounted behind it; Esc closes it and gives focus back.
    const shown = main.getByRole('tabpanel');
    // P3-F (tracker rows 200 and 264): a focus loss here reports the page's focus timeline and the window's state; in a
    // foreground run the app takes the front once first and says whether it got it (no credit when it did not)
    await activateForScene(app, 'overview-focus');
    const trace = await traceForeground(app, page);
    await trace.step('overview-focus', async () => {
      await menu(app, 'tab.overview');
      await expect(overview).toBeVisible();
      await expect(overview).toBeFocused();
    });
    await expect(shown.locator('.transcript')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(overview).toHaveCount(0);
    expect(await tabLabels(page, 'Open tabs'), 'the Overview is no tab').toEqual([three[0], three[2]]);

    // Drag a session tab onto the main region's right edge: the second pane opens with it.
    const mainBox = (await main.boundingBox())!;
    await drag(page, page.getByRole('tab', { name: three[0] }), { x: mainBox.x + mainBox.width - 24, y: mainBox.y + mainBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: 'the drop edge opens the split' }).toEqual([three[0]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([three[2]]);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toBeVisible();

    // ⌘\ moves the focused pane's active tab across; the pane it empties goes, and the split with it.
    await page.getByRole('tab', { name: three[2] }).click();
    await menu(app, 'pane.split');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘\\ moves the active tab, and the emptied pane collapses the split' }).toEqual([three[0], three[2]]);
    await expect(page.getByRole('tablist', { name: 'Right pane tabs' })).toHaveCount(0);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toHaveCount(0);

    // Closing the last tab leaves the main area empty, offering the Overview and a new session.
    await menu(app, 'tab.close');
    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([]);
    await expect(main.getByText('No open tabs')).toBeVisible();
    await menu(app, 'tab.reopen');
    await menu(app, 'tab.reopen');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T twice' }).toEqual([three[0], three[2]]);

    // A sidebar row dragged onto a tab strip opens its session there.
    const strip = page.getByRole('tablist', { name: 'Open tabs' });
    const stripBox = (await strip.boundingBox())!;
    await drag(page, await sidebarRow(page, 'Charter + research'), { x: stripBox.x + stripBox.width - 8, y: stripBox.y + stripBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the dropped row opens a tab' }).toEqual([three[0], three[2], 'Charter + research']);
    // The drag's press left keyboard focus on the sidebar row. The palette below hands focus back where it found it when
    // it closes after a keystroke, where it reads as the keyboard's and opens the row's hover card 300 ms later: on a slow
    // runner over the next palette, which then loses its Escape to the card. The dropped session's tab takes the focus.
    await page.getByRole('tab', { name: 'Charter + research' }).focus();
  });

  await test.step('Item 8: the ⌘K palette', async () => {
    await openPalette(app, page);
    await expect(palette).toBeVisible();
    const actions = palette.getByRole('group', { name: 'Actions' }).getByRole('option');
    // U6a: the palette lists every row but the fixed ones (a key its own editor handles is not an act to run)
    const ids = (Object.keys(ACTIONS) as ActionId[]).filter((id) => !(ACTIONS as ActionTable)[id].fixed);
    await expect(actions).toHaveCount(ids.length);
    const actionTexts = await actions.allTextContents();
    for (const [i, id] of ids.entries()) {
      const { title, chord } = ACTIONS[id] as { title: string; chord: string | null };
      expect(actionTexts[i], `${id} is listed with its chord`).toContain(title);
      if (chord) expect(actionTexts[i], `${id} is listed with its chord`).toContain(formatChord(chord));
    }
    await menu(app, 'theme.dark');
    await expect.poll(() => regionBackground(page)).toBe(tokens.dark['--bg']);
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (palette)').toEqual([]);
    await menu(app, 'theme.light');
    await expect.poll(() => regionBackground(page)).toBe(tokens.light['--bg']);
    expect(await noLeftovers(page, tokens.dark), 'no dark colour after switching back to light').toEqual([]);

    await page.keyboard.type('north');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toContainText(NORTH);
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⏎ opens it' }).toBe(three[2]);

    await openPalette(app, page);
    await page.keyboard.type('dark');
    await expect(palette.getByRole('group', { name: 'Actions' }).getByRole('option')).toHaveText([/^Appearance: Dark/]);
    await expect(palette.getByRole('group', { name: 'Sessions' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    await openPalette(app, page);
    await page.keyboard.type('north');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Meta+Enter');
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: '⌘⏎ opens it in the split' }).toEqual([three[2]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([three[0], 'Charter + research']);
  });

  await test.step('Item 6: sizes, the expanded project, the collapsed panel', async () => {
    // UX2's approved sidebar default is 240px; resize from there to its 200px floor, not from the former 300px.
    await dragBy(page, sidebar.getByRole('separator', { name: 'Resize sidebar' }), -40);
    await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '200');
    await showProjectList(page);
    const usageProjectId = await projectRow(page, USAGE_PROJECT).getAttribute('data-menu').then((menuId) => menuId!.slice('project:'.length));
    await closeProject(page, USAGE_PROJECT); // the 8 s entry left it expanded: the click below is the one that opens it
    await openProject(page, USAGE_PROJECT);
    // U13a (O-01, A1): a project click opens its row and changes no tab: the split stays as it was, and the title bar's
    // chip still names the project of the session in front, not the row clicked. Opening a MAWS session from the palette
    // brings its open tab to the front while the sidebar stays on the project.
    const projectChip = page.getByRole('banner').locator('[data-toolbar-project]');
    expect(await tabLabels(page, 'Left pane tabs'), 'the strip as it was').toEqual([three[0], 'Charter + research']);
    expect(await tabLabels(page, 'Right pane tabs')).toEqual([three[2]]);
    await expect(projectChip).toHaveText('MAWS');
    await openPalette(app, page);
    await page.keyboard.type('charter');
    await page.keyboard.press('Enter');
    await expect.poll(() => selectedTab(page, 'Left pane tabs')).toBe('Charter + research');
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([three[0], 'Charter + research']);
    expect(await tabLabels(page, 'Right pane tabs')).toEqual([three[2]]);
    await expect(projectChip).toHaveText('MAWS');
    // UX2 optional surfaces: explicitly open one in the restored session before resizing it. UX wave U8b (A5): the column
    // remembers two widths; Files is a reading tool, so it opens at 60 % of the room right of the sidebar, and the drag
    // moves that wide width alone (the narrow one stays automatic).
    await page.locator('[data-surface-row]').getByRole('button', { name: 'Files', exact: true }).click();
    const panelResizer = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
    await expect(panelResizer).toBeVisible();
    const panelWidth = Number(await panelResizer.getAttribute('aria-valuenow'));
    expect(panelWidth, 'Files opens at 60 % of the room').toBe(Math.round(((await page.evaluate(() => innerWidth)) - 200) * 0.6));
    await dragBy(page, panelResizer, panelWidth - 320);
    await expect(panelResizer).toHaveAttribute('aria-valuenow', '320');
    await expect.poll(() => layoutGet(page, 'panelTools.widths'), { message: 'the drag wrote the wide width alone' }).toEqual({ version: 1, wide: 320, narrow: null });
    await menu(app, 'panel.toggle'); // the column hides (Files stays a tab) and the session cards show
    await menu(app, 'panel.toggle'); // hide the cards
    await expect(panelResizer).toHaveCount(0);
    await expect.poll(async () => (await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0).toBe(0);

    await expect
      .poll(async () => {
        const regions = (await layoutGet(page, 'regions')) as { sidebar: { width: number; expandedProjects: string[] }; panel: { width: number; collapsed: boolean } };
        const main = (await layoutGet(page, 'main.tabs')) as { version: number; current: string; sets: Record<string, { panes: unknown[] }> };
        return [regions.sidebar.width, regions.panel.width, regions.panel.collapsed, regions.sidebar.expandedProjects.includes(usageProjectId), main.version, main.current, main.sets[main.current]?.panes.length];
      }, { message: 'the layout is written back' })
      .toEqual([200, 320, true, true, 3, 'none', 2]);
    // UX2 preserves the layout and adds only the surface-selection key and this session's Files refs; U13a stores the one
    // strip under the set `none`; UX wave U8b's first read writes its three keys (the lower groups, the two widths, the
    // cards' folds) at once.
    expect((await layoutList(page)).sort()).toEqual(['cards.open', 'main.tabs', `panel.${await addressed(page, CHARTER)}`, 'panel.pinned', 'panelTools.groups', 'panelTools.surfaces', 'panelTools.widths', 'regions', 'window.main'].sort());
  });

  expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  return {
    regions: await layoutGet(page, 'regions'),
    main: await layoutGet(page, 'main.tabs'),
    panelPinned: await layoutGet(page, 'panel.pinned'),
    surfaces: await layoutGet(page, 'panelTools.surfaces'),
    side: { groups: await layoutGet(page, 'panelTools.groups'), widths: await layoutGet(page, 'panelTools.widths'), cards: await layoutGet(page, 'cards.open') },
    keys: (await layoutList(page)).sort(),
    bounds: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
    left: await tabLabels(page, 'Left pane tabs'),
    right: await tabLabels(page, 'Right pane tabs'),
  };
}

async function relaunchedInstance(maws: MawsLaunch, saved: Saved): Promise<void> {
  const { app, page } = maws;
  const sidebar = page.locator('[data-region="sidebar"]');
  // W11: the sidebar opens with the projects expanded at quit.
  await expect(projectRow(page, USAGE_PROJECT)).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
  // W5: the app opens to the last active tab; the Overview stays closed until asked for.
  await expect(page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' })).toHaveCount(0);

  // The layout comes back as it was saved.
  await expect.poll(() => tabLabels(page, 'Left pane tabs'), { message: 'the tabs and the split are back' }).toEqual(saved.left);
  expect(await tabLabels(page, 'Right pane tabs')).toEqual(saved.right);
  await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '200');
  expect(await treeRows(projectRow(page, USAGE_PROJECT))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
  await expect(page.locator('[data-region="panel"]').getByRole('separator')).toHaveCount(0);
  expect((await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0, 'the panel stays collapsed').toBe(0);
  await page.waitForTimeout(500); // past the 250 ms write-back: hydration must not have rewritten anything
  expect(await layoutGet(page, 'regions')).toEqual(saved.regions);
  expect(await layoutGet(page, 'main.tabs')).toEqual(saved.main);
  expect(await layoutGet(page, 'panel.pinned')).toEqual(saved.panelPinned);
  // UX2's optional-surface selections/pins round-trip without resetting the established tab sets or preferences.
  expect(await layoutGet(page, 'panelTools.surfaces')).toEqual(saved.surfaces);
  // UX wave U8b: a second launch is no first read: the groups, the two widths and the folds are read as they were left
  expect({ groups: await layoutGet(page, 'panelTools.groups'), widths: await layoutGet(page, 'panelTools.widths'), cards: await layoutGet(page, 'cards.open') }).toEqual(saved.side);
  expect((await layoutList(page)).sort()).toEqual(saved.keys);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), 'the window bounds are restored').toEqual(saved.bounds);
  const file = JSON.parse(readFileSync(join(maws.userData, 'layout.json'), 'utf8')) as Record<string, unknown>;
  expect(file['window.main']).toMatchObject({ bounds: saved.bounds });

  // UX wave U8b (A5): the two widths after the relaunch. Files, a reading tool, opens at the wide width it was dragged to;
  // Background tasks, any other tool, at the narrow automatic 360 px; neither changes what is stored.
  const panelResizer = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
  await page.locator('[data-surface-row]').getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('[data-region="panel"] [data-surface="files"]')).toBeVisible();
  await expect(panelResizer, 'Files as wide as it was left').toHaveAttribute('aria-valuenow', '320');
  await openSurface(page, 'Background tasks');
  await expect(panelResizer, 'a narrow tool at its automatic width').toHaveAttribute('aria-valuenow', '360');
  expect(await layoutGet(page, 'panelTools.widths'), 'opening the tools wrote no width').toEqual(saved.side.widths);

  expect(maws.consoleErrors(), 'the relaunched console stays free of errors').toEqual([]);
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------

// Clicks an application-menu item in main, by the id `buildMenu` gives it (`tab.select:<n>` for the numbered tabs).
// UX wave U7a: a full-window picture for the owner's look, attached to the run's report and written nowhere else. The
// window takes the content size for the shot and goes back to the one it had, so the scene's own steps see what they saw.
async function attachWindowShot(maws: MawsLaunch, name: string, width: number, height: number): Promise<void> {
  const { app, page } = maws;
  const contentSize = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.getContentSize());
  const before = await contentSize();
  const resize = async ([w, h]: readonly number[]) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(w!, h!), [w, h] as const);
    await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h] as const);
    await page.waitForTimeout(300); // the layout settles at the new size
  };
  await resize([width, height]);
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });
  await resize(before);
}

async function menu(app: ElectronApplication, id: string): Promise<void> {
  const clicked = await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id} exists and is enabled`).toBe(true);
}

// The ⌘K palette opened from its menu item, its input holding focus before anything is typed: Radix moves focus into the
// dialog after it mounts, and a key sent before that is lost, so the query misses its first letters (P3-F, tracker row
// 264: `dark` was read as `ark`, listing `Appearance: Dark` and `Mark up`).
async function openPalette(app: ElectronApplication, page: Page): Promise<void> {
  await menu(app, 'palette.open');
  await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox')).toBeFocused();
}

// Plays the scenario's timeline up to `ms` (the manual clock, MAWS_SCENARIO_CLOCK=manual).
async function advanceTo(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): unknown } }).__maws_scenario;
    if (!scenario) throw new Error('no scenario clock: the app is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    return scenario.advanceTo(ms); // M5b fix round 2: on the daemon shape a relay to mawsd, awaited (D11)
  }, ms);
}

function collectStderr(app: ElectronApplication): () => string {
  let text = '';
  app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
  return () => text;
}

const quitLines = (stderr: string) => stderr.split('\n').filter((line) => line.startsWith('quit-guard:'));

async function captureEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const captured: Captured = { notified: [], navigate: [] };
    window.__maws_e2e = captured;
    window.maws.on('attention.notified', (payload) => captured.notified.push({ ...payload, receivedAt: Date.now() }));
    window.maws.on('attention.navigate', (payload) => captured.navigate.push(payload));
  });
}

const captured = (page: Page) => page.evaluate(() => window.__maws_e2e!);

const layoutGet = async (page: Page, key: 'regions' | 'main.tabs' | 'panel.pinned' | 'panelTools.surfaces' | 'sidebar.hidden' | 'panelTools.groups' | 'panelTools.widths' | 'cards.open') => {
  const result = await page.evaluate((key) => window.maws.invoke('layout.get', { key }), key);
  if (!result.ok) throw new Error(`layout.get ${key}: ${JSON.stringify(result.error)}`);
  return result.value.value;
};

// A key as main last wrote layout.json (UX wave U7: what a relaunch, or another build, reads)
const storedKey = (userData: string, key: string): unknown => (JSON.parse(readFileSync(join(userData, 'layout.json'), 'utf8')) as Record<string, unknown>)[key];

const layoutList = async (page: Page) => {
  const result = await page.evaluate(() => window.maws.invoke('layout.list', undefined));
  if (!result.ok) throw new Error(`layout.list: ${JSON.stringify(result.error)}`);
  return result.value.keys;
};


const treeRows = (scope: Locator) => scope.locator('[data-kind="session"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

// W11: the project rows, and each collapsed project's counts as they read on its line (◐ waiting, ● working).
const projectRows = (sidebar: Locator) => sidebar.locator('[data-kind="project"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const rollups = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="project"]')
    .evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [el.getAttribute('aria-label'), Array.from(el.querySelectorAll('[data-project-line] [aria-label$=" waiting"], [data-project-line] [aria-label$=" working"]')).map((n) => n.textContent).join('')])),
    );

const rowGlyphs = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="session"]')
    .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('aria-label'), el.querySelector('[role="img"]:not([aria-label="Worktree"]):not([aria-label="Pinned"]):not([aria-label="Unread"])')?.getAttribute('aria-label')])));

const unreadRows = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="session"]')
    .evaluateAll((els) => els.filter((el) => el.querySelector('[aria-label="Unread"]')).map((el) => el.getAttribute('aria-label')));

const overviewGroups = (board: Locator) =>
  board.evaluate((el) =>
    Object.fromEntries(
      Array.from(el.querySelectorAll(':scope > [role="listitem"]')).map((group) => [
        group.getAttribute('aria-label'),
        Array.from(group.querySelectorAll('article')).map((card) => card.getAttribute('aria-label')),
      ]),
    ),
  );

// What a strip holds, as mounted: under a page the strip is invisible, and under the Settings dialog everything outside
// the dialog is hidden from accessibility, so the tablist is found with its hidden kin too (UX wave U7b).
const tabLabels = (page: Page, strip: string) =>
  page
    .getByRole('tablist', { name: strip, includeHidden: true })
    .locator('[role="tab"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));

const selectedTab = (page: Page, strip: string) => page.getByRole('tablist', { name: strip, includeHidden: true }).locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label');

// Hovers a session's row (its project expanded, W11) with the pointer and returns its open hover card. The hover is
// retried from a neutral point: now and then, right after a Radix menu has closed, Chromium keeps the synthetic pointer's
// hover state stale and the row sees no pointerenter although it is the hit target (a fresh move in fixes it).
async function hoverRow(page: Page, title: string): Promise<Locator> {
  const card = page.getByRole('dialog', { name: title });
  const row = await sidebarRow(page, title);
  await expect(async () => {
    await page.mouse.move(700, 400);
    await row.hover();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }, `the hover card of ${title} opens`).toPass({ timeout: 10_000 });
  return card;
}

async function unhover(page: Page, card: Locator): Promise<void> {
  await page.locator('[data-region="main"]').hover({ position: { x: 400, y: 300 } });
  await expect(card).toHaveCount(0);
}

// A native HTML drag with the real pointer: press on the source, move in steps to the point, release.
async function drag(page: Page, source: Locator, to: { x: number; y: number }): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

// A resizer drag along x by `dx` pixels.
async function dragBy(page: Page, resizer: Locator, dx: number): Promise<void> {
  const box = (await resizer.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

// ---- themes ----------------------------------------------------------------------------------------------------------------

const COLOUR_TOKENS = [
  '--bg', '--bg-raised', '--bg-overlay', '--bg-hover', '--bg-active', '--border', '--border-strong', '--fg', '--fg-muted', '--fg-faint',
  '--accent', '--accent-soft', '--success', '--warning', '--danger', '--info', '--diff-add-bg', '--diff-del-bg',
] as const;
type Palette = Record<(typeof COLOUR_TOKENS)[number], string>;

// Every colour token resolved to its computed colour under each theme, by probing inside a `[data-theme]` element.
async function themeTokens(page: Page): Promise<{ light: Palette; dark: Palette }> {
  return page.evaluate((names) => {
    const resolve = (theme: string) => {
      const host = document.createElement('div');
      host.setAttribute('data-theme', theme);
      const probe = document.createElement('span');
      host.append(probe);
      document.body.append(host);
      const out: Record<string, string> = {};
      for (const name of names) {
        probe.style.color = `var(${name})`;
        out[name] = getComputedStyle(probe).color;
      }
      host.remove();
      return out;
    };
    return { light: resolve('light'), dark: resolve('dark') } as { light: Palette; dark: Palette };
  }, COLOUR_TOKENS);
}

// UX2 approved mockup mock.css:84: sidebar and main share --bg in either theme (architect-confirmed ruling).
const regionBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('[data-region="sidebar"]')!).backgroundColor);

// Elements (portals included: menus, the hover card, the palette, toasts) whose background, text or border colour is a
// colour only the other theme's tokens produce: a remnant of it. Returns the first few offenders, described.
async function noLeftovers(page: Page, other: Palette): Promise<string[]> {
  const themed = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const own = themed === 'dark' ? (await themeTokens(page)).dark : (await themeTokens(page)).light;
  const forbidden = [...new Set(Object.values(other))].filter((colour) => !Object.values(own).includes(colour));
  return page.evaluate((forbidden) => {
    const props = ['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el);
      for (const prop of props) {
        const value = style.getPropertyValue(prop);
        if (forbidden.includes(value)) {
          offenders.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${el.className} ${prop} ${value}`);
          break;
        }
      }
      if (offenders.length >= 8) break;
    }
    return offenders;
  }, forbidden);
}
