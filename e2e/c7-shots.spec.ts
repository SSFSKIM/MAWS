// C7's mockup checklist (C7 execution document, M6 and Acceptance item 4): screenshots of the composer and its request
// and status-line surfaces in the light and dark themes, against mockups 04 and 05 as redrawn to the frame anatomy,
// saved under docs/doperpowers/plans/shots/c7-*.png for the review. The live frame, the docked approvals and the
// popovers are taken in the product shell over C3's replay (a scratch transcript under the launch's own
// CLAUDE_CONFIG_DIR, the committed ClaudeUsage fixture moved to now); the unstarted frame and the slash palette on the
// harness pages (the stub of C10's intent inside C5's own session pane; a stub widget registered as C11 will). Nothing
// here asserts a look: it drives each state to where the mockup shows it and photographs it. Run on purpose only:
//   MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_C7_SHOTS=1 MAWS_ENGINE_REPLAY=1 pnpm exec playwright test e2e/c7-shots.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { CardsHarnessApi, HarnessIntent } from '../src/renderer/src/harness/composer/api';
import type { EditorHarnessApi } from '../src/renderer/src/harness/composer/editor-api';
import { invoke, launchReady, turnsJournal, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT } from './support/launch';

test.skip(process.env.MAWS_C7_SHOTS !== '1', 'the mockup screenshots run only under MAWS_C7_SHOTS=1');
test.skip(!existsSync(join(REPO_ROOT, 'out/renderer/harness.html')), 'the screenshots need a harness build');

const SHOTS = join(REPO_ROOT, 'docs/doperpowers/plans/shots');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const GRANT = 'spikes/protocol-probe/fixtures/pass2/grant-reapply-start.jsonl';

let scratch: string;
let repo: string;
let config: string;
let usage: string;
const sessions = { live: randomUUID(), approval: randomUUID(), edit: randomUUID() };

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  scratch = realpathSync(mkdtempSync('/tmp/maws-c7-shots-'));
  repo = join(scratch, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=MAWS e2e', '-c', 'user.email=e2e@example.test', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  config = join(scratch, 'claude-config');
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  for (const [title, sessionId] of Object.entries(sessions)) {
    const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: `the ${title} session` }, uuid: randomUUID(), timestamp: '2026-09-29T10:00:00.000Z', cwd: repo, sessionId, version: '2.1.283' };
    writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(row)}\n`);
  }
  // The committed ClaudeUsage fixture, its readings moved so the newest is two minutes old (statusline.spec.ts's way).
  usage = join(scratch, 'claude-usage');
  cpSync(join(REPO_ROOT, 'test/fixtures/claude-usage'), usage, { recursive: true });
  const history = join(usage, 'history');
  const files = readdirSync(history).map((name) => join(history, name));
  const rows = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const newest = Math.max(...files.flatMap((file) => rows(file).map((row) => Date.parse(row.recordedAt as string))));
  const offset = Date.now() - 2 * 60_000 - newest;
  const shift = (at: unknown) => new Date(Date.parse(at as string) + offset).toISOString().replace('.000Z', 'Z');
  for (const file of files) writeFileSync(file, rows(file).map((row) => JSON.stringify({ ...row, recordedAt: shift(row.recordedAt), resetsAt: shift(row.resetsAt) })).join('\n') + '\n');
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const jsonl = (path: string) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { seq: number; direction: string; at: string; frame: Record<string, unknown> });

// One human turn, then three `get_context_usage` reads answered as reads.jsonl recorded them: the one C3's session
// issues at the turn's end (the status line's `ctx`), then one per theme's popover.
function liveJournal(): string {
  const rows = jsonl(turnsJournal(scratch, 'shots-live', 1));
  const reads = jsonl(join(REPO_ROOT, 'spikes/protocol-probe/fixtures/reads.jsonl')).filter((r) => r.seq === 56 || r.seq === 57);
  let seq = rows.at(-1)!.seq;
  for (let k = 0; k < 3; k++) for (const r of reads) rows.push({ ...r, seq: ++seq });
  const path = join(scratch, 'shots-live.jsonl');
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}

// The synthetic Edit request behind the handshake prelude; the replay holds at the answer, which is never given.
function editJournal(): string {
  const rows = jsonl(join(REPO_ROOT, 'test/fixtures/engine/replay-handshake.jsonl'));
  const { frame } = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/requests/edit-permission.json'), 'utf8')) as { frame: Record<string, unknown> };
  (frame.request as { input: { file_path: string } }).input.file_path = join(repo, 'src/a.ts');
  rows.push({ seq: rows.at(-1)!.seq + 1, direction: 'in', at: '2026-09-29T12:00:00.000Z', frame });
  const path = join(scratch, 'shots-edit.jsonl');
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}

function firstPrompt(fixture: string): string {
  return (jsonl(join(REPO_ROOT, fixture)).find((r) => r.direction === 'out' && r.frame.type === 'user')!.frame.message as { content: string }).content;
}

async function setTheme(page: Page, theme: Theme, harness: boolean) {
  if (harness) await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  else value(await invoke(page, 'settings.set', { theme }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.waitForTimeout(150);
}
async function shoot(page: Page, name: string, harness = false) {
  // C5's toasts (a request's "needs you") would cover the card; the mockups show none
  const toasts = page.getByRole('region', { name: /^Notifications/ }).getByRole('button', { name: 'Dismiss' });
  while ((await toasts.count()) > 0) await toasts.first().click();
  for (const theme of THEMES) {
    await setTheme(page, theme, harness);
    await page.screenshot({ path: join(SHOTS, `c7-${name}-${theme}.png`) });
  }
  await setTheme(page, 'light', harness);
}

test('the shell: the frame docked under a live transcript, the docked approvals, the usage and context popovers', async () => {
  test.setTimeout(180_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_CLAUDE_USAGE_DIR: usage } });
  const { page } = maws;
  try {
    const appIdOf = async (sessionId: string) => {
      let id = '';
      await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === sessionId)?.appId ?? '')).not.toBe('');
      return id;
    };
    const [live, approval, edit] = [await appIdOf(sessions.live), await appIdOf(sessions.approval), await appIdOf(sessions.edit)];
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const open = async (id: string) => {
      await page.locator(`[role="treeitem"][data-menu="session:${id}"]`).click();
      await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    };
    const message = pane.getByRole('textbox', { name: 'Message' });

    // the frame at rest, docked under a transcript with one turn in it
    await open(live);
    await launchReady(page, live, liveJournal(), { cwd: repo });
    await message.click();
    await page.keyboard.type('Summarise this repository in one line.');
    await page.keyboard.press('Enter');
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: live as never })).turn).toBeNull();
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: live as never })).queue.length).toBe(0);
    await page.mouse.move(0, 0);
    await shoot(page, 'frame-live');

    // 04 vignette 4, in place: the palette over the docked frame, origin badges on every row
    await message.click();
    await page.keyboard.type('/mo');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await shoot(page, 'palette');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');

    // 04 vignette 5: the context popover, from the toolbar's context ring (W2: the status line and its usage popover are
    // gone; the windows are Session info's until the top bar's usage pill, W6)
    const ring = pane.getByRole('button', { name: /^Context window/ });
    for (const theme of THEMES) {
      await setTheme(page, theme, false);
      await ring.click();
      await expect(page.getByRole('table', { name: 'Context token breakdown' })).toBeVisible();
      await page.screenshot({ path: join(SHOTS, `c7-context-popover-${theme}.png`) });
      await page.keyboard.press('Escape');
    }
    await setTheme(page, 'light', false);

    // 04 vignette 2: the docked approval with its grant scopes (pass2/grant-reapply-start, no ask rule)
    await open(approval);
    await launchReady(page, approval, GRANT, { cwd: repo });
    value(await invoke(page, 'session.send', { appSessionId: approval as never, content: firstPrompt(GRANT) })); // as recorded (the replay holds at it)
    await expect(pane.getByRole('group', { name: 'Approval needed' })).toBeVisible({ timeout: 20_000 });
    await shoot(page, 'approval-scopes');

    // 04 vignette 3: the edit-approval variant (a synthetic Edit request)
    await open(edit);
    await launchReady(page, edit, editJournal(), { cwd: repo });
    await expect(pane.getByRole('group', { name: 'Approval needed' })).toBeVisible({ timeout: 20_000 });
    await shoot(page, 'edit-approval');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('the harness: the frame centred on an unstarted session, and the slash palette beside a registered stub widget', async () => {
  test.setTimeout(120_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  const { page } = maws;
  try {
    // the unstarted frame: the stub of C10's intent, inside C5's own session pane (centred under its heading)
    await page.evaluate(() => (location.hash = 'composer'));
    await page.waitForFunction(() => (window as unknown as { __maws_cards?: unknown }).__maws_cards !== undefined);
    const id = 'c7-shots-unstarted';
    const intent: HarnessIntent = { location: { kind: 'directory', path: repo }, additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, message: null, draft: null };
    await page.evaluate(([i, it]) => {
      const cards = (window as unknown as { __maws_cards: CardsHarnessApi }).__maws_cards;
      cards.intent(i, it);
      cards.show([{ composer: i, shell: true }, null]);
    }, [id, intent] as const);
    await expect(page.locator(`[data-composer="${id}"]`)).toBeVisible();
    await shoot(page, 'frame-unstarted', true);

    // 04 vignette 4: the stub widget registered for /model (as C11 will), opened from the palette
    await page.evaluate(() => (location.hash = 'editor'));
    await page.waitForFunction(() => (window as unknown as { __maws_editor?: unknown }).__maws_editor !== undefined);
    const editor = (fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => ((window as unknown as { __maws_editor: Record<string, (...x: unknown[]) => unknown> }).__maws_editor[f as string]!(...(a as unknown[]))), [fn, args] as const);
    const session = 'c7-shots-palette';
    await launchReady(page, session, turnsJournal(scratch, session, 1));
    const status = value(await invoke(page, 'session.status', { appSessionId: session as never }));
    await editor('show', { appSessionId: session, cwd: repo, sessionId: status.engineSessionId } satisfies Parameters<EditorHarnessApi['show']>[0]);
    const message = page.getByRole('textbox', { name: 'Message' });
    await message.click();
    await page.keyboard.type('hi');
    await page.keyboard.press('Enter'); // the turn's init completes the catalogue
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: session as never })).turn).toBeNull();
    await page.waitForTimeout(300);
    await editor('registerWidget', 'model');
    await message.click();
    await page.keyboard.type('/mo');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await page.keyboard.type('del');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '/model widget' })).toBeVisible(); // W3 (C6): the floating dialog
    await shoot(page, 'palette-widget', true);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});
