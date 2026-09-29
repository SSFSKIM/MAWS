// C8a's panel host end to end (C8a execution document, acceptance item 2; M4 adds the harness cases and the scenario
// cases). The cases here run the product app, not the harness (`MAWS_HARNESS=0`, since `pnpm e2e:panel` runs under
// MAWS_HARNESS=1 and a launch inherits the runner's environment), over the harness scenario's two sessions so that
// main's read model knows them and a Terminal tab has a directory to start in.
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { test } from './support/launch';

const DIR_A = '/tmp/maws-harness/a'; // session A's directory in the harness scenario
test.use({ mawsEnv: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' } });
test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

interface Pty {
  label: string;
  appSessionId: string;
  pid: number;
  alive: boolean;
  offset: number;
}

const ptys = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.maws.invoke('pty.list', undefined);
    return (result.ok ? result.value.ptys : []) as unknown as Pty[];
  });

const panelA = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.maws.invoke('layout.get', { key: 'panel.A' });
    return result.ok ? (result.value.value as { tabs: { id: string }[] } | null) : null;
  });

// C8a's ruling on the product's pty adoption (2026-09-29): after a renderer reload the restored Terminal tab reattaches
// to the shell that kept running in the PTY host, and no second shell is started under its label.
test('a restored Terminal tab reattaches to its running shell after a renderer reload', async ({ maws }) => {
  const { page } = maws;
  const panel = page.locator('[data-region="panel"]');
  await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: 'Harness A' }).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();

  const shellsOfA = async () => (await ptys(page)).filter((pty) => pty.appSessionId === 'A' && pty.alive);
  await expect.poll(shellsOfA, { timeout: 15_000, message: 'a shell for session A' }).toHaveLength(1);
  const [{ label, pid }] = await shellsOfA();
  await expect(panel.locator(`[data-tab-id="${label}"]`)).toBeVisible();
  // The tab reaches layout.json (C5's 250 ms write), so the reload restores it.
  await expect.poll(async () => (await panelA(page))?.tabs.map((tab) => tab.id) ?? []).toContain(label);

  await page.reload();
  await expect(panel.locator(`[data-tab-id="${label}"]`)).toBeVisible({ timeout: 15_000 });
  const terminal = panel.locator('[data-terminal-id]');
  await expect(terminal).toBeVisible({ timeout: 15_000 });

  // Reattached, not failed: without the re-adoption the tab asks the PTY host for a new shell under its label, which
  // the host refuses (the old one still runs), and the tab shows the failure in its status bar.
  await expect(panel.getByRole('status', { name: 'terminal status' })).toHaveCount(0);
  // Keys typed into the restored tab reach the same shell: its pty echoes the command and prints its result.
  const command = 'echo PANEL-RELOAD-$((6*7))';
  const before = (await ptys(page)).find((pty) => pty.label === label)!.offset;
  await terminal.locator('.xterm-screen').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await ptys(page)).find((pty) => pty.label === label)?.offset ?? 0) - before, { message: 'the shell echoes and answers' })
    .toBeGreaterThanOrEqual(command.length + 'PANEL-RELOAD-42'.length);

  const after = (await ptys(page)).filter((pty) => pty.label === label);
  expect(after, 'one pty under the tab’s label').toHaveLength(1);
  expect(after[0]).toMatchObject({ pid, alive: true });
  expect((await ptys(page)).filter((pty) => pty.appSessionId === 'A'), 'no second shell for the session').toHaveLength(1);
  expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
