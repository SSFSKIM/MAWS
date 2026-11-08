// The Share sheet's and the reach marks' look through the gate (P5 O8 M6b Task 3, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M6b's "Touches", e2e; the Decision Log's "M6b is built as four tasks", item 3). A hub project's rows
// across three machines with real-world variety: this Mac's private session, shared with one person; `studio-mini`'s
// private session shared with a member whose name and email are long enough to wrap, at Approve, and one at Can
// message; its session the org can view, shared with one more; its session at the default, which has no mark; another
// member's private session shared with you, its lock read from its listing's audience; and `render-farm-03…`'s
// session, whose sminos can't keep a session's reach yet. The sidebar's marks and a row's hover card, the private
// session's sheet, its change, removal and addition pending in the order Save sends them, its save (one line saved with
// the revision also changed elsewhere, one refused for a reason no line of the sheet knows, its raw word beside it, and
// the one after it not sent), a save whose first line's outcome is unknown (the lines after it not sent, one reload
// offered), and the farm's sheet are attached as PNGs for the architect's look; the case asserts structure only: nothing
// in a sheet or a marked row is wider than its box, every control is drawn whole on all four edges, and each mark lies
// inside its row.
//
// The org is seeded where no real one holds it at once: under MAWS_E2E=1 a harness build's main answers `org.status`,
// `org.view`, `org.rows`, `machines.list`, `org.policy.get` and each save from a file the schemas admit
// (src/main/org/share-fixture.ts), so the real renderer draws what main would send; this Mac's session is C5's stub
// scenario's, in the hub project. `pnpm e2e:settings` builds the harness; under any other build the case skips.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RecordPolicyEntry } from '../src/shared/ipc/schema/endpoint';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { OrgPolicy, OrgPolicySetResult, OrgRows, OrgStatus, OrgView, RemoteRow } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import type { MachineRef } from '../src/shared/machine/ref';
import { memberNames } from '../src/shared/org/member-name';
import { SHARE } from '../src/renderer/src/sessions/share/copy';
import { actionsNotWhole, addClippedProbes, probeFaults, type ActionEntry } from './support/actions-whole';
import { addressed } from './support/address';
import { launchMaws, REPO_ROOT } from './support/launch';
import { openProject, projectLine, projectRow, sidebarOf } from './support/sidebar';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now; a plain build's main lacks the seam.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const FIXTURE_ENV = 'MAWS_E2E_SHARE'; // share-fixture.ts's SHARE_FIXTURE_ENV

const PROJECT = '7a4c2e1b-3d5f-4a6b-8c7d-9e0f1a2b3c4d';
const PROJECT_ID = 'proj-northwind-share'; // the local project the scenario files this Mac's session under
const PROJECT_NAME = 'northwind-clinical-research-operations-platform';
const LOCAL_SESSION = 'app-3eb04b84'; // the shell scenario's permission session (test/fixtures/shell/nine-sessions.json)
const S1 = 'b7e1a9c0-1f2e-4d3c-9b8a-7c6d5e4f3a21';
const S2 = 'c8f2b0d1-2a3f-4e4d-8c9b-8d7e6f5a4b32';
const S3 = 'd9a3c1e2-3b4a-4f5e-9dac-9e8f7a6b5c43';
const S4 = 'eab4d2f3-4c5b-4a6f-8ebd-af9a8b7c6d54';
const S5 = 'fbc5e3a4-5d6c-4b7a-9fce-ba0b9c8d7e65';

const STUDIO = randomBytes(16).toString('base64url') as MachineRef;
const FARM = randomBytes(16).toString('base64url') as MachineRef;
const FARM_NAME = 'render-farm-03.clinical-research-operations';
const memberId = () => randomBytes(16).toString('hex');
const UNKNOWN_REASON = 'policy-frozen-by-the-org-admin';

type Seed = { status: Extract<OrgStatus, { state: 'registered' }>; view: OrgView; rows: OrgRows; machines: MachineState[]; policies: OrgPolicy[]; saves: Record<string, OrgPolicySetResult> };

function seeded(local: MachineRef, now: number): Seed {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  type M = Pick<OrgView['members'][number], 'id' | 'email' | 'role'>;
  const ana: M = { id: memberId(), email: 'ana.lopez@northwind.example', role: 'admin' };
  const long: M = { id: memberId(), email: 'maximiliana.featherstonehaugh-villanueva-oyelaran@clinical-research-operations.northwind-health.example', role: 'member' };
  const ben: M = { id: memberId(), email: 'ben@northwind.example', role: 'member' };
  const chen: M = { id: memberId(), email: 'chen.wei@northwind.example', role: 'member' };
  const dara: M = { id: memberId(), email: 'dara.okafor@northwind.example', role: 'member' };
  const names = memberNames([ana, long, ben, chen, dara]);
  const view: OrgView = {
    version: 41,
    issued: at(3 * 1440),
    maySign: false,
    recoveryKid: randomBytes(16).toString('base64url'),
    members: [ana, long, ben, chen, dara].map((m) => ({ ...m, name: names.get(m.id)!, you: m === ana, devices: [] })),
    machines: [],
    roots: [],
  };
  const status: Seed['status'] = {
    state: 'registered',
    org: 'northwind-health',
    hub: 'https://desk.northwind-health.example',
    member: { id: ana.id, email: ana.email },
    device: randomBytes(16).toString('base64url'),
    session: 'signed-in',
    hubAccess: 'connected',
    head: { version: 41, issued: at(3 * 1440) },
    problem: null,
    signer: null,
    pairing: null,
    enrolling: null,
    hubRowsLeft: [],
  };
  const orgKey = `smns:${PROJECT}` as RemoteRow['orgKey'];
  const row = (machine: MachineRef, session: string, title: string, minutesAgo: number, over: Partial<RemoteRow> = {}): RemoteRow => ({
    machine,
    session,
    lane: 'B',
    state: 'idle',
    title,
    owners: [ana.id],
    project: PROJECT,
    orgKey,
    availability: null,
    revision: 3,
    issued: at(minutesAgo),
    mine: true,
    ...over,
  });
  const rows: OrgRows = {
    machines: [STUDIO, FARM],
    rows: [
      row(STUDIO, S1, 'Rerun the clinical research shards that failed last night and hold the merge until they pass', 4),
      row(STUDIO, S2, 'Migration dashboard colours', 9, { state: 'busy' }),
      row(STUDIO, S3, 'Notes for the review', 30),
      row(STUDIO, S4, 'Ben’s draft of the eviction table', 12, { owners: [ben.id], mine: false, audience: [ana.id, ben.id].sort(), policyRev: 5 }),
      row(FARM, S5, 'Render the nightly cohort report', 45, { orgKey: null }),
    ],
    complete: true,
    pending: [],
    members: [ana, ben].map((m) => ({ id: m.id, email: m.email, name: names.get(m.id)! })),
    member: ana.id,
  };
  const since = at(2 * 1440);
  const machines: MachineState[] = [
    { ref: local, name: 'ana-mbp', local: true, state: 'up', since, generation: 0 },
    { ref: STUDIO, name: 'studio-mini', local: false, state: 'up', since, generation: 1, carrier: 'direct' },
    { ref: FARM, name: FARM_NAME, local: false, state: 'up', since, generation: 1, carrier: 'relay' },
  ];
  const s1: RecordPolicyEntry = { session: S1, access: 'private', shares: [{ member: long.id, grade: 'approve' }, { member: ben.id, grade: 'list' }], policyRev: 7 };
  const policies: OrgPolicy[] = [
    { ok: true, machine: local, supported: true, policies: [{ session: LOCAL_SESSION, access: 'private', shares: [{ member: chen.id, grade: 'view' }], policyRev: 2 }] },
    { ok: true, machine: STUDIO, supported: true, policies: [s1, { session: S2, access: 'org-view', shares: [{ member: chen.id, grade: 'converse' }], policyRev: 4 }, { session: S3, access: 'listed', shares: [], policyRev: 1 }] },
    { ok: true, machine: FARM, supported: false },
  ];
  const saves: Seed['saves'] = {
    [`${STUDIO}/${S1}`]: {
      ok: true,
      results: [
        { line: { kind: 'share', member: long.id, grade: 'converse' }, state: 'done', changed: true, policyRev: 9, elsewhere: true },
        { line: { kind: 'share', member: ben.id, grade: null }, state: 'refused', reason: UNKNOWN_REASON },
        { line: { kind: 'share', member: dara.id, grade: 'list' }, state: 'not-sent' },
      ],
      policy: { ...s1, shares: [{ member: long.id, grade: 'converse' }, { member: ben.id, grade: 'list' }], policyRev: 9 },
    },
    [`${STUDIO}/${S2}`]: {
      ok: true,
      results: [
        { line: { kind: 'access', access: 'org-converse' }, state: 'unknown', reason: 'malformed' },
        { line: { kind: 'share', member: chen.id, grade: null }, state: 'not-sent' },
      ],
      policy: null,
    },
  };
  return { status, view, rows, machines, policies, saves };
}

/** C5's stub scenario: the hub project, holding the shell scenario's permission session. */
function scenario(): unknown {
  const shell = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;
  const ours = (entry: Record<string, unknown>) => (entry.appId ?? entry.appSessionId) === LOCAL_SESSION;
  return {
    version: 1,
    projects: [
      {
        id: PROJECT_ID,
        name: PROJECT_NAME,
        directory: `/Users/ana/Developer/${PROJECT_NAME}`,
        order: 0,
        createdAt: '2026-09-01T09:00:00.000Z',
        org: { key: `smns:${PROJECT}`, name: PROJECT_NAME, source: 'smns', smnsId: PROJECT },
      },
    ],
    sessions: shell.sessions.filter(ours).map((s) => ({ ...s, projectId: PROJECT_ID, title: { text: 'Approve the shard rerun on the clinical research operations cluster before the nightly window', source: 'user' } })),
    digests: shell.digests.filter(ours),
    engine: shell.engine.filter(ours),
    attention: shell.attention.filter(ours),
    timeline: [],
  };
}

// What is wider than its box under `root`: the root and every block that text lands in. A text item too wide for its
// block shows as that block's overflow; a run truncated on purpose (a `truncate` span) is no fault. Each offender as
// `<tag> "<text>" scrollWidth > clientWidth`.
function overflowing(root: Element): string[] {
  return [root, ...Array.from(root.querySelectorAll('section, fieldset, label, div, p, ul, li, button, select'))]
    .filter((el) => el.scrollWidth > el.clientWidth)
    .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 60)}" ${el.scrollWidth} > ${el.clientWidth}`);
}

/** An action lies inside its sheet (a probe inside its own clipping part, so the sheet's locator never names a probe). */
const SHEET: ActionEntry = { selector: '[data-share-sheet], [data-share-probe]', name: 'its sheet', probe: 'data-share-probe' };

/** Each mark that doesn't lie inside its row, and each marked row wider than its box. */
function marksNotWhole(rows: Element[]): string[] {
  return rows.flatMap((row) => {
    const label = row.getAttribute('aria-label') ?? '';
    const out: string[] = row.scrollWidth > row.clientWidth ? [`"${label.slice(0, 40)}" ${row.scrollWidth} > ${row.clientWidth}`] : [];
    const mark = row.querySelector('[data-reach]');
    if (mark === null) return [...out, `"${label.slice(0, 40)}" has no mark`];
    const m = mark.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (m.width === 0 || m.left < r.left - 0.5 || m.top < r.top - 0.5 || m.right > r.right + 0.5 || m.bottom > r.bottom + 0.5) out.push(`"${label.slice(0, 40)}"'s mark ${Math.round(m.left)},${Math.round(m.top)}..${Math.round(m.right)},${Math.round(m.bottom)} outside its row`);
    return out;
  });
}

/** The sheet's structure: nothing wider than its box, every action whole, and the check sees a clipped one. */
async function checkSheet(sheet: Locator): Promise<void> {
  expect(await sheet.evaluate(overflowing), 'nothing in the sheet is wider than its box').toEqual([]);
  expect(await sheet.evaluate(actionsNotWhole, SHEET), 'every action is drawn whole inside the sheet').toEqual([]);
  await sheet.evaluate(addClippedProbes, SHEET);
  const probed = await sheet.evaluate(actionsNotWhole, SHEET);
  await sheet.evaluate((root) => root.querySelectorAll('[data-probe]').forEach((probe) => probe.remove()));
  expect(probeFaults(probed), `the check names every clipped probe and not the mirror: ${probed.join('; ')}`).toEqual([]);
}

/** Opens the row's Share sheet from its menu, as a person does. */
async function openShare(page: Page, row: Locator): Promise<Locator> {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: SHARE.menuItem, exact: true }).click();
  const sheet = page.locator('[data-share-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-share-said]').filter({ hasText: SHARE.reading })).toHaveCount(0);
  return sheet;
}

test.skip(!HARNESS_BUILT, "the seeded org needs a harness build's main (pnpm e2e:settings)");

test('share: the reach marks across machines, a row’s hover card, the private session’s sheet and its save, an unknown outcome stopping a save, and a machine whose sminos can’t keep a reach; each photographed; nothing overflows and every action is whole', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-share-')));
  try {
    const local = readOrMintMachineRef(userData); // the machine the app will be
    const seed = seeded(local, Date.now());
    const fixture = join(userData, 'share.json');
    writeFileSync(fixture, JSON.stringify(seed));
    const stub = join(userData, 'share-scenario.json');
    writeFileSync(stub, JSON.stringify(scenario()));
    // Classic scrollbars, which take width from the view, as on any Mac with a mouse attached (org-page.spec.ts's reason).
    const maws = await launchMaws({ userData, env: { [FIXTURE_ENV]: fixture, MAWS_SESSION_SOURCE: `stub:${stub}` }, appKitDefaults: { AppleShowScrollBars: 'Always' } });
    try {
      const { page } = maws;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the app's default
      const project = page.locator(`[data-menu="project:${await addressed(page, PROJECT_ID)}"]`).first();
      await expect(project).toBeVisible({ timeout: 15_000 });
      await openProject(page, PROJECT_NAME);
      // Others' sessions show while the project's People toggle is on: from its menu, as a person turns it on.
      await projectLine(projectRow(page, PROJECT_NAME)).click({ button: 'right' });
      await page.getByRole('menuitemcheckbox', { name: /Show people’s sessions/ }).click();
      await openProject(page, FARM_NAME);

      const sidebar = sidebarOf(page);
      const rowOf = (address: string) => sidebar.locator(`[role="treeitem"][data-tree-id="s:${address}"]`);
      const at = (machine: MachineRef, session: string) => `${machine}/${session}`;
      const marked = { here: rowOf(at(local, LOCAL_SESSION)), s1: rowOf(at(STUDIO, S1)), s2: rowOf(at(STUDIO, S2)), s4: rowOf(at(STUDIO, S4)) };
      await expect(marked.here.locator('[data-reach="private"]')).toBeVisible({ timeout: 10_000 });
      await expect(marked.s1.locator('[data-reach="private"]')).toBeVisible();
      await expect(marked.s2.locator('[data-reach="shared"]')).toBeVisible();
      await expect(marked.s4.locator('[data-reach="private"]')).toBeVisible(); // another's, read from its listing's audience
      await expect(rowOf(at(STUDIO, S3))).toBeVisible();
      await expect(rowOf(at(STUDIO, S3)).locator('[data-reach]')).toHaveCount(0); // the default: no mark
      await expect(rowOf(at(FARM, S5)).locator('[data-reach]')).toHaveCount(0); // its machine can't say a reach
      await expect(rowOf(at(STUDIO, S4))).toHaveAttribute('data-menu', 'none'); // not yours: no Share
      await expect(rowOf(at(STUDIO, S1))).toHaveAttribute('data-menu', `session:${at(STUDIO, S1)}`);
      const rows = await Promise.all(Object.values(marked).map((row) => row.elementHandle()));
      expect(await page.evaluate(marksNotWhole, rows.filter((row) => row !== null)), 'each mark lies inside its row, and no marked row is wider than its box').toEqual([]);
      // the row the People toggle added moves the rows below it (300 ms): its motion finished, so the photograph holds them all
      await page.evaluate(() => {
        for (const animation of document.querySelector('[data-region="sidebar"]')?.getAnimations({ subtree: true }) ?? []) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      });
      await test.info().attach('share-marks', { body: await sidebar.screenshot(), contentType: 'image/png' });

      // A marked row's hover card says its access.
      await marked.s2.hover();
      const card = page.locator('[data-hover-card]');
      await expect(card.getByTestId('hover-reach')).toHaveText(SHARE.reach('org-view', 1));
      await test.info().attach('share-hover-card', { body: await page.screenshot(), contentType: 'image/png' });
      await page.mouse.move(900, 400);
      await expect(card).toHaveCount(0);

      // The private session's sheet: Private chosen, its two people, Can message's line among theirs.
      let sheet = await openShare(page, marked.s1);
      await expect(sheet.getByRole('radio', { name: new RegExp(`^${SHARE.access.private.label}`) })).toBeChecked();
      await expect(sheet.getByText(SHARE.access.private.line)).toBeVisible();
      await expect(sheet.locator('[data-share-person]')).toHaveCount(2);
      await expect(sheet.getByText(SHARE.grade.list.line).first()).toBeVisible();
      await expect(sheet.getByText(SHARE.foot)).toBeVisible();
      await expect(sheet.getByRole('button', { name: SHARE.save })).toBeDisabled();
      await expect(page.locator('[data-sheet-scrim]')).toHaveClass(/\bbg-bg-active\b/); // the window under it is dimmed
      await test.info().attach('share-sheet', { body: await page.screenshot(), contentType: 'image/png' });
      await checkSheet(sheet);
      // A change, a removal and an addition, each pending in its place (the order Save sends them), then Save: a line
      // saved over another's change, one refused for a reason no line knows, one not sent.
      const people = sheet.locator('[data-share-person]');
      await people.first().locator('select').selectOption('converse');
      await people.nth(1).getByRole('button', { name: /^Remove / }).click();
      await expect(people.nth(1)).toHaveAttribute('data-share-pending', 'remove');
      await expect(people.nth(1)).toContainText(SHARE.removing);
      await sheet.getByRole('combobox', { name: SHARE.addPerson, exact: true }).selectOption(seed.view.members.find((m) => m.email.startsWith('dara'))!.id);
      await sheet.getByRole('combobox', { name: SHARE.newGrade, exact: true }).selectOption('list');
      await sheet.getByRole('button', { name: SHARE.add, exact: true }).click();
      await expect(sheet.locator('[data-share-pending]')).toHaveCount(3);
      await people.last().scrollIntoViewIfNeeded();
      await test.info().attach('share-sheet-pending', { body: await page.screenshot(), contentType: 'image/png' });
      await checkSheet(sheet);
      await sheet.getByRole('button', { name: SHARE.save }).click();
      const results = sheet.locator('[data-share-results]');
      await expect(results.locator('[data-share-outcome]')).toHaveCount(3);
      await expect(results.locator('[data-elsewhere]')).toContainText(SHARE.alsoElsewhere);
      await expect(results.locator('[data-share-outcome="refused"]')).toContainText(SHARE.refused('studio-mini'));
      await expect(results.locator('[data-share-raw]')).toHaveAttribute('title', UNKNOWN_REASON);
      await expect(results.locator('[data-share-outcome="not-sent"]')).toContainText(SHARE.notSent);
      await sheet.locator('[data-share-body]').evaluate((el) => (el.scrollTop = 0)); // the results lead the body
      await test.info().attach('share-sheet-saved', { body: await page.screenshot(), contentType: 'image/png' });
      await checkSheet(sheet);
      await sheet.getByRole('button', { name: SHARE.close }).click();
      await expect(sheet).toHaveCount(0);

      // A save whose first line's outcome is unknown: the lines after it weren't sent, and a reload is offered.
      sheet = await openShare(page, marked.s2);
      await sheet.getByRole('radio', { name: new RegExp(`^${SHARE.access['org-converse'].label}`) }).check();
      await sheet.getByRole('button', { name: SHARE.save }).click();
      await expect(sheet.locator('[data-share-stopped]')).toContainText(SHARE.stopped);
      await expect(sheet.locator('[data-share-outcome="unknown"]')).toContainText(SHARE.unknown.malformed('studio-mini'));
      await expect(sheet.getByText(SHARE.unavailable)).toHaveCount(0); // the results' Reload is the one offered
      await expect(sheet.getByRole('button', { name: SHARE.reload })).toHaveCount(1);
      await test.info().attach('share-sheet-unknown', { body: await page.screenshot(), contentType: 'image/png' });
      await checkSheet(sheet);
      await sheet.getByRole('button', { name: SHARE.close }).click();

      // A machine whose sminos can't keep a session's reach yet: the sheet says so, and offers nothing.
      sheet = await openShare(page, rowOf(at(FARM, S5)));
      await expect(sheet.getByText(SHARE.unsupported(FARM_NAME))).toBeVisible();
      await expect(sheet.getByRole('radio')).toHaveCount(0);
      await test.info().attach('share-sheet-unsupported', { body: await page.screenshot(), contentType: 'image/png' });
      await checkSheet(sheet);
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
