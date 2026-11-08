import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgPolicy, OrgPolicySetResult, OrgRows, OrgStatus, OrgView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { installShareFixture, SHARE_FIXTURE_ENV, type ShareFixtureInstall } from './share-fixture';

const LOCAL = 'LocalMacRef00000000000' as MachineRef;
const STUDIO = 'StudioMiniRef000000000' as MachineRef;
const FARM = 'RenderFarmRef000000000' as MachineRef;
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
  signer: null,
  pairing: null,
};
const VIEW: OrgView = { version: 7, issued: '2026-10-28T09:00:00.000Z', maySign: false, recoveryKid: 'k', members: [{ id: 'a1', email: 'ana@northwind.example', name: 'Ana', role: 'admin', you: true, devices: [] }], machines: [], roots: [] };
const ROWS: OrgRows = { machines: [STUDIO], rows: [], complete: true, pending: [], members: [], member: 'a1' };
const MACHINES: MachineState[] = [{ ref: LOCAL, name: 'ana-mbp', local: true, state: 'up', since: '2026-10-28T09:00:00.000Z', generation: 0 }];
const STUDIO_READ: OrgPolicy = { ok: true, machine: STUDIO, supported: true, policies: [{ session: 's1', access: 'private', shares: [], policyRev: 3 }, { session: 's2', unavailable: true }] };
const FARM_READ: OrgPolicy = { ok: true, machine: FARM, supported: false };
const SAVE: OrgPolicySetResult = { ok: true, results: [{ line: { kind: 'access', access: 'listed' }, state: 'unknown', reason: 'malformed' }], policy: null };
const FILE = { status: STATUS, view: VIEW, rows: ROWS, machines: MACHINES, policies: [STUDIO_READ, FARM_READ], saves: { [`${STUDIO}/s1`]: SAVE } };

let scratch: string | null = null;
afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function fixtureFile(body: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'maws-share-fixture-'));
  const path = join(scratch, 'share.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

type Handler = (input: unknown) => unknown;
function deps(env: Record<string, string>, packaged = false): ShareFixtureInstall & { handlers: Map<string, Handler>; held: string[] } {
  const handlers = new Map<string, Handler>();
  const held: string[] = [];
  return {
    env,
    packaged,
    intercept: (name, handler) => {
      handlers.set(name, handler as Handler);
      return () => void handlers.delete(name);
    },
    unpublish: () => void held.push('org.changed'),
    holdRows: () => void held.push('org.rows.changed'),
    handlers,
    held,
  };
}

describe("the Share sheet's e2e fixture in main", () => {
  it('installs only under MAWS_E2E=1, unpackaged, with an absolute fixture path', () => {
    const path = fixtureFile(FILE);
    for (const [env, packaged] of [
      [{ [SHARE_FIXTURE_ENV]: path }, false],
      [{ MAWS_E2E: '1' }, false],
      [{ MAWS_E2E: '1', [SHARE_FIXTURE_ENV]: path }, true],
      [{ MAWS_E2E: '1', [SHARE_FIXTURE_ENV]: 'share.json' }, false],
    ] as const) {
      const d = deps(env, packaged);
      expect(installShareFixture(d)).toBeNull();
      expect(d.handlers.size).toBe(0);
      expect(d.held).toEqual([]);
    }
  });

  it("answers the org's reads, a machine's policies whole or cut to a session, each save as the file holds it, and holds the production events", async () => {
    const d = deps({ MAWS_E2E: '1', [SHARE_FIXTURE_ENV]: fixtureFile(FILE) });
    const stop = installShareFixture(d);
    expect(d.held).toEqual(['org.changed', 'org.rows.changed']);
    expect([...d.handlers.keys()].sort()).toEqual(['machines.list', 'org.owners.add', 'org.policy.get', 'org.policy.set', 'org.rows', 'org.status', 'org.view']);
    const ask = (name: string, input?: unknown) => Promise.resolve(d.handlers.get(name)!(input));
    expect(await ask('org.status')).toEqual(STATUS);
    expect(await ask('org.view')).toEqual(VIEW);
    expect(await ask('org.rows')).toEqual(ROWS);
    expect(await ask('machines.list')).toEqual({ machines: MACHINES });
    expect(await ask('org.policy.get', { machine: STUDIO })).toEqual(STUDIO_READ);
    expect(await ask('org.policy.get', { address: `${STUDIO}/s2` })).toEqual({ ...STUDIO_READ, policies: [{ session: 's2', unavailable: true }] });
    expect(await ask('org.policy.get', { address: `${FARM}/s5` })).toEqual(FARM_READ);
    expect(await ask('org.policy.get', { machine: LOCAL })).toEqual({ ok: false, machine: LOCAL, reason: 'offline' });
    expect(await ask('org.policy.set', { address: `${STUDIO}/s1`, access: 'listed', policyRev: 3 })).toEqual(SAVE);
    expect(await ask('org.owners.add', { address: `${STUDIO}/s2`, member: 'b1' })).toEqual({ ok: false, reason: 'busy' });
    stop!();
    expect(d.handlers.size).toBe(0);
  });

  it('refuses a file the schemas reject, naming its path', () => {
    const path = fixtureFile({ ...FILE, policies: [{ ...STUDIO_READ, token: 'never' }] });
    expect(() => installShareFixture(deps({ MAWS_E2E: '1', [SHARE_FIXTURE_ENV]: path }))).toThrow(path);
  });

  // As the other org fixtures: a build of main without the harness carries none of it (app.ts's guard).
  const OUT = resolve(__dirname, '../../../out');
  const plainMain = existsSync(join(OUT, 'main/index.js')) && !existsSync(join(OUT, 'renderer/harness.html'));
  it.skipIf(!plainMain)('is absent from a build of main without the harness', () => {
    const chunks = readdirSync(join(OUT, 'main'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'));
    expect(chunks.filter((name) => readFileSync(join(OUT, 'main', name), 'utf8').includes(SHARE_FIXTURE_ENV))).toEqual([]);
  });
});
