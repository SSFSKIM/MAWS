// R8 (C8c of docs/charter.md; docs/doperpowers/plans/2026-09-28-c8c-code-tools.md, *Spike specifications*): does
// `@git-diff-view/react` take C4's multi-file unified patch, split per file, and render it unified and split, a
// 5,000-line file included; does CodeMirror 6 read-only jump to a line; and what do the two libraries weigh.
//
//   pnpm -C spikes/code-tools install --ignore-workspace && node spikes/code-tools/check.mjs [--rewrite-fixture] [--skip-product]
//
// Prints one line per case; exits non-zero when a render case fails. Budgets are reported, not enforced.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { splitPatch } from './split-patch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const fixturePath = join(repoRoot, 'test/fixtures/git/three-files.patch');
const args = new Set(process.argv.slice(2));
let failed = false;
const report = (ok, line) => {
  if (!ok) failed = true;
  console.log(`${ok ? '' : 'FAIL '}${line}`);
};

// ---- the scratch repository and the pinned patch ------------------------------------------------------------------
// Git runs isolated from this machine's configuration (C8a's scratchRepository() environment), with fixed dates, so the
// patch is byte-identical on every run: the `index` lines are blob hashes of fixed contents.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'R8',
  GIT_AUTHOR_EMAIL: 'r8@example.invalid',
  GIT_COMMITTER_NAME: 'R8',
  GIT_COMMITTER_EMAIL: 'r8@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-29T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-29T00:00:00Z',
};
const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, env: gitEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const BIG_LINES = 5000;
const BIG_EDITS = [120, 610, 1100, 1590, 2080, 2570, 3060, 3550, 4040, 4530]; // ten scattered places
const bigLine = (i) => `export const value${String(i).padStart(4, '0')} = { id: ${i}, label: 'line ${i}', enabled: ${i % 2 === 0} };`;
const renamedLines = Array.from({ length: 20 }, (_, i) => `export function helper${i}(input: number): number { return input * ${i}; }`);

function buildScratch() {
  const dir = mkdtempSync(join(tmpdir(), 'r8-scratch-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'src/big.ts'), Array.from({ length: BIG_LINES }, (_, i) => bigLine(i + 1)).join('\n') + '\n');
  writeFileSync(join(dir, 'src/helpers.ts'), renamedLines.join('\n') + '\n');
  writeFileSync(join(dir, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  // Ten edits in the 5,000-line file: eight modifications, one two-line insertion, one deletion.
  const big = Array.from({ length: BIG_LINES }, (_, i) => bigLine(i + 1));
  for (const [n, at] of BIG_EDITS.entries()) {
    if (n === 4) big.splice(at, 0, `// inserted after line ${at}`, `export const inserted${at} = true;`);
    else if (n === 7) big.splice(at + 1, 1);
    else big[at - 1 + (n > 7 ? 1 : n > 4 ? 2 : 0)] = bigLine(at).replace('enabled', 'visible');
  }
  writeFileSync(join(dir, 'src/big.ts'), big.join('\n') + '\n');
  // A rename with a one-line edit (similarity stays well above git's 50%).
  git(dir, 'mv', 'src/helpers.ts', 'src/math-helpers.ts');
  const renamed = [...renamedLines];
  renamed[9] = 'export function helper9(input: number): number { return input * 90; }';
  writeFileSync(join(dir, 'src/math-helpers.ts'), renamed.join('\n') + '\n');
  // A binary change.
  writeFileSync(join(dir, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2]));
  // C4's flags (src/main/git/service.ts, `git.diff` scope 'all': the working tree against HEAD).
  const patch = git(dir, '-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', 'HEAD');
  const numstat = git(dir, 'diff', '--numstat', 'HEAD');
  const bigText = big.join('\n') + '\n';
  rmSync(dir, { recursive: true, force: true });
  return { patch, numstat, bigText };
}

const scratch = buildScratch();
if (!existsSync(fixturePath) || args.has('--rewrite-fixture')) {
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, scratch.patch);
  console.log(`wrote ${fixturePath}`);
}
const pinned = readFileSync(fixturePath, 'utf8');
report(pinned === scratch.patch, `fixture reproducible: ${pinned === scratch.patch ? 'yes' : 'no'} (${pinned.length} bytes)`);
const files = splitPatch(pinned);
report(
  files.length === 3 &&
    files.some((f) => f.kind === 'renamed' && f.oldPath === 'src/helpers.ts' && f.path === 'src/math-helpers.ts' && f.hunks.length === 1) &&
    files.some((f) => f.kind === 'binary' && f.path === 'assets/logo.png' && f.hunks.length === 0) &&
    files.some((f) => f.kind === 'modified' && f.path === 'src/big.ts' && f.hunks.length === 10) &&
    files.every((f) => f.hunks.every((hunk) => hunk.startsWith('@@'))),
  `splitPatch: ${files.map((f) => `${f.path} ${f.kind} ${f.hunks.length} hunks`).join('; ')}`,
);

// A file at Review's cap (REVIEW_FILE_LINES_CAP = 5,000 changed lines): the 5,000-line file added whole, one hunk.
const atCap = {
  path: 'src/big.ts',
  oldPath: null,
  kind: 'added',
  hunks: [`@@ -0,0 +1,${BIG_LINES} @@\n` + scratch.bigText.trimEnd().split('\n').map((line) => `+${line}`).join('\n')],
  header: '',
};

// ---- the scratch render -------------------------------------------------------------------------------------------
// A production build of the page (React's production build, as the product ships), served by `vite preview`; `--dev`
// serves it from the dev server instead (React's development build, roughly 2-3x slower to render).
let server;
if (args.has('--dev')) {
  server = await createServer({ root: join(here, 'page'), logLevel: 'error', server: { port: 0 } });
  await server.listen();
} else {
  const outDir = join(here, 'dist/page');
  await build({ root: join(here, 'page'), logLevel: 'error', configFile: false, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 100000 } });
  server = await preview({ root: join(here, 'page'), logLevel: 'error', configFile: false, build: { outDir }, preview: { port: 0 } });
}
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
const consoleErrors = [];
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
page.on('pageerror', (error) => consoleErrors.push(String(error)));
await page.goto(url);
await page.waitForFunction(() => window.__spike);
// @git-diff-view/shiki creates its highlighter (35 languages) at import time (its deprecated `highlighterReady`), so by
// the time the page runs this the promise has usually settled; the time from navigation is what the import costs.
const shikiInit = await page.evaluate(async () => ({ call: await window.__spike.shikiInit(), sinceNavigation: performance.now() }));
console.log(`shiki highlighter ready ${Math.round(shikiInit.sinceNavigation)} ms after navigation (getDiffViewHighlighter() itself ${Math.round(shikiInit.call)} ms: created at import)`);
console.log(`render mode: ${args.has('--dev') ? 'vite dev server, React development build' : 'vite production build, React production build'}`);

// Each patch file in both modes, wrap off and on, both themes, three highlighters. A text file must show every hunk
// header of its splitPatch entry and, in unified mode, exactly its added and deleted lines; the binary file never
// reaches DiffView (the shell's row). DiffView gets one string per file with a `---`/`+++` header (see review-view.js).
const counts = (file) => {
  const lines = file.hunks.flatMap((hunk) => hunk.split('\n').slice(1));
  return { added: lines.filter((l) => l.startsWith('+')).length, deleted: lines.filter((l) => l.startsWith('-')).length };
};
const results = [];
const render = (opts) => page.evaluate((o) => window.__spike.renderDiff(o), { feed: 'joined', wrap: false, theme: 'light', highlight: 'none', ...opts });
for (const mode of ['split', 'unified']) {
  const problems = [];
  for (const file of files)
    for (const wrap of [false, true])
      for (const theme of ['light', 'dark'])
        for (const highlight of ['none', 'lowlight', 'shiki']) {
          const r = await render({ file, mode, wrap, theme, highlight });
          results.push({ path: file.path, mode, wrap, theme, highlight, ...r });
          const headers = r.hunkHeaders.filter(Boolean);
          const expected = counts(file);
          const ok =
            file.kind === 'binary'
              ? r.placeholder !== null && r.rows === 0
              : r.errors.length === 0 &&
                headers.length === file.hunks.length &&
                headers.every((header, i) => file.hunks[i].startsWith(header)) &&
                (mode === 'split' || (r.addedCells === expected.added && r.deletedCells === expected.deleted));
          if (!ok) problems.push(`${file.path} wrap ${wrap} ${theme} ${highlight}: ${JSON.stringify({ ...r, firstContentHtml: undefined })}`);
        }
  report(problems.length === 0, `${mode} 3 files ${problems.length ? 'failed: ' + problems.slice(0, 3).join(' | ') : 'ok'}`);
}
const detail = (path, mode, highlight = 'none') => results.find((r) => r.path === path && r.mode === mode && !r.wrap && r.theme === 'light' && r.highlight === highlight);
for (const mode of ['split', 'unified'])
  for (const f of files) {
    const r = detail(f.path, mode);
    const e = counts(f);
    console.log(`  ${mode} ${f.path} (${f.kind}): ${r.placeholder ? 'placeholder row, DiffView not mounted' : `hunks ${r.hunkHeaders.filter(Boolean).length}/${f.hunks.length}, line rows ${r.lineRows}, add cells ${r.addedCells} (+${e.added}), del cells ${r.deletedCells} (-${e.deleted})`}`);
  }
for (const path of ['src/math-helpers.ts', 'src/big.ts'])
  console.log(`  syntax tokens in ${path} (unified): none ${detail(path, 'unified').syntaxSpans}, lowlight ${detail(path, 'unified', 'lowlight').syntaxSpans}, shiki ${detail(path, 'unified', 'shiki').syntaxSpans}`);
const overflow = (wrap) => results.some((r) => r.path === 'src/big.ts' && r.wrap === wrap && r.horizontalOverflow);
console.log(`  src/big.ts horizontal overflow: wrap off ${overflow(false) ? 'present' : 'none'}, wrap on ${overflow(true) ? 'present' : 'none'}`);
const bare = await render({ file: files.find((f) => f.kind === 'renamed'), mode: 'unified', feed: 'bare' });
const perHunk = await render({ file: files.find((f) => f.path === 'src/big.ts'), mode: 'unified', feed: 'per-hunk' });
console.log(`  feed shapes: bare '@@' strings render ${bare.lineRows} line rows; one header per hunk renders ${perHunk.hunkHeaders.filter(Boolean).length} hunks`);

// The 5,000-line file: the pinned patch's ten hunks, then the whole file added at Review's cap (5,000 changed lines),
// and a 1,990-line file added whole (under the library's 2,000-line syntax threshold) to price highlighting.
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const paint = async (file, mode, highlight) => {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push((await render({ file, mode, highlight })).ms);
  return Math.round(median(runs));
};
const bigFile = files.find((f) => f.path === 'src/big.ts');
const lines1990 = scratch.bigText.split('\n').slice(0, 1990);
const near = { ...atCap, path: 'src/near.ts', hunks: [`@@ -0,0 +1,1990 @@\n` + lines1990.map((l) => `+${l}`).join('\n')] };
const HIGHLIGHTERS = ['none', 'lowlight', 'shiki'];
const paintsOf = async (file, modes = ['split', 'unified']) => {
  const out = {};
  for (const mode of modes) for (const highlight of HIGHLIGHTERS) out[`${mode}-${highlight}`] = await paint(file, mode, highlight);
  return out;
};
const list = (paints) => Object.entries(paints).map(([k, v]) => `${k} ${v}`).join(', ');
const scrollOf = async (file, mode) => {
  const rendered = await render({ file, mode });
  const scroll = await page.evaluate(() => window.__spike.scrollDiff());
  return `${mode}: ${rendered.lineRows} line rows in the DOM, ${scroll.steps} steps of 300 px, ${(scroll.ms / scroll.steps).toFixed(1)} ms per frame, long tasks ${scroll.longTasks.length}${scroll.longTasks.length ? ' (' + scroll.longTasks.map(Math.round).join(', ') + ' ms)' : ''}`;
};
// The gate's case: the 5,000-line file edited at ten places, as C4's patch carries it.
const tenHunks = await paintsOf(bigFile);
const worst = Math.max(...Object.values(tenHunks));
report(worst < 500, `5000-line first paint ${worst} ms (worst of split/unified x none/lowlight/shiki, median of 3: ${list(tenHunks)})`);
for (const mode of ['unified', 'split']) {
  const line = await scrollOf(bigFile, mode);
  report(!/long tasks [1-9]/.test(line), `5000-line scroll ${line}`);
}
// Beyond the gate: a file at Review's cap (5,000 changed lines) and one under the library's syntax threshold.
const cap = await paintsOf(atCap);
console.log(`  at REVIEW_FILE_LINES_CAP (5,000 added lines, one hunk) first paint ms: ${list(cap)}${Math.max(...Object.values(cap)) >= 500 ? ' (over 500 ms)' : ''}`);
for (const mode of ['unified', 'split']) console.log(`  at the cap, scroll ${await scrollOf(atCap, mode)}`);
const nearPaints = await paintsOf(near, ['unified']);
const nearRender = await render({ file: near, mode: 'unified', highlight: 'shiki' });
console.log(`  1,990 added lines, first paint ms: ${list(nearPaints)} (shiki tokens ${nearRender.syntaxSpans})`);

// CodeMirror: the 5,000-line text, the language by filename, a jump to line 4,321.
const cm = await page.evaluate((opts) => window.__spike.renderCode(opts), { text: scratch.bigText, name: 'big.ts', line: 4321 });
const centred = Math.abs(cm.offsetFromCentre) <= 20 && cm.lineText === scratch.bigText.split('\n')[4320];
report(centred && cm.readOnly && cm.editable === 'false', `cm6 jump line 4321 ${centred ? 'centred' : 'not centred'} (offset ${cm.offsetFromCentre} px; first paint of 5,000 lines ${Math.round(cm.paintMs)} ms; language ${cm.language} loaded in ${Math.round(cm.languageMs)} ms; jump painted in ${Math.round(cm.jumpMs)} ms, ${cm.highlightedSpans} highlighted tokens in view ${Math.round(cm.highlightMs)} ms after the jump; readOnly ${cm.readOnly}, contenteditable ${cm.editable})`);
report(consoleErrors.length === 0, `page errors: ${consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : 'none'}`);
await server.close();

// The same page built with `lowlight` aliased to a module without grammars (how the product would drop highlight.js's
// ~900 KB): DiffView must still render, the shiki highlighter must still colour, the default one just colours nothing.
const lowlightShim = { lowlight: join(here, 'entries/lowlight-no-grammars.js') };
if (!args.has('--dev')) {
  const outDir = join(here, 'dist/page-bare');
  await build({ root: join(here, 'page'), logLevel: 'error', configFile: false, resolve: { alias: lowlightShim }, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 100000 } });
  const bareServer = await preview({ root: join(here, 'page'), logLevel: 'error', configFile: false, build: { outDir }, preview: { port: 0 } });
  consoleErrors.length = 0;
  await page.goto(bareServer.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__spike);
  await page.evaluate(() => window.__spike.shikiInit());
  const renamedFile = files.find((f) => f.kind === 'renamed');
  const bareRuns = {};
  for (const highlight of HIGHLIGHTERS) bareRuns[highlight] = await render({ file: renamedFile, mode: 'split', highlight });
  const ok = Object.values(bareRuns).every((r) => r.hunkHeaders.filter(Boolean).length === 1 && r.errors.length === 0) && bareRuns.shiki.syntaxSpans > 0 && consoleErrors.length === 0;
  report(ok, `lowlight aliased out: renders ${ok ? 'ok' : 'failed'} (tokens: none ${bareRuns.none.syntaxSpans}, lowlight ${bareRuns.lowlight.syntaxSpans}, shiki ${bareRuns.shiki.syntaxSpans}; page errors ${consoleErrors.length})`);
  await bareServer.close();
}
await browser.close();

// ---- bundle weights -----------------------------------------------------------------------------------------------
// One vite build per entry, react and react-dom external (the product already carries them). A chunk is a "language"
// when every module in it is a grammar or a theme (shiki's @shikijs/langs|themes, CodeMirror's lang-* and legacy modes).
const LANGUAGE = /@shikijs[+/](langs|themes)|@codemirror[+/](lang-|legacy-modes)|@lezer[+/](?!highlight|common|lr)|shiki[+/]dist[/](langs|themes)/;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
async function weigh(name, entry, aliases = {}) {
  const outDir = join(here, 'dist', name);
  const output = await build({
    root: here,
    logLevel: 'error',
    configFile: false,
    resolve: { alias: aliases },
    build: {
      outDir,
      emptyOutDir: true,
      modulePreload: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 100000,
      rollupOptions: { input: join(here, 'entries', entry), external: [/^react($|\/)/, /^react-dom($|\/)/] },
    },
  });
  const chunks = (Array.isArray(output) ? output[0] : output).output.filter((o) => o.type === 'chunk');
  const sum = (list) => list.reduce((acc, c) => ({ min: acc.min + Buffer.byteLength(c.code), gz: acc.gz + gzipSync(c.code).length }), { min: 0, gz: 0 });
  const isLanguage = (c) => Object.keys(c.modules).length > 0 && Object.keys(c.modules).every((id) => LANGUAGE.test(id));
  const entryChunk = chunks.filter((c) => c.isEntry);
  const lazy = chunks.filter((c) => !c.isEntry && !isLanguage(c));
  const languages = chunks.filter((c) => !c.isEntry && isLanguage(c));
  const css = (Array.isArray(output) ? output[0] : output).output.filter((o) => o.type === 'asset' && o.fileName.endsWith('.css'));
  const cssBytes = css.reduce((n, a) => n + Buffer.byteLength(a.source), 0);
  return { entry: sum(entryChunk), lazy: sum(lazy), languages: { ...sum(languages), count: languages.length }, total: sum([...entryChunk, ...lazy]), css: cssBytes, chunks };
}

const diffView =await weigh('diff-view', 'diff-view.js');
const diffViewBare = await weigh('diff-view-bare', 'diff-view.js', lowlightShim);
const codemirror = await weigh('codemirror', 'codemirror.js');
const shikiBase = await weigh('shiki-base', 'shiki-base.js');
const shikiPlugin = await weigh('shiki-plugin', 'shiki-plugin.js', lowlightShim);
const shell = await weigh('lazy-shell', 'shell.js', lowlightShim);
const shikiCopies = readdirSync(join(here, 'node_modules/.pnpm')).filter((d) => /^shiki@/.test(d));

console.log(`diff-view ${kb(diffView.total.gz)} gz (${kb(diffView.total.min)} min, css ${kb(diffView.css)}; highlight.js grammars included, as shipped: @git-diff-view/core imports lowlight's \`all\`)`);
report(diffViewBare.total.min < 250 * 1024, `diff-view excluding the highlighter grammars ${kb(diffViewBare.total.gz)} gz (${kb(diffViewBare.total.min)} min; budget 250 KB min)`);
report(codemirror.total.min < 400 * 1024, `codemirror ${kb(codemirror.total.gz)} gz (${kb(codemirror.total.min)} min, read-only + theme + search, languages excluded; budget 400 KB min)`);
const pluginIncrement = { min: shikiPlugin.total.min - diffViewBare.total.min - shikiBase.total.min, gz: shikiPlugin.total.gz - diffViewBare.total.gz - shikiBase.total.gz };
report(pluginIncrement.min < 100 * 1024, `shiki-plugin ${kb(pluginIncrement.gz)} gz (shared shiki: ${shikiCopies.length === 1 ? 'yes' : 'no'}) (${kb(pluginIncrement.min)} min over C6's shiki entry points and the bare diff view; C6's shiki itself ${kb(shikiBase.total.gz)} gz / ${kb(shikiBase.total.min)} min; ${shikiCopies.join(', ')})`);
console.log(`lazy boundary: entry ${kb(shell.entry.gz)} gz (${kb(shell.entry.min)} min) vs lazy chunks ${kb(shell.lazy.gz)} gz (${kb(shell.lazy.min)} min; lowlight grammars aliased out), language chunks ${shell.languages.count}`);
const entryModules = Object.keys(shell.chunks.find((c) => c.isEntry).modules);
report(!entryModules.some((id) => /@codemirror|@git-diff-view|lowlight|highlight\.js/.test(id)), `lazy boundary: entry chunk holds ${entryModules.length} modules, none of @codemirror, @git-diff-view, lowlight or highlight.js`);

// ---- the product's main renderer chunk, the baseline registerCodeTools() will be measured against at M2 and M3 ----
if (!args.has('--skip-product')) {
  execFileSync('pnpm', ['-C', repoRoot, 'exec', 'electron-vite', 'build'], { stdio: 'ignore' });
  // The main chunk is the one index.html loads (another `index-*.js` can be a lazy chunk of a library's index module).
  const main = readFileSync(join(repoRoot, 'out/renderer/index.html'), 'utf8').match(/src="\.\/(assets\/index-[^"]+\.js)"/)[1];
  const code = readFileSync(join(repoRoot, 'out/renderer', main));
  console.log(`product main renderer chunk ${main}: ${kb(code.length)} min, ${kb(gzipSync(code).length)} gz (baseline before C8c)`);
}

process.exit(failed ? 1 : 0);
