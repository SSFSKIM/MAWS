// P4-B2's live IME cases, the harness the real Mac's run drives (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md
// D11; the P4 spec's §4.4 and §4.10; research/p4-ux-prior-art.md §2.4 L1 to L8; spikes/p4-click-model/cua-live.js and
// findings.txt), on ARMED as the state machine builds it (unconditional, its first key replacing the text). It runs only
// with MAWS_IME_LIVE=1, in a GUI hold: the app comes up foreground (its window key, as an owner's launch), and for each
// case the spec prepares the deck, has the case's presses and keys made, then records what the page saw (the trace, the
// model, the clipboard) in `<dir>/<case>.result.json`. L1's trace becomes the fixture the simulated cases replay
// (e2e/fixtures/ime/l1-hangul.json). Two drivers:
// - cua's engine keystroke probe (MAWS_IME_PROBE_CMD set): the spec drives itself. Its presses are Playwright's; its keys
//   go through the probe, which posts plain macOS key codes (no flags, no Unicode string) at the HID tap to the front
//   window, so the Korean 2-Set input method composes them as a keyboard's. MAWS_IME_PROBE_CMD is the JSON array the
//   probe's arguments follow, `{out}` and `{err}` standing for the call's own files; through LaunchServices, so the
//   approved app is its own responsible process (its grants apply only then), and with -W so the call returns when the
//   probe has exited (its report is the last JSON line of `{out}`):
//     MAWS_IME_PROBE_CMD='["/usr/bin/open","-n","-g","-W","--stdout","{out}","--stderr","{err}","-a",
//       "/Users/new/Library/Application Support/cua/engine/cua Engine.app","--args"]'
//   Each case's needs (PROBE_CASES): `ansi` (--ansi-keys, any build), `keys` (--keys with named keys and alt+, hold 2a's
//   build; MAWS_IME_PROBE_KEYS=0 when the build lacks it), `source` (--probe input-source, per-context input off). L0, the
//   r-then-k gate in the notes field, runs first: unless it composes 가, the slot stops there. 2-Set is selected at the
//   start and ABC put back at the end, each read back. L8 is the other driver's (it passed in the mini's 10-20 hold).
// - a driver outside (cua_repl, or the owner's hands): for each case the spec writes `<dir>/<case>.ready.json` with where
//   to press and waits for `<dir>/<case>.done`.
//
//   MAWS_IME_LIVE=1 [MAWS_IME_LIVE_DIR=/tmp/maws-ime-live] [MAWS_IME_LIVE_CASES=L0,L1,…] [MAWS_IME_PROBE_CMD=…]
//     node_modules/.bin/playwright test e2e/presentations-ime-live.spec.ts   (after scripts/e2e-build.sh plain)
//
// The window fills the display's work area with the sidebar and the panel collapsed, so the slide is drawn at about half
// size or more (in the simulated spec's 1600 × 1000 window it is 256 px wide, where a 9 px handle covers 70 slide px).
// MAWS_IME_LIVE_DRY=1 checks the harness itself with no driver and no GUI: the window stays quiet, each case's done file
// is written by the spec at once, and nothing is judged (the ready and result files are, for reading).
import { hideSurfaces } from './support/shell';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { withNativeClipboard } from './support/clipboard';
import { startTrace, stopTrace, type ImeTrace, type TraceEvent } from './support/ime';
import { launchMaws, type MawsLaunch } from './support/launch';

const LIVE = process.env.MAWS_IME_LIVE === '1';
const DIR = process.env.MAWS_IME_LIVE_DIR ?? '/tmp/maws-ime-live';
const POLICY = 'replace'; // ARMED_TYPING (src/artifacts/slides/editor/armed.ts), recorded with each result
const PROBE: string[] | null = process.env.MAWS_IME_PROBE_CMD ? (JSON.parse(process.env.MAWS_IME_PROBE_CMD) as string[]) : null;
const PROBE_KEYS = process.env.MAWS_IME_PROBE_KEYS !== '0';
// L8 first with a driver outside: it makes no native edit, so it runs while the page's (Blink's) undo stack is still
// empty (findings.txt finding 1); a case that composes or types natively fills it. The probe's slot starts at L0's gate.
const CASES = (process.env.MAWS_IME_LIVE_CASES ?? (PROBE ? 'L0,L1,L2,L3,L4,L5,L6,L7' : 'L8,L0,L1,L2,L3,L4,L5,L6,L7')).split(',').map((c) => c.trim());
const WAIT_MS = 15 * 60_000; // per case, for the driver
const DRY = process.env.MAWS_IME_LIVE_DRY === '1';
const MIN_FRAME_PX = 800; // the slide's drawn width the cases' targets need (a scale of about 0.42)
const L4_ATTEMPTS = 3; // L4 under the probe: the tries in all for keys landing within 100 ms of the press

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
    editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }[];
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
  L0: PROBE
    ? 'The r-then-k gate: click `notes`; with 2-Set selected the probe posts r, k. Passes when the notes field ends in 가 (the probe’s keys reach the input method); otherwise the slot stops.'
    : 'Instrument check: click `notes`; with 2-Set selected press g, k, s; then Escape. Passes when the notes field ends in 한 (cua keys reach the input method).',
  L1: 'Click `a`; wait 300 ms; press g k s r m f; wait 300 ms; click `empty`.',
  L2: 'Click `b` (its text one bold run); wait 300 ms; press g k s k; wait 300 ms; click `empty`.',
  L3: 'Select ABC first. Click `a`; wait 300 ms; press ctrl+space (to 2-Set); wait 300 ms; press g k s r m f; wait 300 ms; click `empty`.',
  L4: 'With nothing selected for a second: in one cua call click `a` and press g k s r m f at once; wait 300 ms; click `empty`.',
  L5: 'Click `a`; wait 300 ms; press g k; click `b`; wait 300 ms; press k; wait 300 ms; click `empty`.',
  L6: 'Click `a`; wait 300 ms; press g k s, BackSpace, Left, Right, g k, Return; wait 300 ms; press Escape twice.',
  L7: PROBE
    ? 'Click `a`; wait 300 ms; g k s, then alt+Return; wait 800 ms; Return (the first candidate); wait 300 ms; click `empty`. Judged by the text: a Hanja in place of 한; with no composition after alt+Return, “window not opened” (the probe’s flag, not MAWS).'
    : 'Click `a`; wait 300 ms; press g k s, then alt+Return; wait 800 ms; screenshot (the Hanja window should open at `a`); Escape; click `empty`. Write the verdict into the done file.',
  L8: 'Click `a`; wait 300 ms; screenshot (a selected: the mapping holds); then cmd+c; Right; wait 1200 ms; Right; wait 300 ms; cmd+z; cmd+v; wait 500 ms; then the Edit menu with the mouse: Undo; Escape, then Tab (back from the pasted copy to `a`, the first element of the slide, which a press could not reach: the copy covers it); Copy; Paste; Undo. The spec puts a probe Edit menu in place for the case: the same five items, each noting itself and then doing what the role item does.',
};

/** One step of a case under the probe: a press (Playwright's), a wait, keys (the probe's), an input source (the probe's). */
type ProbeStep =
  | { click: 'a' | 'b' | 'empty' | 'notes' }
  | { wait: number }
  | { ansi: string } // 2-Set letters, posted as plain ANSI codes (--ansi-keys)
  | { keys: string[] } // press_key specs, letters and named keys in order (--keys)
  | { source: 'ABC' | '2-Set' }
  | { pressThenKeys: { click: 'a'; ansi: string; afterMs: number } }; // L4: the keys scheduled (--at) just after the press
/** Each case under the probe: what it needs of the probe's build and the mini, and its steps. */
const PROBE_CASES: Record<string, { needs: 'ansi' | 'keys' | 'source'; steps: ProbeStep[] }> = {
  L0: { needs: 'ansi', steps: [{ click: 'notes' }, { wait: 300 }, { ansi: 'rk' }, { wait: 300 }] },
  L1: { needs: 'ansi', steps: [{ click: 'a' }, { wait: 300 }, { ansi: 'gksrmf' }, { wait: 300 }, { click: 'empty' }] },
  L2: { needs: 'ansi', steps: [{ click: 'b' }, { wait: 300 }, { ansi: 'gksk' }, { wait: 300 }, { click: 'empty' }] },
  L3: { needs: 'source', steps: [{ source: 'ABC' }, { click: 'a' }, { wait: 300 }, { source: '2-Set' }, { wait: 300 }, { ansi: 'gksrmf' }, { wait: 300 }, { click: 'empty' }] },
  L4: { needs: 'ansi', steps: [{ wait: 1000 }, { pressThenKeys: { click: 'a', ansi: 'gksrmf', afterMs: 40 } }, { wait: 300 }, { click: 'empty' }] },
  L5: { needs: 'ansi', steps: [{ click: 'a' }, { wait: 300 }, { ansi: 'gk' }, { click: 'b' }, { wait: 300 }, { ansi: 'k' }, { wait: 300 }, { click: 'empty' }] },
  L6: { needs: 'keys', steps: [{ click: 'a' }, { wait: 300 }, { keys: ['g', 'k', 's', 'BackSpace', 'Left', 'Right', 'g', 'k', 'Return'] }, { wait: 300 }, { keys: ['Escape', 'Escape'] }] },
  // alt+Return a call of its own, so the trace after it is the Hanja window's alone
  L7: { needs: 'keys', steps: [{ click: 'a' }, { wait: 300 }, { keys: ['g', 'k', 's'] }, { keys: ['alt+Return'] }, { wait: 800 }, { keys: ['Return'] }, { wait: 300 }, { click: 'empty' }] },
};
const SOURCES = { ABC: 'com.apple.keylayout.ABC', '2-Set': 'com.apple.inputmethod.Korean.2SetKorean' } as const;

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
  /** The deck as seeded, through the seam, its text drawn again (each case's start, and L4's reset between attempts). */
  const reseed = async () => {
    await page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, DECK] as const);
    await expect(page.locator(`[data-region="main"] [data-artifact-tab="${id}"] [data-stage-slide="ime"] [data-eid="a"]`)).toHaveText('Hello');
  };

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
    // Keep the slide unobstructed: optional surfaces closed, then collapse the sidebar through the View menu.
    await hideSurfaces(page);
    await launch.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sidebar.toggle')?.click());
    const frame = page.locator(`[data-region="main"] [data-artifact-tab="${id}"] [data-stage-slide]`);
    await expect
      .poll(async () => (await frame.boundingBox())?.width ?? 0, { message: `the slide is drawn at least ${MIN_FRAME_PX} px wide (a bigger display, or the inspector closed)` })
      .toBeGreaterThanOrEqual(MIN_FRAME_PX);
    if (PROBE && !DRY) {
      // the slot's prelude: the probe's build, per-context input (L3 runs only with it off), the input source, then 2-Set
      const read = (cmd: string, args: string[]) => {
        try {
          return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
          return undefined;
        }
      };
      const appPath = PROBE[PROBE.indexOf('-a') + 1];
      prelude.build = appPath ? read('/usr/libexec/PlistBuddy', ['-c', 'Print :CUAEngineBuild', join(appPath, 'Contents/Info.plist')]) : undefined;
      prelude.perContextInput = read('defaults', ['read', 'com.apple.HIToolbox', 'TextInputGlobalPropertyPerContextInput']) ?? read('defaults', ['read', '-g', 'TextInputGlobalPropertyPerContextInput']);
      prelude.sourceBefore = read('defaults', ['read', 'com.apple.HIToolbox', 'AppleSelectedInputSources'])?.replace(/\s+/g, ' ');
      prelude.selected2Set = await inputSource('2-Set');
      const selected = outcomeOf(prelude.selected2Set);
      if (selected !== 'selected') stopped = `the prelude did not select 2-Set (${selected}: ${JSON.stringify(prelude.selected2Set.report)})`;
      writeFileSync(join(DIR, 'probe-prelude.json'), JSON.stringify(prelude, null, 1));
    }
  });

  test.afterAll(async () => {
    if (!PROBE || DRY || !launch) return;
    prelude.putBack = await inputSource('ABC'); // ABC put back at the slot's end, its report the read-back
    writeFileSync(join(DIR, 'probe-prelude.json'), JSON.stringify(prelude, null, 1));
  });

  for (const name of CASES) {
    test(`${name}: ${STEPS[name] ?? 'unknown case'}`, async () => {
      test.setTimeout(WAIT_MS + 120_000);
      const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
      if (PROBE) {
        test.skip(stopped !== null, `the slot stopped: ${stopped}`);
        test.skip(!PROBE_CASES[name], `${name} is the other driver's`);
        const needs = PROBE_CASES[name]!.needs;
        test.skip(needs === 'keys' && !PROBE_KEYS, `${name} needs the probe's named keys (--keys), which this build lacks`);
        test.skip(needs === 'source' && prelude.perContextInput !== '0', `${name} needs per-context input off (read: ${prelude.perContextInput ?? 'nothing'})`);
      }
      // the deck as seeded, nothing selected, the stage focused
      await reseed();
      await page.keyboard.press('Escape');
      const where = await targets(page, tab.locator('[data-stage-slide]'));
      await tab.locator('[data-stage-surface]').focus();
      for (const f of ['ready.json', 'done', 'result.json']) rmSync(join(DIR, `${name}.${f}`), { force: true });
      const probes: ProbeCall[] = [];
      const run = async () => {
        await startTrace(page);
        writeFileSync(join(DIR, `${name}.ready.json`), JSON.stringify({ case: name, policy: POLICY, steps: STEPS[name], ...where }, null, 1));
        if (PROBE && !DRY) await drive(name, where.page, probes);
        else {
          if (DRY) writeFileSync(join(DIR, `${name}.done`), 'dry run: no driver\n');
          await expect.poll(() => existsSync(join(DIR, `${name}.done`)), { timeout: WAIT_MS, intervals: [250] }).toBe(true);
        }
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
      // a probe call that posted nothing or not all (the front window not MAWS's, a key refused, a source not selected),
      // or L4 with none of its attempts' keys within 100 ms of the press, halts the case: recorded as halted, with the
      // reports, and skipped with its reason rather than judged on its text
      let halted: string | null = null;
      const events =
        name === 'L8'
          ? await withNativeClipboard(launch!.app, ['Hello', ''], run).finally(async () => (menu = await restoreMenu()))
          : await run().catch(async (error: unknown) => {
              if (!(error instanceof ProbeHalt)) throw error;
              halted = error.message;
              return stopTrace(page);
            });
      if (halted !== null) {
        writeFileSync(join(DIR, `${name}.result.json`), JSON.stringify({ case: name, policy: POLICY, halted, probes, events }, null, 1));
        if (name === 'L0') stopped = `L0 halted: ${halted}`;
        test.skip(true, `${name} halted: ${halted}`);
      }
      const out = await outcome(name, events, menu, probes);
      writeFileSync(join(DIR, `${name}.result.json`), JSON.stringify({ case: name, policy: POLICY, ...out, probes, events }, null, 1));
      if (DRY) return;
      // a case its text cannot judge (L7 with no Hanja and no window seen): recorded, then skipped with the reason
      if (out.inconclusive !== undefined) test.skip(true, `${name} inconclusive: ${out.inconclusive}`);
      if (name === 'L1') await writeFixture(events, out);
      // L0 is the slot's gate: unless the probe's r then k composed 가, nothing after it can be read
      if (PROBE && name === 'L0' && JSON.stringify(out.checks['the keys reach the input method']) !== JSON.stringify([true, true])) stopped = `L0 did not compose 가 (notes: ${JSON.stringify(out.facts.notes)}; probe: ${JSON.stringify(probes.at(-1)?.report ?? null)})`;
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

  // A case its text cannot judge answers why (`inconclusive`), and the test skips it once its result is written.
  async function outcome(name: string, events: TraceEvent[], menu: string[] = [], probes: ProbeCall[] = []): Promise<{ checks: Record<string, [unknown, unknown]>; facts: Record<string, unknown>; inconclusive?: string }> {
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
    let inconclusive: string | undefined;
    if (name === 'L0') {
      const notes = await page.locator('.deck-notes-field').first().inputValue();
      facts.notes = notes;
      checks['the keys reach the input method'] = PROBE ? [/가$/.test(notes.normalize('NFC')), true] : [/한$/.test(notes) || keys.some((k) => k.keyCode === 229), true];
    } else if (name === 'L1' || name === 'L3' || name === 'L4') {
      checks['a reads 한글'] = [a.normalize('NFC'), '한글'];
      checks['no bare jamo'] = [/[ㄱ-ㆎ]/.test(a), false];
      if (name === 'L1') {
        checks['Q2: the first keydown is keyCode 229, not composing'] = [firstKey && [firstKey.keyCode, firstKey.isComposing], [229, false]];
        checks['Q2: the composition starts on cleared content'] = [start?.textBefore, ''];
      }
    } else if (name === 'L2') {
      // a cleared box whose text was one bold run: T11 sets the marks as stored marks, and ProseMirror then redraws the
      // cursor's mark wrapper at compositionstart (findings.txt Q2): the real input method's first syllable through it
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
    } else if (name === 'L7' && PROBE) {
      // judged by the text first (Decision Log 16): one Han character in place of 한 passes. Any other text fails when a
      // composition followed alt+Return (the window opened); with none, the window never opened, which is the probe's
      // flag to suspect (its option flag lacks a physical keyboard's device bit), not MAWS's: the case is inconclusive
      const han = /^\p{Script=Han}$/u.test(a.normalize('NFC'));
      const hanjaKey = probes.findIndex((c) => c.args.includes('alt+Return'));
      const after = hanjaKey < 0 ? [] : events.slice(probes[hanjaKey]!.traceFrom);
      const opened = han || after.some((e) => e.type === 'compositionstart' || e.type === 'compositionupdate');
      facts.hanjaWindow = opened ? 'opened' : 'window not opened';
      if (opened) checks['a reads a Hanja in place of 한'] = [han, true];
      else inconclusive = `window not opened (a reads ${JSON.stringify(a)}, and no composition followed alt+Return)`;
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
    if (name === 'L4') facts.postedAt = probes.map((c) => (c.report as { postedAt?: unknown } | null)?.postedAt ?? null);
    return { checks, facts, inconclusive };
  }

  // ---- the probe's driver: its presses through Playwright, its keys and input sources through cua's engine probe
  const exec = promisify(execFile);
  let calls = 0;
  let stopped: string | null = null;
  const prelude: { build?: string; perContextInput?: string; sourceBefore?: string; selected2Set?: ProbeCall; putBack?: ProbeCall } = {};
  /** One call of the probe: its arguments after MAWS_IME_PROBE_CMD, the report (its stdout's last JSON line), how long. */
  async function probe(args: string[], traceFrom = 0): Promise<ProbeCall> {
    calls += 1;
    const out = join(DIR, `probe-${calls}.out`);
    const err = join(DIR, `probe-${calls}.err`);
    for (const f of [out, err]) rmSync(f, { force: true });
    const cmd = PROBE!.map((a) => (a === '{out}' ? out : a === '{err}' ? err : a));
    const started = Date.now();
    let failure: string | null = null;
    try {
      await exec(cmd[0]!, [...cmd.slice(1), ...args]);
    } catch (error) {
      failure = String(error);
    }
    const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
    const lines = read(out).trim().split('\n').filter((line) => line.trim().startsWith('{'));
    const report = ((): unknown => {
      try {
        return lines.length ? JSON.parse(lines.at(-1)!) : null;
      } catch {
        return { unparsed: lines.at(-1) };
      }
    })();
    return { args, startedAt: started, ms: Date.now() - started, report, stderr: read(err).trim().slice(-2000), failure, traceFrom };
  }
  /** MAWS's window front and key, and where it is now (the probe refuses unless its bounds name the front window). */
  async function front(): Promise<{ pid: number; bounds: string }> {
    const b = await launch!.app.evaluate(({ BrowserWindow, app }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      app.focus({ steal: true });
      win.focus();
      return win.getBounds();
    });
    return { pid: launch!.app.process().pid!, bounds: `${b.x},${b.y},${b.width},${b.height}` };
  }
  const traceLength = () => page.evaluate(() => (window as unknown as { __ime_trace?: { events: unknown[] } }).__ime_trace?.events.length ?? 0);
  async function keystroke(units: { ansi: string } | { keys: string[] }, at?: number): Promise<ProbeCall> {
    const traceFrom = await traceLength();
    const { pid, bounds } = await front();
    const tail = 'ansi' in units ? ['--ansi-keys', units.ansi] : ['--keys', ...units.keys];
    return probe(['--probe', 'keystroke', '--user-pid', String(pid), '--user-bounds', bounds, ...(at !== undefined ? ['--at', String(at)] : []), ...tail], traceFrom);
  }
  const inputSource = (source: keyof typeof SOURCES) => probe(['--probe', 'input-source', SOURCES[source]]);
  type Where = Awaited<ReturnType<typeof targets>>['page'];
  async function press(where: Where, at: 'a' | 'b' | 'empty' | 'notes') {
    const point = where[at];
    if (!point) throw new Error(`no ${at} to press`);
    await page.mouse.click(point.x, point.y);
  }
  /** L4's measure, from the trace: the last press before the keys posted from `from` on, to their first keydown (ms). */
  async function pressToKey(from: number): Promise<number | null> {
    const read = () =>
      page.evaluate((i) => {
        const events = (window as unknown as { __ime_trace?: { events: TraceEvent[] } }).__ime_trace?.events ?? [];
        const key = events.findIndex((e, at) => at >= i && e.type === 'keydown');
        if (key < 0) return undefined;
        const down = events.slice(0, key).findLast((e) => e.type === 'pointerdown');
        return down ? Math.round((events[key]!.t - down.t) * 10) / 10 : null;
      }, from);
    // the probe's exit can come before the page has seen its keys
    const until = Date.now() + 2_000;
    let ms = await read();
    while (ms === undefined && Date.now() < until) {
      await page.waitForTimeout(50);
      ms = await read();
    }
    return ms ?? null;
  }
  async function drive(name: string, where: Where, calls_: ProbeCall[]): Promise<void> {
    const check = (call: ProbeCall) => {
      if (call.failure) throw new Error(`the probe failed at ${name}: ${call.failure} ${JSON.stringify(call.report)}`);
      const outcome = outcomeOf(call);
      if (outcome !== 'posted' && outcome !== 'selected') throw new ProbeHalt(`${outcome} at ${call.args.join(' ')}; report ${JSON.stringify(call.report)}`);
    };
    for (const step of PROBE_CASES[name]!.steps) {
      if ('click' in step) await press(where, step.click);
      else if ('wait' in step) await page.waitForTimeout(step.wait);
      else if ('ansi' in step || 'keys' in step) calls_.push(await keystroke(step));
      else if ('source' in step) calls_.push(await inputSource(step.source));
      else {
        // L4: the probe launched first and told to post at a time just after the press, so the keys land within 100 ms of
        // it whatever LaunchServices' launch takes. The trace's press-to-key time says whether they did: an attempt
        // outside 0 to 100 ms is no sample of L4, so the deck is reset (`empty` pressed, re-seeded, a new trace) and the
        // case tried again, up to L4_ATTEMPTS; with none inside, the case halts as inconclusive. Each attempt's interval
        // is kept on its call, beside its report.
        const { click, ansi, afterMs } = step.pressThenKeys;
        const intervals: (number | null)[] = [];
        for (let attempt = 1; ; attempt++) {
          const at = Date.now() + 2_500;
          const keys = keystroke({ ansi }, at);
          await page.waitForTimeout(Math.max(0, at - afterMs - Date.now()));
          await press(where, click);
          const call = await keys;
          call.pressToKeyMs = await pressToKey(call.traceFrom);
          calls_.push(call);
          check(call);
          intervals.push(call.pressToKeyMs);
          if (call.pressToKeyMs !== null && call.pressToKeyMs >= 0 && call.pressToKeyMs <= 100) break;
          if (attempt === L4_ATTEMPTS) throw new ProbeHalt(`inconclusive: no attempt's keys landed within 100 ms of the press (press to first keydown, ms, per attempt: ${JSON.stringify(intervals)})`);
          await press(where, 'empty');
          await reseed();
          await startTrace(page);
        }
      }
      const last = calls_.at(-1);
      if (last && !('click' in step) && !('wait' in step)) check(last);
    }
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
      mode: POLICY,
      notes: `${passed ? 'L1 passed on the real Mac' : 'L1 did not pass on the real Mac; see the run’s result file'}${PROBE ? `, its keys posted by cua's engine probe (build ${prelude.build ?? 'unread'})` : ''}.`,
      events,
    };
    writeFileSync(join(DIR, 'l1-hangul.json'), `${JSON.stringify(trace, null, 1)}\n`);
  }
});

/** A probe call that posted nothing or not all: the case stops there, recorded, and is skipped with the reason. */
class ProbeHalt extends Error {}

/**
 * What a probe call did, from its report (one JSON line on every exit path): `exitStatus` first (the exit code, in
 * hold 2a's build), else the report's shape. A keystroke posted all (`posted`), some or none with the front window
 * not the named one (`aborted`: a field may hold part of the text, never a composition result), or refused before
 * sending (`refused`: untypeable, usage); an input source selected or not (`selected`, `unselected`, `refused`: no such
 * source); `unknown` with no report.
 */
function outcomeOf(call: ProbeCall): 'posted' | 'aborted' | 'refused' | 'selected' | 'unselected' | 'unknown' {
  const r = call.report as { exitStatus?: number; error?: string; aborted?: boolean; selected?: boolean; postedAt?: unknown; presses?: unknown } | null;
  if (!r || typeof r !== 'object') return 'unknown';
  const source = call.args.includes('input-source');
  if (typeof r.exitStatus === 'number') {
    if (source) return r.exitStatus === 0 ? 'selected' : r.exitStatus === 3 ? 'unselected' : 'refused';
    if (r.exitStatus === 0) return r.aborted ? 'aborted' : 'posted';
    return r.exitStatus === 4 ? 'aborted' : 'refused';
  }
  if (source) return r.selected === true ? 'selected' : r.selected === false ? 'unselected' : 'refused';
  if (r.aborted === true) return 'aborted';
  if (typeof r.error === 'string') return /front window/.test(r.error) ? 'aborted' : 'refused';
  return r.postedAt !== undefined || r.presses !== undefined ? 'posted' : 'unknown';
}

/** One call of cua's engine probe, kept in the case's result. */
interface ProbeCall {
  args: string[];
  startedAt: number;
  ms: number;
  /** the probe's report, its stdout's last JSON line (presses, postedAt, units, layout; with --keys, keys and flagsChanged) */
  report: unknown;
  stderr: string;
  /** the launch's own failure (LaunchServices'), if any */
  failure: string | null;
  /** the trace's length when the call began: the events after it are its keys' */
  traceFrom: number;
  /** L4: the trace's last press before the call's keys to their first keydown, in ms (null: no press before them, or no keys seen) */
  pressToKeyMs?: number | null;
}

/** Where the driver presses: page px, window points and screen points (the window's frame and content from main). */
async function targets(page: Page, frame: ReturnType<Page['locator']>) {
  const editor = page.locator('[data-region="main"] [data-deck-editor]');
  const disclosure = editor.getByRole('button', { name: 'Speaker notes', exact: true });
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  const notesField = editor.getByRole('textbox', { name: 'Speaker notes', exact: true });
  await expect(notesField).toBeVisible();
  // Let the fit observer repaint after opening notes before measuring either screen target.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await frame.boundingBox())!;
  const scale = box.width / 1920;
  const at = (x: number, y: number) => ({ x: Math.round(box.x + x * scale), y: Math.round(box.y + y * scale) });
  const notes = (await notesField.boundingBox())!;
  const page_ = { a: at(260, 250), b: at(1060, 250), empty: at(100, 1000), shape: at(1150, 600), notes: { x: Math.round(notes.x + 40), y: Math.round(notes.y + notes.height / 2) } };
  const win = await page.evaluate(() => ({ outerX: screenX, outerY: screenY, outerW: outerWidth, outerH: outerHeight, innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio }));
  return {
    page: page_,
    scale,
    window: win,
    note: 'page px are CSS px from the content’s top-left; on macOS the content sits at the window’s top-left (MAWS hides the title bar), so window points = page px at zoom 1. Calibrate cua’s coordinate space with the L0 step before L1.',
  };
}
