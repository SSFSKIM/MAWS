// The Org page's look through the gate (P5 O8 M4a Task 8, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Decision Log "M4a gains Task 8"). Settings › Org over a seeded org with real-world variety: a member whose name and
// email are long enough to wrap (two members reading "Maximiliana" widen to their local parts, as `memberNames` does), a
// member with several devices, roots among them, a pairing this Mac runs for that long member's first device (its row's
// line, and the sheet taken up on it showing the device's fingerprint), and a refusal that names no attempt (the key file
// refused at load: its own "Refused" row). The Machines group shows this machine up (the renderer's `useMachines`) and
// two others not connected. Each of the four groups, the window and the pairing sheet are attached as PNGs for the
// architect's look; the case asserts structure only: nothing in the section scrolls sideways, and every action is drawn
// whole inside its row.
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
import type { OrgStatus, OrgView } from '../src/shared/ipc/schema/org';
import { readOrMintMachineRef } from '../src/shared/machine/identity-file';
import { memberNames } from '../src/shared/org/member-name';
import { ORG, SECTIONS } from '../src/renderer/src/settings-tab/copy';
import { launchMaws, REPO_ROOT } from './support/launch';

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

/** The org: what main's session and view would send for it, `now` the clock the ages and the pairing's end read. */
function seededOrg(local: string, userData: string, now: number): { status: Registered; view: OrgView; names: Map<string, string> } {
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
  const view: OrgView = {
    version: 41,
    issued,
    maySign: true,
    recoveryKid: kid(),
    members: [member(ana, [thisMac, anaWeb]), member(long, []), member(ortiz, ortizDevices), member(ben, [benMac]), member(chen, [])],
    machines: [
      { name: 'ana-mbp', ref: local, owners: [ana.id] },
      { name: 'studio-mini', ref: studio, owners: 'org' },
      { name: 'render-farm-03.clinical-research-operations', ref: farm, owners: [long.id, ortiz.id, memberId()] }, // the last a former member
    ],
    roots: [
      { kid: kid(), member: ana.id, device: thisMac.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[0]!.id },
      { kid: kid(), member: ortiz.id, device: ortizDevices[1]!.id },
      { kid: kid(), unlisted: true },
    ],
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
      owing: [{ version: view.version, machines: [studio], tooLarge: [] }],
      abandoned: [],
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
  };
  return { status, view, names };
}

// What is wider than its box in the section: the section, each row and its cells (a label past its column overlaps the
// value without widening the row), each device line. Each offender as `<what> "<text>" scrollWidth > clientWidth`.
async function overflowing(section: Locator): Promise<string[]> {
  return section.evaluate((root) => {
    const rows = Array.from(root.querySelectorAll('[role="group"]'));
    const checked = [root, ...rows, ...rows.flatMap((row) => Array.from(row.children)), ...Array.from(root.querySelectorAll('[data-org-device]'))];
    return checked
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 60)}" ${el.scrollWidth} > ${el.clientWidth}`);
  });
}

// Every action in the section drawn whole inside its row (the Setting row, or the section for a line of its own).
async function clippedActions(section: Locator): Promise<string[]> {
  return section.evaluate((root) =>
    Array.from(root.querySelectorAll('button')).flatMap((button) => {
      const box = button.getBoundingClientRect();
      const row = (button.closest('[role="group"]') ?? root).getBoundingClientRect();
      const whole = box.width > 0 && box.height > 0 && box.left >= row.left - 0.5 && box.right <= row.right + 0.5 && getComputedStyle(button).visibility === 'visible';
      return whole ? [] : [`"${button.textContent}" at ${Math.round(box.left)}..${Math.round(box.right)} in ${Math.round(row.left)}..${Math.round(row.right)}`];
    }),
  );
}

test.skip(!HARNESS_BUILT, "the seeded Org page needs a harness build's main (pnpm e2e:settings)");

test('org page: a seeded org in its four groups, each photographed; nothing scrolls sideways and every action is whole', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-org-page-')));
  try {
    const local = readOrMintMachineRef(userData); // the machine the app will be, so the view can list it up
    const { status, view, names } = seededOrg(local, userData, Date.now());
    const fixture = join(userData, 'org-page.json');
    writeFileSync(fixture, JSON.stringify({ status, view }));
    const maws = await launchMaws({ userData, env: { [FIXTURE_ENV]: fixture } });
    try {
      const { app, page } = maws;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the app's default
      await menu(app, 'settings.open');
      const panel = page.locator('[data-region="main"]').getByRole('tabpanel');
      await panel.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: SECTIONS.org, exact: true }).click();
      const section = panel.getByRole('region', { name: SECTIONS.org });
      const group = (id: (typeof GROUPS)[number]) => section.locator(`[data-org-group="${id}"]`);

      // Ready: every group under its heading, each member's row, the refusal's own row, this Mac's machine up, and the
      // long member's running pairing.
      for (const id of GROUPS) await expect(group(id).locator('h4')).toHaveText(ORG.groups[id]);
      for (const member of view.members) await expect(group('people').getByRole('group', { name: names.get(member.id)!, exact: true })).toBeVisible();
      await expect(group('you').getByRole('group', { name: ORG.refused, exact: true })).toBeVisible();
      await expect(group('machines').getByRole('group', { name: 'ana-mbp', exact: true })).toContainText(ORG.machineState.up);
      await expect(group('machines').getByRole('group', { name: 'studio-mini', exact: true })).toContainText(ORG.machineState.unknown);
      const longRow = group('people').getByRole('group', { name: names.get(status.pairing!.member)!, exact: true });
      const show = longRow.getByRole('button', { name: ORG.pairingShow, exact: true });
      await expect(show).toBeVisible();

      await test.info().attach('org-page-window', { body: await page.screenshot(), contentType: 'image/png' });
      for (const id of GROUPS) await test.info().attach(`org-page-${id}`, { body: await group(id).screenshot(), contentType: 'image/png' });

      expect(await overflowing(section), 'nothing in the Org section scrolls sideways').toEqual([]);
      expect(await clippedActions(section), 'every action is drawn whole inside its row').toEqual([]);
      const buttons = section.getByRole('button');
      expect(await buttons.count(), 'the seeded page offers its actions').toBeGreaterThan(0);
      for (const button of await buttons.all()) await expect(button).toBeVisible();

      // The sheet taken up on the running pairing: the new device's fingerprint to compare, Approve and Cancel pairing.
      await show.click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText(status.pairing!.entry!.fingerprint, { exact: true })).toBeVisible();
      for (const button of await sheet.getByRole('button').all()) await expect(button).toBeVisible();
      await test.info().attach('org-page-pair-sheet', { body: await sheet.screenshot(), contentType: 'image/png' });
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
