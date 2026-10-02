// C11's live acceptance (C11 execution document, M6 and Acceptance item 3), through Playwright against the built app
// with the pinned engine behind ClaudeUsage's relay; no desktop automation (the architect's rule of 2026-09-29): every
// key and click goes to the page through Playwright, the two native surfaces a widget can reach (Finder's reveal and
// the save panel) are replaced in main for the run, and the ClaudeUsage hand-off's `open` is main's MAWS_E2E stand-in.
// Every session is created through C10's "+" on a scratch repository and lives in a scratch CLAUDE_CONFIG_DIR
// (support/c11-live.ts) whose fixtures stand in for the owner's rules, hooks, MCP server and memory; the owner's
// ~/.claude and ~/.claude.json are never read or written, and ClaudeUsage's data directory is read only. Launches through
// "+" carry no budget (C10's mapping passes none), so each case's cost is recorded from `get_usage`'s
// `total_cost_usd`. The relay-down cases launch with the dev-only MAWS_RELAY_URL pointed at a loopback forwarder this
// file stops and starts; ClaudeUsage keeps running. What the engine and the relay answered is written to
// `<scratch>/observations.json`. Run on purpose only; it spends usage:
//   MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_C11_LIVE=1 pnpm exec playwright test e2e/c11-live.spec.ts
// MAWS_C11_LIVE_GPT names the relay alias the gateway-model case uses (default `luna`; a Codex alias at its usage limit
// is refused by the relay at `set_model`).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { invoke, value } from './support/c7-replay';
import { c11LiveSkipReason, c11Scratch, Forwarder, FORWARDER_PORT, relayCatalogue, type C11Scratch } from './support/c11-live';
import { launchMaws, type MawsLaunch } from './support/launch';
import { openProject, sidebarRow } from './support/sidebar';

const skip = c11LiveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_200_000 });

const CLAUDE_USAGE_DIR = join(homedir(), 'Library', 'Application Support', 'ClaudeUsage'); // read only
const GPT = process.env.MAWS_C11_LIVE_GPT ?? 'luna';
// Sonnet as the catalogue names it: `Sonnet 5` in the built-in list, the resolved id once a routed launch filled the
// cache under the owner's ANTHROPIC_DEFAULT_SONNET_MODEL alias (passed through from the shell).
const SONNET = /^(Sonnet 5|claude-sonnet)/;
const NAMES = ['model', 'effort', 'fast', 'permissions', 'usage', 'config', 'plugins', 'mcp', 'sandbox', 'hooks', 'memory', 'skills', 'agents', 'status', 'compact', 'context', 'rename', 'resume', 'export', 'diff'];

let scratch: C11Scratch;
test.beforeAll(() => {
  scratch = c11Scratch();
});

// ---- the app ---------------------------------------------------------------------------------------------------

interface Live {
  maws: MawsLaunch;
  page: Page;
  main: Locator;
  failures: string[];
  observe(key: string, v: unknown): void;
  step(label: string, fn: () => Promise<void>): Promise<void>;
}

async function withApp(label: string, env: Record<string, string>, fn: (live: Live) => Promise<void>): Promise<void> {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config, MAWS_CLAUDE_USAGE_DIR: CLAUDE_USAGE_DIR, ...env } });
  const { page } = maws;
  const failures: string[] = [];
  const observe = (key: string, v: unknown) => scratch.observe(`${label}.${key}`, v);
  // Each step records what it saw; a failed step is recorded and the run goes on (a live run is expensive to repeat),
  // and the test fails at its end with every failed step named.
  const step = (name: string, body: () => Promise<void>) =>
    test.step(name, async () => {
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${name}: ${message}`);
        observe(`${name}.failed`, message);
        await page.screenshot({ path: join(scratch.root, `${label}-${name.replace(/[^a-z0-9]+/gi, '-')}-failed.png`) }).catch(() => undefined);
      }
    });
  try {
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    await collect(page);
    // Finder and the save panel are native surfaces on the owner's desktop: main's calls are recorded instead.
    await maws.app.evaluate(({ shell, dialog }, file) => {
      (globalThis as unknown as { __c11Revealed: string[] }).__c11Revealed = [];
      shell.showItemInFolder = (path: string) => void (globalThis as unknown as { __c11Revealed: string[] }).__c11Revealed.push(path);
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, join(scratch.root, `${label}-export.txt`));
    value(await invoke(page, 'settings.set', { engine: { subagentModel: 'sonnet' } }));
    await fn({ maws, page, main: page.locator('[data-region="main"]'), failures, observe, step });
    observe('consoleErrors', maws.consoleErrors());
    observe('transcriptLoadFailures', await page.evaluate(() => (window as unknown as C11Window).__c11.seen.filter((t) => t.startsWith('Could not load this transcript'))));
  } finally {
    await page.screenshot({ path: join(scratch.root, `${label}.png`) }).catch(() => undefined);
    await maws.cleanup();
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

type C11Window = Window & { __c11: { seen: string[]; notices: { appSessionId: string; key: string; text: string }[]; kinds: { appSessionId: string; kind: string }[] } };

// Every status or alert text the page showed (toasts come and go), and every event kind per session.
async function collect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { seen: [] as string[], notices: [] as { appSessionId: string; key: string; text: string }[], kinds: [] as { appSessionId: string; kind: string }[] };
    (window as unknown as C11Window).__c11 = log;
    const note = () =>
      document.querySelectorAll('[role="status"], [role="alert"]').forEach((node) => {
        const text = (node.textContent ?? '').trim();
        if (text && !log.seen.includes(text)) log.seen.push(text);
      });
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
    window.maws.on('session.eventBatch', (batch) => {
      for (const event of batch.events) {
        log.kinds.push({ appSessionId: batch.appSessionId, kind: event.kind });
        if (event.kind === 'notice.posted') log.notices.push({ appSessionId: batch.appSessionId, key: event.key ?? '', text: event.text });
      }
    });
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as C11Window).__c11.seen.filter((t) => !/^(Notification )?Weekly /.test(t)));
const kindsOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as C11Window).__c11.kinds.filter((k) => k.appSessionId === i).map((k) => k.kind), id);
const revealed = (maws: MawsLaunch) => maws.app.evaluate(() => (globalThis as unknown as { __c11Revealed: string[] }).__c11Revealed);

// ---- sessions, the composer and widgets ----------------------------------------------------------------------------

const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
async function idle(page: Page, id: string, timeout = 240_000): Promise<void> {
  await page.waitForTimeout(1_500);
  await expect.poll(async () => {
    const s = await status(page, id);
    return s.turn === null && s.pendingRequests === 0;
  }, { timeout, intervals: [500] }).toBe(true);
}
const usageCost = async (page: Page, id: string) => value(await invoke(page, 'session.getUsage', { appSessionId: id as AppSessionId })).session.total_cost_usd;

function journalRows(maws: MawsLaunch, id: string): JournalRow[] {
  const dir = join(maws.userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow))
    .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
}
type Frame = Record<string, unknown> & { type?: string; subtype?: string; request?: { subtype?: string } };
const inits = (maws: MawsLaunch, id: string) =>
  journalRows(maws, id)
    .filter((r) => r.direction === 'in' && (r.frame as Frame).type === 'system' && (r.frame as Frame).subtype === 'init')
    .map((r) => {
      const f = r.frame as Frame;
      return { seq: r.seq, model: f.model, permissionMode: f.permissionMode, fast_mode_state: f.fast_mode_state, fast_mode_disabled_reason: f.fast_mode_disabled_reason };
    });

// "+" on the project, the model chosen in the unstarted tab's model widget, the first message sent from the composer.
async function plusSession(live: Live, repo: string, first: string, opts: { mode?: 'default' | 'auto' } = {}): Promise<string> {
  const { page, main } = live;
  const name = repo.split('/').at(-1)!;
  const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
  if (!projects.some((p) => p.directory === repo)) value(await invoke(page, 'session.projects.add', { directory: repo }));
  await openProject(page, name); // W5: the "+" beside the name on the project's page
  await page.locator('[data-region="sidebar"] [data-level-pane="2"]').getByRole('button', { name: `New session in ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `New chat in ${name}` })).toBeVisible();
  const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
  const w = await openWidget(live, 'model'); // W3: the model selector, a pick applies at once
  await w.getByRole('menuitemradio', { name: SONNET }).click();
  await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.model).toBe('sonnet');
  await closeWidgets(page);
  if (opts.mode) value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { permissionMode: opts.mode } }));
  await send(page, main, first);
  return id;
}

async function closeWidgets(page: Page): Promise<void> {
  if (await page.getByRole('dialog', { name: 'Model and effort' }).isVisible()) await page.keyboard.press('Escape'); // W3: the model selector's menu
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}
async function send(page: Page, main: Locator, text: string): Promise<void> {
  await closeWidgets(page);
  await main.getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}
// A widget from the palette: `/name`, the palette's highlighted row checked, Enter.
async function openWidget(live: Pick<Live, 'page' | 'main'>, name: string): Promise<Locator> {
  const { page, main } = live;
  await closeWidgets(page);
  await main.getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.type(`/${name}`);
  const chosen = page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]');
  await expect(chosen).toContainText(`/${name}`);
  await expect(chosen).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  const w = page.locator(`[data-widget="${name}"]`);
  await expect(w).toBeVisible();
  if (!['model', 'effort', 'fast'].includes(name)) await expect(w.locator('footer')).toContainText('Read with'); // W3: the selector is a menu, with no foot
  return w;
}
// A typed line `/name args`, which runs the widget's control with its argument (M3).
async function typedLine(page: Page, main: Locator, line: string): Promise<void> {
  await closeWidgets(page);
  await main.getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.type(`/${line}`);
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
  await page.keyboard.press('Enter');
}
// The body once its read answered: no `Reading…`, no error line.
async function settled(w: Locator): Promise<string> {
  await expect(w).not.toContainText('Reading', { timeout: 15_000 });
  return w.innerText();
}

const sessionInfo = (page: Page, id: string) => page.locator(`[data-session-info="${id}"]`);
const infoRow = async (page: Page, id: string, label: string) => (await sessionInfo(page, id).innerText()).match(new RegExp(`${label}\\n([^\\n]+)`))?.[1] ?? null;
// W2: the status line and its usage popover are gone (§5.5 as amended 2026-10-01): Session info, opened from the panel's
// "+", carries the windows (its Usage row) and the route with its switch (its Route row).
async function openSessionInfo(page: Page, id: string): Promise<Locator> {
  if (!(await sessionInfo(page, id).isVisible())) {
    await page.locator('[data-region="panel"]').getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Session info' }).click();
  }
  await expect(sessionInfo(page, id)).toBeVisible();
  return sessionInfo(page, id);
}
const infoValue = (info: Locator, label: string) => info.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
const routeRow = async (page: Page, id: string) => infoValue(await openSessionInfo(page, id), 'Route');
const usageRow = async (page: Page, id: string) => infoValue(await openSessionInfo(page, id), 'Usage');

// ---- 1. the twenty widgets over a live routed session, their controls, and changes read back ------------------------

test('every widget opens with live engine data; controls take effect and are read back', async () => {
  await withApp('widgets', {}, async (live) => {
    const { page, main, maws, observe, step } = live;
    const repo = scratch.repo('repo-a');
    let id = '';

    await step('start through + on Sonnet', async () => {
      id = await plusSession(live, repo, 'Reply with exactly: C11 LIVE READY');
      await idle(page, id);
      const s = await status(page, id);
      observe('start', { model: s.model, mode: s.permissionMode, gateway: s.gateway, mcp: s.mcpServers, plugins: s.plugins.map((p) => p.source) });
      expect(s.gateway.verified).toBe('routed');
    });

    await step('the twenty names open from the palette with live data', async () => {
      const texts: Record<string, string> = {};
      for (const name of NAMES) {
        if (name === 'rename') {
          await closeWidgets(page);
          await main.getByRole('textbox', { name: 'Message' }).click();
          await page.keyboard.type('/rename');
          await page.keyboard.press('Enter');
          const dialog = page.getByRole('dialog', { name: 'Rename' });
          await expect(dialog).toBeVisible();
          texts[name] = await dialog.innerText();
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          continue;
        }
        const w = await openWidget(live, name);
        texts[name] = await settled(w);
      }
      observe('tour', texts);
      const gateway = texts.model!.split('GATEWAY')[1] ?? '';
      const relay = relayCatalogue();
      observe('tour.relayCatalogue', relay);
      for (const model of relay) expect(gateway, `the Gateway group lists ${model}`).toContain(model);
      expect(texts.model).toMatch(new RegExp(`GATEWAY${relay.length}`));
      expect(texts.status).toContain('Anthropic base URL\nhttp://127.0.0.1:8641');
      expect(texts.hooks).toContain('PostToolUse'.toUpperCase());
      expect(texts.config).toContain('C11_LIVE_FIXTURE');
      expect(texts.mcp).toContain('c11probe\nconnected');
      expect(texts.permissions).toMatch(/ALLOW2[\s\S]*ASK1[\s\S]*DENY1/);
      expect(texts.permissions).toContain('.claude/settings.json · project');
    });

    await step('Allow for this session adds a session grant row; /diff shows the file', async () => {
      await send(page, main, 'Use the Bash tool to run exactly this command and nothing else: touch c11-live.txt');
      const frame = main.getByRole('group', { name: 'Approval needed' });
      await expect(frame).toBeVisible({ timeout: 120_000 });
      await frame.getByRole('radio', { name: 'Allow for this session' }).click();
      await frame.getByRole('button', { name: 'Allow', exact: true }).click();
      await idle(page, id);
      const grantsWidget = await openWidget(live, 'permissions');
      // a read cached before the grant shows until the refetch on mount lands
      await expect(grantsWidget).toContainText(/Bash\(touch c11-live\.txt\)\s*this session · grant/, { timeout: 15_000 });
      const permissions = await grantsWidget.innerText();
      const diffWidget = await openWidget(live, 'diff');
      await expect(diffWidget).toContainText('c11-live.txt', { timeout: 15_000 }); // the read on open lands after the cached one shows
      const diff = await diffWidget.innerText();
      observe('grant', { permissions, diff, hookLog: existsSync(scratch.hookLog) ? readFileSync(scratch.hookLog, 'utf8') : null });
      expect(permissions).toContain('Bash(touch c11-live.txt)\nthis session · grant');
      expect(diff).toContain('c11-live.txt');
    });

    await step('MCP: Reconnect completes; the switch discloses ~/.claude.json and the engine writes the scratch home', async () => {
      const w = await openWidget(live, 'mcp');
      await expect(w).toContainText(/c11probe\s*connected/);
      const project = () => scratch.claudeJson().projects?.[repo] ?? {};
      const before = { disabled: project().disabledMcpServers ?? null };
      await w.getByRole('button', { name: 'Reconnect' }).click();
      await expect(w.getByRole('status')).toHaveText('Reconnected', { timeout: 30_000 });
      const toggle = w.getByRole('switch', { name: 'Enabled: c11probe' });
      await expect(w).toContainText('Recorded by the engine for this project in ~/.claude.json');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
      await expect(w).toContainText(/c11probe\s*disabled/);
      const off = { disabled: project().disabledMcpServers ?? null };
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
      await expect(w).toContainText(/c11probe\s*connected/);
      const on = { disabled: project().disabledMcpServers ?? null };
      observe('mcp', { before, off, on, file: join(scratch.config, '.claude.json') });
      expect(off.disabled).toEqual(['c11probe']);
      expect(on.disabled ?? []).not.toContain('c11probe');
    });

    await step('plugins: Reload reports 0 errors; the catalogue revision moves only when a command changed', async () => {
      const w = await openWidget(live, 'plugins');
      const rev = async () => value(await invoke(page, 'session.catalog', { appSessionId: id as AppSessionId })).revision;
      const r0 = await rev();
      await w.getByRole('button', { name: 'Reload' }).click();
      await expect(w.getByRole('status')).toContainText('Reloaded', { timeout: 60_000 });
      const first = await w.getByRole('status').innerText();
      const r1 = await rev();
      const commands = join(repo, '.claude', 'commands');
      mkdirSync(commands, { recursive: true });
      writeFileSync(join(commands, 'c11-probe.md'), '---\ndescription: C11 live probe command\n---\nReply with exactly: PROBE\n');
      await w.getByRole('button', { name: 'Reload' }).click();
      await expect.poll(rev, { timeout: 30_000 }).toBeGreaterThan(r1);
      const second = await w.getByRole('status').innerText();
      observe('plugins', { first, second, revisions: [r0, r1, await rev()] });
      expect(first).toContain('0 errors');
    });

    await step('memory Reveal and config Open file reach Finder (recorded), paths under the guard', async () => {
      const memory = await openWidget(live, 'memory');
      for (const button of await memory.getByRole('button', { name: 'Reveal' }).all()) await button.click();
      const config = await openWidget(live, 'config');
      await config.getByRole('button', { name: 'Open file' }).first().click();
      await page.waitForTimeout(500);
      const paths = await revealed(maws);
      observe('reveal', paths);
      expect(paths).toContain(join(scratch.config, 'CLAUDE.md'));
      expect(paths).toContain(join(repo, 'CLAUDE.md'));
      expect(paths).toContain(join(scratch.config, 'settings.json'));
    });

    await step('context and status agree on the model; usage windows equal Session info’s', async () => {
      const context = await settled(await openWidget(live, 'context'));
      const statusText = await settled(await openWidget(live, 'status'));
      const usage = await settled(await openWidget(live, 'usage'));
      await closeWidgets(page);
      const line = await (await usageRow(page, id)).innerText();
      const s = await status(page, id);
      observe('agree', { context: context.slice(0, 200), statusModel: statusText.match(/Model\n[^\n]+/)?.[0], resolved: s.model.resolved, usage: usage.slice(0, 400), line });
      expect(statusText).toContain(`Model\n${s.model.resolved}`);
      const five = line.match(/5h (\d+)%/)?.[1];
      const week = line.match(/Weekly (\d+)%/)?.[1];
      expect(usage).toContain(`5h\n${five}%`);
      expect(usage).toContain(`Weekly\n${week}%`);
    });

    await step('/rename Live C11 renames and the sidebar follows within 2 s', async () => {
      const row = await sidebarRow(page, { appSessionId: id }); // W5: on its project's page, opened before the clock starts
      const t0 = Date.now();
      await typedLine(page, main, 'rename Live C11');
      await expect(row).toContainText('Live C11', { timeout: 2_000 });
      observe('rename', { ms: Date.now() - t0 });
    });

    await step('/export saves a file whose head is the first prompt', async () => {
      const w = await openWidget(live, 'export');
      await w.getByRole('button', { name: 'Save as…' }).click();
      await expect(w).toContainText('Saved to');
      const text = readFileSync(join(scratch.root, 'widgets-export.txt'), 'utf8');
      observe('export', { head: text.split('\n').slice(0, 3) });
      expect(text.split('\n').find((l) => l.trim() !== '')).toBe('❯ Reply with exactly: C11 LIVE READY');
    });

    await step('/effort low shows low in Session info', async () => {
      await typedLine(page, main, 'effort low');
      await expect.poll(async () => (await status(page, id)).effort).toBe('low');
      await openSessionInfo(page, id);
      await expect.poll(() => infoRow(page, id, 'Main')).toMatch(/· low$/);
      observe('effort', { main: await infoRow(page, id, 'Main') });
    });

    await step('/permissions → plan is the effective mode in the chip; Implement restores it', async () => {
      const w = await openWidget(live, 'permissions');
      await w.getByRole('menuitemradio', { name: /^Plan/ }).click();
      await expect(main.getByRole('button', { name: /^Permission mode Plan/ })).toBeVisible({ timeout: 15_000 });
      await send(page, main, 'Plan adding a file named hello.txt that contains the word hi. Keep the plan to one or two short steps.');
      const card = main.getByRole('group', { name: 'Plan review' });
      await expect(card).toBeVisible({ timeout: 180_000 });
      await card.getByRole('button', { name: 'Implement', exact: true }).click();
      // default mode again: the write asks
      const approval = main.getByRole('group', { name: 'Approval needed' });
      await expect.poll(async () => {
        if (await approval.count()) await approval.getByRole('button', { name: 'Allow', exact: true }).click().catch(() => undefined);
        const s = await status(page, id);
        return s.turn === null && s.pendingRequests === 0;
      }, { timeout: 240_000, intervals: [1_000] }).toBe(true);
      const s = await status(page, id);
      observe('plan', { mode: s.permissionMode, chip: await main.getByRole('button', { name: /^Permission mode / }).getAttribute('aria-label'), hello: existsSync(join(repo, 'hello.txt')) });
      expect(s.permissionMode.effective).toBe('default');
      await expect(main.getByRole('button', { name: /^Permission mode Manual/ })).toBeVisible();
    });

    await step('fast on Opus in auto: the lane warning, then the init frame answers', async () => {
      let w = await openWidget(live, 'model');
      await w.getByRole('menuitemradio', { name: /^Opus/ }).click(); // W3: applies at once
      await expect.poll(async () => (await status(page, id)).model.requested).toBe('opus');
      w = await openWidget(live, 'permissions');
      await w.getByRole('menuitemradio', { name: /^Auto/ }).click();
      await expect.poll(async () => (await status(page, id)).permissionMode.effective).toBe('auto');
      w = await openWidget(live, 'fast');
      await w.getByRole('switch', { name: 'Fast mode' }).click();
      const warning = await w.getByText('Fast mode disables the auto-mode server lane', { exact: false }).innerText();
      await w.getByRole('button', { name: 'Turn on fast mode' }).click();
      await send(page, main, 'Reply with exactly: FAST ONE');
      await idle(page, id);
      const statusText = await settled(await openWidget(live, 'status'));
      w = await openWidget(live, 'fast');
      const caption = (await w.innerText()).match(/Fast mode · [^\n]+/)?.[0] ?? null; // W3: the selector's fast caption
      const s = await status(page, id);
      observe('fast', { warning, inits: inits(maws, id).slice(-2), fastMode: s.fastMode, autoModeServer: statusText.match(/Auto mode server\n[^\n]+/)?.[0], caption });
      expect(caption).not.toContain('the next init frame confirms it');
      value(await invoke(page, 'session.applyFlagSettings', { appSessionId: id as AppSessionId, settings: { fastMode: false } }));
    });

    await step('/compact compacts and a compaction boundary follows', async () => {
      const w = await openWidget(live, 'compact');
      await w.getByRole('button', { name: 'Compact now' }).click();
      await expect(w).toBeHidden();
      await expect.poll(() => kindsOf(page, id), { timeout: 180_000 }).toContain('boundary.compaction');
      await idle(page, id);
    });

    await step('the usage popover and Session info read ClaudeUsage alike', async () => {
      const popover = await (await openSessionInfo(page, id)).innerText();
      await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('accounts.open')?.click()); // W6: View › Usage, the top bar's usage popover (the Accounts tab retired into it)
      const usagePopover = page.getByRole('dialog', { name: 'Claude Usage' });
      await expect(usagePopover.getByText(/^updated /)).toBeVisible();
      const tab = await usagePopover.innerText();
      const usage = value(await invoke(page, 'settings.usage', { engineSessionIds: [] }));
      const drain = usage.accounts.find((a) => a.uuid === usage.drainTarget);
      // what the popover marks routing is the relay's drain target; emails stay out of the observations
      observe('accounts', { accounts: usage.accounts.length, drainManual: usage.drainTargetIsManual, routingMarkOnDrain: drain ? tab.indexOf(drain.email) < tab.indexOf('Routing here') : null, popoverHasRouting: popover.includes('routing') });
      if (drain) expect(tab.indexOf(drain.email)).toBeLessThan(tab.indexOf('Routing here'));
      await page.screenshot({ path: join(scratch.root, 'accounts-live.png') }); // the owner's accounts: kept in the scratch only
      await page.keyboard.press('Escape');
    });

    observe('cost', { total_cost_usd: await usageCost(page, id) });
  });
});

// ---- 2. a gateway model: the auto-mode lane, then the route switch both ways ------------------------------------------

test('a relay alias takes the local lane; the session switches to Direct and back', async () => {
  await withApp('switch', {}, async (live) => {
    const { page, main, maws, observe, step } = live;
    const repo = scratch.repo('repo-c');
    let id = '';

    await step('start routed on Sonnet in auto; the lane reads Server', async () => {
      id = await plusSession(live, repo, 'Use the Bash tool to run exactly: git status --short. Then reply with exactly: LANE SONNET', { mode: 'auto' });
      await idle(page, id);
      await openSessionInfo(page, id);
      await expect.poll(() => infoRow(page, id, 'Auto-mode lane'), { timeout: 30_000 }).toMatch(/^Server/);
      observe('sonnet', { lane: await infoRow(page, id, 'Auto-mode lane'), gateway: (await status(page, id)).gateway });
    });

    await step(`/model claude/${GPT}: the note, then Local (expected) and the observed lane in the turn`, async () => {
      const w = await openWidget(live, 'model');
      await w.getByRole('menuitemradio', { name: new RegExp(`^${GPT}`) }).click(); // W3: applies at once; the note follows in auto
      const note = (await w.innerText()).match(/Auto-mode reviews[^\n]+/)?.[0] ?? null;
      await expect.poll(async () => (await status(page, id)).model.requested, { timeout: 20_000 }).toBe(`claude/${GPT}`);
      await closeWidgets(page);
      const expected = await infoRow(page, id, 'Auto-mode lane');
      await send(page, main, 'Use the Bash tool to run exactly: git status --short. Then reply with exactly: LANE GPT');
      const lanes = new Set<string>();
      await expect.poll(async () => {
        const lane = await infoRow(page, id, 'Auto-mode lane');
        if (lane) lanes.add(lane);
        const s = await status(page, id);
        return s.turn === null && s.pendingRequests === 0 && lanes.size > 0;
      }, { timeout: 240_000, intervals: [500] }).toBe(true);
      const rows = journalRows(maws, id);
      observe('gpt', {
        note,
        expected,
        lanes: [...lanes],
        after: await infoRow(page, id, 'Auto-mode lane'),
        localLane: (await status(page, id)).gateway.localLane,
        safeguardVerdicts: rows.filter((r) => JSON.stringify(r.frame).includes('provider_not_anthropic')).length,
        informational: rows.filter((r) => (r.frame as Frame).type === 'system' && (r.frame as Frame).subtype === 'informational').map((r) => String((r.frame as { content?: unknown }).content).slice(0, 200)),
        cost: await usageCost(page, id),
      });
      expect(note).toContain('run locally');
      expect(expected).toMatch(/^Local \(expected\)/);
    });

    await step('a background task, then Switch to Direct… names it and requires a Claude model', async () => {
      await send(page, main, 'Use the Bash tool with run_in_background set to true to run exactly: sleep 120. Do not wait for it. Then reply with exactly: STARTED');
      await idle(page, id);
      await expect.poll(async () => (await status(page, id)).backgroundTasks.length).toBe(1);
      await (await routeRow(page, id)).getByRole('button', { name: 'Switch to Direct…' }).click();
      const sheet = page.getByRole('dialog', { name: /Switch this session to Direct/ });
      await expect(sheet).toBeVisible();
      const confirm = sheet.getByRole('button', { name: 'Stop them and switch' });
      await expect(confirm).toBeDisabled();
      const text = await sheet.innerText();
      await sheet.getByRole('radio', { name: SONNET }).click();
      await expect(confirm).toBeEnabled();
      await page.screenshot({ path: join(scratch.root, 'switch-sheet.png') });
      const t0 = Date.now();
      await confirm.click();
      await expect.poll(async () => {
        const s = await status(page, id).catch(() => null);
        return s !== null && s.process === 'ready' && s.gateway.mode === 'direct';
      }, { timeout: 90_000 }).toBe(true);
      const toast = (await seen(page)).find((t) => t.includes('restarted direct'));
      const popover = await (await routeRow(page, id)).innerText();
      const statusText = await settled(await openWidget(live, 'status'));
      await closeWidgets(page);
      observe('direct', {
        sheet: text,
        ms: Date.now() - t0,
        toast,
        route: await infoRow(page, id, 'Route'),
        main: await infoRow(page, id, 'Main'),
        popover,
        line: await (await usageRow(page, id)).innerText(),
        statusRows: statusText.split('\n').filter((l) => /Login|Organization|Email|base URL/i.test(l)),
        transcript: (await main.innerText()).split('\n').filter((l) => /exited|Continued|restarted/i.test(l)),
      });
      expect(text).toContain('1 background task');
      expect(toast).toMatch(/restarted direct · on (Sonnet 5|claude-sonnet)/);
      expect(await infoRow(page, id, 'Route')).toMatch(/^Direct · engine's own login/);
      expect(popover).toContain('Switch to gateway…');
    });

    await step('Switch to gateway… offers no model and names no background work; the relay route returns', async () => {
      await (await routeRow(page, id)).getByRole('button', { name: 'Switch to gateway…' }).click();
      const sheet = page.getByRole('dialog', { name: /Switch this session to the gateway/ });
      await expect(sheet).toBeVisible();
      const text = await sheet.innerText();
      await sheet.getByRole('button', { name: 'Restart routed' }).click();
      await expect.poll(async () => {
        const s = await status(page, id).catch(() => null);
        return s !== null && s.process === 'ready' && s.gateway.mode === 'gateway';
      }, { timeout: 90_000 }).toBe(true);
      const back = await routeRow(page, id);
      await expect(back).toContainText('Gateway · ClaudeUsage relay');
      const popover = await back.innerText();
      await expect(await usageRow(page, id)).toContainText(/5h \d+%/, { timeout: 30_000 });
      observe('back', { sheet: text, popover: popover.replace(/[\w.+-]+@[\w.-]+/g, '<account>'), line: await (await usageRow(page, id)).innerText(), usageCost: await usageCost(page, id) });
      expect(text).not.toContain('Claude models');
      expect(text).not.toContain('background');
    });

    observe('cost', { total_cost_usd: await usageCost(page, id) });
  });
});

// ---- 3. the relay down: the card and the hand-off, the direct policy, the app-wide banner ---------------------------

test('relay down through the forwarder: the card, the direct policy and the banner', async () => {
  const forwarder = new Forwarder();
  try {
    await withApp('relay', { MAWS_RELAY_URL: `http://127.0.0.1:${FORWARDER_PORT}` }, async (live) => {
      const { page, main, observe, step } = live;
      const repo = scratch.repo('repo-b');
      let routed = '';

      await step('the first send docks the relay card; Open ClaudeUsage, then start hands off and starts routed', async () => {
        const health = value(await invoke(page, 'engine.relayHealth', { force: true }));
        expect(health.url).toBe(`http://127.0.0.1:${FORWARDER_PORT}`);
        routed = await plusSession(live, repo, 'Reply with exactly: RELAY CARD');
        const card = main.getByRole('group', { name: 'Relay not answering' });
        await expect(card).toBeVisible({ timeout: 30_000 });
        const text = await card.innerText();
        await card.getByRole('button', { name: 'Open ClaudeUsage, then start' }).click();
        await expect.poll(async () => (await seen(page)).some((t) => t.includes('ClaudeUsage is in the menu bar')), { timeout: 5_000 }).toBe(true);
        const t0 = Date.now();
        await forwarder.start();
        await expect.poll(async () => (await invoke(page, 'session.status', { appSessionId: routed as AppSessionId })).ok, { timeout: 60_000 }).toBe(true);
        await expect.poll(async () => (await status(page, routed)).process, { timeout: 60_000 }).toBe('ready');
        const startedMs = Date.now() - t0;
        await idle(page, routed);
        const s = await status(page, routed);
        observe('card', { text, handOff: (await seen(page)).filter((t) => t.includes('ClaudeUsage')), startedMs, gateway: s.gateway });
        expect(s.gateway.verified).toBe('routed');
      });

      await step("with the policy 'direct' the same launch runs direct without a card and posts the notice", async () => {
        value(await invoke(page, 'settings.set', { gateway: { relayUnreachable: 'direct' } }));
        await forwarder.stop();
        const id = await plusSession(live, repo, 'Reply with exactly: DIRECT FALLBACK');
        await expect.poll(async () => {
          const r = await invoke(page, 'session.status', { appSessionId: id as AppSessionId });
          return r.ok && r.value.process === 'ready' ? r.value.gateway.mode : null;
        }, { timeout: 60_000 }).toBe('direct');
        await idle(page, id);
        const notices = await page.evaluate((i) => (window as unknown as C11Window).__c11.notices.filter((n) => n.appSessionId === i), id);
        observe('direct', {
          card: await main.getByRole('group', { name: 'Relay not answering' }).count(),
          notices,
          rendered: await main.getByText('The relay was unreachable, so this session started on the direct route.').count(),
          reply: (await main.innerText()).split('\n').filter((l) => /login/i.test(l)),
          seen: (await seen(page)).slice(-6),
        });
        expect(notices.map((n) => n.key)).toContain('relay:direct_fallback');
        value(await invoke(page, 'settings.set', { gateway: { relayUnreachable: 'ask' } }));
      });

      await step('with the relay down while a routed session is live the banner appears once and clears', async () => {
        const banner = page.getByText("ClaudeUsage's relay stopped answering", { exact: false });
        await expect(banner).toHaveCount(1, { timeout: 45_000 });
        const t0 = Date.now();
        await forwarder.start();
        await expect(banner).toHaveCount(0, { timeout: 45_000 });
        observe('banner', { clearedMs: Date.now() - t0, posted: (await seen(page)).filter((t) => t.includes('stopped answering')).length });
      });
    });
  } finally {
    await forwarder.stop();
  }
});
