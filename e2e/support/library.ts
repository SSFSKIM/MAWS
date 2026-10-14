// Library helpers shared by the library end-to-end cases. P3-D seeds default `design_system` artifacts into every
// profile's store at host start, so a case reads the library through its own artifacts: the rows on screen without the
// seeded design systems.
import type { Locator, Page } from '@playwright/test';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

// The titles of the design systems the library holds now (the seeds, whatever they are).
export async function designSystemTitles(page: Page): Promise<string[]> {
  const result = (await page.evaluate(() =>
    (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('library.list', { filter: { kind: 'design_system' } }),
  )) as Result<{ rows: { title: string }[] }>;
  if (!result.ok) throw new Error(`library.list failed: ${result.error.code} ${result.error.message}`);
  return result.value.rows.map((row) => row.title);
}

// The titles of the rows the library shows, the seeded design systems left out, in the order shown.
export async function ownTitles(page: Page, library: Locator): Promise<(string | null)[]> {
  const shown = await library.getByRole('article').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
  const seeded = new Set(await designSystemTitles(page));
  return shown.filter((title) => title === null || !seeded.has(title));
}
