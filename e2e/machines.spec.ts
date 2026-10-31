// Two machines, one app (P5 O6, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2, OX3): two MAWS
// profiles on this Mac stand in for two machines. P5 O3-D M6 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// acceptance 5): profile B runs as a daemon alone, no app: the scene starts B's private `mawsd` over its seeded profile
// (e2e/support/profile-daemon.ts: `mawsd run --private --dir <B>/mawsd` with MAWS_USER_DATA=<B>), whose services front
// serves B's machine on its own `machine.sock` with its `mawsd.token`; profile A's app, started with
// MAWS_LOCAL_MACHINES naming B's profile, reaches it through its connection manager (src/main/machines/socket-link.ts,
// which reads B's files through @shared/daemon/files). What B's app answered before, the scene now asks B's daemon over a
// bare machine.sock client, as the CLI does. O6's stand-in (B's app serving from main) is gone.
// O6 M6's scene, in five phases, each asserted before the next (the O6 document's acceptance 3 and 5 to 8):
//   1. Setup. One repository with `origin` set, whose main checkout A adds and whose linked worktree (on another branch)
//      B adds; each profile seeds a session in its own checkout; B seeds one in a folder nobody adds; A adds a plain
//      folder with a session in it. A's machines.list shows B up with B's ref (M3), and session.list naming B's ref is
//      B's index.
//   2. The sidebar. One `shared` row holds both checkouts' sessions, B's chipped `@standin-b` and A's chipped not at all
//      (T1, P5 Decision Log 28); A's folder is a row of its own; B's machine row, `standin-b`, holds the session of the
//      folder nobody added; hovering B's session names B.
//   3. The draft. B's `shared` session opened in A shows its transcript (B's engine config alone holds it); a draft typed
//      into its composer is written to B's index; its Environment card shows B's branch, read by `git.watch` from B's
//      mawsd over the link (the checkouts are `machine`-owned since P5 O3-E, so B's daemon alone answers them).
//   4. The departure. B's daemon stops: within 2 s it is down, and its rows and its tab grey while A's rows are as they
//      were. A session is seeded into B's config while B is down; B's daemon starts again over its profile, and within
//      5 s of its services answering (its spine's first answer, what B's window loading was when B was an app) its rows
//      are live again with no duplicate, and the new session, which B's restarted index stamps from a counter that
//      starts again at zero, is listed (M4's generation reset).
//   5. The relaunches. A relaunched with B up restores B's tab and its draft, read from B; A relaunched with B down keeps
//      the tab, greyed.
// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 5, the machine side): a second scene. B, a
// daemon alone, is asked `artifacts.export` over a bare machine.sock client (as A's connection manager would forward it,
// the remote half being O7 M5's): B's render seam starts B's render host, the file is under B's profile, and B's
// library lists the artifact.
// Run by `pnpm e2e:machines` (MAWS_MACHINES_E2E=1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { daemonPaths } from '../src/shared/daemon/files';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import { reachMachine } from '../src/mawsd/machine-client';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { isolatedGitEnv } from '../test/support/git-env';
import { localRef } from './support/address';
import { launchMaws, type MawsLaunch } from './support/launch';
import { seedTranscripts } from './support/maws-tools';
import { startProfileDaemon, type ProfileDaemon } from './support/profile-daemon';
import { mainTabById, unfoldSessionCard } from './support/shell';
import { showProjectList, sidebarOf } from './support/sidebar';

test.skip(process.env.MAWS_MACHINES_E2E !== '1', 'the two-machine scenes run under pnpm e2e:machines (MAWS_MACHINES_E2E=1)');
test.setTimeout(300_000);

const ORIGIN = 'https://github.com/example/shared.git';
const A_BRANCH = 'main';
const B_BRANCH = 'standin-b';
const [A_NAME, B_NAME] = ['standin-a', 'standin-b'];
const DRAFT = 'a draft typed in A, kept on B';
const OFFLINE = ', machine offline'; // the end of a greyed row's accessible name (src/renderer/src/app/machine-mark.ts)
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedGitEnv() }).trim();

// The raw bridge's answer, or the test fails with the error it carried.
async function invoke<T>(page: Page, name: string, input: unknown, machine?: MachineRef): Promise<T> {
  const result = await page.evaluate(([n, i, m]) => window.maws.invoke(n as never, i as never, (m ?? undefined) as never), [name, input, machine ?? null] as const);
  if (!(result as { ok: boolean }).ok) throw new Error(`${name}: ${JSON.stringify((result as { error: unknown }).error)}`);
  return (result as { value: T }).value;
}
// One machine's services, asked by a command: A's through its page's raw bridge (another machine's through A's link to
// it), B's over a bare client of B's machine.sock (P5 O3-D M6: B has no page)
type Ask = <T>(name: string, input: unknown) => Promise<T>;
const pageAsks = (page: Page, machine?: MachineRef): Ask => (name, input) => invoke(page, name, input, machine);
const daemonAsks = (daemon: ProfileDaemon): Ask => (name, input) => daemon.request(name, input);
const machinesOf = (page: Page) => invoke<{ machines: MachineState[] }>(page, 'machines.list', undefined).then(({ machines }) => machines);
const stateOf = async (page: Page, ref: MachineRef) => (await machinesOf(page)).find((m) => m.ref === ref)?.state;
type Listed = { appId: string; engineSessionId: string | null; projectId: string | null };
const sessionsOn = (ask: Ask) => ask<{ sessions: Listed[] }>('session.list', {}).then(({ sessions }) => sessions);
// The session a seeded transcript became in a machine's index, once indexed (bare ids, as the raw bridge speaks them).
async function indexed(ask: Ask, engineId: string): Promise<Listed> {
  let found: Listed | undefined;
  await expect.poll(async () => (found = (await sessionsOn(ask)).find((s) => s.engineSessionId === engineId)) !== undefined, { timeout: 30_000, message: `session ${engineId} is indexed` }).toBe(true);
  return found!;
}
// Main's own lines about the index and the machine links, per launched page, which a failure below quotes.
const mainLines = new WeakMap<Page, string[]>();
function keepMainLines(launch: MawsLaunch): void {
  const lines: string[] = [];
  mainLines.set(launch.page, lines);
  const keep = (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter((line) => /\[(index|machines|machine)\]/.test(line)));
  launch.app.process().stdout?.on('data', keep);
  launch.app.process().stderr?.on('data', keep);
}
type Project = { id: string; directory: string; org?: { key: string; name: string } };
// A directory added as a project on a machine, once that machine has derived its org project (M5); `said` is what that
// machine logged, which a failure quotes.
async function addProject(ask: Ask, directory: string, said: () => string): Promise<Project> {
  const added = await ask<Project>('session.projects.add', { directory });
  let project: Project | undefined;
  try {
    await expect
      .poll(async () => (project = (await ask<{ projects: Project[] }>('session.projects.list', undefined)).projects.find((p) => p.id === added.id))?.org?.key, { timeout: 30_000, message: `${directory} has its org project` })
      .toBeTruthy();
  } catch (error) {
    throw new Error(`${(error as Error).message}\nthe project: ${JSON.stringify(project ?? added)}\nthe machine said:\n${said()}`, { cause: error });
  }
  return project!;
}
const mainSaid = (page: Page) => () => (mainLines.get(page) ?? []).join('\n');

const projectRowByKey = (page: Page, key: string) => sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:${key}"]`);
const sessionRowIn = (page: Page, key: string, address: string) => projectRowByKey(page, key).locator(`[role="treeitem"][data-menu="session:${address}"]`);
// Expands a project row (read back until it holds: a restored layout may expand it under the click).
async function expanded(page: Page, key: string): Promise<void> {
  await showProjectList(page);
  const row = projectRowByKey(page, key);
  await expect(async () => {
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.locator('[data-project-line]').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
// Every session row of a machine as the sidebar draws it, and the Needs-you entries: its name, greying and status glyph.
const rowsOfMachine = (page: Page, ref: MachineRef) =>
  page.evaluate((prefix) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-region="sidebar"] [data-kind="session"][data-menu^="session:${prefix}"]`));
    const needs = Array.from(document.querySelectorAll<HTMLElement>(`[data-region="sidebar"] [data-needs-you^="${prefix}"]`));
    const glyphs = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="img"]'), (img) => img.getAttribute('aria-label'));
    return {
      rows: rows.map((el) => ({ id: el.dataset.menu, name: el.getAttribute('aria-label'), offline: el.dataset.offline ?? null, glyphs: glyphs(el) })).sort((x, y) => x.id!.localeCompare(y.id!)),
      needsYou: needs.map((el) => el.getAttribute('aria-label')),
    };
  }, `${ref}/`);
const composerOf = (page: Page) => page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
const draftText = (draft: unknown) => JSON.stringify(draft ?? null);

test('two machines in one sidebar by org project; one leaving greys only its rows and comes back whole; its tab and draft follow it across A’s relaunches', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-machines-')));
  // The profiles stay short and are the test's (each launch over them leaves them in place): B's sockets then stay in
  // <B>/mawsd (the link reads the fallback directory too), and both profiles outlive a quit for the relaunches.
  const [aUserData, bUserData] = ['a', 'b'].map((name) => mkdtempSync(join(tmpdir(), `maws-${name}-`)));
  const launches = new Set<MawsLaunch>();
  const daemons = new Set<ProfileDaemon>();
  const launchA = async (prepare?: (paths: { claudeConfigDir: string }) => void) => {
    const launch = await launchMaws({ userData: aUserData, keepConfigHome: prepare === undefined, env: { MAWS_LOCAL_MACHINES: bUserData!, MAWS_MACHINE_NAME: A_NAME }, prepare });
    launches.add(launch);
    keepMainLines(launch);
    return launch;
  };
  // B's daemon alone, ready once its services answer (its engine host woken, its spine loaded)
  const startB = async (prepare?: (paths: { claudeConfigDir: string }) => void) => {
    const daemon = await startProfileDaemon({ userData: bUserData!, keepConfigHome: prepare === undefined, env: { MAWS_MACHINE_NAME: B_NAME }, prepare });
    daemons.add(daemon);
    return daemon;
  };
  const quit = async (launch: MawsLaunch) => {
    await launch.cleanup();
    launches.delete(launch);
  };
  const stopB = async (daemon: ProfileDaemon) => {
    daemons.delete(daemon);
    return daemon.stop();
  };
  try {
    // 1. Setup: the repository, its two checkouts on two branches, a folder B never adds and a plain folder A adds. The
    // commit holds no file, so the index keeps the linked worktree a checkout of its own rather than folding it into the
    // main checkout (src/services/index/projects.ts, holdsHead).
    const shared = join(root, 'shared');
    const worktree = join(root, 'shared-b');
    const [loose, notes] = ['loose-b', 'notes'].map((name) => join(root, name));
    for (const dir of [shared, loose!, notes!]) mkdirSync(dir);
    git(shared, 'init', '--quiet', '-b', A_BRANCH);
    git(shared, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'the first commit');
    git(shared, 'remote', 'add', 'origin', ORIGIN);
    git(shared, 'worktree', 'add', '--quiet', '-b', B_BRANCH, worktree);

    let bConfig = '';
    let bSeeded: { shared: string; loose: string } = { shared: '', loose: '' };
    let aSeeded: { shared: string; notes: string } = { shared: '', notes: '' };
    let b = await startB(({ claudeConfigDir }) => {
      bConfig = claudeConfigDir;
      bSeeded = { shared: seedTranscripts(claudeConfigDir, worktree, ['B’s shared session'])[0]!, loose: seedTranscripts(claudeConfigDir, loose!, ['B’s loose session'])[0]! };
    });
    const onB = () => daemonAsks(b);
    const bRef = (await b.request<{ ref: MachineRef }>('machine.identity')).ref;
    const bShared = await indexed(onB(), bSeeded.shared);
    const bLoose = await indexed(onB(), bSeeded.loose);
    const bCheckout = await addProject(onB(), worktree, () => b.log());

    let a = await launchA(({ claudeConfigDir }) => {
      aSeeded = { shared: seedTranscripts(claudeConfigDir, shared, ['A’s shared session'])[0]!, notes: seedTranscripts(claudeConfigDir, notes!, ['A’s notes session'])[0]! };
    });
    const aRef = await localRef(a.page);
    expect(aRef).not.toBe(bRef);
    const aShared = await indexed(pageAsks(a.page), aSeeded.shared);
    const aNotes = await indexed(pageAsks(a.page), aSeeded.notes);
    const aCheckout = await addProject(pageAsks(a.page), shared, mainSaid(a.page));
    const aFolder = await addProject(pageAsks(a.page), notes!, mainSaid(a.page));
    expect(aCheckout.org!.key, 'both checkouts derive one org project, by the remote').toBe(bCheckout.org!.key);
    expect(aFolder.org!.key).toMatch(/^folder:/);
    const sharedKey = aCheckout.org!.key;

    await expect.poll(() => stateOf(a.page, bRef), { timeout: 15_000 }).toBe('up');
    const machines = await machinesOf(a.page);
    expect(machines[0]).toMatchObject({ ref: aRef, local: true, state: 'up', name: A_NAME });
    expect(machines.find((m) => m.ref === bRef)).toMatchObject({ local: false, name: B_NAME, generation: 1 });
    const listedOnB = (await sessionsOn(pageAsks(a.page, bRef))).map((s) => s.engineSessionId);
    expect(listedOnB, 'session.list naming B’s ref is B’s index').toEqual(expect.arrayContaining([bSeeded.shared, bSeeded.loose]));
    expect(listedOnB).not.toContain(aSeeded.shared);

    const [bSharedAt, bLooseAt, aSharedAt, aNotesAt] = [addressOf(bRef, bShared.appId), addressOf(bRef, bLoose.appId), addressOf(aRef, aShared.appId), addressOf(aRef, aNotes.appId)];
    const bMachineKey = `machine:${bRef}`;

    await test.step('2. the sidebar: one row per org project across machines, a folder’s own row, B’s machine row', async () => {
      await expanded(a.page, sharedKey);
      await expect(projectRowByKey(a.page, sharedKey)).toHaveAttribute('aria-label', 'shared');
      const bRow = sessionRowIn(a.page, sharedKey, bSharedAt);
      const aRow = sessionRowIn(a.page, sharedKey, aSharedAt);
      await expect(bRow, 'B’s session is in the shared row').toBeVisible({ timeout: 15_000 });
      await expect(aRow, 'A’s session is in the shared row').toBeVisible();
      await expect(bRow.locator('[data-machine-chip]'), 'B’s row carries B’s chip').toHaveText(`@${B_NAME}`);
      await expect(aRow.locator('[data-machine-chip]'), 'this machine’s rows carry none (T1)').toHaveCount(0);

      await expanded(a.page, aFolder.org!.key);
      await expect(projectRowByKey(a.page, aFolder.org!.key)).toHaveAttribute('aria-label', 'notes');
      await expect(sessionRowIn(a.page, aFolder.org!.key, aNotesAt), 'A’s folder is a row of its own').toBeVisible();

      await expanded(a.page, bMachineKey);
      await expect(projectRowByKey(a.page, bMachineKey)).toHaveAttribute('aria-label', B_NAME);
      await expect(sessionRowIn(a.page, bMachineKey, bLooseAt), 'B’s machine row holds the session of the folder nobody added').toBeVisible();
      expect((await b.request<{ projects: Project[] }>('session.projects.list')).projects.find((p) => p.directory === realpathSync(loose!))).toMatchObject({ discovered: true });

      const card = a.page.locator('[data-hover-card]');
      await expect(async () => {
        await a.page.mouse.move(700, 400);
        await bRow.hover();
        await expect(card.getByTestId('hover-machine'), 'hovering B’s session names B').toHaveText(B_NAME, { timeout: 2_000 });
      }).toPass({ timeout: 10_000 });
      await a.page.mouse.move(700, 400);
      await expect(card).toHaveCount(0);
    });

    await test.step('3. the draft: B’s session opened in A is B’s, and its draft is written to B', async () => {
      await sessionRowIn(a.page, sharedKey, bSharedAt).click();
      await expect(mainTabById(a.page, `session:${bSharedAt}`), 'the tab’s DOM id is the address').toHaveAttribute('aria-selected', 'true');
      const pane = a.page.locator('[data-region="main"] [data-pane="0"]');
      await expect(pane.getByRole('region', { name: 'Your message' }).filter({ hasText: 'B’s shared session' }), 'its transcript, which only B’s engine config holds').toBeVisible({ timeout: 15_000 });
      // The Environment card's branch: only B's checkout is on B_BRANCH, and `git.watch` is `machine`-owned since P5 O3-E
      // (O3 Decision Log 16, D22), so B's daemon, with no app of B running, answers it over the link.
      const environment = await unfoldSessionCard(a.page, 'Environment');
      await expect(environment, 'its branch, from git on B’s daemon').toContainText(`⎇ ${B_BRANCH}`, { timeout: 15_000 });

      await composerOf(a.page).click();
      await a.page.keyboard.type(DRAFT);
      await expect.poll(async () => draftText(await b.request('session.drafts.get', { appSessionId: bShared.appId })), { timeout: 10_000, message: 'the draft is in B’s index' }).toContain(DRAFT);
      await expect
        .poll(async () => JSON.stringify(await invoke<{ value: unknown }>(a.page, 'layout.get', { key: 'main.tabs' })), { message: 'A’s layout holds the tab by its address' })
        .toContain(`"session:${bSharedAt}"`);
      await a.page.mouse.move(700, 400);
    });

    await test.step('4. the departure: B’s rows and tab grey within 2 s and A’s stay as they were; B comes back within 5 s, whole', async () => {
      const aBefore = await rowsOfMachine(a.page, aRef);
      expect(aBefore.rows.map((r) => r.id).sort()).toEqual([`session:${aNotesAt}`, `session:${aSharedAt}`].sort());

      const { exitedAt } = await stopB(b); // B's daemon stops cleanly (SIGTERM); its hosts are ended after its exit
      await expect.poll(() => stateOf(a.page, bRef), { timeout: 2_000 }).toBe('down');
      const down = (await machinesOf(a.page)).find((m) => m.ref === bRef)!;
      expect(exitedAt).toBeGreaterThan(0);
      expect(Date.parse(down.since) - exitedAt, 'B down within 2 s of its exit').toBeLessThanOrEqual(2_000);
      await expect(sessionRowIn(a.page, sharedKey, bSharedAt), 'B’s rows grey').toHaveAttribute('aria-label', `B’s shared session${OFFLINE}`, { timeout: 2_000 });
      await expect(sessionRowIn(a.page, bMachineKey, bLooseAt)).toHaveAttribute('aria-label', `B’s loose session${OFFLINE}`);
      await expect(projectRowByKey(a.page, bMachineKey), 'B’s machine row greys with its machine').toHaveAttribute('aria-label', `${B_NAME}${OFFLINE}`);
      await expect(projectRowByKey(a.page, sharedKey), 'the shared row has A’s checkout, so stays live').toHaveAttribute('aria-label', 'shared');
      await expect(sessionRowIn(a.page, sharedKey, bSharedAt).locator('[data-machine-chip]')).toHaveText('offline');
      const tab = mainTabById(a.page, `session:${bSharedAt}`);
      await expect(tab, 'B’s open tab stays').toBeVisible();
      await expect(tab.locator('span.text-fg-faint', { hasText: 'B’s shared session' }), 'its title in the disabled token (T5)').toBeVisible();
      await expect(a.page.locator('[data-region="main"] [data-machine-offline]'), 'its content says B is offline').toHaveText(`${B_NAME} is offline`);
      expect(await rowsOfMachine(a.page, aRef), 'A’s rows, statuses and Needs-you entries are as they were').toEqual(aBefore);
      await expect(invoke(a.page, 'session.list', {}, bRef)).rejects.toThrow(/host_unavailable/);

      // While B is down, B's engine config gains a session; B's daemon starts again over its profile and comes back as a
      // new generation, whose index stamps from zero again
      const later = seedTranscripts(bConfig, loose!, ['B’s later session'])[0]!;
      b = await startB();
      const servingAt = b.readyAt;
      expect((await b.request<{ ref: MachineRef }>('machine.identity')).ref, 'B’s ref survives its restart').toBe(bRef);
      await expect.poll(() => stateOf(a.page, bRef), { timeout: 15_000 }).toBe('up');
      await expect(sessionRowIn(a.page, sharedKey, bSharedAt)).toHaveAttribute('aria-label', 'B’s shared session', { timeout: 15_000 });
      const liveAt = Date.now();
      expect(liveAt - servingAt, 'B’s rows live within 5 s of its services answering').toBeLessThanOrEqual(5_000);
      await expect(sessionRowIn(a.page, bMachineKey, bLooseAt)).toHaveAttribute('aria-label', 'B’s loose session');
      await expect(projectRowByKey(a.page, bMachineKey)).toHaveAttribute('aria-label', B_NAME);
      expect((await machinesOf(a.page)).find((m) => m.ref === bRef)).toMatchObject({ state: 'up', generation: 2 });
      const bLater = await indexed(onB(), later);
      await expect(sessionRowIn(a.page, bMachineKey, addressOf(bRef, bLater.appId)), 'the session seeded while B was down is listed').toBeVisible({ timeout: 15_000 });
      for (const at of [bSharedAt, bLooseAt]) await expect(sidebarOf(a.page).locator(`[data-kind="session"][data-menu="session:${at}"]`), 'no duplicate').toHaveCount(1);
      await expect(sidebarOf(a.page).locator(`[data-kind="project"][data-tree-id="p:${bMachineKey}"]`)).toHaveCount(1);
      await expect(a.page.locator('[data-region="main"] [data-machine-offline]'), 'the kept tab is B’s session again').toHaveCount(0);
      expect(await rowsOfMachine(a.page, aRef)).toEqual(aBefore);
    });

    await test.step('5. the relaunches: A with B up restores B’s tab and draft, read from B; A with B down keeps the tab, greyed', async () => {
      await quit(a);
      a = await launchA();
      await expect(mainTabById(a.page, `session:${bSharedAt}`), 'B’s tab is restored').toBeVisible({ timeout: 20_000 });
      await expect.poll(() => stateOf(a.page, bRef), { timeout: 15_000 }).toBe('up');
      await expect(composerOf(a.page), 'its draft is in the composer').toHaveText(DRAFT, { timeout: 15_000 });
      await expect(invoke(a.page, 'session.drafts.get', { appSessionId: bShared.appId }), 'A’s own index has no such session: the draft came from B').rejects.toThrow();
      expect(draftText(await b.request('session.drafts.get', { appSessionId: bShared.appId }))).toContain(DRAFT);

      await quit(a);
      await stopB(b);
      a = await launchA();
      const tab = mainTabById(a.page, `session:${bSharedAt}`);
      await expect(tab, 'B’s tab is kept with B down').toBeVisible({ timeout: 20_000 });
      await expect(a.page.locator('[data-region="main"] [data-machine-offline]'), 'greyed: its content says B is offline').toHaveText(`${B_NAME} is offline`, { timeout: 15_000 });
      // its title in the disabled token (T5): the session's own, which the tab kept, since B has not loaded in this run
      await expect(tab.locator('span.text-fg-faint', { hasText: 'B’s shared session' })).toBeVisible();
      expect(await stateOf(a.page, bRef)).not.toBe('up');
      await a.page.waitForTimeout(1_000); // past the layout's write delay: a drop would have been written
      expect(JSON.stringify(await invoke(a.page, 'layout.get', { key: 'main.tabs' })), 'nothing dropped').toContain(`"session:${bSharedAt}"`);
      await expect(tab).toBeVisible();
    });
  } finally {
    for (const launch of [...launches].reverse()) await launch.cleanup().catch((error: unknown) => console.error('[e2e] cleanup failed', error));
    for (const daemon of daemons) await daemon.stop().catch((error: unknown) => console.error('[e2e] B’s daemon’s stop failed', error));
    for (const dir of [root, aUserData!, bUserData!]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// P5 O5 M4 (acceptance 5, the machine side): B renders an export it is asked for with no app, through its own render host
test('export on another machine, the machine side: B, a daemon alone, renders artifacts.export through its render host, the file under B’s profile and B’s library naming the artifact', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-mx-render-')));
  const bUserData = join(root, 'b');
  mkdirSync(bUserData, { recursive: true });
  let daemon: ProfileDaemon | null = null;
  try {
    daemon = await startProfileDaemon({ userData: bUserData, env: { MAWS_MACHINE_NAME: B_NAME } });
    // The daemon's start read session.list, whose discovery wake woke the parked engine host and, its pass heard, asks it
    // to exit when idle (discovery-wake.ts). A request racing that exit is answered host_unavailable, so the scene waits
    // for the host to park: B's first request then wakes it on its own, and only the park clock (10 min) asks it again.
    const parkedAgain = () => {
      const text = daemon!.log();
      const at = text.lastIndexOf('[spine] discovery: the wake is over: asking the engine host to exit when idle');
      return at >= 0 && /\[hosts\] supervisor pid \d+ exited \(code 0\)/.test(text.slice(at));
    };
    await expect.poll(parkedAgain, { timeout: 60_000, message: `B's engine host parks after its discovery wake:\n${daemon.log()}` }).toBe(true);
    const reached = await reachMachine(daemonPaths(bUserData), { build: 'e2e-machines-render' });
    if (!reached.ok) throw new Error(`B's machine.sock: ${reached.state}: ${reached.why}`);
    try {
      const ask = async <T>(name: string, input: unknown, timeoutMs?: number): Promise<T> => {
        const answer = await reached.link.request(name, input, timeoutMs);
        if (!answer.ok) throw new Error(`${name} on B: ${answer.error.code} ${answer.error.message}\nB's mawsd.log:\n${daemon!.log()}`);
        return answer.value as T;
      };
      expect(reached.link.welcome.capabilities, 'B’s welcome lists machine.render').toContain('machine.render');
      const page = '<!doctype html><html><head><title>B</title></head><body><h1>MACHINE_B_EXPORT</h1></body></html>';
      const { artifact } = await ask<{ artifact: { id: string; revision: number } }>('artifacts.create', { kind: 'html', title: 'B’s page', content: { bytes: new TextEncoder().encode(page), name: 'index.html' } });
      const exported = await ask<{ path: string; revision: number }>('artifacts.export', { artifactId: artifact.id, format: 'pdf' }, 150_000);
      expect(exported.revision).toBe(artifact.revision);
      expect(exported.path.startsWith(join(bUserData, 'artifacts', artifact.id, 'exports')), 'the file is under B’s profile').toBe(true);
      expect(readFileSync(exported.path).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(daemon.log(), 'B’s mawsd started its render host for the export').toContain('[render] starting the render host for the library’s Export');
      await expect
        .poll(async () => (await ask<{ rows: { id: string }[] }>('library.list', {})).rows.some((row) => row.id === artifact.id), { timeout: 30_000, message: 'B’s library lists the artifact' })
        .toBe(true);
    } finally {
      reached.link.close();
    }
  } finally {
    await daemon?.stop().catch((error: unknown) => console.error(error));
    rmSync(root, { recursive: true, force: true });
  }
});
