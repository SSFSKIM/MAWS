// P3-F1 (docs/doperpowers/ledgers/2026-10-17-P3-F1.md): the harness's `#document` page under `pnpm e2e:document`
// shows its two replicas side by side, each 720 px wide or more and wholly inside the window, so the document editor's
// rail stays beside the page there (fix 1 makes it a drawer below 720 px) as P3-B's cases in document-editor.spec.ts
// expect. At the default 1280 px window each replica was 640 px; the group's script sizes the window
// (`MAWS_E2E_WINDOW_SIZE`, e2e/support/launch.ts). The widths measured are logged and annotated on the report.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const RAIL_BESIDE_FROM_PX = 720;

let maws: MawsLaunch | null = null;
test.afterEach(async () => {
  await maws?.cleanup();
  maws = null;
});

test('the harness shows both replicas 720 px wide or more inside the window, each rail beside its page', async () => {
  test.skip(!HARNESS_BUILT, 'needs the harness build: pnpm e2e:document');
  maws = await launchMaws();
  const { page } = maws;
  await page.evaluate(() => {
    location.hash = 'document';
  });
  await page.waitForFunction(() => (window as unknown as { __maws_document?: { ready(): boolean } }).__maws_document?.ready() === true);
  const measured = await page.evaluate(() => ({
    window: window.innerWidth,
    replicas: ['a', 'b'].map((which) => {
      const body = document.querySelector(`[data-replica="${which}"] .doc-editor-body`)!.getBoundingClientRect();
      return { which, left: body.left, right: body.right, width: body.width };
    }),
  }));
  const line = `window ${measured.window} px; ${measured.replicas.map((r) => `replica ${r.which} ${r.width} px`).join(', ')} (at the default 1280 px window: 640 px each)`;
  console.log(`[e2e] P3-F1 harness widths: ${line}`);
  test.info().annotations.push({ type: 'harness widths', description: line });
  for (const r of measured.replicas) {
    expect(r.width, `replica ${r.which}'s editor width`).toBeGreaterThanOrEqual(RAIL_BESIDE_FROM_PX);
    expect(r.left, `replica ${r.which} inside the window`).toBeGreaterThanOrEqual(0);
    expect(r.right, `replica ${r.which} inside the window`).toBeLessThanOrEqual(measured.window);
  }
  for (const which of ['a', 'b']) {
    const replica = page.locator(`[data-replica="${which}"]`);
    await replica.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ }).click();
    await expect(replica.getByRole('complementary', { name: 'Comments' })).toBeVisible();
    await expect(replica.locator('.doc-editor-body')).toHaveAttribute('data-rail-layout', 'beside');
  }
});
