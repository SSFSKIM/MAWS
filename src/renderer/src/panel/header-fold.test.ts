// UX wave U8b (the branch review's fix wave): the header's fold threshold is derived from the side column's default
// width, so the two cannot drift: with another default width, the threshold follows it.
import { expect, it, vi } from 'vitest';
import { COLUMN_CHROME_PX, NARROW_HEADER_PX } from './PanelHeader';

vi.mock('../app/shell-geometry', async (importOriginal) => ({ ...(await importOriginal<typeof import('../app/shell-geometry')>()), NARROW_AUTOMATIC_WIDTH: 420 }));

it('folds the header under the column’s default width less the column’s chrome, whatever that width is', () => {
  expect(NARROW_HEADER_PX).toBe(420 - COLUMN_CHROME_PX);
});
