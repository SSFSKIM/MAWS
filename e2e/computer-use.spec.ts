// U12a's computer-use scenes (the UX wave's U12a execution document,
// docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, M5; the section's A6): sessions MAWS
// runs, on C3's replay transport and C10's replay seam over journals e2e/support/computer-use-replay.ts writes from
// recorded frames, in which the agent calls the computer-use plugin's `js` tool. The line at the top of the session's
// pane reads "Computer use running" with Stop while a call runs; the call's row reads "Used computer use"; Stop writes
// the composer's interrupt; after a Stop that withdrew the running call the line reads "Computer use may still be
// finishing a step" with Dismiss and outlasts the call's `timeout_ms`, until a later call of the session settles or the
// person dismisses it; a call waiting for a permission answer draws no line. Each scene attaches its lines' pictures.
// No scene runs a terminal session or a session on another machine: the strip reads one model by one function on
// every route, and its unit tests feed it rows mapped from a transcript file. Collected by the default group (`pnpm e2e`);
// no engine runs and the owner's `~/.claude` is never read or written. Session titles and prompts are invented.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { invoke, value } from './support/c7-replay';
import { ComputerUseJournal } from './support/computer-use-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { journalOf, metaEvents } from './support/maws-tools';
import { newChatIn, openProject } from './support/sidebar';

test.describe.configure({ timeout: 180_000 });

const TIMEOUT_MS = 2_000; // the cell's `timeout_ms`, which the lingering line must outlast
const CELL = "const app = await cua.app('Preview');\nawait app.click({ title: 'Zoom In' });";
const SESSIONS = ['c12a0000-0000-4000-8000-0000000000c1', 'c12a0000-0000-4000-8000-0000000000c2', 'c12a0000-0000-4000-8000-0000000000c3'] as const;
const PROMPTS = {
  first: 'Zoom the sample chart in Preview so the legend is readable.',
  second: 'Try the zoom once more, then tell me what the legend says.',
  dismissed: 'Close the sample chart window in Preview.',
  asked: 'Open the sample chart in Preview and zoom in once.',
};
const REPLIES = { second: 'The legend reads Revenue and Costs.', asked: 'Zoomed in once; the chart is open in Preview.' };

interface ComputerUseCase {
  maws: MawsLaunch;
  page: Page;
  pane: Locator; // the main region's first pane: the session started last
  start(prompt: string): Promise<AppSessionId>; // a new chat in the scratch project, started with `prompt`
  journal(id: AppSessionId): JournalRow[];
  cleanup(): Promise<void>;
}

// The product on the journals `build` writes, one per session in the order the case starts them (the seam gives each
// launch the next), over a scratch repository trusted in a temp config home and a throwaway profile.
async function computerUseCase(build: (cwd: string) => ComputerUseJournal[]): Promise<ComputerUseCase> {
  const repo = await ScratchRepo.create({ sentinels: false });
  const store = await StoreFixture.create();
  const journals = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-computer-use-')));
  const disposers: (() => Promise<void> | void)[] = [() => rmSync(journals, { recursive: true, force: true }), () => store.dispose(), () => repo.dispose()];
  const cleanup = async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  };
  try {
    writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
    writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
    const fixtures = build(repo.root).map((journal, k) => journal.write(journals, `computer-use-${k}`));
    const maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixtures.join(','), CLAUDE_CONFIG_DIR: store.configHome } });
    disposers.push(() => maws.cleanup());
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    const { page } = maws;
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    const project = value(await invoke(page, 'session.projects.add', { directory: repo.root }));
    await openProject(page, project.name);
    const start = async (prompt: string) => {
      await newChatIn(page, project.name);
      await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
      const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
      value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { gateway: 'direct' } }));
      value(await invoke(page, 'session.start', { appSessionId: id, message: { content: prompt, display: prompt }, options: {} }));
      return id;
    };
    return { maws, page, pane: page.locator('[data-region="main"] [data-pane="0"]'), start, journal: (id) => journalOf(maws.userData, id), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

const turnOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.status', { appSessionId: id })).turn;
// The interrupts MAWS wrote to the engine, as the session's journal recorded them.
const interruptsIn = (rows: JournalRow[]) =>
  rows.filter((row) => row.direction === 'out' && (row.frame as { type?: string; request?: { subtype?: string } }).request?.subtype === 'interrupt').map((row) => (row.frame as { request: unknown }).request);
// The strip: a zero-height mount whose state is its attribute, and its line, the status region drawn over the transcript.
const stripIn = (pane: Locator) => pane.locator('[data-computer-use-strip]');
// A picture of the pane's body, its tab panel: the pane element itself is `display: contents` (main/Pane.tsx) and has no
// box of its own, nor has the strip's zero-height mount.
const shot = async (pane: Locator, name: string) => {
  const body = pane.locator('[role="tabpanel"]').first();
  await expect(body).toBeVisible();
  await test.info().attach(name, { body: await body.screenshot(), contentType: 'image/png' });
};
const followedItsRecording = (c: ComputerUseCase, id: AppSessionId) => expect(metaEvents(c.journal(id)), `the journal of ${id}`).not.toContain('replay_mismatch');

test('computer use in the session (A6): a running js call draws "Computer use running" with Stop and its row reads "Used computer use"; Stop writes the composer’s interrupt and the line lingers past the call’s timeout_ms; a later call’s ordinary result takes it away', async () => {
  const c = await computerUseCase((cwd) => {
    const journal = new ComputerUseJournal(SESSIONS[0], cwd);
    const first = journal.prompt();
    journal.interrupted(first, journal.js(first, CELL, TIMEOUT_MS));
    const second = journal.prompt();
    const call = journal.js(second, CELL, TIMEOUT_MS);
    journal.holdAtContextUsage();
    journal.result(call, 'clicked Zoom In');
    journal.reply(second, REPLIES.second);
    return [journal];
  });
  try {
    const id = await c.start(PROMPTS.first);
    const strip = stripIn(c.pane);
    const line = strip.getByRole('status');
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'running', { timeout: 20_000 });
    await expect(line).toContainText('Computer use running');
    const stop = line.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    await expect(c.pane.getByText('Used computer use', { exact: true })).toBeVisible();
    await shot(c.pane, 'u12a-computer-use-running');

    // Stop: the composer's interrupt, held at by the replay; the engine withdraws the call and the turn ends
    await stop.click();
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'lingering');
    await expect(line).toContainText('Computer use may still be finishing a step');
    await expect(line.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect.poll(() => turnOf(c.page, id), { timeout: 20_000 }).toBeNull();
    expect(interruptsIn(c.journal(id))).toEqual([{ subtype: 'interrupt', reason: 'user-cancel', cancel_queued: false }]);

    // the call's own budget is no evidence that the cell is over: the line outlasts it
    await c.page.waitForTimeout(TIMEOUT_MS + 1_000);
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'lingering');
    await shot(c.pane, 'u12a-computer-use-lingering');

    // a second turn's call: the line runs again while it is in flight, and its ordinary result (the earlier cell is
    // over, since the plugin runs calls one after another) takes the line away once its turn ends
    value(await invoke(c.page, 'session.send', { appSessionId: id, content: PROMPTS.second }));
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'running', { timeout: 20_000 });
    await expect(line).toContainText('Computer use running');
    value(await invoke(c.page, 'session.getContextUsage', { appSessionId: id, detail: 'summary' })); // lets the engine go on
    await expect(c.pane.getByText(REPLIES.second)).toBeVisible({ timeout: 20_000 });
    await expect(strip).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => turnOf(c.page, id), { timeout: 20_000 }).toBeNull();
    followedItsRecording(c, id);
  } finally {
    await c.cleanup();
  }
});

test('computer use in the session (A6): after a Stop that withdrew the running call, Dismiss takes the lingering line away at once, and it does not come back for that call', async () => {
  const c = await computerUseCase((cwd) => {
    const journal = new ComputerUseJournal(SESSIONS[1], cwd);
    const prompt = journal.prompt();
    journal.interrupted(prompt, journal.js(prompt, CELL, TIMEOUT_MS));
    return [journal];
  });
  try {
    const id = await c.start(PROMPTS.dismissed);
    const strip = stripIn(c.pane);
    const line = strip.getByRole('status');
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'running', { timeout: 20_000 });
    await line.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'lingering');
    await expect.poll(() => turnOf(c.page, id), { timeout: 20_000 }).toBeNull();
    await line.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(strip).toHaveCount(0, { timeout: 1_000 });
    await c.page.waitForTimeout(1_000);
    await expect(strip).toHaveCount(0);
    followedItsRecording(c, id);
  } finally {
    await c.cleanup();
  }
});

test('computer use in the session (A6): a js call waiting for a permission answer draws no line; allowed, it runs and the line shows until its turn ends', async () => {
  const c = await computerUseCase((cwd) => {
    const journal = new ComputerUseJournal(SESSIONS[2], cwd);
    const prompt = journal.prompt();
    const call = journal.js(prompt, CELL, TIMEOUT_MS);
    journal.asked(call);
    journal.holdAtContextUsage();
    journal.result(call, 'clicked Zoom In');
    journal.reply(prompt, REPLIES.asked);
    return [journal];
  });
  try {
    const id = await c.start(PROMPTS.asked);
    const strip = stripIn(c.pane);
    const approval = c.pane.getByRole('group', { name: 'Approval needed' });
    await expect(approval).toBeVisible({ timeout: 20_000 });
    await c.page.waitForTimeout(1_000); // well past the 250 ms before a running call's line
    await expect(strip).toHaveCount(0);
    await shot(c.pane, 'u12a-computer-use-waiting');

    await approval.getByRole('button', { name: 'Allow once', exact: true }).click(); // U1a's card: a button per scope
    await expect(strip).toHaveAttribute('data-computer-use-strip', 'running', { timeout: 20_000 });
    await expect(strip.getByRole('status')).toContainText('Computer use running');
    value(await invoke(c.page, 'session.getContextUsage', { appSessionId: id, detail: 'summary' })); // lets the engine go on
    await expect(c.pane.getByText(REPLIES.asked)).toBeVisible({ timeout: 20_000 });
    await expect(strip).toHaveCount(0, { timeout: 15_000 });
    followedItsRecording(c, id);
  } finally {
    await c.cleanup();
  }
});
