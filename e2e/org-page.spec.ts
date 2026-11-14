// The Org page's look through the gate (P5 O8 M4a Task 8, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Decision Log "M4a gains Task 8"). Settings › Org over a seeded org with real-world variety: a member whose name and
// email are long enough to wrap (two members reading "Maximiliana" widen to their local parts, as `memberNames` does), a
// member with several devices, roots among them, a pairing this Mac runs for that long member's first device (its row's
// line, and the sheet taken up on it showing the device's fingerprint), and a refusal that names no attempt (the key file
// refused at load: its own "Refused" row). The Machines group shows this machine up (the renderer's `useMachines`) and
// the others not connected. M4b (Task 5): the Machines group's actions while this Mac may sign; a machine with several
// grants (on the machine, not yet on it, and one another device changed), one whose grants this Mac issued are missing,
// one that didn't answer (as of its last answer), a certified machine (its delegation's owners), a dropped machine whose
// hub row is still listed (Retry), and an enrollment awaiting its key. A pairing and an enrollment exclude each other in
// main; the seed shows both, as no one session holds them at once. M4c (Task 5): the Org group's Delegations section, a
// delegation in effect with certified machines live and retired, a half-done renewal, an unsent one, a dropped one whose
// hub key is still live, two stray hub keys (one young), and the code's destination set. The unsent delegation is shown
// with no pending slot, which main never does (its slot is what makes it unsent), so that Create stays enabled for the
// create sheet's photograph; since a row acts only on the slot holding its own delegation (Task 5's fix wave), it offers
// neither Write again nor Discard here (the unit suite draws both, DelegationsSection.test.tsx). Each of the four groups, the window, the Delegations section,
// the pairing sheet and the enrollment, grant, re-grant and create sheets, and the grant sheet saving, are attached as
// PNGs for the architect's look; the case asserts structure only: nothing in the section or a sheet scrolls sideways,
// and every action is drawn whole inside its row.
//
// The org is seeded where no real session can hold it at once (a key file refused at load leaves this Mac nothing to
// pair with): under MAWS_E2E=1 a harness build's main answers `org.status` and `org.view` from a file the `org.*`
// schemas admit (src/main/org/page-fixture.ts), so the real renderer draws what main would send. `pnpm e2e:settings`
// builds the harness; under any other build the case skips.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator } from '@playwright/test';
import type { GrantsView, OrgStatus, OrgView, ProvisioningSecret } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import { memberNames } from '../src/shared/org/member-name';
import { ORG, SECTIONS } from '../src/renderer/src/settings-tab/copy';
import { actionsNotWhole, addClippedProbes, probeFaults, type ActionEntry } from './support/actions-whole';
import { launchMaws, REPO_ROOT } from './support/launch';
import { settingsDialog } from './support/shell';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now; a plain build's main lacks the seam.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const FIXTURE_ENV = 'MAWS_E2E_ORG_PAGE'; // page-fixture.ts's ORG_PAGE_FIXTURE_ENV
const GROUPS = ['you', 'people', 'machines', 'org'] as const;

async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}

// The ids' shapes as the org state carries them: a key id is 16 bytes of base64url, a member id 16 bytes of hex (edits.ts),
// a machine ref 22 base64url characters, a fingerprint two runs of five base32 letters.
const kid = () => randomBytes(16).toString('base64url');
const memberId = () => randomBytes(16).toString('hex');
const ref = () => randomBytes(16).toString('base64url');
const fingerprint = () => {
  const letters = Array.from(randomBytes(10), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b & 31]).join('');
  return `${letters.slice(0, 5)}-${letters.slice(5)}`;
};

type Device = OrgView['members'][number]['devices'][number];
type Registered = Extract<OrgStatus, { state: 'registered' }>;
const device = (over: Partial<Device> & Pick<Device, 'class'>): Device => ({
  id: kid(),
  keyStorage: over.class === 'web-cards' ? 'webcrypto' : 'software',
  root: false,
  thisMac: false,
  fingerprint: fingerprint(),
  ...over,
});

const DAY_MS = 86_400_000;
// A delegation's id is its hub key's: 16 bytes of lowercase hex.
const delegationId = () => randomBytes(16).toString('hex');
/** Production's destination (M4c's *The destination*). */
const DESTINATION: ProvisioningSecret = { project: 'maws-example-prod', secret: 'desk-provisioning-v2', account: 'cli-owner@maws-example-prod.iam.gserviceaccount.com' };

/** The org: what main's session and view would send for it, `now` the clock the ages and the pairing's end read. */
function seededOrg(local: string, userData: string, now: number): { status: Registered; view: OrgView; grants: Record<string, GrantsView>; names: Map<string, string> } {
  type Seed = Pick<OrgView['members'][number], 'id' | 'email' | 'role'>;
  const ana: Seed = { id: memberId(), email: 'ana.lopez@northwind.example', role: 'admin' };
  const long: Seed = { id: memberId(), email: 'maximiliana.featherstonehaugh-villanueva-oyelaran@clinical-research-operations.northwind-health.example', role: 'member' };
  const ortiz: Seed = { id: memberId(), email: 'maximiliana.ortiz@northwind.example', role: 'admin' };
  const ben: Seed = { id: memberId(), email: 'ben@northwind.example', role: 'member' };
  const chen: Seed = { id: memberId(), email: 'chen.wei@northwind.example', role: 'member' };
  const names = memberNames([ana, long, ortiz, ben, chen]);

  const thisMac = device({ class: 'native-mac', root: true, thisMac: true });
  const anaWeb = device({ class: 'web-cards' });
  const ortizDevices = [device({ class: 'native-mac', root: true }), device({ class: 'native-mac', keyStorage: 'enclave', root: true }), device({ class: 'native-mac' }), device({ class: 'web-cards' })];
  const benMac = device({ class: 'native-mac' });
  const member = (m: Seed, devices: Device[]) => ({ ...m, name: names.get(m.id)!, you: m === ana, devices });

  const issued = new Date(now - 6 * 86_400_000).toISOString();
  const studio = ref();
  const farm = ref();
  const lab = ref();
  const runner = ref();
  const runners = delegationId();
  const at = (days: number) => new Date(now + days * DAY_MS).toISOString();
  const view: OrgView = {
    version: 41,
    issued,
    maySign: true,
    recoveryKid: kid(),
    members: [member(ana, [thisMac, anaWeb]), member(long, []), member(ortiz, ortizDevices), member(ben, [benMac]), member(chen, [])],
    machines: [
      { name: 'ana-mbp', ref: local, owners: [ana.id], keyId: kid(), certified: false, delegation: null, mayGrant: true },
      { name: 'studio-mini', ref: studio, owners: 'org', keyId: kid(), certified: false, delegation: null, mayGrant: true }, // Ana an admin: hers to grant on
      { name: 'render-farm-03.clinical-research-operations', ref: farm, owners: [long.id, ortiz.id, memberId()], keyId: kid(), certified: false, delegation: null, mayGrant: false }, // the last a former member
      { name: 'lab-mini-02', ref: lab, owners: [ana.id], keyId: kid(), certified: false, delegation: null, mayGrant: true },
      { name: 'ci-runner-7', ref: runner, owners: [ortiz.id], keyId: kid(), certified: true, delegation: runners, mayGrant: false },
    ],
    roots: [
      { kid: kid(), member: ana.id, device: thisMac.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[0]!.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[1]!.id },
      { kid: kid(), unlisted: true },
    ],
    // M4c: the Delegations section's rows in each state, and the hub's key list behind them
    delegations: [
      {
        id: runners,
        prefix: 'ci-runner-',
        owners: [ortiz.id],
        expires: at(23.05),
        maxUses: 25,
        machines: [
          { ref: runner, name: 'ci-runner-7', live: true },
          { ref: ref(), name: 'ci-runner-3', live: false },
        ],
        hub: { expires: at(23.05), uses: 4, revoked: false },
        state: 'in-effect',
        unsent: null,
        hubBehind: null,
        hubProblem: null,
      },
      {
        id: delegationId(),
        prefix: 'render-farm.clinical-research-operations-',
        owners: 'org',
        expires: at(180.05),
        maxUses: null,
        machines: [],
        hub: { expires: at(12.05), uses: 2, revoked: false },
        state: 'in-effect',
        unsent: null,
        hubBehind: 'renew',
        hubProblem: { reason: 'not-renewed', detail: "the hub's org state doesn't hold the renewal yet" },
      },
      {
        id: delegationId(),
        prefix: 'devcloud-vm-',
        owners: [ana.id],
        expires: at(90),
        maxUses: null,
        machines: [],
        hub: { expires: at(90), uses: 0, revoked: false },
        state: 'unsent',
        unsent: {
          rewrite: true,
          writing: false,
          problem: 'gcloud secrets versions add failed: PERMISSION_DENIED: Permission denied on secret projects/maws-example-prod/secrets/desk-provisioning-v2 for cli-owner@maws-example-prod.iam.gserviceaccount.com',
          generation: 1,
        },
        hubBehind: null,
        hubProblem: null,
      },
      {
        id: delegationId(),
        prefix: 'old-render-',
        owners: [],
        expires: at(40),
        maxUses: 50,
        machines: [],
        hub: { expires: at(40), uses: 9, revoked: false },
        state: 'dropped',
        unsent: null,
        hubBehind: 'revoke',
        hubProblem: { reason: 'hub', detail: 'the hub was not reached (timeout): Retry' },
      },
    ],
    strayKeys: [
      { id: delegationId(), prefix: 'tmp-', label: 'delegation create from a laptop, abandoned mid-way', created: at(-3), expires: at(87), young: false },
      { id: delegationId(), prefix: 'gpu-box-', label: 'gpu boxes', created: at(-4 / 1440), expires: at(30), young: true },
    ],
    hubKeys: { at: new Date(now - 20_000).toISOString(), failed: false },
  };
  const status: Registered = {
    state: 'registered',
    org: 'northwind-health',
    hub: 'https://desk.northwind-health.example',
    member: { id: ana.id, email: ana.email },
    device: thisMac.id,
    session: 'signed-in',
    hubAccess: 'connected',
    head: { version: view.version, issued },
    problem: null,
    refused: { code: 'keys', detail: `${join(userData, 'device', 'keys.json')} is gone` }, // org-session.ts's words at load
    signer: {
      root: true,
      maySign: true,
      fingerprint: thisMac.fingerprint,
      stepUpKid: view.roots[0]!.kid,
      due: true,
      ageDays: 6,
      pending: null,
      offer: null,
      owing: [{ version: view.version, machines: [studio, farm], tooLarge: [farm] }], // each named by the org state's name, never its ref
      abandoned: [{ hash: randomBytes(32).toString('base64url'), version: view.version - 1, hub: true, machines: [farm] }],
      rekey: null,
      rekeying: null,
      oldDevice: null,
    },
    pairing: {
      generation: 3,
      member: long.id,
      class: 'native-mac',
      expires: new Date(now + 8 * 60_000).toISOString(),
      entry: { id: kid(), class: 'native-mac', keyStorage: 'software', fingerprint: fingerprint(), digest: randomBytes(32).toString('hex') },
      problem: null,
    },
    enrolling: { generation: 2, name: 'gpu-box-02', replace: null, expires: new Date(now + 50 * 60_000).toISOString(), candidate: null, problem: null }, // awaiting its key
    hubRowsLeft: [{ name: 'old-render-01', ref: ref() }],
    delegations: { creating: false, rev: 0 },
  };
  // Each machine's rights as `org.grants.view` answers them: the machine's own word, this Mac's issued record beside it.
  const read = new Date(now).toISOString();
  const shown = (machine: string, patch: Partial<Extract<GrantsView, { ok: true }>>): GrantsView => ({ ok: true, ref: machine, live: true, asOf: read, grants: [], missing: [], digest: null, ...patch });
  const grants: Record<string, GrantsView> = {
    [local]: shown(local, { grants: [{ member: chen.id, rights: ['spawn'], version: 1, state: 'on-machine' }] }),
    [studio]: shown(studio, {
      grants: [
        { member: long.id, rights: ['machine-admin'], version: 4, state: 'refused', reason: 'not-newer' },
        { member: ben.id, rights: ['spawn', 'shell'], version: 3, state: 'on-machine' },
        { member: chen.id, rights: ['spawn'], version: 2, state: 'pending' },
      ],
    }),
    [farm]: shown(farm, { live: false, asOf: new Date(now - 3 * 3_600_000).toISOString() }), // not Ana's: her own entry, none
    [lab]: shown(lab, {
      missing: [
        { member: ben.id, rights: ['spawn'], version: 3 },
        { member: chen.id, rights: ['spawn', 'shell'], version: 2 },
      ],
      digest: randomBytes(32).toString('base64url'),
    }),
    [runner]: shown(runner, {}),
  };
  return { status, view, grants, names };
}

// What is wider than its box under `root`: the root, each row and each of its cells (a label past its grid column
// overlaps the value without widening the row, so the cells are looked at, not only the rows), and every block that text
// lands in. A text item too wide for its cell shows as its cell's overflow. Each offender as `<what> "<text>" scrollWidth >
// clientWidth`.
function overflowing(root: Element): string[] {
  return [root, ...Array.from(root.querySelectorAll('[role="group"], [role="group"] > *, div, p, h1, h2, h3, h4, h5, h6'))]
    .filter((el) => el.scrollWidth > el.clientWidth)
    .map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 60)}" ${el.scrollWidth} > ${el.clientWidth}`);
}

/** An action lies inside its Setting row. */
const ROW: ActionEntry = { selector: '[role="group"]', name: 'its row', probe: 'role="group"' };

test.skip(!HARNESS_BUILT, "the seeded Org page needs a harness build's main (pnpm e2e:settings)");

test('org page: a seeded org in its four groups, each photographed; nothing scrolls sideways and every action is whole', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-org-page-')));
  try {
    const local = readOrMintMachineRef(userData); // the machine the app will be, so the view can list it up
    const { status, view, grants, names } = seededOrg(local, userData, Date.now());
    const fixture = join(userData, 'org-page.json');
    writeFileSync(fixture, JSON.stringify({ status, view, grants, holdGrantSave: true, provisioningSecret: DESTINATION })); // a grant saved stays saving, for its photograph
    // Classic scrollbars, which take width from the view, as on any Mac with a mouse attached, whatever the desktop's own
    // setting (the hosted lane selects overlay ones for every group).
    const maws = await launchMaws({ userData, env: { [FIXTURE_ENV]: fixture }, appKitDefaults: { AppleShowScrollBars: 'Always' } });
    try {
      const { app, page } = maws;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the app's default
      // UX wave U7b (O-40): Settings is a modal dialog over the window, no longer the main pane's tab
      await menu(app, 'settings.open');
      const panel = settingsDialog(page);
      await expect(panel).toBeVisible();
      await panel.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: SECTIONS.org, exact: true }).click();
      const section = panel.getByRole('region', { name: SECTIONS.org });
      const body = panel.locator('[data-settings-body]');
      await expect.poll(() => body.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth), { message: "the settings body's scrollbar takes width (classic scrollbars)" }).toBeGreaterThan(0);
      const group = (id: (typeof GROUPS)[number]) => section.locator(`[data-org-group="${id}"]`);

      // Ready: every group under its heading, each member's row, the refusal's own row, this Mac's machine up, and the
      // long member's running pairing.
      for (const id of GROUPS) await expect(group(id).locator('h4')).toHaveText(ORG.groups[id]);
      for (const member of view.members) await expect(group('people').getByRole('group', { name: names.get(member.id)!, exact: true })).toBeVisible();
      await expect(group('you').getByRole('group', { name: ORG.refused, exact: true })).toBeVisible();
      await expect(group('machines').getByRole('group', { name: 'ana-mbp', exact: true })).toContainText(ORG.machineState.up);
      await expect(group('machines').getByRole('group', { name: 'studio-mini', exact: true })).toContainText(ORG.machineState.unknown);
      // M4b: the Machines group's actions and rights, read from each machine's grants
      const machineRow = (name: string) => group('machines').getByRole('group', { name, exact: true });
      await expect(machineRow('studio-mini')).toContainText(ORG.notYetOn('studio-mini'));
      await expect(machineRow('studio-mini')).toContainText(ORG.notNewer);
      await expect(machineRow('studio-mini').getByRole('button', { name: ORG.grant, exact: true })).toBeVisible();
      await expect(machineRow('lab-mini-02')).toContainText(ORG.missingGrants(2, 'lab-mini-02'));
      await expect(machineRow('render-farm-03.clinical-research-operations')).toContainText(ORG.noRightsYou);
      await expect(machineRow('ci-runner-7')).toContainText(ORG.certifiedOwners(view.delegations[0]!.id));
      await expect(machineRow('ana-mbp').getByRole('button', { name: ORG.drop, exact: true })).toHaveCount(0); // this Mac's own
      await expect(machineRow('old-render-01')).toContainText(ORG.hubRowLeft('old-render-01'));
      await expect(group('machines').getByRole('group', { name: ORG.enroll, exact: true })).toContainText('Enrolling gpu-box-02 until');

      const longRow = group('people').getByRole('group', { name: names.get(status.pairing!.member)!, exact: true });
      const show = longRow.getByRole('button', { name: ORG.pairingShow, exact: true });
      await expect(show).toBeVisible();

      // M4c: the Delegations section, a section of the Org group, its destination read
      const delegations = group('org').locator('[data-org-section="delegations"]');
      const delegationRow = (prefix: string) => delegations.getByRole('group', { name: prefix, exact: true });
      await expect(delegations.locator('h5')).toHaveText(ORG.delegations);
      await expect(delegationRow('ci-runner-')).toContainText(ORG.expiresIn(23.05 * DAY_MS));
      await expect(delegationRow('ci-runner-')).toContainText(ORG.certified('ci-runner-7 (live) and ci-runner-3 (retired)'));
      await expect(delegationRow('ci-runner-').getByRole('button', { name: ORG.renew, exact: true })).toBeVisible();
      await expect(delegationRow('render-farm.clinical-research-operations-')).toContainText('Renewed in the org state; the hub’s key still expires');
      await expect(delegationRow('render-farm.clinical-research-operations-').getByRole('button', { name: ORG.retry, exact: true })).toBeVisible();
      await expect(delegationRow('devcloud-vm-')).toContainText(ORG.unsentLine);
      await expect(delegationRow('devcloud-vm-').getByRole('button')).toHaveCount(0); // no slot holds it: nothing to act on
      await expect(delegationRow('old-render-')).toContainText(ORG.hubBehindRevoke);
      await expect(delegations.getByRole('group', { name: ORG.strayKeys, exact: true })).toContainText(ORG.justMinted);
      await expect(delegations.getByRole('group', { name: ORG.destination, exact: true }).getByRole('textbox', { name: ORG.destinationFields.account })).toHaveValue(DESTINATION.account);
      const create = delegations.getByRole('group', { name: ORG.newDelegation, exact: true }).getByRole('button', { name: ORG.createAction, exact: true });
      await expect(create).toBeEnabled();

      // A machine reads by its name wherever the page names one (Machines, Deliveries, Discarded), never by its ref.
      await expect(group('org').getByRole('group', { name: ORG.deliveries, exact: true })).toContainText('studio-mini');
      const text = (await section.textContent()) ?? '';
      expect(view.machines.filter((m) => text.includes(m.ref)).map((m) => `${m.name} (${m.ref})`), 'no machine shows by its raw ref').toEqual([]);

      await test.info().attach('org-page-window', { body: await page.screenshot(), contentType: 'image/png' });
      for (const id of GROUPS) await test.info().attach(`org-page-${id}`, { body: await group(id).screenshot(), contentType: 'image/png' });
      await test.info().attach('org-page-delegations', { body: await delegations.screenshot(), contentType: 'image/png' });

      expect(await section.evaluate(overflowing), 'nothing in the Org section is wider than its box').toEqual([]);
      expect(await section.getByRole('button').count(), 'the seeded page offers its actions').toBeGreaterThan(0);
      expect(await section.evaluate(actionsNotWhole, ROW), 'every action is drawn whole inside its row').toEqual([]);
      // ...and the check sees a clipped action when there is one
      await section.evaluate(addClippedProbes, ROW);
      const probed = await section.evaluate(actionsNotWhole, ROW);
      await section.evaluate((root) => root.querySelectorAll('[data-probe]').forEach((probe) => probe.remove()));
      expect(probeFaults(probed), `the check names every clipped probe and not the mirror: ${probed.join('; ')}`).toEqual([]);

      // Each sheet is read by its name: the Settings dialog under it is a dialog too (UX wave U7b). A sheet is a layer over
      // Settings, so Esc closes the sheet alone and Settings stays (Interfaces §H, row 2).
      const sheetNamed = (title: string) => page.getByRole('dialog', { name: title, exact: true });
      const closedToSettings = async (sheet: Locator) => {
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(panel).toBeVisible();
      };

      // The sheet taken up on the running pairing: the new device's fingerprint to compare, Approve and Cancel pairing.
      const pairing = view.members.find((m) => m.id === status.pairing!.member)!;
      await show.click();
      const pairSheet = sheetNamed(ORG.pairTitle(pairing.email, pairing.you));
      await expect(pairSheet.getByText(status.pairing!.entry!.fingerprint, { exact: true })).toBeVisible();
      await test.info().attach('org-page-pair-sheet', { body: await pairSheet.screenshot(), contentType: 'image/png' });
      expect(await pairSheet.evaluate(overflowing), 'nothing in the pairing sheet is wider than its box').toEqual([]);
      expect(await pairSheet.evaluate(actionsNotWhole, ROW), "every action is drawn whole inside the pairing sheet").toEqual([]);

      // M4b's sheets, each opened from its row, photographed and checked as the pairing sheet is, then closed
      const photographed = async (title: string, open: (sheet: Locator) => Promise<void>, ready: string, name: string) => {
        const sheet = sheetNamed(title);
        await open(sheet);
        await expect(sheet.getByText(ready, { exact: true })).toBeVisible();
        await test.info().attach(name, { body: await sheet.screenshot(), contentType: 'image/png' });
        expect(await sheet.evaluate(overflowing), `nothing in ${name} is wider than its box`).toEqual([]);
        expect(await sheet.evaluate(actionsNotWhole, ROW), `every action is drawn whole inside ${name}`).toEqual([]);
        await closedToSettings(sheet);
      };
      await closedToSettings(pairSheet);
      // the enrollment awaiting its key, taken up without its code
      await photographed(
        ORG.enrollTitle,
        () => group('machines').getByRole('group', { name: ORG.enroll, exact: true }).getByRole('button', { name: ORG.enrollShow, exact: true }).click(),
        ORG.enrollWaiting('gpu-box-02'),
        'org-page-enroll-sheet',
      );
      // a grant on studio-mini, Ben chosen: his rights as the machine holds them
      await photographed(
        ORG.grantTitle('studio-mini'),
        async (sheet) => {
          await machineRow('studio-mini').getByRole('button', { name: ORG.grant, exact: true }).click();
          await sheet.getByRole('combobox', { name: ORG.grantPerson }).selectOption({ label: `${names.get(view.members[3]!.id)!} (${view.members[3]!.email})` });
        },
        ORG.rightLines.shell,
        'org-page-grant-sheet',
      );
      // lab-mini-02's missing grants, each shown
      await photographed(
        ORG.regrantTitle('lab-mini-02'),
        () => machineRow('lab-mini-02').getByRole('button', { name: ORG.regrant, exact: true }).click(),
        ORG.regrantIntro('lab-mini-02'),
        'org-page-regrant-sheet',
      );
      // Ben's grant on studio-mini saved, machine-admin added: studio-mini brought up to date before Touch ID (held there)
      await photographed(
        ORG.grantTitle('studio-mini'),
        async (sheet) => {
          await machineRow('studio-mini').getByRole('button', { name: ORG.grant, exact: true }).click();
          await sheet.getByRole('combobox', { name: ORG.grantPerson }).selectOption({ label: `${names.get(view.members[3]!.id)!} (${view.members[3]!.email})` });
          await sheet.getByRole('checkbox', { name: /^machine-admin / }).check();
          await sheet.getByRole('button', { name: ORG.grantSave, exact: true }).click();
        },
        ORG.grantSaving('studio-mini'),
        'org-page-grant-saving',
      );
      // M4c: the create sheet, its fields filled, where its code goes said and the code never shown
      await photographed(
        ORG.createTitle,
        async (sheet) => {
          await create.click();
          await sheet.getByRole('textbox', { name: ORG.createFields.label, exact: true }).fill('devcloud VMs for the clinical research operations render farm');
          await sheet.getByRole('textbox', { name: ORG.createFields.prefix, exact: true }).fill('crops-render-');
          await sheet.getByRole('radiogroup', { name: ORG.createFields.uses, exact: true }).getByText(ORG.createUsesKinds.cap, { exact: true }).click();
          await sheet.getByRole('spinbutton', { name: ORG.createUseCap, exact: true }).fill('40');
          await expect(sheet.getByRole('button', { name: ORG.createConfirm, exact: true })).toBeEnabled();
        },
        ORG.createDestination(DESTINATION.project, DESTINATION.secret),
        'org-page-create-sheet',
      );
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
