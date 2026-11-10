// The project registry on the page through the gate (docs/doperpowers/plans/2026-11-10-project-registry.md, M11's "It
// proves", e2e; Interfaces §J). An org whose registry holds a project with a folder on this Mac and a missing one on
// `studio-mini`, and a project with no folder on this Mac: replaced on `studio-mini`, and on `render-farm-03`, which is
// off, with a removal held for it. The case asserts that the project with no folder here is a row naming its machines;
// that the missing, the offline and the replaced location each read as §J.3 says (the row's line, the hover card); that
// Add project on `studio-mini` sends `session.projects.addFolder` there with the project chosen; and that the held
// removal is listed under Hidden projects… and cancelled from there. The row, both cards, the sheet and the list are
// attached as PNGs for the architect's look.
//
// The org is seeded where no real one holds it at once: under MAWS_E2E=1 a harness build's main answers `org.status`,
// `org.view`, `org.rows`, `machines.list` and `org.projects` from a file the schemas admit, answers the project acts
// sent to the file's machines (`session.projects.resolve`, `session.projects.addFolder`) and `org.removals.cancel`, the
// cancel dropping the removal and emitting `org.projects.changed`, and writes each act it answered to the file's `log`
// as a JSON line (src/main/org/registry-fixture.ts), so the real renderer draws what main would send and the case reads
// what it was sent. This Mac's project is C5's stub scenario's. `pnpm e2e:settings` builds the harness; under any other
// build the case skips.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { OrgProjectLocation, OrgProjects, OrgRows, OrgStatus, OrgView } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import type { OrgKey } from '../src/shared/machine/org-key';
import type { MachineRef } from '../src/shared/machine/ref';
import { memberNames } from '../src/shared/org/member-name';
import { REGISTRY } from '../src/renderer/src/sidebar/registry-copy';
import { addressed } from './support/address';
import { launchMaws, REPO_ROOT } from './support/launch';
import { projectLine, projectRow, showProjectList, sidebarOf } from './support/sidebar';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now; a plain build's main lacks the seam.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const FIXTURE_ENV = 'MAWS_E2E_REGISTRY'; // registry-fixture.ts's REGISTRY_FIXTURE_ENV

const APP = '3f6b2a91-8c4d-4e7f-9a1b-2c3d4e5f6a7b';
const SCRAPE = '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f';
const APP_NAME = 'northwind-app';
const SCRAPE_NAME = 'scrape';
const PROJECT_ID = 'proj-northwind-app'; // this Mac's row of APP in the stub scenario
const LOCAL_SESSION = 'app-3eb04b84'; // the shell scenario's permission session (test/fixtures/shell/nine-sessions.json)
const HELD = 'held-removal-1';

const STUDIO = randomBytes(16).toString('base64url') as MachineRef;
const FARM = randomBytes(16).toString('base64url') as MachineRef;
const LOCAL_NAME = 'ana-mbp';
const STUDIO_NAME = 'studio-mini';
const FARM_NAME = 'render-farm-03';
const NEW_FOLDER = '/srv/scrape-next';

type Seed = { status: Extract<OrgStatus, { state: 'registered' }>; view: OrgView; rows: OrgRows; machines: MachineState[]; projects: OrgProjects; log: string };
type Logged = { name: string; machine?: MachineRef; input: unknown };

function seeded(local: MachineRef, now: number, log: string): Seed {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const ana = { id: randomBytes(16).toString('hex'), email: 'ana.lopez@northwind.example', role: 'admin' as const };
  const names = memberNames([ana]);
  const view: OrgView = {
    version: 12,
    issued: at(1440),
    maySign: false,
    recoveryKid: randomBytes(16).toString('base64url'),
    members: [{ ...ana, name: names.get(ana.id)!, you: true, devices: [] }],
    machines: [],
    roots: [],
    delegations: [],
    strayKeys: [],
    hubKeys: { at: null, failed: false },
  };
  const status: Seed['status'] = {
    state: 'registered',
    org: 'northwind-health',
    hub: 'https://desk.northwind-health.example',
    member: { id: ana.id, email: ana.email },
    device: randomBytes(16).toString('base64url'),
    session: 'signed-in',
    hubAccess: 'connected',
    head: { version: 12, issued: at(1440) },
    problem: null,
    signer: null,
    pairing: null,
    enrolling: null,
    hubRowsLeft: [],
    delegations: { creating: false, rev: 0 },
  };
  // the other machines' sessions come from their listings, none here: no record snapshot is read over their links
  const rows: OrgRows = { machines: [STUDIO, FARM], rows: [], complete: true, pending: [], members: [{ id: ana.id, email: ana.email, name: names.get(ana.id)! }], member: ana.id };
  const machines: MachineState[] = [
    { ref: local, name: LOCAL_NAME, local: true, state: 'up', since: at(2880), generation: 0 },
    { ref: STUDIO, name: STUDIO_NAME, local: false, state: 'up', since: at(2880), generation: 1, carrier: 'direct', rights: ['spawn', 'shell', 'machine-admin'], capabilities: ['rl2.project-acts'] },
    { ref: FARM, name: FARM_NAME, local: false, state: 'down', since: at(240), generation: 1 },
  ];
  const location = (machine: MachineRef, pid: string, path: string, key: string, over: Partial<OrgProjectLocation> = {}): OrgProjectLocation => ({
    machine, pid, path, key: key as OrgKey, name: path.split('/').at(-1)!, source: 'folder', acts: true, ...over,
  });
  const projects: OrgProjects = {
    projects: [
      {
        id: APP,
        name: APP_NAME,
        hub: true,
        renamable: false,
        locations: [
          location(local, PROJECT_ID, `/Users/ana/Developer/${APP_NAME}`, `smns:${APP}`, { source: 'smns' }),
          location(STUDIO, 'p-app', `/Users/studio/src/${APP_NAME}`, `smns:${APP}`, { source: 'smns', state: 'missing' }),
        ],
      },
      {
        id: SCRAPE,
        name: SCRAPE_NAME,
        hub: true,
        renamable: true,
        locations: [
          location(STUDIO, 'p-scrape', '/srv/scrape', `folder:${STUDIO}:p-scrape`, { state: 'replaced' }),
          location(FARM, 'p-scrape-farm', '/data/scrape', `folder:${FARM}:p-scrape-farm`),
        ],
      },
    ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    keys: { [APP]: `smns:${APP}` as OrgKey, [SCRAPE]: `id:${SCRAPE}` as OrgKey },
    moved: {},
    removals: [{ id: HELD, project: SCRAPE, machine: FARM, pid: 'p-scrape-old', path: '/data/scrape-old', askedAt: at(30) }],
    seen: { [FARM]: at(90) },
  };
  return { status, view, rows, machines, projects, log };
}

/** C5's stub scenario: APP's folder on this Mac, holding the shell scenario's permission session. */
function scenario(): unknown {
  const shell = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;
  const ours = (entry: Record<string, unknown>) => (entry.appId ?? entry.appSessionId) === LOCAL_SESSION;
  return {
    version: 1,
    projects: [
      {
        id: PROJECT_ID,
        name: APP_NAME,
        directory: `/Users/ana/Developer/${APP_NAME}`,
        order: 0,
        createdAt: '2026-09-01T09:00:00.000Z',
        org: { key: `smns:${APP}`, name: APP_NAME, source: 'smns', smnsId: APP },
      },
    ],
    sessions: shell.sessions.filter(ours).map((s) => ({ ...s, projectId: PROJECT_ID })),
    digests: shell.digests.filter(ours),
    engine: shell.engine.filter(ours),
    attention: shell.attention.filter(ours),
    timeline: [],
  };
}

/** The acts the fixture answered, in order (its log: one JSON line each). */
function logged(log: string): Logged[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Logged);
}

/** A row's hover card, opened as a person opens it: the pointer rests on the row's line (300 ms). */
async function cardOf(page: Page, name: string): Promise<Locator> {
  const card = page.locator('[data-hover-card]');
  await page.mouse.move(900, 400);
  await expect(card).toHaveCount(0);
  await projectLine(projectRow(page, name)).hover();
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
  return card;
}

test.skip(!HARNESS_BUILT, "the seeded registry needs a harness build's main (pnpm e2e:settings)");

test('registry: a project with no folder here is a row naming its machines; missing, offline and replaced locations in §J.3’s words; Add project on another machine sends addFolder with the project chosen; a held removal is listed and cancelled', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-registry-')));
  try {
    const local = readOrMintMachineRef(userData); // the machine the app will be
    const log = join(userData, 'registry-acts.log');
    const fixture = join(userData, 'registry.json');
    writeFileSync(fixture, JSON.stringify(seeded(local, Date.now(), log)));
    const stub = join(userData, 'registry-scenario.json');
    writeFileSync(stub, JSON.stringify(scenario()));
    const maws = await launchMaws({ userData, env: { [FIXTURE_ENV]: fixture, MAWS_SESSION_SOURCE: `stub:${stub}` } });
    try {
      const { page } = maws;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the app's default
      const sidebar = sidebarOf(page);
      await expect(page.locator(`[data-menu="project:${await addressed(page, PROJECT_ID)}"]`).first()).toBeVisible({ timeout: 15_000 });
      await showProjectList(page);

      // One row per project id, each naming its machines, this Mac's first; one that is off said offline.
      const scrape = projectRow(page, SCRAPE_NAME);
      await expect(scrape).toBeVisible({ timeout: 10_000 });
      await expect(scrape.locator('[data-row-machines]')).toHaveText(REGISTRY.machines([`${FARM_NAME} ${REGISTRY.offline}`, STUDIO_NAME]));
      await expect(scrape).toHaveAttribute('data-menu', /^project:/); // a location of another machine acts for it
      const app = projectRow(page, APP_NAME);
      await expect(app.locator('[data-row-machines]')).toHaveText(REGISTRY.machines([LOCAL_NAME, STUDIO_NAME]));
      await expect(sidebar.locator('[data-kind="project"]').filter({ hasText: APP_NAME })).toHaveCount(1); // two folders, one row
      await test.info().attach('registry-rows', { body: await sidebar.screenshot(), contentType: 'image/png' });

      // The missing location: its words, Locate… and Remove.
      let card = await cardOf(page, APP_NAME);
      const missing = card.locator(`[data-location="${STUDIO}/p-app"]`);
      await expect(missing).toHaveAttribute('data-location-state', 'missing');
      await expect(missing.locator('[data-location-words]')).toHaveText(REGISTRY.missing(STUDIO_NAME));
      await expect(missing.getByRole('button', { name: REGISTRY.locate, exact: true })).toBeVisible();
      await expect(missing.getByRole('button', { name: REGISTRY.remove, exact: true })).toBeVisible();
      await expect(card.locator(`[data-location="${local}/${PROJECT_ID}"] [data-location-words]`)).toHaveCount(0); // there: no state
      await test.info().attach('registry-card-missing', { body: await page.screenshot(), contentType: 'image/png' });

      // The replaced location (Use this folder and Remove), the offline one (since when), and the removal held for it.
      card = await cardOf(page, SCRAPE_NAME);
      const replaced = card.locator(`[data-location="${STUDIO}/p-scrape"]`);
      await expect(replaced).toHaveAttribute('data-location-state', 'replaced');
      await expect(replaced.locator('[data-location-words]')).toHaveText(REGISTRY.replaced);
      await expect(replaced.getByRole('button', { name: REGISTRY.useThisFolder, exact: true })).toBeVisible();
      await expect(replaced.getByRole('button', { name: REGISTRY.remove, exact: true })).toBeVisible();
      await expect(replaced.locator('[data-location-suggestion]')).toHaveCount(0); // none for a replaced location
      const offline = card.locator(`[data-location="${FARM}/p-scrape-farm"]`);
      await expect(offline).toHaveAttribute('data-location-state', 'offline');
      await expect(offline.locator('[data-location-words]')).toHaveText(new RegExp(`^${REGISTRY.offlineSince('')}\\S`));
      await expect(offline.getByRole('button')).toHaveCount(0); // a machine that is off: nothing to do there now
      await expect(card.locator(`[data-held-removal="${HELD}"]`)).toContainText(REGISTRY.pending(FARM_NAME));
      await test.info().attach('registry-card-replaced-offline', { body: await page.screenshot(), contentType: 'image/png' });
      await page.mouse.move(900, 400);
      await expect(card).toHaveCount(0);

      // Add project on studio-mini, into scrape: one addFolder there with the project chosen.
      await page.getByRole('button', { name: 'Add project', exact: true }).first().click();
      await page.getByRole('dialog', { name: 'Add project', exact: true }).getByRole('button', { name: 'Choose folder…', exact: true }).click();
      const sheet = page.locator('[data-add-project]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-machine-choice]')).toHaveCount(2); // this Mac, studio-mini; render-farm-03 is off
      await sheet.locator(`[data-machine-choice="${STUDIO}"]`).getByRole('radio').check();
      await expect(sheet.getByRole('button', { name: REGISTRY.browse, exact: true })).toBeVisible(); // another machine's folders
      await sheet.getByPlaceholder(REGISTRY.folderPlaceholder).fill(NEW_FOLDER);
      await sheet.getByRole('combobox', { name: REGISTRY.project, exact: true }).selectOption({ label: SCRAPE_NAME });
      await expect(sheet.locator('[data-registry-notice]')).toHaveCount(0); // a machine that serves the acts; no folder above it decides
      await test.info().attach('registry-add-project', { body: await page.screenshot(), contentType: 'image/png' });
      await sheet.getByRole('button', { name: REGISTRY.add, exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(() => logged(log).filter((act) => act.name === 'session.projects.addFolder')).toEqual([{ name: 'session.projects.addFolder', machine: STUDIO, input: { directory: NEW_FOLDER, into: SCRAPE } }]);

      // The held removal under Hidden projects…, cancelled there: nothing is sent, and the list follows the registry.
      await sidebar.getByRole('button', { name: 'Hidden projects…', exact: true }).click();
      const hidden = page.getByRole('dialog', { name: 'Hidden projects', exact: true });
      const pending = hidden.getByRole('region', { name: REGISTRY.pendingTitle, exact: true });
      await expect(pending.locator(`[data-held-removal="${HELD}"]`)).toContainText(REGISTRY.pending(FARM_NAME));
      await test.info().attach('registry-pending-removal', { body: await page.screenshot(), contentType: 'image/png' });
      await pending.locator(`[data-held-removal="${HELD}"]`).getByRole('button', { name: REGISTRY.cancel, exact: true }).click();
      await expect(pending).toHaveCount(0);
      expect(logged(log).filter((act) => act.name === 'org.removals.cancel')).toEqual([{ name: 'org.removals.cancel', input: { id: HELD } }]);
      await expect(hidden.getByText('No hidden projects.')).toBeVisible();
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
