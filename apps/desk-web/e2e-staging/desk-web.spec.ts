// Acceptance 8's desk-web check on staging (P5 O11 M8): the web app the staging Worker serves, in a headless Chromium of
// Playwright's own (never a browser profile of the owner's), lists a fake machine's session and answers its permission
// card. Run by `apps/desk-hub/deploy/staging-run.sh desk-web <n>` while staging serves the throwaway org
// staging-probe-<n>, never staging-ssfskim: the check sets the org's key up, which an org has once.
//
// Access admits the browser by the owner's app token, which cloudflared already holds for staging: read here at run time
// (`cloudflared access token`), handed to the browser as its `CF_Authorization` cookie for the staging host alone and to
// this process's own requests as `cf-access-token`. It is never printed, logged or passed as an argument, and the run
// records no trace, video, HAR or failure context (`test` is e2e-staging/unrecorded.ts's): the screenshots carry pixels
// only. The enrollment code, which holds the org key, is listed in DESK_STAGING_SCAN, the file the runner searches every
// file of the run for afterwards, as it does for the token.
//
// The machine is M4's fake machine, enrolled the way the web app enrolls one (the Machines dialog's code, which holds
// the org key the browser set up), replaying the committed recording with its decisions left to the web.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { FakeMachine, loadRecording, TWO_SUBAGENTS, type Step } from 'desk-hub/fake-machine';
import { decodeEnrollmentCode } from 'desk-hub/protocol';
import { SUITE_PASSPHRASE, enrollInBrowser, newPassphrase, openKeyDialog } from '../e2e-hub/org';
import { test } from './unrecorded';

const STAGING_HOST = 'desk-hub-staging.opencognita-platform.workers.dev';
const PRODUCTION_HOST = 'desk-hub.opencognita-platform.workers.dev';
const HUB = `https://${STAGING_HOST}`;
const org = process.env.DESK_STAGING_TEST_ORG ?? '';
const shots = process.env.DESK_STAGING_SHOTS ?? '';
const scan = process.env.DESK_STAGING_SCAN ?? '';

/** The owner's staging Access token, as cloudflared holds it; read here, never shown. */
function accessToken(): string {
  const token = execFileSync('cloudflared', ['access', 'token', `-app=${HUB}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!token.startsWith('eyJ')) throw new Error(`cloudflared holds no Access token for ${HUB}: the owner runs 'cloudflared access login ${HUB}' once`);
  return token;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Channels' });
const status = (step: Step) => (step.k === 'presence' ? (step.record as { status?: string } | null)?.status : undefined);

test('acceptance 8: desk-web lists a fake machine’s session and answers its permission card', async ({ browser }) => {
  test.setTimeout(300_000);
  expect(HUB).not.toContain(PRODUCTION_HOST);
  expect(org, 'DESK_STAGING_TEST_ORG: the throwaway org staging serves').toMatch(/^staging-probe-[a-z0-9-]+$/);
  expect(shots, 'DESK_STAGING_SHOTS: where the screenshots go').not.toBe('');
  expect(scan, 'DESK_STAGING_SCAN: the file listing what the runner searches the run’s files for').not.toBe('');
  const token = accessToken();
  const api = (path: string, init: RequestInit = {}) => fetch(`${HUB}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), 'cf-access-token': token } });
  const me = (await (await api('/api/me')).json()) as { org: { id: string }; member: { id: string } };
  expect(me.org.id, 'the org staging serves').toBe(org);
  expect(((await (await api('/api/org/keys')).json()) as { key_check: unknown }).key_check, 'a throwaway org with no key yet').toBeNull();

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addCookies([{ name: 'CF_Authorization', value: token, domain: STAGING_HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const enrolled: string[] = [];
  let fm: FakeMachine | undefined;
  try {
    // The org's key, set up in the browser and kept on this device, as the owner's first visit does.
    await page.goto(HUB);
    const dialog = await openKeyDialog(page);
    await dialog.getByLabel('Keep unlocked on this device').check();
    await newPassphrase(dialog, SUITE_PASSPHRASE, 'Set up');
    await expect(dialog.getByTestId('unlocked')).toContainText('Unlocked on this device', { timeout: 90_000 });
    await page.keyboard.press('Escape');

    const name = `web-${randomUUID().slice(0, 6)}`;
    enrolled.push(name);
    const code = await enrollInBrowser(page, name);
    // The code, its one-time token and the org key, one a line: none may be in any file the run leaves.
    const { token: once, key } = decodeEnrollmentCode(code);
    appendFileSync(scan, `${code}\n${once}\n${key}\n`, { mode: 0o600 });
    const redeemed = await FakeMachine.redeem(code);
    const rec = loadRecording(TWO_SUBAGENTS, { session: randomUUID() });
    const project = randomUUID();
    fm = new FakeMachine({ ...redeemed, member: me.member.id, project, projectName: `o11 m8 desk-web ${project.slice(0, 4)}`, recordings: [rec], decisions: 'wait' });
    // A fresh service token reaches Access's edge in seconds; until then the stream is refused.
    for (let tries = 0; ; tries++) {
      try {
        await fm.connect();
        break;
      } catch (error) {
        if (tries > 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // The session listed: its project on the grid, then its channel in the sidebar.
    await fm.play({ speed: 0, until: (step) => step.k === 'log' && step.event.kind === 'joined' && step.event.session === rec.session });
    await fm.play({ speed: 0, until: (step) => status(step) === 'busy' });
    await page.goto(HUB);
    await expect(page.locator(`[data-project="${project}"]`)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: join(shots, '1-grid-project.png') });
    await page.goto(`${HUB}/p/${project}/s/${rec.session}`);
    await expect(nav(page).locator(`[data-session="${rec.session}"]`)).toBeVisible({ timeout: 30_000 });
    const view = page.getByRole('region', { name: 'Channel' }).getByTestId('session-view');
    await expect(view).toHaveAttribute('data-session', rec.session);
    await page.screenshot({ path: join(shots, '2-session-listed.png') });

    // Its permission card, answered from the page.
    await fm.play({ speed: 0, until: (step) => step.k === 'raised' });
    const [bash] = fm.pendingRequests();
    expect(bash.tool).toBe('Bash');
    const card = view.locator(`[data-tail-request="${bash.request}"]`);
    await expect(card).toContainText(/wants to run a command/i, { timeout: 30_000 });
    await page.screenshot({ path: join(shots, '3-permission-card.png') });
    await card.getByRole('button', { name: 'Allow' }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    expect(fm.rpcs).toMatchObject([{ rpc: 'decide', executed: true, outcome: { state: 'done' } }]);
    await page.screenshot({ path: join(shots, '4-card-answered.png') });
    await page.goto(`${HUB}/p/${project}`);
    const settled = page.getByRole('region', { name: 'Channel' }).locator(`[data-request="${bash.request}"]`).getByTestId('settled');
    await expect(settled).toHaveText('Allowed from the web by you', { timeout: 30_000 });
    await page.screenshot({ path: join(shots, '5-group-chat-settled.png') });
  } finally {
    await fm?.close();
    await context.close();
    for (const name of enrolled) {
      const response = await api(`/api/machines/${encodeURIComponent(name)}`, { method: 'DELETE' });
      expect(response.status, `revoking ${name}`).toBe(200);
    }
  }
});
