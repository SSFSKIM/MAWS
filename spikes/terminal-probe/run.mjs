// The spike's driver (C9 M1, Interfaces *Spike layout*): launches the built app with MAWS_HARNESS=1, opens `#probe`,
// runs the automated workloads against each renderer, writes `results/<renderer>-<workload>.json` and
// `evidence/<renderer>-<item>.png`, and drives the items Playwright can drive (typed workloads, clicks, wheel,
// selection, resize, context loss, the TUIs). What needs a human (Korean IME composition, sleep and resume) is
// recorded as pending in findings.md. `--phase m2-gate` is the transport gate that closes M2: the full floods on the
// binary stream with acks (judged against GATE_CRITERIA) and the links through `pty.openLink`, with main's
// `shell.openExternal` stubbed to record the URL instead of opening a browser.
//
//   MAWS_HARNESS=1 pnpm build && node spikes/terminal-probe/run.mjs [--phase m1|m2-gate] [--renderer xterm|ghostty|both]
//                [--steps smoke,measure,items,tui,exit-check,replay,links] [--keep-open]
//   MAWS_CLAUDE_BIN / MAWS_CODEX_BIN override the TUI binaries.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';
import {
  AUTOMATED_MEASUREMENTS,
  CLAUDE_BIN_DEFAULT,
  CODEX_BIN_DEFAULT,
  GATE_CRITERIA,
  GATE_ECHO_P95_MS,
  GATE_FRAME_P95_MS,
  GATE_MEASUREMENTS,
  SCRATCH_CWD,
  workloads,
} from './workloads.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../..');
// `--key=value`, `--key value` or a bare `--flag`.
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=');
  const next = process.argv[i + 1];
  if (inline !== undefined) args.set(key, inline);
  else if (next && !next.startsWith('--')) args.set(key, process.argv[++i]);
  else args.set(key, true);
}
const phase = args.get('phase') ?? 'm1';
const only = args.get('renderer'); // a renderer id, or unset for every candidate the page reports
const steps = new Set((args.get('steps') ?? (phase === 'm2-gate' ? 'smoke,measure,links' : 'smoke,measure,items')).split(','));
const bins = { claude: process.env.MAWS_CLAUDE_BIN ?? CLAUDE_BIN_DEFAULT, codex: process.env.MAWS_CODEX_BIN ?? CODEX_BIN_DEFAULT };

for (const dir of ['results', 'evidence', 'recordings']) mkdirSync(join(here, dir), { recursive: true });
const main = join(repo, 'out/main/index.js');
if (!existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);
if (!existsSync(join(repo, 'out/renderer/harness.html'))) throw new Error('out/renderer/harness.html does not exist (run MAWS_HARNESS=1 pnpm build)');

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeResult = (name, data) => writeFileSync(join(here, 'results', `${name}.json`), JSON.stringify(data, null, 2) + '\n');
const readResult = (name) => JSON.parse(readFileSync(join(here, 'results', `${name}.json`), 'utf8'));

const userData = mkdtempSync(join(tmpdir(), 'maws-probe-'));
const env = { ...process.env, MAWS_HARNESS: '1', MAWS_E2E: '1', MAWS_USER_DATA: userData };
delete env.ELECTRON_RENDERER_URL;
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({ args: [main], env, cwd: repo });
const page = await app.firstWindow();
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`uncaught: ${e.message}`));

const probe = {
  call: (method, ...params) => page.evaluate(([m, p]) => window.__maws_harness.probe[m](...p), [method, params]),
  screenshot: async (name) => {
    await probe.call('screenshotReady');
    await page.screenshot({ path: join(here, 'evidence', `${name}.png`) });
    log('  evidence', `${name}.png`);
  },
};
const state = (r) => probe.call('state', r);
const snapshot = (r, from, to) => probe.call('snapshot', r, from, to);
const type = (r, text) => probe.call('type', r, text);
const idle = (r, ms = 600) => probe.call('idle', r, ms);
// A prompt: the shell went quiet with bracketed paste on (zsh sets it at every prompt; the owner's prompt is a
// powerline one with no `$`), or a line ending in a prompt character for shells that do not.
const waitForPrompt = async (r) => {
  for (let i = 0; i < 50; i++) {
    await idle(r, 400);
    const snap = await snapshot(r);
    const line = snap.lines[snap.cursorY] ?? '';
    if (!snap.modes.alternateScreen && (snap.modes.bracketedPaste || /[$%#>❯] ?$/.test(line))) return snap;
  }
  throw new Error(`${r}: no prompt appeared`);
};
const spawnShell = async (r) => {
  await probe.call('spawn', r, 'shell');
  return waitForPrompt(r);
};
// Pixel centre of a cell, from the pane's geometry (no library internals: the container's box divided by cols/rows).
const cellPoint = async (r, col, row) => {
  const g = await probe.call('geometry', r);
  const cw = g.width / g.cols;
  const ch = g.height / g.rows;
  return { x: g.x + (col + 0.5) * cw, y: g.y + (row + 0.5) * ch, cw, ch };
};
const findRow = (snap, needle) => snap.lines.findIndex((l) => l.includes(needle));

// The only screens the driver answers, each identified by its exact wording, each with the one safe answer. Anything
// else that looks like a question stops the run with a screenshot: the driver never grants an unknown request.
const KNOWN_SCREENS = [
  {
    name: 'claude-trust',
    test: (text) => /Do you trust the files in this folder\?/.test(text),
    answer: async (r) => {
      // "Yes, proceed" is the preselected option; Enter takes it.
      await probe.call('focus', r);
      await page.keyboard.press('Enter');
    },
  },
  {
    name: 'codex-update',
    test: (text) => /Update available!/.test(text) && /\d\. Skip\b/.test(text),
    answer: async (r) => {
      // Move the selection off "Update now" to "Skip" and confirm only once the marker sits on Skip; never on the
      // install option.
      await probe.call('focus', r);
      for (let i = 0; i < 3; i++) {
        const snap = await snapshot(r);
        const selected = snap.lines.find((l) => l.trimStart().startsWith('›')) ?? '';
        if (/›\s*\d\.\s*Skip\b/.test(selected) && !/until next version/.test(selected)) {
          await page.keyboard.press('Enter');
          return;
        }
        await page.keyboard.press('ArrowDown');
        await sleep(300);
      }
      const last = await snapshot(r);
      await probe.screenshot(`${r}-codex-update-prompt`);
      throw new Error(`codex update prompt: could not move the selection to "Skip"; screen:\n${last.lines.filter((l) => l.trim()).slice(-8).join('\n')}`);
    },
  },
];
const LOOKS_LIKE_A_QUESTION = /Press Enter|Enter to continue|Yes, proceed|\(y\/n\)|\[y\/N\]|\[Y\/n\]|Do you trust|Allow|Approve|allow|approve/;
const answerKnownScreen = async (r, tui, item, snap) => {
  const text = snap.lines.join('\n');
  const known = KNOWN_SCREENS.find((screen) => screen.test(text));
  if (known) {
    log(r, tui, `answering the known screen ${known.name}`);
    (item.prompts ??= []).push({ screen: known.name, lines: snap.lines.filter((l) => l.trim()).slice(-8) });
    await known.answer(r);
    return true;
  }
  if (LOOKS_LIKE_A_QUESTION.test(text)) {
    await probe.screenshot(`${r}-${tui}-unknown-prompt`);
    throw new Error(`${tui}: an unknown prompt appeared; not answered (see evidence/${r}-${tui}-unknown-prompt.png):\n${snap.lines.filter((l) => l.trim()).slice(-8).join('\n')}`);
  }
  return false;
};
// Starts a TUI from the shell prompt and waits for its first frame, answering only the known screens.
const startTui = async (r, tui, command, item) => {
  await type(r, command);
  for (let i = 0; i < 20; i++) {
    await idle(r, 1000, 5000);
    const snap = await snapshot(r);
    if (await answerKnownScreen(r, tui, item, snap)) continue;
    if (snap.lines.join('').trim()) return snap;
  }
  throw new Error(`${tui}: no frame appeared`);
};
// Sends the TUI's exit command (Enter again while the composer still shows it: codex's slash completion takes the
// first Enter), then proves the shell is back by running a marker command that only a shell answers.
const exitTui = async (r, tui) => {
  const command = tui === 'claude' ? '/exit' : '/quit';
  await probe.call('focus', r);
  await page.keyboard.type(command, { delay: 40 });
  await sleep(600);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Enter');
    await idle(r, 1500, 6000);
    const snap = await snapshot(r);
    const composer = snap.lines.filter((l) => l.trim()).slice(-4).join('\n');
    if (!snap.modes.alternateScreen && !composer.includes(command)) break;
    if (snap.modes.alternateScreen && tui === 'codex') {
      await page.keyboard.press('Control+KeyC');
      await sleep(300);
      await page.keyboard.press('Control+KeyC');
      await idle(r, 1500, 6000);
    }
  }
  await type(r, "printf 'MAWS_%s\\n' BACK\r");
  for (let i = 0; i < 60; i++) { // codex shuts down slowly on a cold start ("Shutting down…" while its model still loads)
    await idle(r, 1000, 2000);
    const snap = await snapshot(r);
    if (!snap.modes.alternateScreen && snap.lines.some((l) => l === 'MAWS_BACK')) return;
  }
  await probe.screenshot(`${r}-${tui}-still-open`);
  throw new Error(`${tui}: the shell did not answer after the exit command (evidence/${r}-${tui}-still-open.png)`);
};
// Item 1's comparison: every line above the prompt row the command was typed on is unchanged after the TUI exits
// (that row now holds the command); the TUI's own rows, if any, come after.
const restorationCheck = (preSnap, postSnap) => {
  const priorRows = preSnap.baseY + preSnap.cursorY;
  const before = preSnap.lines.slice(0, priorRows);
  const after = postSnap.lines.slice(0, priorRows);
  const firstDifference = before.findIndex((l, i) => l !== after[i]);
  return {
    priorRows,
    priorScrollbackIntact: firstDifference === -1,
    firstDifference,
    beforeLines: before,
    afterLines: postSnap.lines,
    alternateScreenAfter: postSnap.modes.alternateScreen,
    lineCountBefore: preSnap.lineCount,
    lineCountAfter: postSnap.lineCount,
    tuiFramesInScrollback: postSnap.lines.slice(preSnap.lineCount).filter((l) => l.trim()).length,
  };
};

// Item 9 at the gate: output bytes and line feeds exact (the page's byte-count check, `error` otherwise), the last
// line right, frame p95 within 50 ms; MB/s against its floor, a finding when below.
const judgeGate = (id, metrics) => {
  if (id === 'latency') {
    const echoP95Ok = metrics.latency?.p95 != null && metrics.latency.p95 <= GATE_ECHO_P95_MS;
    return { pass: echoP95Ok && metrics.error === undefined, echoP95Ok, echoP95Ms: metrics.latency?.p95 ?? null };
  }
  const criteria = GATE_CRITERIA[id];
  const countsExact = metrics.error === undefined;
  const lastLineOk = criteria.lastLine(metrics.lastLine);
  const frameP95Ok = metrics.frames?.p95 != null && metrics.frames.p95 <= GATE_FRAME_P95_MS;
  const belowFloor = criteria.floorMBps !== null && (metrics.mbps ?? 0) < criteria.floorMBps;
  return { pass: countsExact && lastLineOk && frameP95Ok, countsExact, lastLineOk, frameP95Ok, floorMBps: criteria.floorMBps, belowFloor };
};

try {
  // ---- smoke: the page loads, both renderers initialise, the console is clean of CSP refusals ----
  // C6's hash router opens on its default page; a mounted page has assigned __maws_harness and the router listens.
  await page.waitForFunction(() => window.__maws_harness !== undefined, null, { timeout: 15_000 });
  await page.evaluate(() => (location.hash = '#probe'));
  await page.waitForFunction(() => window.__maws_harness?.page === 'probe', null, { timeout: 15_000 });
  await probe.call('setBins', bins);
  const ready = await probe.call('ready');
  log('renderers', JSON.stringify(Object.fromEntries(Object.entries(ready).map(([k, v]) => [k, { status: v.status, acceleration: v.acceleration, error: v.error, size: `${v.cols}x${v.rows}` }]))));
  await sleep(300);
  await probe.screenshot('00-probe-page');
  const csp = consoleLines.filter((l) => /Content Security Policy|CSP|wasm|WebAssembly/i.test(l));
  writeResult('smoke', { phase, ready, console: consoleLines, cspRelated: csp, at: new Date().toISOString() });
  log('console lines', consoleLines.length, 'csp-related', csp.length);
  if (csp.length) console.log(csp.join('\n'));
  const live = Object.keys(ready).filter((r) => (!only || only === 'both' || r === only) && ready[r].status !== 'failed');

  // ---- measure: W1, W2, W3, width, latency (+ scroll-region) per renderer; at the gate the three floods only ----
  if (steps.has('measure')) {
    for (const r of live) {
      for (const id of phase === 'm2-gate' ? GATE_MEASUREMENTS : [...AUTOMATED_MEASUREMENTS, 'scroll-region']) {
        log(r, id, 'running');
        const metrics = await probe.call('run', id, r, phase);
        if (phase === 'm2-gate') metrics.gate = judgeGate(id, metrics);
        writeResult(`${r}-${id}`, metrics);
        log(r, id, JSON.stringify({ bytes: metrics.bytes, expected: metrics.expectedBytes, seconds: metrics.seconds, mbps: metrics.mbps, framesP95: metrics.frames?.p95, over50: metrics.frames?.over50ms, latencyP95: metrics.latency?.p95, pausedSeen: metrics.pausedSeen, acks: metrics.acks, gate: metrics.gate, error: metrics.error }));
        if (id === 'width') {
          await probe.screenshot(`${r}-03-width`);
          log(r, 'widths', JSON.stringify(metrics.widths?.map((w) => `${w.expected}/${w.reported}`)));
        }
        if (id === 'W3') await probe.screenshot(`${r}-09-W3-end`);
        if (id === 'scroll-region') await probe.screenshot(`${r}-13-scroll-region`);
      }
    }
  }

  // ---- items: the shell-driven items 1 (less), 5, 6, 7, 8 (stty), 10 (context loss), 14, and the palette ----
  if (steps.has('items')) {
    for (const r of live) {
      const item = {};
      const before = await spawnShell(r);
      item.shell = { pid: (await state(r)).pid, prompt: before.lines[before.cursorY] };

      // Item 1 (less): the alternate screen, then the shell screen and scrollback restored on q. Run before the
      // buffer fills, so the typed command line and the prompt after q do not shift the comparison.
      await type(r, 'seq 1 30\r');
      await idle(r, 500);
      const preLess = await snapshot(r, 0);
      await type(r, workloads.less.command);
      await idle(r, 800);
      const inLess = await snapshot(r);
      await probe.screenshot(`${r}-01-less-alt`);
      await type(r, 'q');
      await idle(r, 800);
      const postLess = await snapshot(r, 0);
      item.less = {
        alternateScreenWhileOpen: inLess.modes.alternateScreen,
        firstLineWhileOpen: inLess.lines[0],
        // Everything before the `less` command line is unchanged; after it, only the command line and a new prompt.
        priorLinesIntact: preLess.lines.slice(0, preLess.baseY + preLess.cursorY).every((l, i) => l === postLess.lines[i]),
        residueLines: postLess.lines.slice(preLess.baseY + preLess.cursorY + 1).filter((l) => l.trim()),
        lineCountBefore: preLess.lineCount,
        lineCountAfter: postLess.lineCount,
      };
      await probe.screenshot(`${r}-01-less-restored`);

      // Item 7: scrollback holds exactly 10000 + rows lines after seq 1 20000 and the first line is the expected one.
      await type(r, workloads.seq20000.command);
      await idle(r, 800);
      const seq = await snapshot(r, 0, 3);
      const expectedFirst = String(20000 - (10000 + seq.rows) + 1);
      item.scrollback = { lineCount: seq.lineCount, rows: seq.rows, expectedLineCount: 10000 + seq.rows, firstLine: seq.lines[0], expectedFirstLine: expectedFirst, note: 'the first buffer line is the line that scrolled out last but one prompt line and the typed command also occupy the buffer' };
      const p = await cellPoint(r, 10, 5);
      await page.mouse.move(p.x, p.y);
      await page.mouse.wheel(0, -200000);
      await sleep(300);
      await probe.screenshot(`${r}-07-scrollback-top`);
      await page.mouse.wheel(0, 200000);
      await sleep(200);

      // Item 6 (M1 half): the adapter's link handler fires with the exact URL on ⌘-click; nothing opens.
      await type(r, workloads.osc8.command);
      await idle(r, 500);
      const links = await snapshot(r);
      const rowBare = findRow(links, 'https://example.org');
      const osc8Row = links.lines.findIndex((l, i) => l.trim() === 'example' && i !== rowBare);
      item.links = {};
      if (osc8Row >= 0) {
        const pt = await cellPoint(r, links.lines[osc8Row].indexOf('example') + 2, osc8Row);
        await page.mouse.move(pt.x, pt.y);
        await sleep(150);
        await page.mouse.click(pt.x, pt.y, { modifiers: ['Meta'] });
        await sleep(300);
        item.links.osc8 = (await state(r)).lastLink;
      } else item.links.osc8 = 'no row with the link text';
      if (rowBare >= 0) {
        const pt = await cellPoint(r, links.lines[rowBare].indexOf('https://example.org') + 5, rowBare);
        await page.mouse.move(pt.x, pt.y);
        await sleep(150);
        await page.mouse.click(pt.x, pt.y, { modifiers: ['Meta'] });
        await sleep(300);
        item.links.bare = (await state(r)).lastLink;
      }
      await probe.screenshot(`${r}-06-links`);

      // Palette (item 10 half): recolours on the theme toggle without a reload.
      await type(r, workloads.colours.command);
      await idle(r, 500);
      await probe.screenshot(`${r}-10-palette-light`);
      await page.getByRole('button', { name: /^theme:/ }).click();
      await sleep(400);
      await probe.screenshot(`${r}-10-palette-dark`);
      await page.getByRole('button', { name: /^theme:/ }).click();
      await sleep(400);

      // Item 5: drag across two wrapped lines, ⌘C, the clipboard equals the selection; paste into the field.
      await type(r, `printf '%s\\n' "$(printf 'wrap%.0s' $(seq 1 40))"\r`);
      await idle(r, 500);
      const wrapSnap = await snapshot(r);
      const wrapRow = wrapSnap.lines.findIndex((l) => l.startsWith('wrapwrap'));
      const a = await cellPoint(r, 2, wrapRow);
      const b = await cellPoint(r, 20, wrapRow + 1);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
      await sleep(200);
      const selected = await probe.call('selection', r);
      await page.keyboard.press('Meta+KeyC');
      await sleep(300);
      const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
      await page.getByLabel('paste target').click();
      await page.keyboard.press('Meta+KeyV');
      await sleep(200);
      const pasted = await page.getByLabel('paste target').inputValue();
      item.selection = { selectedLength: selected.length, clipboardEqualsSelection: clipboard === selected, pastedEqualsSelection: pasted === selected, sample: selected.slice(0, 40) };
      await probe.screenshot(`${r}-05-selection`);
      await page.getByLabel('paste target').fill('');
      await probe.call('focus', r);

      // Item 14: how the chords arrive without Kitty encoding, observed through cat.
      await type(r, 'cat\r');
      await idle(r, 400);
      item.keys = {};
      for (const [name, chord] of [['shiftEnter', 'Shift+Enter'], ['altLeft', 'Alt+ArrowLeft'], ['ctrlLeft', 'Control+ArrowLeft']]) {
        await probe.call('focus', r);
        await page.keyboard.press(chord);
        await sleep(150);
        item.keys[name] = (await state(r)).lastInput;
      }
      await page.keyboard.press('Control+KeyC');
      await idle(r, 400);

      // Item 8 (shell half): the pane divider drags, the shell learns the new size.
      await probe.call('setSplit', 0.3);
      await idle(r, 500);
      await type(r, workloads['stty-size'].command);
      await idle(r, 500);
      const small = await snapshot(r);
      await probe.call('setSplit', 0.5);
      await idle(r, 500);
      await type(r, workloads['stty-size'].command);
      await idle(r, 500);
      const back = await snapshot(r);
      const sttyOf = (snap) => snap.lines.filter((l) => /^\d+ \d+$/.test(l.trim())).at(-1)?.trim();
      item.resize = { at30: { stty: sttyOf(small), pane: `${small.rows} ${small.cols}` }, at50: { stty: sttyOf(back), pane: `${back.rows} ${back.cols}` } };

      // Item 10 (simulated half, xterm): context loss falls back to dom within four seconds, input still works,
      // hide and show returns webgl.
      if (r === 'xterm') {
        await probe.call('simulateContextLoss', r);
        const t0 = Date.now();
        let acc = (await state(r)).acceleration;
        while (acc !== 'dom' && Date.now() - t0 < 6_000) {
          await sleep(100);
          acc = (await state(r)).acceleration;
        }
        const fellBackMs = Date.now() - t0;
        await type(r, 'echo after-loss-ok\r');
        await idle(r, 400);
        const afterLoss = await snapshot(r);
        await probe.call('setVisible', r, false);
        await sleep(100);
        await probe.call('setVisible', r, true);
        await sleep(300);
        item.contextLoss = { acceleration: acc, fellBackMs, inputAfterLoss: afterLoss.lines.some((l) => l === 'after-loss-ok'), afterShow: (await state(r)).acceleration };
        await probe.screenshot(`${r}-10-after-context-loss`);
      }

      writeResult(`${r}-items`, item);
      log(r, 'items', JSON.stringify(item));
      await probe.call('kill', r);
    }
  }

  // ---- links (the gate's half of item 6): ⌘-click an OSC 8 link and a bare URL; each reaches main's pty.openLink,
  // whose shell.openExternal is stubbed here to record the URL (no browser opens; the real ⌘-click by hand is M5's).
  // A javascript: OSC 8 link checks the refusal end to end. ----
  if (steps.has('links')) {
    await app.evaluate(({ shell }) => {
      globalThis.__mawsOpened = [];
      shell.openExternal = async (url) => void globalThis.__mawsOpened.push(url);
    });
    for (const r of live) {
      const item = {};
      await spawnShell(r);
      await type(r, workloads.osc8.command);
      await type(r, workloads['osc8-script'].command);
      await idle(r, 600);
      const snap = await snapshot(r);
      const bareRow = findRow(snap, 'https://example.org');
      const osc8Row = snap.lines.findIndex((l, i) => l.trim() === 'example' && i !== bareRow);
      const scriptRow = snap.lines.findIndex((l) => l.trim() === 'scripted');
      const clickAt = async (row, text) => {
        if (row < 0) return { clicked: false, reason: `no row reading ${JSON.stringify(text)}` };
        const before = await state(r);
        const pt = await cellPoint(r, snap.lines[row].indexOf(text) + 2, row);
        await page.mouse.move(pt.x, pt.y);
        await sleep(150);
        await page.mouse.click(pt.x, pt.y, { modifiers: ['Meta'] });
        await sleep(400);
        const s = await state(r);
        const activated = s.lastLink !== before.lastLink;
        return { clicked: true, activated, handler: activated ? s.lastLink : null, openLink: activated ? s.lastOpen : null };
      };
      item.osc8 = await clickAt(osc8Row, 'example');
      item.bare = await clickAt(bareRow, 'https://example.org');
      // xterm 6.0.0 itself drops an OSC 8 link whose scheme is not http(s) unless `linkHandler.allowNonHttpProtocols`
      // is set (OscLinkProvider.ts): the click is expected not to activate anything.
      item.javascript = await clickAt(scriptRow, 'scripted');
      // Main's refusal over the real IPC path, from the page: the schema accepts the URL, the handler refuses it.
      item.javascriptInvoke = await page.evaluate(() => window.maws.invoke('pty.openLink', { url: 'javascript:alert(1)' }));
      item.openExternalCalls = await app.evaluate(() => globalThis.__mawsOpened);
      const opened = item.openExternalCalls.map((url) => url.replace(/\/$/, ''));
      item.pass =
        JSON.stringify(opened) === JSON.stringify(['https://example.com', 'https://example.org']) &&
        item.osc8.activated &&
        item.bare.activated &&
        !item.javascript.activated &&
        item.javascriptInvoke.ok === true &&
        item.javascriptInvoke.value.opened === false;
      item.note =
        "main's shell.openExternal was stubbed through electronApp.evaluate: each URL reached it through pty.openLink and openExternalUrl's scheme check; this run opened no browser";
      await probe.screenshot(`${r}-06-links-m2-gate`);
      writeResult(`${r}-links-m2-gate`, item);
      log(r, 'links', JSON.stringify(item));
      await probe.call('kill', r);
    }
  }

  // ---- tui: the real claude and codex, launched from the shell in the scratch cwd, recorded with script -r ----
  if (steps.has('tui')) {
    const tuiRenderer = args.get('tui-renderer') ?? 'xterm';
    for (const r of live.filter((x) => x === tuiRenderer)) {
      for (const tui of (args.get('tui') ?? 'claude,codex').split(',')) {
        const bin = bins[tui];
        const rec = join(here, 'recordings', `${tui}.rec`);
        const item = { tui, bin, renderer: r };
        const before = await spawnShell(r);
        const preSnap = await snapshot(r, 0);
        const counters = await state(r);
        item.before = { pid: counters.pid, lineCount: preSnap.lineCount };
        // Typed from the shell so item 1 has a shell screen to restore; recorded by script -r for the replay.
        await startTui(r, tui, `script -q -r ${rec} ${bin}\r`, item);
        await probe.screenshot(`${r}-11-${tui}-frame`);
        const started = await state(r);
        item.startup = { syncFrames: started.syncFrames, kittyQueried: started.kittyQueried, kittyAnswered: started.kittyAnswered, xtversionQueried: started.xtversionQueried, xtversionAnswered: started.xtversionAnswered, alternateScreen: (await snapshot(r)).modes.alternateScreen, mouseTracking: (await snapshot(r)).modes.mouseTracking, title: started.title };
        // Item 12: wheel over the TUI; then read the composer area for stray characters.
        const mid = await cellPoint(r, 20, Math.floor(before.rows / 2));
        await page.mouse.move(mid.x, mid.y);
        await page.mouse.wheel(0, -300);
        await sleep(300);
        await page.mouse.wheel(0, 300);
        await sleep(500);
        const afterWheel = await snapshot(r);
        item.wheel = { strayMouseSequences: afterWheel.lines.filter((l) => /\[<\d+;\d+;\d+[mM]|\d+;\d+[mM]$/.test(l)), lastLines: afterWheel.lines.slice(-6) };
        await probe.screenshot(`${r}-12-${tui}-after-wheel`);
        // Item 5 (⌥-drag inside the TUI while it tracks the mouse).
        const s1 = await cellPoint(r, 2, 2);
        const s2 = await cellPoint(r, 30, 3);
        await page.keyboard.down('Alt');
        await page.mouse.move(s1.x, s1.y);
        await page.mouse.down();
        await page.mouse.move(s2.x, s2.y, { steps: 6 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await sleep(200);
        item.altDrag = { selectionLength: (await probe.call('selection', r)).length };
        await page.mouse.click(mid.x, mid.y);
        // Item 4 (committed text, not composition): the composer takes Korean and Japanese text exactly.
        await probe.call('focus', r);
        await page.keyboard.insertText('한글 입력 にほんご');
        await sleep(800);
        const ime = await snapshot(r);
        item.imeInsert = { composerHasText: ime.lines.some((l) => l.includes('한글 입력 にほんご')), note: 'insertText commits without composition; real IME composition is the owner\'s manual run (M5)' };
        await probe.screenshot(`${r}-04-${tui}-korean-japanese`);
        for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
        await sleep(300);
        // Item 11: one short conversation; item 2's streaming rides on it.
        const syncBefore = (await state(r)).syncFrames;
        await page.keyboard.type('count to 20', { delay: 30 });
        await page.keyboard.press('Enter');
        let streamed = null;
        for (let i = 0; i < 90; i++) {
          await sleep(1000);
          const snap = await snapshot(r);
          const text = snap.lines.join('\n');
          // Nothing is granted mid-turn: a permission request stops the run with a screenshot.
          if (/\(y\/n\)|\[y\/N\]|Allow|Approve|Do you want to/.test(text.split('\n').slice(-12).join('\n')) && !/count to 20/.test(text.split('\n').slice(-3).join('\n'))) {
            await probe.screenshot(`${r}-${tui}-mid-turn-prompt`);
            throw new Error(`${tui}: a mid-turn prompt appeared; not answered (evidence/${r}-${tui}-mid-turn-prompt.png)`);
          }
          if (/\b20\b/.test(text) && /(19|nineteen)/i.test(text)) {
            streamed = snap;
            break;
          }
        }
        await idle(r, 2500, 8000);
        await probe.screenshot(`${r}-11-${tui}-streamed`);
        const afterTurn = await state(r);
        item.conversation = { answered: streamed !== null, syncFramesDuringTurn: afterTurn.syncFrames - syncBefore, lastLines: (await snapshot(r)).lines.slice(-8) };
        // Item 8: resize while the TUI runs.
        await probe.call('setSplit', r === 'xterm' ? 0.32 : 0.68);
        await idle(r, 1200);
        await probe.screenshot(`${r}-08-${tui}-resized`);
        const resized = await snapshot(r);
        item.resize = { cols: resized.cols, rows: resized.rows, lastLines: resized.lines.slice(-6) };
        await probe.call('setSplit', 0.5);
        await idle(r, 1200);
        await probe.screenshot(`${r}-08-${tui}-resized-back`);
        // Exit and item 1: the shell screen and scrollback are back.
        await exitTui(r, tui);
        const postSnap = await snapshot(r, 0);
        item.exit = { ...restorationCheck(preSnap, postSnap), lastLines: postSnap.lines.slice(-6) };
        await probe.screenshot(`${r}-01-${tui}-exited`);
        // Item 2 without the variable (claude only): the sync count at startup through a subshell that unsets it.
        if (tui === 'claude') {
          const syncBeforeNoSync = (await state(r)).syncFrames;
          await startTui(r, tui, `(unset CLAUDE_CODE_FORCE_SYNC_OUTPUT; exec ${bin})\r`, item);
          await sleep(1500);
          item.noSync = { syncFramesAtStartup: (await state(r)).syncFrames - syncBeforeNoSync, withVariableAtStartup: item.startup.syncFrames };
          await probe.screenshot(`${r}-02-claude-nosync`);
          await page.keyboard.type('/exit', { delay: 40 });
          await page.keyboard.press('Enter');
          await idle(r, 2000);
        }
        writeResult(`${r}-tui-${tui}`, item);
        log(r, tui, JSON.stringify(item).slice(0, 600));
        await probe.call('kill', r);
      }
    }
  }

  // ---- exit-check: item 1 for each TUI without a conversation (start, then /exit or /quit; no model usage) ----
  if (steps.has('exit-check')) {
    for (const r of live) {
      for (const tui of (args.get('tui') ?? 'claude,codex').split(',')) {
        const item = { tui, bin: bins[tui], renderer: r, prompts: [] };
        await spawnShell(r);
        await type(r, 'seq 1 5\r'); // a few lines of prior scrollback to restore
        await idle(r, 500);
        const preSnap = await snapshot(r, 0);
        item.before = { pid: (await state(r)).pid, lineCount: preSnap.lineCount, cursorRow: preSnap.baseY + preSnap.cursorY };
        await probe.call('capture', r, true); // what the program writes from start to exit
        const frame = await startTui(r, tui, `${bins[tui]}\r`, item);
        item.startup = { alternateScreen: frame.modes.alternateScreen, lineCountWhileOpen: frame.lineCount };
        await probe.screenshot(`${r}-01-${tui}-exit-check-open`);
        await exitTui(r, tui);
        const postSnap = await snapshot(r, 0);
        item.exit = restorationCheck(preSnap, postSnap);
        item.sequences = await probe.call('sequenceCounts', r);
        await probe.call('capture', r, false);
        await probe.screenshot(`${r}-01-${tui}-exit-check-restored`);
        writeResult(`${r}-exit-${tui}`, item);
        log(r, tui, 'exit-check', JSON.stringify({ intact: item.exit.priorScrollbackIntact, firstDifference: item.exit.firstDifference, priorRows: item.exit.priorRows, framesLeft: item.exit.tuiFramesInScrollback, lineCountAfter: item.exit.lineCountAfter, sequences: item.sequences }));
        await probe.call('kill', r);
      }
    }
  }

  // ---- replay: script -p of each recording into the other renderer, for side-by-side evidence ----
  if (steps.has('replay')) {
    for (const r of live) {
      for (const tui of ['claude', 'codex']) {
        const rec = join(here, 'recordings', `${tui}.rec`);
        if (!existsSync(rec)) continue;
        await spawnShell(r);
        await type(r, `script -p ${rec}\r`);
        await sleep(2500);
        await probe.screenshot(`${r}-11-${tui}-replay-early`);
        await idle(r, 3000);
        await probe.screenshot(`${r}-11-${tui}-replay-end`);
        writeResult(`${r}-replay-${tui}`, { lastLines: (await snapshot(r)).lines.slice(-10), modes: (await snapshot(r)).modes });
        await probe.call('kill', r);
      }
    }
  }

  if (args.get('keep-open')) {
    log('keeping the window open; Ctrl-C to end');
    await new Promise(() => {});
  }
} finally {
  writeResult('console', consoleLines);
  if (!args.get('keep-open')) {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
}
