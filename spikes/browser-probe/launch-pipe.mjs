// S2 (a) route 3: --remote-debugging-pipe through Playwright's own Electron launcher (`_electron.launch`), which owns
// the pipe fds of the process it spawns. This is the e2e model (an external driver), not the in-app model: MAWS's main
// process cannot hold the pipe of its own process, so this route is measured for completeness and to show what
// Playwright exposes of an app's WebContentsViews.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { findProbePage, inventory, runDriver } from './cdp/driver.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright-core');
const here = dirname(fileURLToPath(import.meta.url));
const now = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;
const log = (...a) => console.log('[probe]', ...a);
const PAGE_PREFIX = 'http://127.0.0.1:17333/';
const cssPathSource = readFileSync(join(here, 'shared', 'locator.cjs'), 'utf8').replace(/module\.exports[^\n]*\n?/g, '');

const out = { route: 'remote-debugging-pipe via playwright _electron.launch' };
const t0 = now();
const electronApp = await _electron.launch({ executablePath: require('electron'), args: [here, '--scenario=cdp-pipe'], cwd: here });
out.launchMs = round(now() - t0);
out.launcherSwitches = await electronApp.evaluate(() => process.argv.filter((a) => a.startsWith('--')));
const browser = electronApp.context().browser();
const t1 = now();
const page = await findProbePage(electronApp.context().browser() ?? { contexts: () => [electronApp.context()] }, PAGE_PREFIX, { timeoutMs: 10000 }) ?? (await electronApp.firstWindow());
out.firstWindowMs = round(now() - t1);
out.windows = electronApp.windows().map((w) => w.url());
out.inventory = browser ? inventory(browser) : { note: 'electron context only', pages: electronApp.context().pages().map((p) => p.url()) };
if (!page.url().startsWith(PAGE_PREFIX)) throw new Error(`unexpected window ${page.url()}`);
out.driver = await runDriver({ browser, page, pageUrl: `${PAGE_PREFIX}index.html`, cssPathSource, log });
out.mainProcessEvaluate = await electronApp.evaluate(({ app }) => ({ version: process.versions.electron, name: app.getName() }));
await electronApp.close();
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', 'cdp-pipe.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
