// P2-A's end-to-end group (the execution document §6.2 M3 and §6.3; acceptance 1, 4, 5 and 7 as the replay can show
// them): sessions discovered from a scratch config home (`CLAUDE_CONFIG_DIR`, transcripts the engine would have left),
// against the built product with C3's replay transport (`MAWS_ENGINE_REPLAY=1`) and C10's replay seam
// (`MAWS_E2E_REPLAY_FIXTURES`: each launch takes the next journal and pins its id), the journals built by
// `support/side-replay.ts` behind C3's handshake prelude under the discovered session's own id, so an acquisition's
// resume replays the conversation it continues. The replay plays `system/init` only with a recorded turn and answers
// the host's own context sample at ready empty, so observed facts appear after a turn (§11). Opening a session starts
// nothing; Load now and Send are the gestures that do. No engine runs; the owner's `~/.claude` is never read or written.
// Run by `pnpm e2e:available`.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, type MawsLaunch } from './support/launch';
import { seedTranscript, SideJournal, transcript } from './support/side-replay';
import { sidebarRow } from './support/sidebar';

const SKILLS_SESSION = 'a2a20000-0000-4000-8000-00000000000a';
const SEND_SESSION = 'a2a20000-0000-4000-8000-00000000000b';
const SKILL = { name: 'e8-probe:e8-hello', display_name: 'e8-probe:e8-hello', description: 'Says hello from the E8 probe plugin.', source: 'plugin', tokens: 14, state: 'on', locked_by: 'plugin', advertised: true, handles: { aliases: ['e8-hello'] } }; // pass3/e8-plugins-reload seq 37
const REPLY = 'OK';

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

type JournalRow = { direction: string; frame: Record<string, unknown> & { type?: string; event?: string; args?: string[] } };
const journalDir = (maws: MawsLaunch, id: string) => join(maws.userData, 'engine-host', 'journal', id);
function journal(maws: MawsLaunch, id: string): JournalRow[] {
  const dir = journalDir(maws, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow));
}
const spawns = (maws: MawsLaunch, id: string) => journal(maws, id).filter((r) => r.direction === 'meta' && r.frame.event === 'spawn');
const writtenUsers = (maws: MawsLaunch, id: string) => journal(maws, id).filter((r) => r.direction === 'out' && r.frame.type === 'user');

let cleanups: (() => Promise<void> | void)[] = [];
test.afterEach(async () => {
  const pending = cleanups.reverse();
  cleanups = [];
  for (const cleanup of pending) await cleanup();
});

// A scratch repository holding one discovered session (a transcript the engine left), a config home trusting it, the
// session's replay journal, and the product launched over them with the route direct.
async function launchWith(sessionId: string, build: (journal: SideJournal) => void): Promise<{ maws: MawsLaunch; page: Page; appId: string }> {
  const repo = await ScratchRepo.create({ sentinels: false });
  const store = await StoreFixture.create();
  const journals = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2a-journals-')));
  cleanups.push(() => rmSync(journals, { recursive: true, force: true }), () => store.dispose(), () => repo.dispose());
  writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  const t = transcript({ sessionId, cwd: repo.root, start: Date.UTC(2026, 9, 8, 9, 0, 0) });
  t.user('a2a2d000-0000-4000-8000-000000000001', 'An earlier prompt in a terminal');
  t.text('a2a2d000-0000-4000-8000-000000000002', 'An earlier answer.');
  t.turnEnd('a2a2d000-0000-4000-8000-000000000003');
  seedTranscript(store.configHome, repo.root, sessionId, t.records);
  const replay = new SideJournal(sessionId, repo.root);
  build(replay);
  const fixture = replay.write(journals, `p2a-${sessionId}`);
  // the launch gate probes a version even for a replay: no installed binary is needed
  const gate = join(store.configHome, 'version-only-engine');
  writeFileSync(gate, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.283 (Claude Code)"; exit 0; fi\nexit 99\n');
  chmodSync(gate, 0o755);
  // the replay paced, so "Starting…" is on screen long enough to read
  const maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixture, MAWS_E2E_REPLAY_ROW_MS: '60', MAWS_E2E_ENGINE_BIN: gate, CLAUDE_CONFIG_DIR: store.configHome } });
  cleanups.push(() => maws.cleanup());
  const page = maws.page;
  await expect(page.locator('[data-region="main"]')).toBeVisible();
  value(await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } }));
  await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sessionId), { timeout: 20_000 }).toBe(true);
  const appId = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sessionId)!.appId;
  return { maws, page, appId };
}

const mainRegion = (page: Page) => page.locator('[data-region="main"]');
async function open(page: Page, appId: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: appId })).click();
  await page.mouse.move(700, 450); // off the sidebar: its hover card would cover what follows
  await expect(mainRegion(page).locator(`[role="tab"][data-tab-id="session:${appId}"]`)).toHaveAttribute('aria-selected', 'true');
}
async function sessionInfo(page: Page) {
  const panel = page.locator('[data-region="panel"]');
  if ((await panel.locator('[data-session-info]').count()) === 0) {
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Session info' }).click();
  }
  return panel.locator('[data-session-info]');
}
const valueOf = (info: Awaited<ReturnType<typeof sessionInfo>>, label: string) => info.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');

test.describe('sessions available on demand (P2-A)', () => {
  test('opening a discovered session starts nothing; /skills offers Load now, which says Starting… and then shows the skills', async () => {
    test.setTimeout(120_000);
    const { maws, page, appId } = await launchWith(SKILLS_SESSION, (journal) => journal.read({ subtype: 'get_skills_dialog' }, { skills: [SKILL] }));
    await open(page, appId);
    const info = await sessionInfo(page);
    await expect(valueOf(info, 'Main')).toContainText('Not observed yet');
    await expect(info.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(existsSync(journalDir(maws, appId)), 'nothing launched on open').toBe(false);

    const composer = mainRegion(page).getByRole('textbox', { name: 'Message' });
    await composer.click();
    await page.keyboard.type('/skills');
    await page.keyboard.press('Enter');
    const frame = page.locator('[data-widget="skills"]');
    await expect(frame.getByText('Not read yet.')).toBeVisible();
    expect(existsSync(journalDir(maws, appId)), 'nothing launched on opening the widget').toBe(false);
    await frame.getByRole('button', { name: 'Load now' }).click();
    await expect(frame.getByText('Starting…')).toBeVisible();
    await expect(frame.locator('[data-skill-row="e8-probe:e8-hello"]')).toBeVisible({ timeout: 20_000 }); // P2-B's skills library row
    expect(spawns(maws, appId), 'one launch').toHaveLength(1);
    expect(spawns(maws, appId)[0]!.frame.args).toEqual(expect.arrayContaining(['--resume', SKILLS_SESSION]));
    expect(writtenUsers(maws, appId), 'no prompt sent to populate the widget').toEqual([]);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('Send on a discovered session starts it and continues the conversation; once stopped, the facts read Last observed, and a reload keeps them', async () => {
    test.setTimeout(120_000);
    const { maws, page, appId } = await launchWith(SEND_SESSION, (journal) => journal.turn(REPLY));
    await open(page, appId);
    const control = mainRegion(page).locator('[data-submit-state]');
    const composer = mainRegion(page).getByRole('textbox', { name: 'Message' });
    await composer.click();
    await page.keyboard.type('Reply with OK');
    await expect(control).toHaveText('Send');
    await expect(control).toHaveAttribute('aria-description', 'Starts this session');
    expect(existsSync(journalDir(maws, appId)), 'nothing launched on open').toBe(false);
    await control.click();
    await expect(control).toHaveText('Starting…');
    await expect(mainRegion(page).getByText(REPLY, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(composer).toHaveText('');
    expect(spawns(maws, appId)).toHaveLength(1);
    expect(spawns(maws, appId)[0]!.frame.args, 'the same conversation').toEqual(expect.arrayContaining(['--resume', SEND_SESSION]));
    expect(writtenUsers(maws, appId).map((r) => (r.frame as { message?: { content?: unknown } }).message?.content), 'sent once').toEqual(['Reply with OK']);

    // stopped: what the engine reported is kept, labelled with when
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: appId as never })).turn, { timeout: 10_000 }).toBeNull();
    value(await invoke(page, 'session.stop', { appSessionId: appId as never, reason: 'stop' }));
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: appId as never })).process, { timeout: 15_000 }).toBe('exited');
    let info = await sessionInfo(page);
    await expect(valueOf(info, 'Main')).toContainText('Last observed');
    await page.reload();
    await expect(mainRegion(page)).toBeVisible();
    await open(page, appId);
    info = await sessionInfo(page);
    await expect(valueOf(info, 'Main')).toContainText('Last observed');
    expect(spawns(maws, appId), 'the reload started nothing').toHaveLength(1);
  });
});
