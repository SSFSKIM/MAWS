// The org directory on the desk (smns org directory §8, M6), in a browser against the DX3 double: a machine project —
// the project of a machine's sessions no repository's `.smns` claims — is a tile labelled by its kind, and offers no
// checkout to spawn into; "All sessions" lists every live session of every project, waiting on the owner first, each
// with its project and machine, a click opening it in its project; a cross-project message shows in both projects'
// timelines, the sender's copy marked with its destination and the delivering event with its origin. Locked, the org
// view draws the grid's counts and no session.
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject, summary } from './scene';

const MINI = 'a5c3c1de-7a5e-5d2b-9f3a-2c6b7e1d4f20'; // the mini's machine project
const STRAY = '1ea561bc-a60d-4437-a6ac-fa7cd5eda54f'; // mini-7c: a session in /Users/new on the mini, waiting
const SPARE = 'c7d1e2f3-0a4b-4c5d-9e6f-7a8b9c0d1e2f'; // mini-02: a session in ~/claude-code-bundle on the mini, idle
const policy = { read_only: false, ceiling: 'default' };

async function stageOrg(hub: Parameters<typeof stageProject>[0]): Promise<void> {
  await stageProject(hub);
  hub.setGrid([summary(), { id: MINI, name: 'mini', kind: 'machine', machines: 1, machines_online: 1, working: 0, waiting: 1, live: 2 }]);
  // Later than every join of the MAWS project: the newest join of the waiting group.
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const joined = (session: string, alias: string, cwd: string) => ({ writer: `mini/${session}`, kind: 'joined', session, alias, name_source: 'derived', machine: 'mini', cwd, worktree: '', role: '', seat: '', by: '', session_kind: 'interactive', repo: '', branch: '' });
  await hub.append(MINI, joined(SPARE, 'mini-02', '/Users/new/claude-code-bundle'), later(1));
  await hub.append(MINI, joined(STRAY, 'mini-7c', '/Users/new'), later(2));
  await hub.append(MINI, { writer: `mini/${STRAY}`, kind: 'in-charge', session: STRAY, text: 'the devcloud image build', source: 'set' }, later(3));
  hub.setMachines(MINI, [{ machine: 'mini', online: true, policy, checkouts: [] }]);
  const presence = (session: string, status: string) => hub.sendSession(MINI, { project: MINI, machine: 'mini', session, kind: 'presence', sub: null, n: null, body: { record: { status }, bridge: true } });
  presence(STRAY, 'waiting');
  presence(SPARE, 'idle');
}

test('a machine project is a tile labelled by its kind, and its "+ Session" offers no checkout to spawn into', async ({ page, hub }) => {
  await stageOrg(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  const mini = page.locator(`[data-project="${MINI}"]`);
  await expect(mini).toHaveAttribute('data-kind', 'machine');
  await expect(mini.getByTestId('project-kind')).toHaveText('machine');
  await expect(page.locator(`[data-project="${PROJECT}"]`).getByTestId('project-kind')).toHaveCount(0);

  await mini.click();
  await expect(page).toHaveURL(new RegExp(`/p/${MINI}$`));
  const nav = page.getByRole('navigation', { name: 'Channels' });
  await expect(nav.locator(`[data-session="${STRAY}"]`)).toContainText('mini-7c');
  await nav.getByRole('button', { name: '+ Session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await expect(dialog.getByRole('combobox', { name: 'Checkout' })).toBeDisabled();
  await expect(dialog).toContainText('mini knows no checkout of this project');
});

test('"All sessions" lists every live session of every project, waiting first, each with its project and machine', async ({ page, hub }) => {
  await stageOrg(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  await page.getByTestId('all-sessions').click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByTestId('top-bar')).toContainText('All sessions');

  const rows = page.getByTestId('org-session');
  await expect(rows).toHaveCount(5);
  const order = async () => rows.evaluateAll((all) => all.map((r) => `${(r as HTMLElement).dataset.group} ${(r as HTMLElement).dataset.session}`));
  expect(await order()).toEqual([`waiting ${STRAY}`, `waiting ${S.asks}`, `working ${S.works}`, `idle ${SPARE}`, `idle ${S.rests}`]);
  const stray = page.locator(`[data-testid="org-session"][data-session="${STRAY}"]`);
  await expect(stray).toContainText('mini-7c');
  await expect(stray).toContainText('@mini');
  await expect(stray.getByTestId('org-project')).toHaveText('mini');
  await expect(stray.getByTestId('charge')).toHaveText('the devcloud image build');
  await expect(page.locator(`[data-testid="org-session"][data-session="${S.asks}"]`).getByTestId('org-project')).toHaveText('MAWS');
  await expect(page.getByTestId('org-view')).not.toContainText('doperpowers-1e'); // retired: not drawn

  // Live: a session that stops waiting moves out of the waiting group.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: { status: 'busy' }, bridge: true } });
  await expect(page.locator(`[data-group="working"][data-session="${S.asks}"]`)).toBeVisible();

  // A click opens the session in its project.
  await stray.click();
  await expect(page).toHaveURL(new RegExp(`/p/${MINI}/s/${STRAY}$`));
  await expect(page.getByRole('region', { name: 'Channel' }).getByTestId('channel-header')).toContainText('mini-7c');
  await page.goBack();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(rows).toHaveCount(5);
});

test("a cross-project message is in both projects' timelines: the copy marked with its destination, the delivering event with its origin", async ({ page, hub }) => {
  await stageOrg(hub);
  // maws-45 (MAWS) to mini-7c (the mini's project): the delivering event in the mini's log, then the copy in MAWS's.
  const delivering = await hub.append(MINI, { writer: `mini/${S.asks}`, kind: 'say', from: 'maws-45', to: [{ session: STRAY, alias: 'mini-7c' }], text: 'did the devcloud image build?', from_project: PROJECT });
  await hub.append(PROJECT, {
    writer: `mini/${S.asks}`,
    kind: 'say',
    from: 'maws-45',
    to: [{ session: STRAY, alias: 'mini-7c', project: MINI }],
    text: 'did the devcloud image build?',
    copy: `${MINI}:${delivering.event.writer}:${delivering.event.seq}`,
  });
  await seedKey(page, hub);

  await page.goto(`${hub.url}/p/${PROJECT}`);
  const center = page.getByRole('region', { name: 'Channel' });
  const copy = center.getByTestId('agent-run').filter({ hasText: 'did the devcloud image build?' });
  await expect(copy).toContainText('maws-45 → mini-7c');
  await expect(copy.getByTestId('cross-project')).toHaveText('→ mini');

  await page.goto(`${hub.url}/p/${MINI}`);
  const received = center.getByTestId('agent-run').filter({ hasText: 'did the devcloud image build?' });
  await expect(received).toContainText('maws-45 → mini-7c');
  await expect(received.getByTestId('cross-project')).toHaveText('from MAWS');
});

test("locked, the org view draws the grid's counts and no session", async ({ page, hub }) => {
  await stageOrg(hub);
  await page.goto(`${hub.url}/sessions`);
  await expect(page.getByTestId('org-locked')).toContainText('2 waiting on you · 1 working');
  await expect(page.getByTestId('org-session')).toHaveCount(0);
  await expect(page.getByTestId('org-view')).not.toContainText('mini-7c');
});
