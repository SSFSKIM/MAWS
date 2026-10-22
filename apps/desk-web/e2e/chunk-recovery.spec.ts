// Serve real old/new build files: intercepting a navigation with page.route makes Chrome's local-network checks
// reject the fixture's sockets, and WebKit can retain a failed module URL across a reload. The notification worker
// stays enabled here, so the new document must reach the server even after the worker claims the retained tab.
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubDouble } from '../test/double/hub-double';
import { VECTOR_KEY } from '../test/vectors';
import { DIST, expect, seedKey, test as base } from './fixtures';
import { PROJECT, stageProject } from './scene';

const test = base.extend<{ assets: string }>({
  // eslint-disable-next-line no-empty-pattern
  assets: async ({}, use) => {
    const assets = await mkdtemp(join(tmpdir(), 'desk-chunk-build-'));
    try { await cp(DIST, assets, { recursive: true }); await use(assets); }
    finally { await rm(assets, { recursive: true, force: true }); }
  },
  hub: async ({ assets }, use) => {
    const hub = await HubDouble.start({ orgKey: VECTOR_KEY, staticDir: assets });
    try { await use(hub); } finally { await hub.close(); }
  },
});

test('@layout a retained tab fetches the new index after a missing project chunk and keeps its route', async ({ page, hub, assets }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const index = await readFile(join(assets, 'index.html'), 'utf8');
  const entry = /<script[^>]+src="([^"]+)"/.exec(index)![1];
  const source = await readFile(join(assets, entry), 'utf8');
  const obsoleteEntry = '/assets/index-obsolete.js';
  await writeFile(join(assets, obsoleteEntry), source.replace(/ProjectView-[A-Za-z0-9_-]+\.js/g, 'ProjectView-obsolete.js'));
  await writeFile(join(assets, 'index.html'), index.replace(entry, obsoleteEntry));
  await stageProject(hub);
  await seedKey(page, hub);
  let documents = 0;
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  const response = await page.goto(hub.url);
  expect(response!.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
  await expect(page.locator(`[data-project="${PROJECT}"]`)).toBeVisible();
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', obsoleteEntry);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  // Deploy while the tab is open. Its next import still names the missing old chunk; the server returns SPA HTML.
  await writeFile(join(assets, 'index.html'), index);
  await page.locator(`[data-project="${PROJECT}"]`).click();
  await expect(page.getByTestId('project-view')).toBeVisible();
  expect(documents).toBe(2);
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', entry);
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}`));
});

test('@layout a persistently missing chunk reloads only once and leaves a visible manual recovery', async ({ page, hub, assets }) => {
  const chunks = (await readdir(join(assets, 'assets'))).filter((name) => /^ProjectView-.*\.js$/.test(name));
  expect(chunks).toHaveLength(1);
  await rm(join(assets, 'assets', chunks[0]));
  await stageProject(hub);
  await seedKey(page, hub);
  let documents = 0;
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByRole('alert')).toContainText('The desk could not load.');
  await expect(page.getByRole('button', { name: 'Reload the desk' })).toBeVisible();
  expect(documents).toBe(2);
});
