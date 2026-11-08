import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, type GrantsView, type OrgStatus, type OrgView } from '@shared/ipc/schema/org';
import type { OrgSessionService } from './org-session';
import { installOrgPageFixture, ORG_PAGE_FIXTURE_ENV, type OrgPageFixtureInstall } from './page-fixture';
import { registerOrgHandlers } from './register';

const STATUS: OrgStatus = {
  state: 'registered',
  org: 'northwind',
  hub: 'https://desk.northwind.example',
  member: { id: 'a1', email: 'ana@northwind.example' },
  device: 'dev-ana-mac-0000000000',
  session: 'signed-in',
  hubAccess: 'connected',
  head: { version: 7, issued: '2026-10-28T09:00:00.000Z' },
  problem: null,
  refused: { code: 'keys', detail: 'keys.json is gone' },
  signer: null,
  pairing: null,
  enrolling: null,
  hubRowsLeft: [],
};
const VIEW: OrgView = {
  version: 7,
  issued: '2026-10-28T09:00:00.000Z',
  maySign: true,
  recoveryKid: 'recovery-kid',
  members: [{ id: 'a1', email: 'ana@northwind.example', name: 'Ana', role: 'admin', you: true, devices: [] }],
  machines: [],
  roots: [],
};

let scratch: string | null = null;
afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function fixtureFile(body: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'maws-org-page-fixture-'));
  const path = join(scratch, 'org-page.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

type Handler = (input: unknown) => unknown;
function deps(env: Record<string, string>, packaged = false, unpublish = () => {}): OrgPageFixtureInstall & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    env,
    packaged,
    intercept: (name, handler) => {
      handlers.set(name, handler as Handler);
      return () => void handlers.delete(name);
    },
    unpublish,
    handlers,
  };
}

describe("the Org page's e2e fixture in main", () => {
  it('installs only under MAWS_E2E=1, unpackaged, with an absolute fixture path', () => {
    const path = fixtureFile({ status: STATUS, view: VIEW });
    for (const [env, packaged] of [
      [{ [ORG_PAGE_FIXTURE_ENV]: path }, false],
      [{ MAWS_E2E: '1' }, false],
      [{ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: path }, true],
      [{ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: 'org-page.json' }, false],
    ] as const) {
      const d = deps(env, packaged);
      expect(installOrgPageFixture(d)).toBeNull();
      expect(d.handlers.size).toBe(0);
    }
  });

  it("answers org.status and org.view from the file and every act without effect, leaving org.rows, org.policy.get and org.channel.* to main's", async () => {
    const d = deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW }) });
    const stop = installOrgPageFixture(d);
    expect(stop).not.toBeNull();
    expect([...d.handlers.keys()].sort()).toEqual(Object.keys(commands).filter((name) => name !== 'org.rows' && name !== 'org.policy.get' && !name.startsWith('org.channel.')).sort()); // M7a: the channel stays main's; M6b: so does the policy read
    const ask = (name: string, input?: unknown) => Promise.resolve(d.handlers.get(name)!(input));
    expect(await ask('org.status')).toEqual(STATUS);
    expect(await ask('org.view')).toEqual(VIEW);
    expect(await ask('org.register', { code: 'x' })).toMatchObject({ ok: false, reason: { code: 'busy' } });
    expect(await ask('org.change', { change: { kind: 'member.remove', member: 'a1' }, digest: 'd' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.preview', { change: { kind: 'member.remove', member: 'a1' } })).toMatchObject({ ok: false, findings: [] });
    expect(await ask('org.pair.start', { member: 'a1', class: 'native-mac' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.pair.approve', { generation: 1, digest: 'd' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.discardPending', { confirmed: true, hash: 'h' })).toEqual({ ok: false, reason: 'none' });
    expect(await ask('org.pair.cancel')).toBeUndefined();
    expect(await ask('org.enroll.start', { name: 'box' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.enroll.approve', { generation: 1, digest: 'd' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.enroll.cancel')).toBeUndefined();
    expect(await ask('org.drop.retry', { name: 'box' })).toMatchObject({ ok: false, reason: 'none' });
    expect(await ask('org.grants.view', { ref: 'mref-box-00000001' })).toEqual({ ok: false, ref: 'mref-box-00000001', reason: 'signed-out' });
    expect(await ask('org.grants.set', { ref: 'mref-box-00000001', member: 'a1', rights: ['spawn'] })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.grants.regrant', { ref: 'mref-box-00000001', digest: 'd' })).toMatchObject({ ok: false, reason: 'busy' });
    expect(await ask('org.policy.set', { address: 'm/s', access: 'public', policyRev: 1 })).toEqual({ ok: false, reason: 'busy' });
    expect(await ask('org.owners.add', { address: 'm/s', member: 'a1' })).toEqual({ ok: false, reason: 'busy' });
    stop!();
    expect(d.handlers.size).toBe(0);
  });

  it("stops the production session's org.changed, so a status it publishes late never replaces the seeded one", () => {
    // main's composition: the production session's handlers and its status forwarding, then the fixture over them
    let publish: (status: OrgStatus) => void = () => {};
    const service = {
      onStatus(listener: (status: OrgStatus) => void) {
        publish = listener;
        return () => void (publish = () => {});
      },
      onChannel: () => () => {},
      onGrants: () => () => {},
    } as unknown as OrgSessionService;
    const emitted: OrgStatus[] = [];
    const unpublish = registerOrgHandlers({ register: () => {}, emit: (_name, status) => void emitted.push(status), emitChannel: () => {}, emitGrants: () => {}, service, development: null });
    publish({ state: 'none' });
    expect(emitted).toEqual([{ state: 'none' }]); // forwarded before the fixture

    const stop = installOrgPageFixture(deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW }) }, false, unpublish));
    expect(stop).not.toBeNull();
    publish({ state: 'none' }); // load()'s completion (`changed(true)`), landing after the page read the seeded status
    expect(emitted).toEqual([{ state: 'none' }]);
  });

  it("M4b: answers org.grants.view from the file's grants by machine, and signed out for a machine it doesn't name", async () => {
    const shown: GrantsView = { ok: true, ref: 'mref-box-00000001', live: false, asOf: '2026-10-28T08:00:00.000Z', grants: [{ member: 'a1', rights: ['spawn'], version: 2, state: 'pending' }], missing: [], digest: null };
    const d = deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW, grants: { 'mref-box-00000001': shown } }) });
    expect(installOrgPageFixture(d)).not.toBeNull();
    const ask = (input: unknown) => Promise.resolve(d.handlers.get('org.grants.view')!(input));
    expect(await ask({ ref: 'mref-box-00000001' })).toEqual(shown);
    expect(await ask({ ref: 'mref-other-0000002' })).toEqual({ ok: false, ref: 'mref-other-0000002', reason: 'signed-out' });
    expect(() => installOrgPageFixture(deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW, grants: { 'mref-box-00000001': { ...shown, code: 'never' } } }) }))).toThrow(
      /is not an Org page fixture/,
    );
  });

  it('M4b: holds org.grants.set unanswered when the file asks (`holdGrantSave`), so the grant sheet can be photographed saving', async () => {
    const d = deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW, holdGrantSave: true }) });
    expect(installOrgPageFixture(d)).not.toBeNull();
    const set = Promise.resolve(d.handlers.get('org.grants.set')!({ ref: 'mref-box-00000001', member: 'a1', rights: ['spawn'] }));
    expect(await Promise.race([set, new Promise((resolve) => setTimeout(() => resolve('unanswered'), 20))])).toBe('unanswered');
    expect(await Promise.resolve(d.handlers.get('org.grants.regrant')!({ ref: 'mref-box-00000001', digest: 'd' }))).toMatchObject({ ok: false, reason: 'busy' });
  });

  it('leaves the forwarding alone when it does not install', () => {
    let unpublished = false;
    expect(installOrgPageFixture(deps({ MAWS_E2E: '1' }, false, () => void (unpublished = true)))).toBeNull();
    expect(unpublished).toBe(false);
  });

  it('refuses a file the schemas reject, naming its path', () => {
    const path = fixtureFile({ status: { ...STATUS, token: 'never' }, view: VIEW });
    expect(() => installOrgPageFixture(deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: path }))).toThrow(path);
  });

  // The unit gate builds main without the harness (`pnpm build:main-preload`) before this suite: that main must carry
  // none of the fixture, which only a harness build's main may (index.ts's guard, electron.vite.config.ts's define).
  const OUT = resolve(__dirname, '../../../out');
  const plainMain = existsSync(join(OUT, 'main/index.js')) && !existsSync(join(OUT, 'renderer/harness.html'));
  it.skipIf(!plainMain)('is absent from a build of main without the harness', () => {
    const chunks = readdirSync(join(OUT, 'main'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'));
    expect(chunks.filter((name) => readFileSync(join(OUT, 'main', name), 'utf8').includes(ORG_PAGE_FIXTURE_ENV))).toEqual([]);
  });
});
