// P2-B's acceptance run (the P2-B execution document §6.3, M6's last step; §4 items 1 to 10 as far as the landed
// siblings let them run): the built app against the installed engine behind ClaudeUsage's relay, in E8's live scratch
// layout (support/plugins-live.ts: a scratch root under /tmp holding the config home, the trusted repository and the
// log), so no step can reach ~/.claude. Setup runs the engine's own CLI against the scratch home only (`env -i` with
// HOME and CLAUDE_CONFIG_DIR inside the scratch root): the Anthropic marketplace added from GitHub (network-dependent: a
// refusal is recorded and the counts check is skipped with its words), code-review installed for the user,
// frontend-design for the scratch repository, supabase for another project only; a user skill and a project skill
// written. Then, through Playwright: one Haiku turn in the repository and the session stopped; `/plugins` at its library
// size with Esc handing the keyboard back; My items' groups; frontend-design's detail ("Loaded last time"); the loaded
// line on the exited session ("Loaded last time, <relative>" with Refresh) with no engine started; `/skills` on the
// exited session in P2-A's dormant state, starting nothing until its Load now (which then reads the skills with no
// turn), the session stopped again; the loaded line's Refresh ("Starting…", then "Loaded now"); Browse's counts and the
// other-projects card installing here; Manage marketplaces; `/skills`' groups with Use in chat, and `/sandbox`. Light
// and dark shots of each library. The owner's ~/.claude.json check runs
// around the whole run, outside this file (§6.3). Run on purpose only; it spends usage (one one-line Haiku turn):
//   MAWS_HARNESS=1 pnpm exec electron-vite build && unset MAWS_E2E; MAWS_E8_LIVE=1 pnpm exec playwright test e2e/plugins-library-live.spec.ts --reporter=line
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { installCountWords } from '../src/renderer/src/widgets/plugins/browse';
import { ENGINE_BIN, ENGINE_VERSION } from '../test/support/engine-pin';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';
import { pluginsLiveSkipReason, pluginsScratch, type PluginsScratch } from './support/plugins-live';
import { newChatIn } from './support/sidebar';

const skip = pluginsLiveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_800_000 });

const HAIKU = /^(Haiku|claude-haiku)/;
const OFFICIAL = 'claude-plugins-official';
const DIRECTORY = 'anthropic-plugin-directory';
const o = (name: string) => `${name}@${OFFICIAL}`;
const NETWORK_REFUSAL = /could not resolve host|unable to access|failed to connect|connection (refused|reset|timed out)|network is unreachable|operation timed out|timed out|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|SSL|TLS|offline/i;

let scratch: PluginsScratch;
let other: string; // a second project, trusted in the scratch home, where supabase is installed
let refusal: string | null = null; // the network's words when the marketplace could not be added
// an official plugin not installed here, counted in the millions, and the count of a directory entry of its name (the
// card Browse folds them into keeps the larger)
let popular: { name: string; count: number; directoryCount: number | null } | null = null;
let directoryOnly: string | null = null; // a directory entry no official entry shares a name with

// The engine's CLI against the scratch home only: nothing of the runner's environment, HOME and the config home inside
// the scratch root (§6.3).
function cli(args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('/usr/bin/env', ['-i', `HOME=${scratch.root}`, `CLAUDE_CONFIG_DIR=${scratch.config}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', ENGINE_BIN, 'plugin', ...args], { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message };
  }
}

test.beforeAll(() => {
  scratch = pluginsScratch();
  other = join(scratch.root, 'other');
  mkdirSync(other);
  const home = join(scratch.config, '.claude.json');
  const config = JSON.parse(readFileSync(home, 'utf8')) as { projects: Record<string, unknown> };
  config.projects[other] = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
  writeFileSync(home, JSON.stringify(config, null, 2));
  scratch.log(`P2-B acceptance run · ${new Date().toISOString()} · engine ${ENGINE_VERSION} · CLAUDE_CONFIG_DIR=${scratch.config} · proj ${scratch.repo} · other ${other}`);

  const run = (what: string, args: string[], cwd: string) => {
    const r = cli(args, cwd);
    scratch.log(`setup · ${what}: ${r.ok ? 'ok' : 'FAILED'} · ${r.out.split('\n').filter((l) => l.trim() !== '').slice(-2).join(' ⏎ ').slice(0, 400)}`);
    return r;
  };
  const added = run(`plugin marketplace add anthropics/${OFFICIAL}`, ['marketplace', 'add', `anthropics/${OFFICIAL}`], scratch.root);
  if (!added.ok) {
    if (!NETWORK_REFUSAL.test(added.out)) throw new Error(`marketplace add failed other than by the network: ${added.out}`);
    refusal = added.out;
    scratch.log('the network refused the marketplace: the counts check is skipped with these words');
  } else {
    expect(run('install code-review --scope user', ['install', o('code-review'), '--scope', 'user'], scratch.root).ok).toBe(true);
    expect(run('install frontend-design --scope project (proj)', ['install', o('frontend-design'), '--scope', 'project'], scratch.repo).ok).toBe(true);
    expect(run('install supabase --scope project (other)', ['install', o('supabase'), '--scope', 'project'], other).ok).toBe(true);
    // what Browse should show, from the engine's own catalogue listing (a listing: catalogue caches only)
    const listed = cli(['list', '--json', '--available'], scratch.repo);
    const available = (JSON.parse(listed.out) as { available: { name: string; marketplaceName: string; installCount?: unknown }[] }).available;
    const official = available.filter((p) => p.marketplaceName === OFFICIAL);
    const positive = (n: unknown): number | null => (typeof n === 'number' && n > 0 ? n : null);
    const counted = official.filter((p) => (positive(p.installCount) ?? 0) >= 1_000_000).sort((a, b) => (b.installCount as number) - (a.installCount as number));
    if (counted.length > 0) {
      const { name } = counted[0];
      popular = { name, count: counted[0].installCount as number, directoryCount: positive(available.find((p) => p.marketplaceName === DIRECTORY && p.name === name)?.installCount) };
    }
    const names = new Set(official.map((p) => p.name));
    directoryOnly = available.find((p) => p.marketplaceName === DIRECTORY && !names.has(p.name))?.name ?? null;
    scratch.log(`setup · the catalogue: ${official.length} official entries, ${available.filter((p) => p.marketplaceName === DIRECTORY).length} directory entries; most popular not installed: ${popular ? `${popular.name} (${popular.count}; its directory entry ${popular.directoryCount ?? 'uncounted or absent'})` : 'none'}; a directory-only entry: ${directoryOnly ?? 'none'}`);
  }
  mkdirSync(join(scratch.config, 'skills', 'p2b-user'), { recursive: true });
  writeFileSync(join(scratch.config, 'skills', 'p2b-user', 'SKILL.md'), '---\nname: p2b-user\ndescription: A skill of your own, for the P2-B acceptance run.\n---\nReply with exactly: user skill.\n');
  mkdirSync(join(scratch.repo, '.claude', 'skills', 'p2b-project'), { recursive: true });
  writeFileSync(join(scratch.repo, '.claude', 'skills', 'p2b-project', 'SKILL.md'), '---\nname: p2b-project\ndescription: A skill this project keeps, for the P2-B acceptance run.\n---\nReply with exactly: project skill.\n');
});

// ---- the page ------------------------------------------------------------------------------------------------------

const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
async function idle(page: Page, id: string): Promise<void> {
  await page.waitForTimeout(1_500);
  await expect.poll(async () => {
    const s = await status(page, id);
    return s.turn === null && s.pendingRequests === 0;
  }, { timeout: 240_000, intervals: [500] }).toBe(true);
}
const composer = (page: Page) => page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
async function closeWidgets(page: Page): Promise<void> {
  if (await page.getByRole('dialog', { name: 'Model and effort' }).isVisible()) await page.keyboard.press('Escape');
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}
async function send(page: Page, text: string): Promise<void> {
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}
async function openWidget(page: Page, name: string): Promise<Locator> {
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.type(`/${name}`);
  await expect(page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]')).toContainText(`/${name}`);
  await page.keyboard.press('Enter');
  const w = page.locator(`[data-widget="${name}"]`);
  await expect(w).toBeVisible();
  return w;
}
const myItems = (w: Locator) => w.locator('[data-plugins-section="my-items"]');
const idsIn = (scope: Locator, group: string, attr: 'plugin' | 'skill') => scope.locator(`[data-${attr === 'plugin' ? 'plugins' : 'skills'}-group="${group}"] [data-${attr}-row]`).evaluateAll((rows, a) => rows.map((r) => r.getAttribute(`data-${a}-row`)), attr);
async function show(w: Locator, filter: string): Promise<void> {
  await w.getByRole('button', { name: 'Show' }).click();
  await w.page().getByRole('menuitemradio', { name: filter, exact: true }).click();
}
// Counts the invokes main answers for each command, by wrapping their handlers where Electron keeps them (as
// support/plugins-live.ts's read tracker does), so "starts no engine" and "sends nothing" are read from main itself,
// not from a status that a fast turn could leave unchanged. A command main does not answer fails the run.
type Tracked = 'session.start' | 'session.acquire' | 'session.send' | 'session.steer';
async function trackInvokes(app: ElectronApplication): Promise<(commands: readonly Tracked[]) => Promise<number>> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const log: Record<string, number> = {};
    (globalThis as unknown as { __p2bInvokes: typeof log }).__p2bInvokes = log;
    for (const command of ['session.start', 'session.acquire', 'session.send', 'session.steer']) {
      const handler = handlers.get(`maws:cmd:${command}`);
      if (!handler) throw new Error(`main answers no ${command}: nothing to count`);
      log[command] = 0;
      handlers.set(`maws:cmd:${command}`, (event, ...args) => {
        log[command] += 1;
        return handler(event, ...args);
      });
    }
  });
  return async (commands) => {
    const log = await app.evaluate(() => (globalThis as unknown as { __p2bInvokes: Record<string, number> }).__p2bInvokes);
    return commands.reduce((sum, command) => sum + (log[command] ?? 0), 0);
  };
}

// ---- the run -------------------------------------------------------------------------------------------------------

test('P2-B acceptance: the plugin and skills libraries on the installed engine, in a scratch home', async () => {
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: ENGINE_BIN, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config } });
  const { page, app } = maws;
  const invokes = await trackInvokes(app);
  const starts = () => invokes(['session.start', 'session.acquire']);
  const failures: string[] = [];
  let n = 0;
  const shot = (name: string) => page.screenshot({ path: join(scratch.root, `acceptance-${name}.png`) }).catch(() => undefined);
  const theme = async (t: 'light' | 'dark') => {
    value(await invoke(page, 'settings.set', { theme: t }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', t);
    await page.waitForTimeout(200);
  };
  const bothThemes = async (name: string) => {
    await shot(`${name}-light`);
    await theme('dark');
    await shot(`${name}-dark`);
    await theme('light');
  };
  const step = (name: string, title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      n += 1;
      const label = `${String(n).padStart(2, '0')}-${name}`;
      scratch.log('');
      scratch.log(`=== ${label} · ${title}`);
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${label}: ${message}`);
        scratch.log(`FAILED: ${message}`);
        scratch.observe(`${label}.failed`, message);
      }
      await shot(label);
    });
  const needsCatalogue = () => {
    if (refusal !== null) {
      scratch.log(`skipped: the network refused the marketplace (${refusal.split('\n').at(-1)})`);
      return false;
    }
    return true;
  };

  try {
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
    let id = '';
    let launched = 0; // the engine starts main answered by the end of the first step (the session's own launch)

    await step('start', 'a session in proj on Haiku, one turn ("Reply with OK"), then stopped', async () => {
      const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
      if (!projects.some((p) => p.directory === scratch.repo)) value(await invoke(page, 'session.projects.add', { directory: scratch.repo }));
      await newChatIn(page, 'e8-repo');
      await expect(page.getByRole('heading', { name: 'New chat in e8-repo' })).toBeVisible();
      id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
      const model = await openWidget(page, 'model');
      await model.getByRole('menuitemradio', { name: HAIKU }).click();
      await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.model ?? '').toMatch(/haiku/);
      await send(page, 'Reply with OK');
      await idle(page, id);
      const s = await status(page, id);
      scratch.log(`session ${id}: ${s.process} · model ${s.model.resolved} · gateway ${s.gateway.verified} · plugins loaded: ${s.plugins.map((p) => p.source ?? p.name).join(', ')}`);
      scratch.observe('start', { id, model: s.model.resolved, plugins: s.plugins.map((p) => p.source ?? p.name) });
      expect(s.gateway.verified).toBe('routed');
      value(await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
      await expect.poll(async () => (await status(page, id)).process, { timeout: 60_000 }).not.toBe('ready');
      scratch.log(`stopped: ${(await status(page, id)).process}`);
      launched = await starts();
    });

    await step('size', '/plugins: the library box at a 1440 by 960 window; Esc closes it and the composer has the keyboard', async () => {
      const before = await starts();
      const w = await openWidget(page, 'plugins');
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const box = (await page.locator('[data-widget-dialog="plugins"]').boundingBox())!;
      scratch.log(`window ${viewport.width}×${viewport.height}; the dialog ${box.width}×${box.height}`);
      scratch.observe('size', { viewport, dialog: { width: box.width, height: box.height } });
      expect(Math.round(box.width)).toBe(Math.min(960, viewport.width - 48));
      expect(Math.round(box.height)).toBe(Math.round(Math.min(viewport.height * 0.85, 800)));
      await expect(myItems(w)).toBeVisible();
      await w.focus();
      await page.keyboard.press('Escape');
      await expect(w).toBeHidden();
      await expect(composer(page)).toBeFocused();
      expect(await starts()).toBe(before); // opening /plugins started no engine
    });

    await step('my-items', 'My items: code-review under From Anthropic & Partners, frontend-design under In this project, supabase only under Other projects', async () => {
      if (!needsCatalogue()) return;
      const w = await openWidget(page, 'plugins');
      await expect.poll(() => idsIn(myItems(w), 'here', 'plugin'), { timeout: 60_000 }).toContain(o('frontend-design'));
      expect(await idsIn(myItems(w), 'anthropic', 'plugin')).toContain(o('code-review'));
      await expect(myItems(w).locator(`[data-plugin-row="${o('supabase')}"]`)).toHaveCount(0);
      await show(w, 'Other projects');
      expect(await idsIn(myItems(w), 'otherProjects', 'plugin')).toEqual([o('supabase')]);
      await show(w, 'All plugins');
      scratch.log(`My items: ${(await myItems(w).innerText()).replaceAll('\n', ' · ')}`);
      scratch.log(`loaded line: ${await w.locator('[data-plugins-loaded]').innerText()}`);
      await bothThemes('my-items');
    });

    await step('detail', 'frontend-design’s detail: Enabled for this project, the loaded fact, What’s inside with its skill', async () => {
      if (!needsCatalogue()) return;
      const w = page.locator('[data-widget="plugins"]');
      await myItems(w).locator(`[data-plugin-row="${o('frontend-design')}"]`).click();
      const detail = w.locator('[data-plugin-detail]');
      await expect(detail).toHaveAttribute('data-plugin-detail', o('frontend-design'));
      await expect(detail.locator('[data-plugin-fact="enabled"]')).toHaveText('Enabled for this project');
      const loaded = await detail.locator('[data-plugin-fact="loaded"]').innerText();
      scratch.log(`loaded fact: ${loaded}`);
      scratch.observe('detail.loaded', loaded);
      // P2-A's observed facts: the stopped session's list, labelled with when it was loaded
      expect(loaded).toMatch(/^Loaded in this session · Loaded last time, \S/);
      const inside = detail.getByRole('region', { name: 'What’s inside' });
      await expect(inside).toContainText('Skills');
      await expect(inside).toContainText('frontend-design');
      scratch.log(`what's inside: ${(await inside.innerText()).replaceAll('\n', ' · ')}`);
      await bothThemes('detail');
      await w.getByRole('button', { name: /^Back to / }).click();
    });

    await step('loaded-line', 'the loaded line on the stopped session: N plugins loaded · Loaded last time, with Refresh; no engine started by /plugins', async () => {
      const plugins = await openWidget(page, 'plugins');
      const line = plugins.locator('[data-plugins-loaded]');
      await expect(line).toHaveAttribute('data-loaded-freshness', 'last');
      const text = (await line.textContent()) ?? '';
      scratch.log(`loaded line: ${text}`);
      scratch.observe('loadedLine', text);
      expect(text).toMatch(/^[1-9]\d* plugins? loaded in this session·Loaded last time, \S/);
      await expect(line.getByRole('button', { name: 'Refresh' })).toBeVisible();
      expect(await starts()).toBe(launched); // nothing since the stop: /plugins, the detail and the line started no engine
      expect((await status(page, id)).process).not.toBe('ready');
    });

    await step('skills-dormant', '/skills on the stopped session: Not read yet. with Load now, nothing started until it is clicked; Load now reads the skills with no turn; stopped again', async () => {
      const sent = await invokes(['session.send', 'session.steer']);
      const w = await openWidget(page, 'skills');
      await expect(w.getByText('Not read yet.')).toBeVisible();
      await expect(w.getByRole('button', { name: 'Load now' })).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(await starts()).toBe(launched); // opening /skills started nothing
      await shot('skills-dormant');
      await w.getByRole('button', { name: 'Load now' }).click();
      await expect(w.getByText('Starting…')).toBeVisible({ timeout: 10_000 });
      await expect(w.locator('[data-skill-row="p2b-project"]')).toBeVisible({ timeout: 120_000 });
      expect(await starts()).toBe(launched + 1); // one acquisition, the click's
      expect(await invokes(['session.send', 'session.steer'])).toBe(sent); // no prompt to read them
      scratch.log(`after Load now: ${(await status(page, id)).process}; skills rows ${await w.locator('[data-skill-row]').count()}`);
      // a start with no turn reports no plugins: the ready session's line keeps the last observed list, never "Loaded now"
      // over an empty one (the architect's ruling of 2026-10-10, now A's precedence)
      const s = await status(page, id);
      const plugins = await openWidget(page, 'plugins');
      const line = plugins.locator('[data-plugins-loaded]');
      scratch.log(`ready with no turn: pluginsObservedAt ${s.pluginsObservedAt ?? 'null'}, ${s.plugins.length} plugins in the status; loaded line: ${(await line.textContent()) ?? ''}`);
      if (s.pluginsObservedAt === null) {
        await expect(line).toHaveAttribute('data-loaded-freshness', 'last');
        await expect(line).not.toContainText('Loaded now');
      }
      await closeWidgets(page);
      value(await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
      await expect.poll(async () => (await status(page, id)).process, { timeout: 60_000 }).not.toBe('ready');
      launched = await starts();
    });

    await step('refresh', 'the loaded line’s Refresh on the stopped session: Starting…, then Loaded now (acquire, then reload_plugins; no turn)', async () => {
      const sent = await invokes(['session.send', 'session.steer']);
      const plugins = await openWidget(page, 'plugins');
      const line = plugins.locator('[data-plugins-loaded]');
      await expect(line).toHaveAttribute('data-loaded-freshness', 'last');
      expect(await starts()).toBe(launched);
      await line.getByRole('button', { name: 'Refresh' }).click();
      await expect(line).toContainText('Starting…', { timeout: 10_000 });
      scratch.log(`after the click: ${(await line.textContent()) ?? ''}`);
      await expect(line).toHaveAttribute('data-loaded-freshness', 'now', { timeout: 120_000 });
      await expect(line).toContainText('Loaded now');
      await expect(line.getByRole('button', { name: 'Reload plugins' })).toBeVisible();
      const text = (await line.textContent()) ?? '';
      scratch.log(`loaded line: ${text}`);
      scratch.observe('refresh', text);
      expect(text).toMatch(/^[1-9]\d* plugins? loaded in this session·Loaded now/);
      expect(await starts()).toBe(launched + 1); // one acquisition, the click's
      expect(await invokes(['session.send', 'session.steer'])).toBe(sent); // no turn
      expect((await status(page, id)).process).toBe('ready');
      await bothThemes('refresh');
      if (!needsCatalogue()) return;
      await myItems(plugins).locator(`[data-plugin-row="${o('frontend-design')}"]`).click();
      await expect(plugins.locator('[data-plugin-detail] [data-plugin-fact="loaded"]')).toHaveText('Loaded in this session · Loaded now');
      await plugins.getByRole('button', { name: /^Back to / }).click();
    });

    await step('browse', 'Browse after its click: counts on official cards, none on a directory-only card; supabase Installed in other projects, installed here', async () => {
      if (!needsCatalogue()) return;
      const w = page.locator('[data-widget="plugins"]');
      await w.getByRole('radio', { name: 'Browse' }).click();
      const browse = w.locator('[data-plugins-section="browse"]');
      await expect(browse.locator('[data-browse-card]').first()).toBeVisible({ timeout: 120_000 });
      const search = w.getByRole('searchbox', { name: 'Search plugins' });
      // the marketplace was added, so the catalogue must offer both candidates: a count left unproved is a failure
      if (!popular) throw new Error('the catalogue offers no official plugin counted in the millions: the counts went unproved');
      if (!directoryOnly) throw new Error('the catalogue offers no directory-only entry: the uncounted card went unproved');
      await search.fill(popular.name);
      // the official entry's own card, or the directory's card it folded into, which keeps the larger count (§5.8)
      const own = browse.locator(`[data-browse-card="${o(popular.name)}"]`);
      const folded = browse.locator(`[data-browse-card="${popular.name}@${DIRECTORY}"]`);
      await expect(own.or(folded).first()).toBeVisible();
      const isOwn = (await own.count()) > 0;
      const counted = isOwn ? own : folded;
      const expected = `${installCountWords(isOwn ? popular.count : Math.max(popular.count, popular.directoryCount ?? 0))} installs`;
      await expect(counted.locator('[data-install-count]')).toHaveText(expected);
      scratch.log(`${popular.name}: ${await counted.getAttribute('data-browse-card')} · ${await counted.locator('[data-install-count]').innerText()} (the CLI's ${popular.count}, its directory entry's ${popular.directoryCount ?? 'none'})`);
      await search.fill(directoryOnly);
      const uncounted = browse.locator(`[data-browse-card="${directoryOnly}@${DIRECTORY}"]`);
      await expect(uncounted).toBeVisible();
      await expect(uncounted.locator('[data-install-count]')).toHaveCount(0);
      scratch.log(`${directoryOnly}@${DIRECTORY}: no count`);
      await search.fill('');
      await bothThemes('browse');
      await search.fill('supabase');
      const supabase = browse.locator(`[data-browse-card="${o('supabase')}"]`);
      await expect(supabase).toHaveAttribute('data-installed', 'otherProjects');
      await expect(supabase).toContainText('Installed in other projects');
      await supabase.getByRole('button', { name: 'Install', exact: true }).click();
      const sheet = page.locator('[data-plugins-sheet="install"]');
      await sheet.getByRole('radio', { name: 'Project' }).check();
      const argv = await sheet.locator('[data-plugins-argv]').innerText();
      scratch.log(`sheet: ${argv}`);
      await shot('browse-install-sheet');
      await sheet.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(supabase).toHaveAttribute('data-installed', 'here', { timeout: 120_000 });
      // the session is running since Refresh, so E8's reload of the running sessions follows the install before its result
      await expect(supabase.getByRole('status')).toContainText(`Successfully installed plugin: ${o('supabase')} (scope: project)`, { timeout: 120_000 });
      scratch.log(`result: ${await supabase.getByRole('status').innerText()}`);
      await w.getByRole('radio', { name: 'My items' }).click();
      await expect.poll(() => idsIn(myItems(w), 'here', 'plugin'), { timeout: 60_000 }).toContain(o('supabase'));
    });

    await step('manage', 'Add › Manage marketplaces lists claude-plugins-official', async () => {
      if (!needsCatalogue()) return;
      const w = page.locator('[data-widget="plugins"]');
      await w.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Manage marketplaces', exact: true }).click();
      const manage = page.locator('[data-marketplaces-dialog="manage"]');
      await expect(manage.locator(`[data-marketplace-row="${OFFICIAL}"]`)).toContainText(`anthropics/${OFFICIAL}`);
      scratch.log(`Manage marketplaces: ${(await manage.innerText()).replaceAll('\n', ' · ')}`);
      await bothThemes('manage');
      await manage.getByRole('button', { name: 'Done' }).click();
    });

    await step('skills', '/skills: p2b-project and frontend-design’s skill under In this project, p2b-user under Created by you; Use in chat inserts and sends nothing', async () => {
      const w = await openWidget(page, 'skills');
      await expect(w.locator('[data-skill-row="p2b-project"]')).toBeVisible({ timeout: 30_000 });
      const groups = await w.locator('[data-skills-group]').evaluateAll((gs) => gs.map((g) => `${g.getAttribute('data-skills-group')}: ${Array.from(g.querySelectorAll('[data-skill-row]'), (r) => r.getAttribute('data-skill-row')).join(', ')}`));
      scratch.log(`skills: ${groups.join(' · ')}`);
      scratch.observe('skills', groups);
      expect(await idsIn(w, 'here', 'skill')).toContain('p2b-project');
      expect(await idsIn(w, 'yours', 'skill')).toContain('p2b-user');
      await bothThemes('skills');
      if (!needsCatalogue()) return;
      const design = w.locator('[data-skills-group="here"] [data-skill-row="frontend-design:frontend-design"]');
      await expect(design).toBeVisible();
      await expect(design.locator('[data-skill-badge]')).not.toHaveText('');
      scratch.log(`frontend-design's skill: ${(await design.innerText()).replaceAll('\n', ' · ')}`);
      const sends = () => invokes(['session.send', 'session.steer', 'session.start', 'session.acquire']);
      const sentBefore = await sends();
      await design.getByRole('button', { name: 'Use in chat' }).click();
      await expect(w).toBeHidden();
      await expect(composer(page)).toContainText('/frontend-design:frontend-design');
      await page.waitForTimeout(1_000);
      expect(await sends()).toBe(sentBefore); // nothing sent: no send, steer or start reached main
      await shot('skills-inserted');
      await composer(page).click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
    });

    await step('sandbox', '/sandbox reads Sandbox off and offers no control that writes settings', async () => {
      const w = await openWidget(page, 'sandbox');
      await expect(w).toContainText('Sandbox off', { timeout: 30_000 });
      await expect(w).toContainText('Not turned on in your settings');
      expect(await w.getByRole('switch').count()).toBe(0);
      expect(await w.getByRole('checkbox').count()).toBe(0);
      scratch.log(`sandbox: ${(await w.innerText()).replaceAll('\n', ' · ')}`);
      await bothThemes('sandbox');
    });

    scratch.observe('consoleErrors', maws.consoleErrors());
    scratch.log('');
    scratch.log(`console errors: ${JSON.stringify(maws.consoleErrors())}`);
    scratch.log(failures.length === 0 ? 'result: every step passed' : `result: ${failures.length} step(s) failed:\n${failures.join('\n')}`);
  } finally {
    await shot('final');
    await maws.cleanup();
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
