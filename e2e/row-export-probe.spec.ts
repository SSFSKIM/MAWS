// A free diagnostic probe for P3-H's Send to live run (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H; the
// ledger docs/doperpowers/ledgers/2026-10-16-P3-H.md): the live run's two attempts found the library row's menu open
// with no Export item, while main serves an HTML page pdf and png. This probe opens the same menu in the same scene (the
// seeded session's HTML page, imported as the host imports it) and records why, without any model or engine: no session
// is launched and nothing is sent. It records the window's console and page errors from launch; the first opening's
// menu after 5 s; a second opening after closing it; the artifact tab's header Export in the same window; the
// ExportItems fiber's hook state and memo cache; and every `library.exportFormats` the window asks, through a recording
// wrapper over `window.maws.invoke` tried before the first ask (the preload's contextBridge property is neither writable
// nor configurable, so on the built app it notes that refusal and the fiber's state is the evidence). Everything goes
// to `probe-log.txt` and screenshots under its scratch root, which is kept. It passes when the probe ran through; its
// findings are the log's.
//
// Opt-in only (it is evidence gathering, not acceptance), against a built out/:
//   MAWS_PROBE_ROW_EXPORT=1 pnpm exec playwright test e2e/row-export-probe.spec.ts
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type JSHandle, type Page } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { importSeeded, seedArtifact, seedTranscripts } from './support/maws-tools';

test.skip(process.env.MAWS_PROBE_ROW_EXPORT !== '1', 'the row Export probe runs only under MAWS_PROBE_ROW_EXPORT=1');

const TITLE = 'Harbor Tutoring — fall flyer';
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>${TITLE}</title></head>
<body style="font-family: Georgia, serif; margin: 48px"><h1>Harbor Tutoring</h1><p>After-school tutoring.</p></body></html>
`;

// The ExportItems fibers under the open menu: each one's hook values and its compiler memo cache, summarised.
const exportItemsState = (page: Page) =>
  page.evaluate(() => {
    const brief = (v: unknown): unknown => {
      if (v === undefined) return 'undefined';
      if (v === null || typeof v !== 'object') return typeof v === 'function' ? 'fn' : v;
      if (Array.isArray(v)) return v.length <= 8 && v.every((x) => x === null || typeof x !== 'object') ? v : `array(${v.length})`;
      if (typeof (v as { $$typeof?: unknown }).$$typeof === 'symbol') return 'react element';
      return `object{${Object.keys(v).slice(0, 6).join(',')}}`;
    };
    const menu = document.querySelector('[role="menu"]');
    if (menu === null) return 'no open menu';
    const key = Object.keys(menu).find((k) => k.startsWith('__reactFiber$'));
    if (key === undefined) return 'no React fiber on the menu node';
    interface Fiber {
      type: unknown;
      child: Fiber | null;
      sibling: Fiber | null;
      memoizedState: { memoizedState: unknown; next: unknown } | null;
      updateQueue: { memoCache?: { data: unknown[][] } } | null;
    }
    const top = (menu as unknown as Record<string, Fiber>)[key]!;
    const found: Fiber[] = [];
    const stack: Fiber[] = top.child ? [top.child] : [];
    while (stack.length > 0) {
      const fiber = stack.pop()!;
      if (typeof fiber.type === 'function' && (fiber.type as { name?: string }).name === 'ExportItems') found.push(fiber);
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return found.map((fiber) => {
      const hooks: unknown[] = [];
      for (let h = fiber.memoizedState as { memoizedState: unknown; next: unknown } | null; h !== null; h = h.next as typeof h) hooks.push(brief(h.memoizedState));
      return { hooks, memoCache: fiber.updateQueue?.memoCache?.data.map((slots) => slots.map(brief)) ?? 'none' };
    });
  });

test('the library row menu’s Export in the Send to scene: first opening, a second opening, the tab header’s Export, the hook’s state and the asks', async () => {
  test.setTimeout(240_000);
  const root = realpathSync(mkdtempSync('/tmp/maws-p3h-row-export-probe-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [home, repo, userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# Harbor Tutoring\n');
  const logFile = join(root, 'probe-log.txt');
  const note = (line: string) => {
    appendFileSync(logFile, `${line}\n`);
    console.log(line);
  };
  let shots = 0;
  let engineId = '';
  let maws: MawsLaunch | null = null;
  note(`==== P3-H row Export probe, ${new Date().toISOString()}; scratch ${root}; no session launched, nothing sent`);
  try {
    maws = await launchMaws({
      userData,
      env: { MAWS_HARNESS: '0', HOME: home, DISABLE_AUTOUPDATER: '1' },
      prepare: ({ claudeConfigDir }) => {
        writeFileSync(join(claudeConfigDir, 'settings.json'), '{}\n');
        writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
        [engineId] = seedTranscripts(claudeConfigDir, repo, ['P3-H probe: the flyer']) as [string];
      },
    });
    const { page } = maws;
    const electronApp = maws.app;
    page.on('console', (message) => note(`  [console.${message.type()}] ${message.text().slice(0, 600)}`));
    page.on('pageerror', (error) => note(`  [pageerror] ${error.stack ?? error.message}`));
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));

    const screenshot = async (label: string) => {
      const file = join(root, `${String(++shots).padStart(2, '0')}-${label}.png`);
      const win = (await electronApp.browserWindow(page)) as JSHandle<BrowserWindow>;
      const png = await win.evaluate(async (w) => {
        const image = await w.webContents.capturePage();
        return image.isEmpty() ? '' : image.toPNG().toString('base64');
      });
      if (png !== '') writeFileSync(file, Buffer.from(png, 'base64'));
      else await page.screenshot({ path: file });
      return file;
    };
    const menuState = async (label: string) => {
      const menus = page.locator('[role="menu"]');
      const snapshots: string[] = [];
      for (let i = 0, n = await menus.count(); i < n; i++) snapshots.push(await menus.nth(i).ariaSnapshot({ timeout: 2_000 }));
      note(`${label}: ${snapshots.length} open menu(s)${snapshots.map((s) => `\n${s.replace(/^/gm, '    ')}`).join('')}`);
      note(`  ExportItems fiber: ${JSON.stringify(await exportItemsState(page))}`);
      note(`  screenshot ${await screenshot(label)}`);
    };

    // ---- the scene: the seeded session's HTML page, imported as at a host start (no session launched) ---------------
    let id = '' as AppSessionId;
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        id = (sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '') as AppSessionId;
        return id !== '';
      }, { timeout: 30_000 })
      .toBe(true);
    const record = seedArtifact(userData, id, 'flyer', TITLE, [PAGE], new Date(Date.now() - 3_600_000).toISOString());
    await importSeeded(page);
    const row = value(await invoke(page, 'library.get', { artifactId: record.id })).row;
    note(`artifact ${record.id} kind ${row?.kind} revision ${row?.revision}, created by ${JSON.stringify(row?.createdBy)}`);

    // ---- every library.exportFormats the window asks, recorded before the first ask --------------------------------
    note(`invoke recorder: ${await page.evaluate(() => {
      const w = window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> }; __exportAsks: unknown[] };
      const descriptor = Object.getOwnPropertyDescriptor(window, 'maws');
      const original = w.maws;
      w.__exportAsks = [];
      const wrapped = {
        ...original,
        invoke: (name: string, input: unknown) => {
          const pending = original.invoke(name, input);
          if (name === 'library.exportFormats') {
            const ask = { at: performance.now(), input, settled: 'pending' as string, answer: null as unknown };
            w.__exportAsks.push(ask);
            pending.then(
              (answer) => Object.assign(ask, { settled: 'resolved', answer }),
              (error: unknown) => Object.assign(ask, { settled: 'rejected', answer: String(error) }),
            );
          }
          return pending;
        },
      };
      try {
        Object.defineProperty(window, 'maws', { value: wrapped, configurable: true, writable: true });
      } catch (error) {
        return `not installed (${String(error)}; descriptor ${JSON.stringify({ writable: descriptor?.writable, configurable: descriptor?.configurable })})`;
      }
      return w.maws === wrapped ? 'installed' : `not installed (window.maws unchanged; descriptor ${JSON.stringify({ writable: descriptor?.writable, configurable: descriptor?.configurable })})`;
    })}`);
    const asks = async (label: string) => note(`${label}: library.exportFormats asks ${JSON.stringify(await page.evaluate(() => (window as unknown as { __exportAsks?: unknown[] }).__exportAsks ?? 'no recorder'))}`);

    // ---- 1. the first opening, after 5 s --------------------------------------------------------------------------
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    const article = page.locator('[data-library]').getByRole('article', { name: TITLE, exact: true });
    await expect(article).toBeVisible({ timeout: 30_000 });
    const actions = article.getByRole('button', { name: `Actions for ${TITLE}` });
    await actions.click();
    await expect(page.getByRole('menu', { name: `Actions for ${TITLE}` })).toBeVisible();
    await page.waitForTimeout(5_000);
    await menuState('first-opening-after-5s');
    await asks('after the first opening');
    const exportItem = page.getByRole('menuitem', { name: 'Export', exact: true });
    note(`  Export item on the first opening: ${await exportItem.count()}`);

    // ---- 2. closed and opened again -------------------------------------------------------------------------------
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await actions.click();
    await expect(page.getByRole('menu', { name: `Actions for ${TITLE}` })).toBeVisible();
    await page.waitForTimeout(1_000);
    await menuState('second-opening-after-1s');
    note(`  Export item on the second opening: ${await exportItem.count()}`);
    await asks('after the second opening');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // ---- 3. the control in the same window: the artifact's tab header Export (opened, never chosen) ----------------
    await article.locator('[data-part="title"]').click();
    await expect(page.locator(`[data-region="main"] [data-artifact-tab="${record.id}"] [data-artifact-viewer]`)).toBeVisible({ timeout: 30_000 });
    const header = page.locator('[data-region="main"] [data-editor-header]');
    await expect(header).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const headerExport = header.getByRole('button', { name: 'Export', exact: true });
    note(`header Export button: ${await headerExport.count()}`);
    if ((await headerExport.count()) > 0) {
      await headerExport.click();
      await page.waitForTimeout(1_000);
      await menuState('header-export-menu');
      await page.keyboard.press('Escape');
    } else {
      note(`  screenshot ${await screenshot('header-without-export')}`);
    }
    await asks('at the end');

    // ---- no engine: no session launched, no journal written ---------------------------------------------------------
    const status = await invoke(page, 'session.status', { appSessionId: id });
    const journalDir = join(userData, 'engine-host', 'journal');
    const journals = existsSync(journalDir) ? readdirSync(journalDir) : [];
    note(`no engine: session.status ${JSON.stringify(status.ok ? { process: status.value.process, pid: status.value.pid, journalPath: status.value.journalPath } : status.error)}; engine-host/journal entries ${JSON.stringify(journals)}`);
    note(`the window's console errors since load: ${JSON.stringify(maws.consoleErrors())}`);
    note(`scratch kept: ${root}`);
  } finally {
    if (maws !== null) await maws.cleanup();
  }
});
