// S1 of board #90 (cua docs/doperpowers/specs/2026-10-08-maws-browser-chrome-design.md, Plan of Work S1): can a
// WebContentsView in a partition's session show an extension's default_popup usefully under Electron 44.4.5?
//
// `node spikes/extension-popup/run.mjs [--show]` from the MAWS root. It builds the variants into scratch/ (gitignored):
//   mv3          the fixture probe extension (spikes/browser-probe/ext/test-ext, copied, never edited) plus pages/popup.*
//                and pages/options.*, with action.default_popup and options_ui.page; its sw.js gains one onConnect
//                listener so chrome.runtime.connect has an answerer (the fixture's onMessage echo answers sendMessage)
//   mv3-nopopup  the same without default_popup, its sw.js gaining a chrome.action.onClicked listener that records
//                clicks in storage, for the onClicked question
//   mv2          mv2/ (a background page) plus the same pages, browser_action.default_popup and options_page
// then fetches two public MIT extensions by pinned release URL (Dark Reader 4.9.133 MV3 and MV2 builds, Refined GitHub
// 26.10), launches Electron (node_modules/.bin/electron) on main.mjs with its own user data under scratch/, and prints
// main's `[spike]` lines, which also land in results/run.txt. Never touches the owner's Chrome profile or MAWS's data.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const scratch = join(here, 'scratch');
const fixture = join(root, 'spikes/browser-probe/ext/test-ext');
const show = process.argv.includes('--show');

const PUBLIC = [
  { name: 'darkreader-mv3', url: 'https://github.com/darkreader/darkreader/releases/download/v4.9.133/darkreader-chrome-mv3.zip' },
  { name: 'darkreader-mv2', url: 'https://github.com/darkreader/darkreader/releases/download/v4.9.133/darkreader-chrome.zip' },
  { name: 'refined-github', url: 'https://github.com/refined-github/refined-github/releases/download/26.10/refined-github-26.10-for-local-testing-only.zip' },
];

const extDir = join(scratch, 'ext');
rmSync(extDir, { recursive: true, force: true });
rmSync(join(scratch, 'userData'), { recursive: true, force: true }); // a fresh profile every run
mkdirSync(extDir, { recursive: true });

function variant(name, from, edit) {
  const dir = join(extDir, name);
  cpSync(from, dir, { recursive: true });
  cpSync(join(here, 'pages'), dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  edit(manifest, dir);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { name, dir, kind: 'probe' };
}

const extensions = [
  variant('mv3', fixture, (m, dir) => {
    m.action = { ...m.action, default_popup: 'popup.html' };
    m.options_ui = { page: 'options.html', open_in_tab: true };
    appendFileSync(join(dir, 'sw.js'), `
// S1: an answerer for the popup's chrome.runtime.connect.
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => port.postMessage({ pong: msg && msg.ping, from: 'service-worker', via: 'port' }));
});
`);
  }),
  variant('mv3-nopopup', fixture, (m, dir) => {
    m.name = 'MAWS probe extension (no popup)';
    m.options_ui = { page: 'options.html', open_in_tab: true };
    appendFileSync(join(dir, 'sw.js'), `
// S1: does anything fire chrome.action.onClicked? Clicks land in storage for the spike to read.
chrome.storage.local.set({ onClickedType: typeof (chrome.action && chrome.action.onClicked && chrome.action.onClicked.addListener) });
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    chrome.storage.local.get('clicks').then(({ clicks = [] }) => chrome.storage.local.set({ clicks: [...clicks, { at: Date.now(), tabId: tab ? tab.id : null }] }));
  });
}
`);
  }),
  variant('mv2', join(here, 'mv2'), () => {}),
];

const downloads = join(scratch, 'downloads');
mkdirSync(downloads, { recursive: true });
for (const { name, url } of PUBLIC) {
  const zip = join(downloads, `${name}.zip`);
  try {
    if (!existsSync(zip)) execFileSync('curl', ['-fsSL', '-m', '60', '-o', zip, url], { stdio: 'pipe' });
    const dir = join(extDir, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: 'pipe' });
    extensions.push({ name, dir, kind: 'public', url });
  } catch (e) {
    rmSync(zip, { force: true });
    extensions.push({ name, dir: null, kind: 'public', url, blocked: `blocked: network (${String(e.message).split('\n')[0]})` });
  }
}

const results = join(here, 'results');
mkdirSync(results, { recursive: true });
const out = [];
const electron = join(root, 'node_modules/.bin/electron');
const child = spawn(electron, [join(here, 'main.mjs')], {
  cwd: here,
  env: { ...process.env, SPIKE_SCRATCH: scratch, SPIKE_EXTENSIONS: JSON.stringify(extensions), SPIKE_SHOW: show ? '1' : '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let pending = '';
child.stdout.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop();
  for (const line of lines) if (line.startsWith('[spike]')) { out.push(line); console.log(line); }
});
const stderr = [];
child.stderr.on('data', (chunk) => stderr.push(chunk));
child.on('exit', (code, signal) => {
  out.push(`[spike] electron exited: code ${code}${signal ? ` signal ${signal}` : ''}`);
  console.log(out.at(-1));
  writeFileSync(join(results, show ? 'run-show.txt' : 'run.txt'), `${out.join('\n')}\n`);
  writeFileSync(join(scratch, 'stderr.txt'), Buffer.concat(stderr));
  process.exitCode = code ?? 1;
});
