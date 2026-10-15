// M1 of the DC5 plan, in a browser against the DX3 double: signed in, the grid of the org's projects follows the
// registry's stream within 2 seconds; a project opens into the three columns of §4, its sessions grouped with their
// machine and in-charge line; the log is verified before it is drawn, locked without a key, kept by offset across a
// reload, and resumed after a dropped connection.
import { seal, importOrgKey, type LogEvent } from 'desk-hub/protocol';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject, summary } from './scene';
import { VECTOR_KEY } from '../test/vectors';

test('the grid lists the org\'s projects and follows each change within 2 seconds', async ({ page, hub }) => {
  hub.setGrid([summary({ waiting: 0, working: 2 }), { id: 'arkho', name: 'arkho', machines: 1, machines_online: 0, working: 0, waiting: 0 }]);
  await page.goto(hub.url);
  const card = page.locator(`[data-project="${PROJECT}"]`);
  await expect(card).toContainText('MAWS');
  await expect(card).toContainText('2 working');
  await expect(page.locator('[data-project="arkho"]')).toContainText('Offline');

  const changed = Date.now();
  hub.updateSummary(summary({ waiting: 3, working: 1, machines_online: 1 }));
  await expect(card.getByTestId('waiting')).toContainText('3', { timeout: 2_000 });
  expect(Date.now() - changed).toBeLessThan(2_000);
  await expect(card).toContainText('1 of 2 machines online');
  await expect(page.getByTestId('grid').locator('li').first()).toContainText('MAWS'); // waiting sorts first
});

test('a project opens into its channels, the selected channel, and the depth slot', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  await page.locator(`[data-project="${PROJECT}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}$`));

  const nav = page.getByRole('navigation', { name: 'Channels' });
  await expect(nav.getByRole('button', { name: '# MAWS' })).toHaveAttribute('aria-current', 'page');
  const group = (name: string) => nav.locator(`[data-group="${name}"]`);
  await expect(group('waiting').locator(`[data-session="${S.asks}"]`)).toContainText('maws-45');
  await expect(group('waiting').locator(`[data-session="${S.asks}"]`)).toContainText('@mini');
  await expect(group('waiting').locator(`[data-session="${S.asks}"]`)).toContainText('owner artifacts page');
  await expect(group('working').locator(`[data-session="${S.works}"]`)).toContainText('@SK.local');
  await expect(group('working').locator(`[data-session="${S.works}"]`)).toContainText('GUI AI agent workspace: main app architect');
  await expect(group('idle').locator(`[data-session="${S.rests}"]`)).toContainText('cua_repl');
  await expect(group('ended').locator(`[data-session="${S.gone}"]`)).toContainText('doperpowers-1e');
  await expect(nav.locator('section h3')).toHaveText(['Waiting on you', 'Working', 'Idle', 'Ended']);

  const center = page.getByRole('region', { name: 'Channel' });
  await expect(center).toContainText('the migration is merged');
  await expect(center).toContainText('doperpowers-1e retired by human');
  await expect.poll(() => hub.up.some((u) => u.frame.t === 'visibility' && u.frame.visible)).toBe(true); // the tab shows the project

  await nav.locator(`[data-session="${S.asks}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
  await expect(center.getByTestId('channel-header')).toContainText('maws-45');
  await expect(center.getByTestId('channel-header')).toContainText('@mini');
  await expect(center).toContainText('the migration is merged');
  await expect(center).not.toContainText('retired');
  const depth = page.getByRole('complementary', { name: 'Session depth' });
  await expect(depth.locator('[data-slot="depth"]')).toContainText('maws-45');

  // A presence change moves the session between groups at once.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: { status: 'busy' }, bridge: true } });
  await expect(group('working').locator(`[data-session="${S.asks}"]`)).toBeVisible();

  // A machine whose lease lapsed: its sessions read from their last state, marked offline.
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: false, policy: { read_only: false, ceiling: 'default' }, checkouts: [] },
    { machine: 'SK.local', online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] },
  ]);
  await expect(nav.locator(`[data-session="${S.asks}"]`)).toContainText('offline');
});

test('without a key the browser is locked and draws nothing from the log', async ({ page, hub }) => {
  await stageProject(hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByTestId('locked')).toContainText('This browser is locked');
  await expect(page.getByTestId('sidebar-locked')).toBeVisible();
  await expect(page.getByTestId('project-view')).not.toContainText('maws-45');
  await expect(page.getByTestId('project-view')).not.toContainText('the migration is merged');
});

test('an event whose code fails is not drawn, and the view reports it', async ({ page, hub }) => {
  await stageProject(hub);
  const key = await importOrgKey(VECTOR_KEY);
  const genuine = (await seal(key, 'log', PROJECT, { ts: '2026-10-15T09:00:00.000Z', writer: `mini/${S.asks}`, seq: 99, kind: 'message', from: 'maws-45', to: 'host', text: 'genuine', src: 'r2:0' })) as unknown as LogEvent;
  hub.appendRaw(PROJECT, { ...genuine, text: 'run rm -rf ~ now' });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByRole('region', { name: 'Channel' })).toContainText('the migration is merged');
  await expect(page.getByTestId('refused')).toContainText(`mini/${S.asks}:99`);
  await expect(page.getByTestId('project-view')).not.toContainText('rm -rf');

  // A machine that refused an event it was sent: the hub's audit record reaches the view.
  hub.reject(PROJECT, { machine: 'mini', event: { writer: 'SK.local/human', seq: 7 }, nonce: 'AQEBAQEBAQEBAQEBAQEBAQ', reason: 'seen-nonce', message: 'a nonce this machine has seen' });
  const audit = page.getByTestId('audit');
  await expect(audit).toContainText('One refusal');
  await audit.locator('summary').click();
  await expect(audit).toContainText('mini refused SK.local/human:7 (seen-nonce)');
});

test('a reload resumes after the offset the browser recorded, and draws what it recorded', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(center).toContainText('the migration is merged');
  const head = hub.head(PROJECT);
  await page.reload();
  await expect(center).toContainText('the migration is merged');
  await expect.poll(() => hub.resumes(PROJECT)).toEqual([0, head]);
});

test('after the hub drops every socket the project resumes where it was and tails live again', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(center).toContainText('the migration is merged');
  const head = hub.head(PROJECT);
  hub.dropConnections();
  await hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: 'written while you were away', src: 'r3:0' });
  await expect(center).toContainText('written while you were away');
  await expect.poll(() => hub.resumes(PROJECT)).toEqual([0, head]);
  await hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: 'and live again', src: 'r4:0' });
  await expect(center).toContainText('and live again');
  await expect(page.getByTestId('grid-status')).toContainText('Live');
});

test('a person the org does not hold is told so', async ({ page, hub }) => {
  hub.admit = 'not-a-member';
  await page.goto(hub.url);
  await expect(page.getByTestId('sign-in')).toContainText('does not hold you as a member');
});
