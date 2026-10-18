// An expired Access session while the app is open, in a browser against the DX3 double standing in for Access: every
// request, each socket's upgrade included, answered with a 302 to a sign-in on another origin, as Access answers once
// its session lapses. The views say the sign-in expired and offer to sign in again, which goes through the stand-in's
// sign-in and returns to the view the owner was on, live. A dead network still reads as connecting.
//
// The phone's case is tagged @layout, so the Linux lane runs it in WebKit as well (playwright.config.ts): the probe's
// `redirect: 'manual'` is answered by the engine of the owner's phone, short of the phone itself.
//
// With DESK_SHOTS set to a directory, each view's notice is saved there.
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';

const SHOTS = process.env.DESK_SHOTS;
const EXPIRED = /Your sign-in has expired, so (this project|the grid) can't update until you sign in again\./;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('an expired sign-in is said on every view that waits on the hub, and signing in again returns to the view, live', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  const where = `/p/${PROJECT}/s/${S.asks}`;
  await page.goto(`${hub.url}${where}`);
  const view = page.getByTestId('project-view');
  await expect(view).toHaveAttribute('data-connection', 'open');
  await expect(page.getByTestId('grid-status')).toContainText('Live');

  // Access's session lapses; the hub restarts (a deploy), and every reconnect meets Access's redirect.
  hub.admit = 'signed-out';
  hub.dropConnections();
  const banner = view.getByTestId('signed-out');
  await expect(banner).toContainText("Your sign-in has expired, so this project can't update until you sign in again.");
  await expect(view).not.toContainText('Connecting to the hub');
  await expect(page.getByTestId('grid-status')).toContainText('Signed out');
  await shot(page, 'project-signed-out');

  // The grid says it too, over the counts it last had.
  await page.getByRole('navigation', { name: 'Where' }).getByRole('button', { name: 'Projects' }).click();
  const gridNotice = page.getByRole('main', { name: 'Projects' }).getByTestId('signed-out');
  await expect(gridNotice).toContainText(/Counts as of .+\. Your sign-in has expired, so the grid can't update until you sign in again\./);
  await expect(page.getByTestId('grid-stale')).toHaveCount(0);
  await shot(page, 'grid-signed-out');

  // Back to the session, and sign in from there: Access's sign-in, then the same view, connected.
  await page.goBack();
  await expect(page).toHaveURL(`${hub.url}${where}`);

  // A message sent while signed out waits in the page, which signing in reloads: the owner is asked before it is lost.
  await page.getByPlaceholder('Message maws-45').fill('sent while signed out');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await view.getByRole('button', { name: 'Sign in again' }).click();
  await expect.poll(() => asked).toEqual(["A message you sent hasn't reached the hub yet and is lost when you sign in again. Sign in anyway?"]);
  await expect(page).toHaveURL(`${hub.url}${where}`);
  page.once('dialog', (dialog) => void dialog.accept());
  await view.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page).toHaveURL(new RegExp(`^${hub.signIn}/cdn-cgi/access/login/`));
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${hub.url}${where}`);
  await expect(view).toHaveAttribute('data-connection', 'open');
  await expect(page.getByTestId('signed-out')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Channel' }).getByTestId('channel-header')).toContainText('maws-45');
  await expect(page.getByTestId('grid-status')).toContainText('Live');
});

test('a dead network still reads as connecting, and a member the org no longer holds is told so', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  const view = page.getByTestId('project-view');
  await expect(view).toHaveAttribute('data-connection', 'open');

  hub.admit = 'unreachable';
  hub.dropConnections();
  await expect(view.getByRole('status').filter({ hasText: 'Connecting to the hub…' })).toBeVisible();
  // Long enough for several failed connects and their probes, each of which the network drops.
  await page.waitForTimeout(4_000);
  await expect(view).toContainText('Connecting to the hub…');
  await expect(page.getByTestId('signed-out')).toHaveCount(0);
  await expect(page.getByTestId('grid-status')).toContainText('Reconnecting');

  hub.admit = 'not-a-member';
  await expect(view.getByTestId('signed-out')).toContainText("You are signed in, but the org no longer holds you as a member, so this project can't update.");
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test('@layout the channel list says the sign-in expired, and signing in again returns to it', async ({ page, hub }) => {
    await stageProject(hub);
    await seedKey(page, hub);
    const where = `/p/${PROJECT}`;
    await page.goto(`${hub.url}${where}`);
    const view = page.getByTestId('project-view');
    await expect(view).toHaveAttribute('data-connection', 'open');
    await expect(page.getByRole('navigation', { name: 'Channels' })).toBeVisible();

    hub.admit = 'signed-out';
    hub.dropConnections();
    await expect(view.getByTestId('signed-out')).toContainText(EXPIRED);
    await expect(view.getByTestId('signed-out')).toBeInViewport();
    await shot(page, 'phone-list-signed-out');

    await view.getByRole('button', { name: 'Sign in again' }).click();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${hub.url}${where}`);
    await expect(view).toHaveAttribute('data-connection', 'open');
    await expect(page.getByTestId('signed-out')).toHaveCount(0);
  });
});
