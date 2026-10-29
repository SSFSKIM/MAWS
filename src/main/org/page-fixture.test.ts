import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, type OrgStatus, type OrgView } from '@shared/ipc/schema/org';
import { installOrgPageFixture, ORG_PAGE_FIXTURE_ENV, type OrgPageFixtureInstall } from './page-fixture';

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
function deps(env: Record<string, string>, packaged = false): OrgPageFixtureInstall & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    env,
    packaged,
    intercept: (name, handler) => {
      handlers.set(name, handler as Handler);
      return () => void handlers.delete(name);
    },
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

  it("answers org.status and org.view from the file and every act without effect, leaving org.rows to main's rows", async () => {
    const d = deps({ MAWS_E2E: '1', [ORG_PAGE_FIXTURE_ENV]: fixtureFile({ status: STATUS, view: VIEW }) });
    const stop = installOrgPageFixture(d);
    expect(stop).not.toBeNull();
    expect([...d.handlers.keys()].sort()).toEqual(Object.keys(commands).filter((name) => name !== 'org.rows').sort());
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
    stop!();
    expect(d.handlers.size).toBe(0);
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
