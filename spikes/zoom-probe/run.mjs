// The spike's one command (UX wave U6b-5b, M1; docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M1's table):
// one launch of main.mjs per part of each row a to j, each on a scratch profile of its own under runs/<time>/profiles/,
// on the repository's own Electron. Prints one `RECORD <row> <verdict> {json}` line per row, and writes every part,
// with each launch's output, to runs/<time>/results.json. On Linux without a display it re-runs itself under xvfb-run,
// as spikes/viewer-frame/run.mjs does.
//
//   node run.mjs [--only=<row,row>] [--setuid-sandbox] [--look]
//
// --look: the windows come to the front (a person is looking); without it every window is shown inactive, so a run on
// a shared Mac never takes the keyboard.
//
// --setuid-sandbox: on a host whose kernel restricts unprivileged user namespaces (Ubuntu 24.04), Chromium's sandbox
// needs its setuid helper; this sets it on the repository's Electron with `sudo -n` (spikes/viewer-frame/FINDINGS.md,
// "Linux"). The sandbox is never turned off.
//
// Verdicts: PASS and FAIL where the document names what decides the row (c, d, f, h, i, j), RECORD where the row
// only records (a, b, e, g), NOT RUN for row j without a second display of another scale. A FAIL is one of M1's stops.
// The 15 s before a forced exit (rows b and d) is a wait the run makes, not a bound it asserts.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { pathsIn, scrubber } from './scrub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const electron = require('electron');
const version = require('electron/package.json').version;
if (process.platform === 'linux') {
  const helper = join(dirname(electron), 'chrome-sandbox');
  const s = statSync(helper);
  if (!(s.mode & 0o4000) || s.uid !== 0) {
    if (!argv['setuid-sandbox']) {
      console.error("the repository's Electron chrome-sandbox is not setuid root; pass --setuid-sandbox to set it with sudo -n");
      process.exit(2);
    }
    for (const args of [['chown', 'root:root', helper], ['chmod', '4755', helper]]) {
      const r = spawnSync('sudo', ['-n', ...args], { stdio: 'inherit' });
      if (r.status !== 0) process.exit(2);
    }
    console.error("set the repository's Electron chrome-sandbox setuid root");
  }
}

// What the run prints and stores names this folder as `<harness>`, never by its absolute path (a Preferences key holds
// the page's whole file URL), so a line can be copied into FINDINGS.md as it is.
// A text that still holds a path of the checkout or of the home folder after the scrub is not printed or stored: the run
// stops on it (scrub.test.mjs holds the scrub to that).
// The checkout (Electron's own lines name its node_modules) and the home folder (anything else under it) get theirs too.
const checkout = join(here, '..', '..');
const scrubOnly = scrubber({ '<harness>': here, '<checkout>': checkout, '<home>': homedir() });
const scrub = (text) => {
  const clean = scrubOnly(text);
  const left = pathsIn(clean, [here, checkout, homedir()]);
  if (left.length > 0) throw new Error('a record would print a path of this machine; nothing was written');
  return clean;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runs = join(here, 'runs', stamp);
const profiles = join(runs, 'profiles');
mkdirSync(profiles, { recursive: true });
const only = argv.only ? new Set(String(argv.only).split(',')) : null;
const LAUNCH_MS = 120_000; // a launch that has not exited by then is ended and reported as such

// One launch of main.mjs. `kill`: 'now' sends SIGKILL at the `ZOOMED` line, a number of ms that long after it.
function launch(label, args, { kill = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(electron, [here, ...args, ...(argv.look ? ['--look'] : [])], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' } });
    let out = '';
    let err = '';
    let killedAt = null;
    const guard = setTimeout(() => child.kill('SIGKILL'), LAUNCH_MS);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (kill !== null && killedAt === null && /(^|\n)ZOOMED\n/.test(out)) {
        killedAt = kill === 'now' ? 0 : kill;
        if (kill === 'now') child.kill('SIGKILL');
        else setTimeout(() => child.kill('SIGKILL'), kill);
      }
    });
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('exit', (code, signal) => {
      clearTimeout(guard);
      const results = out.split('\n').filter((l) => l.startsWith('RESULT ')).map((l) => JSON.parse(l.slice(7)));
      writeFileSync(join(runs, `${label}.log`), scrub(`${out}\n--- stderr ---\n${err}`));
      resolve({ label, code, signal, killedAfterMs: killedAt, results, stderrTail: err.split('\n').slice(-6).join(' ').slice(0, 600) });
    });
  });
}
const profile = (label) => {
  const dir = join(profiles, label);
  mkdirSync(dir, { recursive: true });
  return dir;
};
// A launch's result of that part, without main.mjs's own `job` and `part` fields (the row's parts carry labels of their own).
const part = (got, name) => {
  const found = got.results.find((r) => r.part === name);
  if (!found) return null;
  const { job: _job, part: _part, ...rest } = found;
  return rest;
};

// Every key path holding "zoom" in each Preferences file under the profile (the default session's is the profile's own),
// with its value: where Chromium keeps a zoom, by host or by the whole URL.
function zoomPrefs(dir) {
  const found = {};
  const walk = (folder, depth) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const st = statSync(path);
      if (st.isDirectory() && depth < 3) walk(path, depth + 1);
      else if (st.isFile() && name === 'Preferences') {
        let prefs;
        try {
          prefs = JSON.parse(readFileSync(path, 'utf8'));
        } catch (error) {
          found[path.slice(dir.length + 1)] = { unreadable: String(error) };
          continue;
        }
        const keys = [];
        const visit = (node, at) => {
          if (node === null || typeof node !== 'object') return;
          for (const [key, value] of Object.entries(node)) {
            const here = [...at, key];
            if (/zoom/i.test(key)) keys.push({ key: here.join('.'), value });
            else visit(value, here);
          }
        };
        visit(prefs, []);
        found[path.slice(dir.length + 1)] = keys;
      }
    }
  };
  if (existsSync(dir)) walk(dir, 0);
  return found;
}

const rows = {};
const want = (row) => !only || only.has(row);

// Rows a to d: a zooming launch in a mode, ended one way, then the stand-in on its profile.
async function kept(row, mode, end, kill = null) {
  const label = `${row}-${mode}-${end}`;
  const dir = profile(label);
  const zoomed = await launch(`${label}-zoom`, ['--job=zoom', `--profile=${dir}`, `--mode=${mode}`, '--factor=1.5', `--end=${kill === null ? 'quit' : 'hold'}`], { kill });
  const prefsAfterZoom = zoomPrefs(dir);
  const standin = await launch(`${label}-standin`, ['--job=standin', `--profile=${dir}`]);
  const opened = part(standin, 'opened');
  const set = part(zoomed, 'set');
  // the experiment stands only when the zooming launch set 1.5 in the mode asked and ended the way asked: a launch that
  // failed early leaves a clean profile, which would read as "nothing kept"
  const ended = kill === null ? zoomed.code === 0 && zoomed.signal === null : zoomed.signal === 'SIGKILL' && zoomed.killedAfterMs === (kill === 'now' ? 0 : kill);
  const valid = set !== null && set.factor === 1.5 && (mode !== 'isolated' || set.zoomMode === 'isolated') && ended && opened !== null;
  return {
    part: end,
    valid,
    set,
    zoomed: part(zoomed, 'zoomed'),
    exit: { code: zoomed.code, signal: zoomed.signal, killedAfterMs: zoomed.killedAfterMs },
    prefsAfterZoom,
    standinFactor: opened?.factor ?? null,
    standinPage: opened?.page ?? null,
    prefsAfterStandin: zoomPrefs(dir),
    ...(opened ? {} : { standinFailed: standin.stderrTail }),
  };
}
const keptAtOne = (parts) => parts.every((p) => p.standinFactor === 1 && p.standinPage?.zoom === 1);
// PASS or FAIL only over valid experiments; a part that did not stand makes the row FAIL as an experiment, said so
const keptVerdict = (parts) => (parts.some((p) => !p.valid) ? 'FAIL (an experiment did not stand)' : keptAtOne(parts) ? 'PASS' : 'FAIL');
const recordVerdict = (parts) => (parts.some((p) => !p.valid) ? 'FAIL (an experiment did not stand)' : 'RECORD');

if (want('a')) {
  const parts = [await kept('a', 'default', 'quit')];
  rows.a = { verdict: recordVerdict(parts), parts };
}
if (want('b')) {
  const parts = [await kept('b', 'default', 'kill-now', 'now'), await kept('b', 'default', 'kill-15s', 15_000)];
  rows.b = { verdict: recordVerdict(parts), parts };
}
if (want('c')) {
  const parts = [await kept('c', 'isolated', 'quit')];
  rows.c = { verdict: keptVerdict(parts), parts };
}
if (want('d')) {
  const parts = [await kept('d', 'isolated', 'kill-now', 'now'), await kept('d', 'isolated', 'kill-15s', 15_000)];
  rows.d = { verdict: keptVerdict(parts), parts };
}

// Row e: the factor after a reload and after another load.
if (want('e')) {
  const parts = [];
  for (const f of [0.5, 2]) {
    const got = await launch(`e-${f}`, ['--job=reload', `--profile=${profile(`e-${f}`)}`, `--factor=${f}`]);
    const loads = part(got, 'loads');
    parts.push({ part: `factor ${f}`, ...(loads ?? { failed: got.stderrTail }), keptAfterReload: loads?.afterReload.factor === f, keptAfterLoad: loads?.afterLoad.factor === f });
  }
  rows.e = { verdict: 'RECORD', parts };
}

// Row f: a way passes when, at both factors, the factor is in force at the show and the capture taken at the show has
// the line's ink at the factor times the control's height (within 10 %).
if (want('f')) {
  const control = part(await launch('f-f0', ['--job=show', `--profile=${profile('f-f0')}`, '--way=f0']), 'shown');
  const base = control?.inkSettled ?? null;
  const parts = [{ part: 'f0 (the control, at 1)', ...(control ?? { failed: 'no result' }) }];
  const passing = [];
  for (const way of ['f1', 'f2', 'f3']) {
    let all = true;
    for (const f of [0.5, 2]) {
      const shown = part(await launch(`f-${way}-${f}`, ['--job=show', `--profile=${profile(`f-${way}-${f}`)}`, `--way=${way}`, `--factor=${f}`]), 'shown');
      const ratio = shown && base && shown.inkAtShow !== null ? shown.inkAtShow / base : null;
      // a way passes only where it stood (f3: a painted frame before the show), with the factor in force at the show
      const stood = shown !== null && shown.stood === true;
      const atFactor = stood && shown.atShow === f && ratio !== null && Math.abs(ratio / f - 1) <= 0.1;
      all &&= atFactor;
      parts.push({ part: `${way} at ${f}`, ...(shown ?? { failed: 'no result' }), stood, inkRatioAtShow: ratio === null ? null : Math.round(ratio * 1000) / 1000, atFactorWhenShown: atFactor });
    }
    if (all) passing.push(way);
  }
  rows.f = { verdict: passing.length > 0 ? 'PASS' : 'FAIL', openAt: passing[0] ?? null, passing, parts };
}

// Row g: what the other two windows take.
if (want('g')) {
  const parts = [];
  for (const mode of ['default', 'isolated']) {
    const got = await launch(`g-${mode}`, ['--job=windows', `--profile=${profile(`g-${mode}`)}`, `--mode=${mode}`]);
    const others = part(got, 'others');
    // the others' factors count only where the propagation control took the zoom (and first was at it)
    parts.push({ part: mode, ...(others ?? { failed: got.stderrTail }), established: !!others && others.firstReflects && others.control.took });
  }
  rows.g = { verdict: parts.every((p) => p.established) ? 'RECORD' : 'FAIL (an experiment did not stand)', parts };
}

// Row h: the child view's own factor is 1 and its bounds are the box's rect times the factor, edge by edge.
const sameRect = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
if (want('h')) {
  const parts = [];
  for (const f of [0.5, 2]) {
    const placed = part(await launch(`h-${f}`, ['--job=view', `--profile=${profile(`h-${f}`)}`, `--factor=${f}`]), 'placed');
    parts.push({ part: `factor ${f}`, ...(placed ?? { failed: 'no result' }), stood: !!placed && placed.reflected, ok: !!placed && placed.reflected && placed.viewFactor === 1 && placed.appFactor === f && sameRect(placed.viewBounds, placed.want) && placed.viewInner.width === placed.want.width });
  }
  rows.h = { verdict: parts.some((p) => !p.stood) ? 'FAIL (an experiment did not stand)' : parts.every((p) => p.ok) ? 'PASS' : 'FAIL', parts };
}

// Row i: the call exists and the preference took.
if (want('i')) {
  const api = part(await launch('i', ['--job=api', `--profile=${profile('i')}`]), 'api');
  // both are needed: the call exists, and the mode the preference set reads back as isolated (no getter: not shown, a stop)
  const ok = api?.setZoomMode === 'function' && api.getZoomMode === 'function' && api.mode === 'isolated';
  rows.i = { verdict: ok ? 'PASS' : 'FAIL', parts: [{ part: 'api', ...(api ?? { failed: 'no result' }) }] };
}

// Row j: on a Mac with two displays of different scale only. A changed devicePixelRatio is recorded, not judged.
if (want('j')) {
  const got = await launch('j', ['--job=view', `--profile=${profile('j')}`, '--factor=1.25', '--move']);
  const moved = part(got, 'moved');
  // NOT RUN only for the launch's own word that no display of another scale is at hand; a launch that gave no answer
  // failed. A move counts only once the window reached the display asked and the page settled at the factor there.
  if (!moved) rows.j = { verdict: 'FAIL (the experiment gave no result)', parts: [{ part: 'move', failed: got.stderrTail }] };
  else if (moved.notRun) rows.j = { verdict: 'NOT RUN', parts: [{ part: 'move', ...moved }] };
  else {
    const reached = (at, display) => at.display === display && at.settled;
    const holds = (at) => at.appFactor === 1.25 && sameRect(at.againstBox.want, at.againstBox.bounds);
    const verdict = !reached(moved.there, moved.to.id) || !reached(moved.back, moved.from.id) ? 'FAIL (the move did not complete)' : holds(moved.there) && holds(moved.back) ? 'PASS' : 'FAIL';
    rows.j = { verdict, parts: [{ part: 'move', ...moved }] };
  }
}

writeFileSync(join(runs, 'results.json'), scrub(JSON.stringify({ electron: version, platform: `${process.platform} ${process.arch}`, stamp, rows }, null, 1)));
// One line per row, its decisive values in brief (the parts in full are in results.json).
const brief = {
  a: (r) => r.parts.map((p) => ({ end: p.part, valid: p.valid, standin: p.standinFactor, prefs: p.prefsAfterZoom })),
  b: (r) => r.parts.map((p) => ({ end: p.part, valid: p.valid, standin: p.standinFactor, prefs: p.prefsAfterZoom })),
  c: (r) => r.parts.map((p) => ({ end: p.part, valid: p.valid, standin: p.standinFactor, prefs: p.prefsAfterZoom })),
  d: (r) => r.parts.map((p) => ({ end: p.part, valid: p.valid, standin: p.standinFactor, prefs: p.prefsAfterZoom })),
  e: (r) => r.parts.map((p) => ({ at: p.part, afterReload: p.afterReload?.factor, afterLoad: p.afterLoad?.factor })),
  f: (r) => ({ openAt: r.openAt, ways: r.parts.map((p) => ({ way: p.part, stood: p.stood, atDomReady: p.atDomReady, atShow: p.atShow, inkRatio: p.inkRatioAtShow, ok: p.atFactorWhenShown })) }),
  g: (r) => r.parts.map((p) => ({ mode: p.part, established: p.established, control: p.control, first: p.first, openBefore: p.openBefore, openedAfter: p.openedAfter })),
  h: (r) => r.parts.map((p) => ({ at: p.part, viewFactor: p.viewFactor, want: p.want, bounds: p.viewBounds, inner: p.viewInner })),
  i: (r) => r.parts[0],
  j: (r) => (r.verdict === 'NOT RUN' ? r.parts[0] : { there: r.parts[0].there?.againstBox, back: r.parts[0].back?.againstBox, dpr: [r.parts[0].before?.page?.dpr, r.parts[0].there?.page?.dpr, r.parts[0].back?.page?.dpr] }),
};
for (const [row, r] of Object.entries(rows)) console.log(scrub(`RECORD ${row} ${r.verdict} ${JSON.stringify(brief[row](r))}`));
console.log(`\nelectron ${version}, ${process.platform} ${process.arch}; evidence: runs/${stamp}`);
