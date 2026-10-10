// P2-A's live acceptance (the execution document §6.3's last paragraph; acceptance 1, 4, 5 and 7 on the installed
// engine): the built app against the owner's installed engine behind ClaudeUsage's relay, through Playwright only, in a
// scratch root under /tmp (E8's live form, `e2e/plugins-live.spec.ts`): a scratch `CLAUDE_CONFIG_DIR` the engine reads
// and writes, a scratch profile (`userData`) kept across one relaunch, the runner's CLAUDE* variables dropped by
// `launchMaws`, the relay reached only by the engine (and `GET /api/hello` at the gate). Two terminal-style sessions are
// discovered from transcripts seeded in the scratch home: the first is opened (nothing launches; "Not observed yet"),
// then sent "Reply with OK" (Starting…, then the one-line Haiku reply in the same conversation) and stopped; the second
// is started once with no prompt from Session info's Refresh and stopped, so it is an exited MAWS-run session, and its
// `/skills` reads "Not read yet." with Load now, which says Starting… and then shows the scratch home's skill. MAWS then
// quits and relaunches over the same profile: the first session's ring and Session info read "Last reading, …" and
// "Last observed …" with no engine started. The product launches with no `--max-budget-usd` (C11's rule; the
// architect's accepted form): the spend is one Haiku reply, read from the session's own receipts. With
// MAWS_LIVE_MAX_USD set (at most 1), the engine is reached through support/live-budget.ts's forwarding script, which
// adds `--max-budget-usd <what that cap leaves>` to every session process (P2-F's re-run cap). The owner's
// ~/.claude.json (A-15, its /tmp project keys and their digest) and ~/.claude/settings.json are read before and after,
// never written. Run on purpose only; it spends usage (one Haiku turn):
//   MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_P2A_LIVE=1 [MAWS_LIVE_MAX_USD=0.20] pnpm exec playwright test e2e/sessions-available-live.spec.ts --reporter=line
// Its log, observations and screenshots stay in the scratch root, which the run leaves in place and names.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ENGINE_BIN, ENGINE_VERSION } from '../test/support/engine-pin';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { journalCost } from '../test/live/support/live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { cappedEngine, capWords, spentUnder, type CappedEngine } from './support/live-budget';
import { a15Line, a15Reading } from './support/p1-live';
import { seedTranscript, transcript } from './support/side-replay';
import { sidebarRow } from './support/sidebar';

const RELAY = 'http://127.0.0.1:8641';
function skipReason(): string | null {
  if (process.env.MAWS_P2A_LIVE !== '1') return 'the P2-A live acceptance runs only under MAWS_P2A_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  if (!ENGINE_VERSION) return `engine did not report a version at ${ENGINE_BIN}`;
  return relaySkipReason(RELAY);
}
const skip = skipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 900_000 });

const SEND_SESSION = 'a2a2e000-0000-4000-8000-0000000000a1';
const SKILLS_SESSION = 'a2a2e000-0000-4000-8000-0000000000a2';
const SKILL = 'p2a-hello';

// ---- the scratch root ------------------------------------------------------------------------------------------------

const root = skip === null ? realpathSync(mkdtempSync('/tmp/maws-p2a-live-')) : '/tmp/maws-p2a-live-skipped'; // made only for a run
const config = join(root, 'claude-config');
const userData = join(root, 'user-data');
const repo = join(root, 'p2a-repo');
const logFile = join(root, 'live-run.txt');
const log = (line = '') => appendFileSync(logFile, `${line}\n`);
const observationsFile = join(root, 'observations.json');
function observe(key: string, data: unknown): void {
  const prior = existsSync(observationsFile) ? (JSON.parse(readFileSync(observationsFile, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(observationsFile, JSON.stringify({ ...prior, [key]: data }, null, 2));
}
const sha256 = (path: string): string => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent');
const ownerFiles = () => ({ claudeJson: sha256(join(homedir(), '.claude.json')), settingsJson: sha256(join(homedir(), '.claude', 'settings.json')), keys: ownerKeyDigests() });
// The owner's ~/.claude.json as a digest per top-level key and per `projects` key (never its content), so a change found
// by the whole file's digest names where it was: another owner session's bookkeeping, or this run.
function ownerKeyDigests(): Record<string, string> {
  const file = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as Record<string, unknown>;
  const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex').slice(0, 12);
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(file)) out[key] = digest(v);
  for (const [key, v] of Object.entries((file.projects as Record<string, unknown> | undefined) ?? {})) out[`projects[${key}]`] = digest(v);
  return out;
}
const changedKeys = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

function prepare(): void {
  mkdirSync(config);
  mkdirSync(userData);
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), '# P2-A live acceptance\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'seed');
  // trusted as the owner's trust dialog would leave it; Haiku as the scratch home's model (spend); one user skill
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
  writeFileSync(join(config, 'settings.json'), `${JSON.stringify({ model: 'haiku', permissions: { defaultMode: 'default' } }, null, 2)}\n`);
  mkdirSync(join(config, 'skills', SKILL), { recursive: true });
  writeFileSync(join(config, 'skills', SKILL, 'SKILL.md'), `---\nname: ${SKILL}\ndescription: Says hello, for the P2-A live acceptance.\n---\nReply with exactly: hello.\n`);
  // two sessions as a terminal would have left them: one exchange each, never run by MAWS
  for (const [n, id] of [[1, SEND_SESSION], [2, SKILLS_SESSION]] as const) {
    const t = transcript({ sessionId: id, cwd: repo, start: Date.UTC(2026, 9, 8, 9, n, 0) });
    t.user(`a2a2d00${n}-0000-4000-8000-000000000001`, `Remember the number ${n}.`);
    t.text(`a2a2d00${n}-0000-4000-8000-000000000002`, `Noted: ${n}.`);
    t.turnEnd(`a2a2d00${n}-0000-4000-8000-000000000003`);
    seedTranscript(config, repo, id, t.records);
  }
}

// ---- the page --------------------------------------------------------------------------------------------------------

let engine: CappedEngine; // the installed engine, or its capped forwarding script under MAWS_LIVE_MAX_USD (set at the run's start)
const launch = () => {
  engine.budget(spentUnder(userData));
  return launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
};
const main = (page: Page) => page.locator('[data-region="main"]');
const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
const engineSessions = async (page: Page) => value(await invoke(page, 'engine.sessions', undefined));
function journal(id: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow));
}
const spawns = (id: string) => journal(id).filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn');
const userFrames = (id: string) => journal(id).filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user');
async function appIdOf(page: Page, engineSessionId: string): Promise<string> {
  await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === engineSessionId), { timeout: 30_000 }).toBe(true);
  return value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === engineSessionId)!.appId;
}
async function open(page: Page, appId: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: appId as AppSessionId })).click();
  await page.mouse.move(700, 450);
  await expect(main(page).locator(`[role="tab"][data-tab-id="session:${appId}"]`)).toHaveAttribute('aria-selected', 'true');
}
async function sessionInfo(page: Page) {
  const panel = page.locator('[data-region="panel"]');
  if ((await panel.locator('[data-session-info]').count()) === 0) {
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Session info' }).click();
  }
  return panel.locator('[data-session-info]');
}
const infoValue = (info: Awaited<ReturnType<typeof sessionInfo>>, label: string) => info.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
async function untilExited(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await status(page, id)).process, { timeout: 60_000 }).toBe('exited');
}
async function stop(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
  await untilExited(page, id);
}

// ---- the run -----------------------------------------------------------------------------------------------------------

test('P2-A live: discovered sessions open with nothing started; Send, Load now and Refresh start them; a relaunch keeps the observed facts', async () => {
  prepare();
  engine = await cappedEngine({ root, real: ENGINE_BIN });
  log(`P2-A live acceptance · ${new Date().toISOString()} · engine ${ENGINE_VERSION} (${ENGINE_BIN.replace(homedir(), '~')}) · cap ${capWords(engine)} · relay ${RELAY} · scratch ${root}`);
  const a15First = a15Reading();
  const ownerBefore = ownerFiles();
  log(a15Line('before', a15First, a15First, [root]));
  log(`owner files before: ~/.claude.json sha256 ${ownerBefore.claudeJson} · ~/.claude/settings.json sha256 ${ownerBefore.settingsJson}`);
  observe('before', { a15: a15First, owner: { claudeJson: ownerBefore.claudeJson, settingsJson: ownerBefore.settingsJson } });

  const failures: string[] = [];
  let n = 0;
  let page!: Page;
  let maws: MawsLaunch | null = null;
  const step = (name: string, title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      n += 1;
      const label = `${String(n).padStart(2, '0')}-${name}`;
      log('');
      log(`=== ${label} · ${title}`);
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${label}: ${message}`);
        log(`FAILED: ${message}`);
        observe(`${label}.failed`, message);
      }
      await page?.screenshot({ path: join(root, `live-${label}.png`) }).catch(() => undefined);
    });

  let sendId = '';
  let skillsId = '';
  let spent = 0;
  try {
    maws = await launch();
    page = maws.page;
    await expect(main(page)).toBeVisible();
    sendId = await appIdOf(page, SEND_SESSION);
    skillsId = await appIdOf(page, SKILLS_SESSION);
    log(`discovered: ${SEND_SESSION} → ${sendId}; ${SKILLS_SESSION} → ${skillsId}`);

    await step('open', 'a discovered terminal session opened: nothing launches; Session info reads Not observed yet', async () => {
      await open(page, sendId);
      const info = await sessionInfo(page);
      await expect(infoValue(info, 'Main')).toContainText('Not observed yet');
      const main = (await infoValue(info, 'Main').innerText()).trim();
      expect(spawns(sendId), 'no session.launch for it').toHaveLength(0);
      expect((await engineSessions(page)).filter((s) => s.appSessionId === sendId)).toEqual([]);
      log(`Session info Main: ${main} · journal directory: ${existsSync(join(userData, 'engine-host', 'journal', sendId)) ? 'present' : 'absent'}`);
      observe('open', { main, launched: spawns(sendId).length });
    });

    await step('send', 'Send "Reply with OK": the composer reads Starting…, then the reply streams in the same conversation', async () => {
      const control = main(page).locator('[data-submit-state]');
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.insertText('Reply with OK');
      await expect(control).toHaveAttribute('aria-description', 'Starts this session');
      await control.click();
      await expect(control).toHaveText('Starting…', { timeout: 10_000 });
      log('control read: Starting…');
      await expect(main(page).locator('[data-bubble]').filter({ hasText: 'Reply with OK' })).toBeVisible({ timeout: 120_000 });
      await expect.poll(async () => (await status(page, sendId)).turn, { timeout: 180_000 }).toBeNull();
      await expect(main(page).locator('[data-kind="assistant_text"]').last()).toContainText(/OK/i, { timeout: 30_000 });
      const args = (spawns(sendId)[0]?.frame as { args?: string[] } | undefined)?.args ?? [];
      const s = await status(page, sendId);
      const reply = await main(page).locator('[data-kind="assistant_text"]').last().innerText().catch(() => '');
      expect(spawns(sendId), 'one launch').toHaveLength(1);
      expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), 'the same conversation').toEqual(['--resume', SEND_SESSION]);
      expect(s.engineSessionId).toBe(SEND_SESSION);
      expect(userFrames(sendId), 'sent once').toHaveLength(1);
      spent = journalCost(journal(sendId)).costUsd;
      log(`spawn args: ${args.filter((a) => !a.includes('/')).join(' ')} · engine session ${s.engineSessionId} · model ${JSON.stringify(s.model)} · user frames ${userFrames(sendId).length}`);
      log(`reply: ${JSON.stringify(reply.slice(0, 200))} · spend US$${spent.toFixed(5)}`);
      observe('send', { args, engineSessionId: s.engineSessionId, model: s.model, reply, spentUsd: spent });
    });

    await step('stop-send', 'the sent session stopped', async () => {
      await stop(page, sendId);
    });

    await step('skills-prepare', 'the other session started once with no prompt (Session info’s Refresh) and stopped: an exited MAWS-run session', async () => {
      await open(page, skillsId);
      const info = await sessionInfo(page);
      await info.getByRole('button', { name: 'Refresh' }).click();
      await expect.poll(async () => (await status(page, skillsId).catch(() => null))?.process ?? null, { timeout: 120_000 }).toBe('ready');
      expect(userFrames(skillsId), 'no prompt').toHaveLength(0);
      await stop(page, skillsId);
      log(`launches so far: ${spawns(skillsId).length}; user frames ${userFrames(skillsId).length}`);
    });

    await step('skills', '/skills on the exited MAWS-run session: Not read yet. with Load now, which says Starting… and then shows the skill', async () => {
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.type('/skills');
      await expect(page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]')).toContainText('/skills');
      await page.keyboard.press('Enter');
      const frame = page.locator('[data-widget="skills"]');
      await expect(frame.getByText('Not read yet.')).toBeVisible();
      const before = spawns(skillsId).length;
      await frame.getByRole('button', { name: 'Load now' }).click();
      await expect(frame.getByText('Starting…')).toBeVisible({ timeout: 10_000 });
      log('frame read: Starting…');
      await expect(frame.locator(`[data-skill-row="${SKILL}"]`)).toBeVisible({ timeout: 120_000 }); // P2-B's skills library row
      expect(spawns(skillsId).length, 'one more launch').toBe(before + 1);
      expect(userFrames(skillsId), 'no prompt to populate it').toHaveLength(0);
      const rows = await frame.locator('li').allInnerTexts();
      log(`skills rows: ${JSON.stringify(rows.slice(0, 8))}`);
      observe('skills', { rows });
      await frame.getByRole('button', { name: /^Close / }).click();
      await stop(page, skillsId);
    });

    await step('relaunch', 'quit and relaunch: the ring reads Last reading, …, Session info Last observed …, and nothing starts', async () => {
      const launches = { send: spawns(sendId).length, skills: spawns(skillsId).length };
      await maws!.cleanup(); // the profile is the run's: kept
      maws = await launch();
      page = maws.page;
      await expect(main(page)).toBeVisible();
      await open(page, sendId);
      const info = await sessionInfo(page);
      await expect(infoValue(info, 'Main')).toContainText('Last observed', { timeout: 30_000 });
      const ring = main(page).getByRole('button', { name: /^Context window/ });
      await expect(ring).toHaveAttribute('aria-label', /Last reading, /, { timeout: 30_000 });
      const lines = { main: (await infoValue(info, 'Main').innerText()).trim(), context: (await infoValue(info, 'Context').innerText()).trim(), ring: await ring.getAttribute('aria-label') };
      await page.waitForTimeout(3_000);
      const live = (await engineSessions(page)).filter((s) => s.process !== 'exited');
      expect(live, 'no engine started').toEqual([]);
      expect({ send: spawns(sendId).length, skills: spawns(skillsId).length }).toEqual(launches);
      log(`after relaunch: ${JSON.stringify(lines)} · engines running: ${live.length}`);
      observe('relaunch', { ...lines, running: live.length, launches });
    });
  } finally {
    await maws?.cleanup().catch(() => undefined);
    const a15Now = a15Reading();
    const ownerAfter = ownerFiles();
    log('');
    log(a15Line('after', a15First, a15Now, [root]));
    log(`owner files after: ~/.claude.json sha256 ${ownerAfter.claudeJson} · ~/.claude/settings.json sha256 ${ownerAfter.settingsJson}`);
    log(`~/.claude.json keys whose digest moved: ${JSON.stringify(changedKeys(ownerBefore.keys, ownerAfter.keys))} · mtime ${new Date(statSync(join(homedir(), '.claude.json')).mtimeMs).toISOString()}`);
    log(`spend: US$${spent.toFixed(5)} (the sent session's receipts; the two no-prompt starts made no model request)`);
    observe('after', { a15: a15Now, owner: { claudeJson: ownerAfter.claudeJson, settingsJson: ownerAfter.settingsJson, changedKeys: changedKeys(ownerBefore.keys, ownerAfter.keys) }, spentUsd: spent });
    console.log(`P2-A live: scratch root ${root}`);
  }
  expect(a15Reading().keys.filter((k) => k.startsWith(root) || k.startsWith(root.replace(/^\/private\/tmp\//, '/tmp/'))), 'A-15: the owner file names none of the run’s scratch').toEqual([]);
  expect(failures, failures.join('\n')).toEqual([]);
});
