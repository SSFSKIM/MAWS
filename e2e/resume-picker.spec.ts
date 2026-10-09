// The Resume… picker end to end (charter §5.1 as amended 2026-10-01, W11, I7): on the stub scenario, the search icon on
// an expanded project's row opens "Resume session" scoped to that project; a search narrows it, Enter opens the session
// in the main area and the picker goes.
import { expect, test } from '@playwright/test';
import { clickRevealed } from './support/hover';
import { launchMaws } from './support/launch';
import { openProject, projectLine, projectRow } from './support/sidebar';

const SHELL_ENV = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' };

test('resume picker: from an expanded project, search, open a session', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 });
    await openProject(page, 'MAWS');
    const row = projectRow(page, 'MAWS');
    await clickRevealed(projectLine(row), row.getByRole('button', { name: 'Resume a session in MAWS' }));

    const picker = page.getByRole('dialog', { name: 'Resume session' });
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId('resume-scope')).toHaveText('MAWS');
    await expect(picker.getByRole('option')).toHaveCount(4);
    await expect(picker.getByPlaceholder('Search sessions')).toBeFocused();
    await page.keyboard.type('drag');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await expect(picker.getByRole('option').first()).toContainText('Fix sidebar drag');
    await page.keyboard.press('Enter');

    await expect(picker).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Fix sidebar drag · MAWS' })).toHaveAttribute('aria-selected', 'true');
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});
