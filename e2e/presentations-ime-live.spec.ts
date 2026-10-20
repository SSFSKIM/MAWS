// P4-B2's spike S-IME, its live half: the harness the real Mac's run drives (docs/doperpowers/plans/2026-10-19-
// p4-smoothing.md §4.4, §4.10; research/p4-ux-prior-art.md §2.4 L1 to L8; spikes/p4-click-model/cua-live.js and
// findings.txt). It runs only with MAWS_IME_LIVE=1, in a GUI hold: the app comes up foreground (its window key, as an
// owner's launch), and for each case the spec prepares the deck, writes `<dir>/<case>.ready.json` with where to press,
// waits for the driver (cua_repl, keys at the HID level through the Korean 2-Set input method) to write
// `<dir>/<case>.done`, then records what the page saw (the trace, the model, the clipboard) in `<dir>/<case>.result.json`.
// L1's trace becomes the fixture the simulated cases replay (e2e/fixtures/ime/l1-hangul.json).
//
//   MAWS_IME_LIVE=1 [MAWS_IME_LIVE_DIR=/tmp/maws-ime-live] [MAWS_IME_LIVE_CASES=L0,L1,…] [MAWS_IME_LIVE_MODE=clear|select]
//     node_modules/.bin/playwright test e2e/presentations-ime-live.spec.ts   (after scripts/e2e-build.sh plain)
//
// The window fills the display's work area with the sidebar and the panel collapsed, so the slide is drawn at about half
// size or more (in the simulated spec's 1600 × 1000 window it is 256 px wide, where a 9 px handle covers 70 slide px).
// MAWS_IME_LIVE_DRY=1 checks the harness itself with no driver and no GUI: the window stays quiet, each case's done file
// is written by the spec at once, and nothing is judged (the ready and result files are, for reading).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { withNativeClipboard } from './support/clipboard';
import { startTrace, stopTrace, type ImeTrace, type TraceEvent } from './support/ime';
import { launchMaws, type MawsLaunch } from './support/launch';

const LIVE = process.env.MAWS_IME_LIVE === '1';
const DIR = process.env.MAWS_IME_LIVE_DIR ?? '/tmp/maws-ime-live';
const MODE: 'clear' | 'select' = process.env.MAWS_IME_LIVE_MODE === 'select' ? 'select' : 'clear';
// L8 first: it makes no native edit, so it runs while the page's (Blink's) undo stack is still empty, which the Edit menu's
// Undo turns on (findings.txt finding 1); a case that composes or types natively fills it
const CASES = (process.env.MAWS_IME_LIVE_CASES ?? 'L8,L0,L1,L2,L3,L4,L5,L6,L7').split(',').map((c) => c.trim());
const WAIT_MS = 15 * 60_000; // per case, for the driver
const DRY = process.env.MAWS_IME_LIVE_DRY === '1';
const MIN_FRAME_PX = 800; // the slide's drawn width the cases' targets need (a scale of about 0.42)

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
interface ElementIR {
  id: string;
  style: Record<string, string>;
  children: ElementIR[];
  text?: { inline: ({ text: string; marks: Record<string, unknown> } | { br: true })[] }[];
}
interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<unknown>;
    slide(artifactId: string, slideId: string): Promise<{ children: ElementIR[] }>;
    armed(mode: 'clear' | 'select' | null): void;
    editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null }[];
  };
}

const DECK: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, title: 'IME live', cover: 'ime', order: ['ime'] }),
  'project/slides/ime.html': `<section id="ime" style="background:#ffffff; padding:128px">
<p id="a" style="position:absolute; left:200px; top:200px; width:700px; font-size:64px">Hello</p>
<p id="b" style="position:absolute; left:1000px; top:200px; width:700px; font-size:64px"><b>World</b></p>
<x-shape id="s" kind="ellipse" style="position:absolute; left:1000px; top:500px; width:300px; height:200px; background:#0000ff"></x-shape>
<aside>Notes</aside>
</section>`,
};

/** What the driver does for each case, in words; spikes/p4-click-model/cua-live.js has the steps as code. */
const STEPS: Record<string, string> = {
  L0: 'Instrument check: click `notes`; with 2-Set selected press g, k, s; then Escape. Passes when the notes field ends in 한 (cua keys reach the input method).',
  L1: 'Click `a`; wait 300 ms; press g k s r m f; wait 300 ms; click `empty`.',
  L2: 'Click `b` (its text one bold run); wait 300 ms; press g k s k; wait 300 ms; click `empty`.',
  L3: 'Select ABC first. Click `a`; wait 300 ms; press ctrl+space (to 2-Set); wait 300 ms; press g k s r m f; wait 300 ms; click `empty`.',
  L4: 'With nothing selected for a second: in one cua call click `a` and press g k s r m f at once; wait 300 ms; click `empty`.',
  L5: 'Click `a`; wait 300 ms; press g k; click `b`; wait 300 ms; press k; wait 300 ms; click `empty`.',
  L6: 'Click `a`; wait 300 ms; press g k s, BackSpace, Left, Right, g k, Return; wait 300 ms; press Escape twice.',
  L7: 'Click `a`; wait 300 ms; press g k s, then alt+Return; wait 800 ms; screenshot (the Hanja window should open at `a`); Escape; click `empty`. Write the verdict into the done file.',
  L8: 'Click `a`; wait 300 ms; screenshot (a selected: the mapping holds); then cmd+c; Right; wait 1200 ms; Right; wait 300 ms; cmd+z; cmd+v; wait 500 ms; then the Edit menu with the mouse: Undo; Escape, then Tab (back from the pasted copy to `a`, the first element of the slide, which a press could not reach: the copy covers it); Copy; Paste; Undo. The spec puts a probe Edit menu in place for the case: the same five items, each noting itself and then doing what the role item does.',
};

let launch: MawsLaunch | null = null;
test.afterAll(async () => {
  await launch?.cleanup();
  launch = null;
});

test.describe('the real Mac’s input method on the ARMED prototype (L0 to L8)', () => {
  test.skip(!LIVE, 'MAWS_IME_LIVE=1 only, in a GUI hold (spikes/p4-click-model/findings.txt)');
  test.describe.configure({ mode: 'serial' });

  let page: Page;
  let id: string;
  const plain = (e: ElementIR | undefined) => (e?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');
  const slide = () => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.slide(a, 'ime'), id);
  const element = async (eid: string) => (await slide()).children.find((c) => c.id === eid);

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });
    launch = await launchMaws({ env: DRY ? {} : { MAWS_E2E_FOREGROUND: '1', MAWS_E2E_QUIET: '0' } });
    page = launch.page;
    await launch.app.evaluate(({ BrowserWindow, app, screen }, dry) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setBounds(screen.getPrimaryDisplay().workArea);
      if (dry) return;
      app.focus({ steal: true });
      win.focus();
    }, DRY);
    await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000 }).toBe('ready');
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations)).toBe('object');
    ({
      artifact: { id },
    } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'IME live' }));
    await page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, DECK] as const);
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.locator('[data-library]').getByRole('article', { name: 'IME live', exact: true }).click();
    await expect(page.locator(`[data-region="main"] [data-artifact-tab="${id}"] [data-deck-editor]`)).toBeVisible({ timeout: 15_000 });
    // the sidebar and the panel collapsed, through the View menu's items (the shell's own actions)
    for (const action of ['sidebar.toggle', 'panel.toggle']) await launch.app.evaluate(({ Menu }, a) => Menu.getApplicationMenu()?.getMenuItemById(a)?.click(), action);
    const frame = page.locator(`[data-region="main"] [data-artifact-tab="${id}"] [data-stage-slide]`);
    await expect
      .poll(async () => (await frame.boundingBox())?.width ?? 0, { message: `the slide is drawn at least ${MIN_FRAME_PX} px wide (a bigger display, or the inspector closed)` })
      .toBeGreaterThanOrEqual(MIN_FRAME_PX);
  });

  for (const name of CASES) {
    test(`${name}: ${STEPS[name] ?? 'unknown case'}`, async () => {
      test.setTimeout(WAIT_MS + 120_000);
      const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
      // the deck as seeded, nothing selected, the prototype on, the stage focused
      await page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, DECK] as const);
      await page.evaluate((m) => (window as unknown as Seam).__maws_presentations.armed(m), name === 'L0' ? null : MODE);
      await expect(tab.locator('[data-stage-slide="ime"] [data-eid="a"]')).toHaveText('Hello');
      await page.keyboard.press('Escape');
      await tab.locator('[data-stage-surface]').focus();
      const where = await targets(page, tab.locator('[data-stage-slide]'));
      for (const f of ['ready.json', 'done', 'result.json']) rmSync(join(DIR, `${name}.${f}`), { force: true });
      const run = async () => {
        await startTrace(page);
        writeFileSync(join(DIR, `${name}.ready.json`), JSON.stringify({ case: name, mode: MODE, steps: STEPS[name], ...where }, null, 1));
        if (DRY) writeFileSync(join(DIR, `${name}.done`), 'dry run: no driver\n');
        await expect.poll(() => existsSync(join(DIR, `${name}.done`)), { timeout: WAIT_MS, intervals: [250] }).toBe(true);
        await page.waitForTimeout(500);
        return stopTrace(page);
      };
      // L8 copies through the Mac's pasteboard: what it held comes back after the case (e2e/support/clipboard.ts). Its
      // Edit menu is a probe: the role items' effects (webContents' undo, copy, paste: what their selectors reach,
      // render_widget_host_view_cocoa.mm undo:, copy:, paste:), each noted in the order it fires, so the case can tell
      // whether a ⌘ key the box cancelled reached the menu (an Undo of the deck's stack via the menu does nothing while
      // Blink's own undo stack is empty, findings.txt finding 1, so the effect alone cannot tell).
      let menu: string[] = [];
      if (name === 'L8') await probeMenu();
      const events = name === 'L8' ? await withNativeClipboard(launch!.app, ['Hello', ''], run).finally(async () => (menu = await restoreMenu())) : await run();
      const out = await outcome(name, events, menu);
      writeFileSync(join(DIR, `${name}.result.json`), JSON.stringify({ case: name, mode: MODE, ...out, events }, null, 1));
      if (DRY) return;
      if (name === 'L1') await writeFixture(events, out);
      for (const [label, [got, want]] of Object.entries(out.checks)) expect.soft(got, `${name} ${label}`).toEqual(want);
    });
  }

  // What each case is judged by: [what happened, what the case expects], and the facts the findings quote.
  async function probeMenu(): Promise<void> {
    await launch!.app.evaluate(({ Menu, BrowserWindow }) => {
      const g = globalThis as unknown as { __menuOrder: string[]; __menu: { saved: Electron.Menu | null; set: typeof Menu.setApplicationMenu } };
      g.__menuOrder = [];
      g.__menu = { saved: Menu.getApplicationMenu(), set: Menu.setApplicationMenu.bind(Menu) };
      const act = (name: 'undo' | 'redo' | 'cut' | 'copy' | 'paste') => () => {
        g.__menuOrder.push(name);
        (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents[name]();
      };
      g.__menu.set(
        Menu.buildFromTemplate([
          { label: 'MAWS', submenu: [{ role: 'quit' }] },
          {
            label: 'Edit',
            submenu: [
              { label: 'Undo', accelerator: 'Cmd+Z', click: act('undo') },
              { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: act('redo') },
              { type: 'separator' },
              { label: 'Cut', accelerator: 'Cmd+X', click: act('cut') },
              { label: 'Copy', accelerator: 'Cmd+C', click: act('copy') },
              { label: 'Paste', accelerator: 'Cmd+V', click: act('paste') },
            ],
          },
        ]),
      );
      Menu.setApplicationMenu = () => {}; // main reinstalls its menu as the page's actions change: not during the case
    });
  }
  async function restoreMenu(): Promise<string[]> {
    return launch!.app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { __menuOrder: string[]; __menu: { saved: Electron.Menu | null; set: typeof Menu.setApplicationMenu } };
      Menu.setApplicationMenu = g.__menu.set;
      Menu.setApplicationMenu(g.__menu.saved);
      return g.__menuOrder;
    });
  }

  async function outcome(name: string, events: TraceEvent[], menu: string[] = []): Promise<{ checks: Record<string, [unknown, unknown]>; facts: Record<string, unknown> }> {
    const a = plain(await element('a'));
    const b = plain(await element('b'));
    const keys = events.filter((e) => e.type === 'keydown');
    const firstKey = keys[0];
    const press = events.find((e) => e.type === 'pointerdown');
    const start = events.find((e) => e.type === 'compositionstart');
    const facts: Record<string, unknown> = {
      a,
      b,
      elements: (await slide()).children.length,
      left: (await element('a'))?.style.left,
      state: (await page.evaluate((x) => (window as unknown as Seam).__maws_presentations.editorState(x), id))[0],
      firstKey: firstKey && { key: firstKey.key, keyCode: firstKey.keyCode, isComposing: firstKey.isComposing, textBefore: firstKey.textBefore, textAfter: firstKey.textAfter },
      pressToFirstKeyMs: press && firstKey ? Math.round((firstKey.t - press.t) * 10) / 10 : null,
      compositionStartText: start?.textBefore,
      focusChanges: events.filter((e) => e.type === 'focusin' || e.type === 'focusout').map((e) => `${e.type} ${e.target} @${e.t}`),
    };
    const checks: Record<string, [unknown, unknown]> = {};
    if (name === 'L0') {
      const notes = await page.locator('.deck-notes-field').first().inputValue();
      facts.notes = notes;
      checks['the keys reach the input method'] = [/한$/.test(notes) || keys.some((k) => k.keyCode === 229), true];
    } else if (name === 'L1' || name === 'L3' || name === 'L4') {
      checks['a reads 한글'] = [a.normalize('NFC'), '한글'];
      checks['no bare jamo'] = [/[ㄱ-ㆎ]/.test(a), false];
      if (name === 'L1') {
        checks['Q2: the first keydown is keyCode 229, not composing'] = [firstKey && [firstKey.keyCode, firstKey.isComposing], [229, false]];
        checks['Q2: the composition starts on cleared content'] = [start?.textBefore, MODE === 'clear' ? '' : 'Hello'];
      }
    } else if (name === 'L2') {
      // a cleared box whose text was one bold run: mode clear sets the marks as stored marks, and ProseMirror then redraws
      // the cursor's mark wrapper at compositionstart (findings.txt Q2): the real input method's first syllable through it
      facts.runs = (await element('b'))?.text?.flatMap((blk) => blk.inline);
      checks['b reads 하나'] = [b.normalize('NFC'), '하나'];
      checks['b stays bold'] = [facts.runs, [{ text: '하나', marks: { b: {} } }]];
    }
    else if (name === 'L5') {
      checks['a keeps 하'] = [a.normalize('NFC'), '하'];
      checks['b gets a fresh ㅏ, no stray jamo'] = [b.normalize('NFC'), 'ㅏ'];
    } else if (name === 'L6') {
      checks['a begins 하하'] = [a.normalize('NFC').startsWith('하하'), true];
      checks['the element kept and not moved'] = [[facts.elements, facts.left], [3, '200px']];
    } else if (name === 'L7') {
      checks['a reads 한 or its Hanja'] = [a.length, 1];
    } else if (name === 'L8') {
      facts.menu = menu;
      facts.historyUndo = events.filter((e) => e.type === 'beforeinput' && e.inputType === 'historyUndo').length;
      facts.clipboard = events.filter((e) => e.type === 'copy' || e.type === 'paste' || e.type === 'cut').map((e) => `${e.type} ${e.target} prevented=${e.defaultPrevented}`);
      checks['a keeps Hello'] = [a, 'Hello'];
      checks['⌘Z undid one nudge, in the box'] = [facts.left, '201px'];
      // the keyboard's paste copied a at 200 (⌘C came before the nudges), the mouse's a at 201, each pasted 24 px on;
      // another left means the mouse's Copy took another element than a (the reselect missed)
      facts.pasted = (await slide()).children.filter((c) => !['a', 'b', 's'].includes(c.id)).map((c) => c.style.left).sort();
      checks['the pastes are copies of a, at 200 and at 201'] = [facts.pasted, ['224px', '225px']];
      // ⌘C and ⌘V left to the menu reach it; the ⌘Z the box cancelled does not; then the mouse's Undo, Copy, Paste, Undo
      checks['Q3: the menu saw ⌘C and ⌘V, not ⌘Z, then the mouse'] = [menu, ['copy', 'paste', 'undo', 'copy', 'paste', 'undo']];
      // finding 1's gap: the menu's Undo does nothing to the deck while Blink's own undo stack is empty, so both pastes stay
      checks['the Edit menu’s Undo left both pastes (today’s gap)'] = [[facts.elements, facts.historyUndo], [5, 0]];
    }
    return { checks, facts };
  }

  async function writeFixture(events: TraceEvent[], out: { checks: Record<string, [unknown, unknown]> }) {
    const read = (cmd: string, args: string[]) => {
      try {
        return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
      } catch {
        return undefined;
      }
    };
    const passed = Object.values(out.checks).every(([got, want]) => JSON.stringify(got) === JSON.stringify(want));
    const trace: ImeTrace = {
      source: 'live-hid',
      case: 'L1',
      recordedAt: new Date().toISOString(),
      host: hostname(),
      macos: read('sw_vers', ['-productVersion']),
      inputSource: read('defaults', ['read', 'com.apple.HIToolbox', 'AppleSelectedInputSources'])?.replace(/\s+/g, ' '),
      ...(await launch!.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }))),
      mode: MODE,
      notes: passed ? 'L1 passed on the real Mac.' : 'L1 did not pass on the real Mac; see the run’s result file.',
      events,
    };
    writeFileSync(join(DIR, 'l1-hangul.json'), `${JSON.stringify(trace, null, 1)}\n`);
  }
});

/** Where the driver presses: page px, window points and screen points (the window's frame and content from main). */
async function targets(page: Page, frame: ReturnType<Page['locator']>) {
  const box = (await frame.boundingBox())!;
  const scale = box.width / 1920;
  const at = (x: number, y: number) => ({ x: Math.round(box.x + x * scale), y: Math.round(box.y + y * scale) });
  const notes = await page.locator('.deck-notes-field').first().boundingBox();
  const page_ = { a: at(260, 250), b: at(1060, 250), empty: at(100, 1000), shape: at(1150, 600), notes: notes ? { x: Math.round(notes.x + 40), y: Math.round(notes.y + notes.height / 2) } : null };
  const win = await page.evaluate(() => ({ outerX: screenX, outerY: screenY, outerW: outerWidth, outerH: outerHeight, innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio }));
  return {
    page: page_,
    scale,
    window: win,
    note: 'page px are CSS px from the content’s top-left; on macOS the content sits at the window’s top-left (MAWS hides the title bar), so window points = page px at zoom 1. Calibrate cua’s coordinate space with the L0 step before L1.',
  };
}
