// A retained tab asks for a chunk removed by a deploy: the SPA fallback answers HTML, not a module.
// Exercise the built lazy imports, not a synthetic preload event. The phone runs this in WebKit too.
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';

test('@layout a retained tab reloads the current build after a missing project chunk and keeps its route', async ({ page, hub }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stageProject(hub);
  await seedKey(page, hub);
  let documents = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) documents++; });
  let chunks = 0;
  await page.route(/\/assets\/ProjectView-[^/]+\.js$/, async (route) => {
    if (++chunks === 1) await route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
    else await route.continue();
  });
  await page.goto(hub.url);
  await page.locator(`[data-project="${PROJECT}"]`).click();
  await expect(page.getByTestId('project-view')).toBeVisible();
  expect(documents).toBe(2); // initial grid, then one recovery reload
  expect(chunks).toBe(2);
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}`));
});

test('@layout a persistently missing chunk reloads only once and leaves a visible manual recovery', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  let documents = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) documents++; });
  await page.route(/\/assets\/ProjectView-[^/]+\.js$/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByRole('alert')).toContainText('The desk could not load.');
  await expect(page.getByRole('button', { name: 'Reload the desk' })).toBeVisible();
  expect(documents).toBe(2);
});
