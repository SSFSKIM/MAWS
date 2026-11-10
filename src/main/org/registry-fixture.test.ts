import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgProjects, OrgRows, OrgStatus, OrgView } from '@shared/ipc/schema/org';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import type { MachineStandIn } from '../lane-b/remote';
import { installRegistryFixture, REGISTRY_FIXTURE_ENV, type RegistryFixtureInstall } from './registry-fixture';

// The project registry's e2e fixture in main (docs/doperpowers/plans/2026-11-10-project-registry.md, M11): inert unless
// asked for, and then the seeded org, the registry, the other machines' project acts and the held removals' cancel.
const LOCAL = 'LocalMacRef00000000000' as MachineRef;
const STUDIO = 'StudioMiniRef000000000' as MachineRef;
const SCRAPE = '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f';
const STATUS: OrgStatus = {
  state: 'registered',
  org: 'northwind',
  hub: 'https://desk.northwind.example',
  member: { id: 'a1', email: 'ana@northwind.example' },
  device: 'dev-ana-mac-0000000000',
  session: 'signed-in',
  hubAccess: 'connected',
  head: { version: 7, issued: '2026-11-10T09:00:00.000Z' },
  problem: null,
  signer: null,
  pairing: null,
  enrolling: null,
  hubRowsLeft: [],
  delegations: { creating: false, rev: 0 },
};
const VIEW: OrgView = { version: 7, issued: '2026-11-10T09:00:00.000Z', maySign: false, recoveryKid: 'k', members: [{ id: 'a1', email: 'ana@northwind.example', name: 'Ana', role: 'admin', you: true, devices: [] }], machines: [], roots: [], delegations: [], strayKeys: [], hubKeys: { at: null, failed: false } };
const ROWS: OrgRows = { machines: [STUDIO], rows: [], complete: true, pending: [], members: [], member: 'a1' };
const MACHINES: MachineState[] = [
  { ref: LOCAL, name: 'ana-mbp', local: true, state: 'up', since: '2026-11-10T09:00:00.000Z', generation: 0 },
  { ref: STUDIO, name: 'studio-mini', local: false, state: 'up', since: '2026-11-10T09:00:00.000Z', generation: 1, carrier: 'direct', capabilities: ['rl2.project-acts'] },
];
const PROJECTS: OrgProjects = {
  projects: [{ id: SCRAPE, name: 'scrape', hub: true, renamable: true, locations: [{ machine: STUDIO, pid: 'p-scrape', path: '/srv/scrape', key: `folder:${STUDIO}:p-scrape` as OrgKey, name: 'scrape', source: 'folder', state: 'replaced', acts: true }] }],
  keys: { [SCRAPE]: `id:${SCRAPE}` as OrgKey },
  moved: {},
  removals: [{ id: 'held-1', project: SCRAPE, machine: STUDIO, pid: 'p-old', path: '/srv/old', askedAt: '2026-11-10T09:30:00.000Z' }],
  seen: {},
};

let scratch: string | null = null;
afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});
const dir = () => (scratch ??= mkdtempSync(join(tmpdir(), 'maws-registry-fixture-')));
const logPath = () => join(dir(), 'acts.log');
function fixtureFile(body: unknown): string {
  const path = join(dir(), 'registry.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}
const FILE = () => ({ status: STATUS, view: VIEW, rows: ROWS, machines: MACHINES, projects: PROJECTS, log: logPath() });
const logged = () => (existsSync(logPath()) ? readFileSync(logPath(), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown) : []);

type Handler = (input: unknown) => unknown;
function deps(env: Record<string, string>, packaged = false) {
  const handlers = new Map<string, Handler>();
  const held: string[] = [];
  const said: OrgProjects[] = [];
  const taps = new Set<(payload: OrgProjects) => void>();
  let standIn: MachineStandIn | null = null;
  // main's emit: to the windows (`said`), then its taps, as src/main/ipc/events.ts's
  const emit = (_name: 'org.projects.changed', payload: OrgProjects) => {
    said.push(payload);
    for (const tap of [...taps]) tap(payload);
  };
  const d: RegistryFixtureInstall = {
    env,
    packaged,
    intercept: (name, handler) => {
      handlers.set(name, handler as Handler);
      return () => void handlers.delete(name);
    },
    standIn: (s) => {
      standIn = s;
      return () => void (standIn = null);
    },
    emit,
    onEmitted: (_name, listener) => {
      taps.add(listener);
      return () => void taps.delete(listener);
    },
    unpublish: () => void held.push('org.changed'),
    holdRows: () => void held.push('org.rows.changed'),
  };
  return { d, handlers, held, said, emit, taps, standIn: () => standIn };
}

describe("the project registry's e2e fixture in main", () => {
  it('installs nothing unless MAWS_E2E=1, the app unpackaged and MAWS_E2E_REGISTRY an absolute path', () => {
    const path = fixtureFile(FILE());
    for (const [env, packaged] of [
      [{ MAWS_E2E: '1' }, false], // the env unset
      [{ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: path }, true], // packaged
      [{ [REGISTRY_FIXTURE_ENV]: path }, false],
      [{ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: 'registry.json' }, false],
    ] as const) {
      const f = deps(env, packaged);
      expect(installRegistryFixture(f.d)).toBeNull();
      expect(f.handlers.size).toBe(0);
      expect(f.held).toEqual([]);
      expect(f.taps.size).toBe(0);
      expect(f.standIn()).toBeNull();
    }
  });

  it('answers the org’s reads and the registry from the file, and holds the production events', async () => {
    const f = deps({ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: fixtureFile(FILE()) });
    const stop = installRegistryFixture(f.d);
    expect(f.held).toEqual(['org.changed', 'org.rows.changed']);
    expect([...f.handlers.keys()].sort()).toEqual(['machines.list', 'org.projects', 'org.removals.cancel', 'org.rows', 'org.status', 'org.view']);
    const ask = (name: string, input?: unknown) => Promise.resolve(f.handlers.get(name)!(input));
    expect(await ask('org.status')).toEqual(STATUS);
    expect(await ask('org.view')).toEqual(VIEW);
    expect(await ask('org.rows')).toEqual(ROWS);
    expect(await ask('machines.list')).toEqual({ machines: MACHINES });
    expect(await ask('org.projects')).toEqual(PROJECTS);
    // the production registry's word is followed by the seeded value, which is not heard as another
    f.emit('org.projects.changed', { projects: [], keys: {}, moved: {}, removals: [], seen: {} });
    expect(f.said.map((p) => p.projects.length)).toEqual([0, 1]);
    stop!();
    expect(f.handlers.size).toBe(0);
    expect(f.taps.size).toBe(0);
    expect(f.standIn()).toBeNull();
  });

  it('stands in for the other machines’ resolve and addFolder, logging each, and leaves every other command to the link', () => {
    const f = deps({ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: fixtureFile(FILE()) });
    installRegistryFixture(f.d);
    const standIn = f.standIn()!;
    expect(standIn(STUDIO, 'session.projects.resolve', { directory: '/srv/next' })).toEqual({
      ok: true,
      value: { project: null, by: 'machine', at: null, label: { key: `folder:${STUDIO}:/srv/next`, name: 'next', source: 'folder', smnsId: null } },
    });
    expect(standIn(STUDIO, 'session.projects.addFolder', { directory: '/srv/next', into: SCRAPE })).toMatchObject({ ok: true, value: { project: { directory: '/srv/next' }, location: { kind: 'directory', path: '/srv/next' } } });
    expect(standIn(STUDIO, 'git.worktree.list', { directory: '/srv/next' })).toBeUndefined();
    expect(standIn(STUDIO, 'machines.list', undefined)).toBeUndefined(); // a command with no input, left to the link
    expect(standIn(LOCAL, 'session.projects.addFolder', { directory: '/srv/next' })).toBeUndefined(); // this Mac is not stood in for
    expect(logged()).toEqual([
      { name: 'session.projects.resolve', machine: STUDIO, input: { directory: '/srv/next' } },
      { name: 'session.projects.addFolder', machine: STUDIO, input: { directory: '/srv/next', into: SCRAPE } },
    ]);
  });

  it('cancels a held removal: logged, dropped, and the value left said', async () => {
    const f = deps({ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: fixtureFile(FILE()) });
    installRegistryFixture(f.d);
    await f.handlers.get('org.removals.cancel')!({ id: 'held-1' });
    expect(logged()).toEqual([{ name: 'org.removals.cancel', input: { id: 'held-1' } }]);
    expect(f.said.map((p) => p.removals)).toEqual([[]]);
    expect(((await f.handlers.get('org.projects')!(undefined)) as OrgProjects).removals).toEqual([]);
  });

  it('refuses a file the schemas reject, naming its path', () => {
    const path = fixtureFile({ ...FILE(), projects: { ...PROJECTS, extra: true } });
    expect(() => installRegistryFixture(deps({ MAWS_E2E: '1', [REGISTRY_FIXTURE_ENV]: path }).d)).toThrow(path);
  });

  // As the other org fixtures: a build of main without the harness carries none of it (app.ts's guard).
  const OUT = resolve(__dirname, '../../../out');
  const plainMain = existsSync(join(OUT, 'main/index.js')) && !existsSync(join(OUT, 'renderer/harness.html'));
  it.skipIf(!plainMain)('is absent from a build of main without the harness', () => {
    const chunks = readdirSync(join(OUT, 'main'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'));
    expect(chunks.filter((name) => readFileSync(join(OUT, 'main', name), 'utf8').includes(REGISTRY_FIXTURE_ENV))).toEqual([]);
  });
});
