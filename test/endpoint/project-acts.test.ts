// The project registry's acts over the network (docs/doperpowers/plans/2026-11-10-project-registry.md, M9's offers;
// Interfaces §G; design §3), through the real gate and a real index behind the machine's services: `addFolder`'s `into`
// and `own`, `link`, `relocate`, `update` and `remove` are `machine-admin` acts of the machine's owners alone, the first
// three always stepped up and the last two never; `resolve` is an owners' read. `relocate` and `resolve` name a
// directory, held to the setup policy before anything reads in it; a remote `addFolder` keeps its checked path and its
// `into`. An `into` the verified records do not name is the machine's own refusal, `unknown-project`. The endpoint's
// `h2` lists `rl2.project-acts`.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from 'org-protocol';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS } from '../../src/endpoint/offers';
import { stepUpRequired } from '../../src/endpoint/step-up';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import type { SetupGuard } from '../../src/services/machine/setup';
import { act, done, makeOrg, openRemote, ORG, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];
const indexes: Index[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const index of indexes.splice(0)) index.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const tempDir = (prefix: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** The machine with a fake macOS home and a real index answering the project commands, its sminos reading locations. */
async function setup(): Promise<{ f: Fixture; home: string; index: Index; a: Remote; b: Remote }> {
  const home = tempDir('project-acts-home-');
  for (const dir of ['work/scrape', 'work/moved', 'work/other']) mkdirSync(join(home, dir), { recursive: true });
  const f = await startEndpoint(org, started, { setup: { home, platform: 'darwin' } });
  const index = new Index(join(tempDir('project-acts-index-'), 'index.sqlite'), { registry: f.endpoint.registry });
  indexes.push(index);
  const guard: SetupGuard = { where: { home, platform: 'darwin' } };
  registerIndexHandlers(index, f.spine.bus as never, guard);
  await sminos(f, [], ['audience', 'record', 'locations']);
  await index.refreshOrgProjects({ machine: f.services.machine.ref, enrollment: () => ({ org: ORG, machine: 'mini' }), home });
  return { f, home, index, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

const action = (f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Action => r.device.action({ machine: f.ref, action: name, args });
const stepped = (f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Promise<Action> => r.device.stepUp(action(f, r, name, args));
async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
/** An admitted act's outcome. */
async function admitted(r: Remote, a: Action): Promise<{ state: string; result?: unknown; reason?: string; error?: { message?: string } }> {
  const from = r.inbox.length;
  expect([a.action, await act(r, a)]).toEqual([a.action, 'ok']);
  return (await done(r, a, from)) as never;
}
const claimed = (f: Fixture, name: string) => f.spine.claimed.filter((c) => c.name === name);

describe('the project acts over the network', () => {
  it('are offered as M9 has them, and the endpoint lists `rl2.project-acts`', () => {
    for (const name of ['session.projects.addFolder', 'session.projects.link', 'session.projects.relocate', 'session.projects.update', 'session.projects.remove']) {
      expect([name, { ...OFFERS.commands[name], accepts: undefined }]).toEqual([name, { kind: 'act', executor: 'machine', target: 'machine', grade: 'machine-admin', owners: true, accepts: undefined }]);
    }
    expect(OFFERS.commands['session.projects.resolve']).toEqual({ kind: 'call', executor: 'machine', target: 'machine', grade: 'list', owners: true });
    expect(ENDPOINT_CAPABILITIES).toContain(PROJECT_ACTS_CAPABILITY);
    const owner = { grade: 'machine-admin' as const, ownsSession: false, ownsMachine: true };
    expect(['addFolder', 'link', 'relocate', 'update', 'remove'].map((verb) => [verb, stepUpRequired({ name: `session.projects.${verb}`, ...owner })])).toEqual([
      ['addFolder', true],
      ['link', true],
      ['relocate', true],
      ['update', false],
      ['remove', false],
    ]);
  });

  it('refuse a member each act and the read, `owners-only`, unrun; refuse an owner’s addFolder {into}, link and relocate without a step-up', async () => {
    const { f, home, a, b } = await setup();
    const folder = join(home, 'work/scrape');
    const added = await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: folder }));
    const pid = (added.result as { project: { id: string } }).project.id;
    const acts: Array<[string, Record<string, unknown>]> = [
      ['session.projects.addFolder', { directory: join(home, 'work/other'), into: 'id-x' }],
      ['session.projects.link', { id: pid, into: null }],
      ['session.projects.relocate', { id: pid, directory: folder }],
      ['session.projects.update', { id: pid, patch: { name: 'renamed' } }],
      ['session.projects.remove', { id: pid }],
    ];
    const before = f.spine.claimed.length;
    for (const [name, args] of acts) expect([name, await act(b, await stepped(f, b, name, args))]).toEqual([name, 'owners-only']);
    expect(code(await call(b, 'session.projects.resolve', { directory: folder }))).toBe('owners-only');
    for (const [name, args] of acts.slice(0, 3)) expect([name, await act(a, action(f, a, name, args))]).toEqual([name, 'step-up']);
    expect(f.spine.claimed.length).toBe(before);
  });

  it('admit an owner’s update and remove with no step-up; a rename takes a name alone', async () => {
    const { f, home, a, index } = await setup();
    const folder = join(home, 'work/scrape');
    const pid = ((await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: folder }))).result as { project: { id: string } }).project.id;
    expect(await act(a, action(f, a, 'session.projects.update', { id: pid, patch: { name: 'Scrape', order: 3 } }))).toBe('malformed');
    expect(await admitted(a, action(f, a, 'session.projects.update', { id: pid, patch: { name: 'Scrape' } }))).toMatchObject({ state: 'done', result: { name: 'Scrape' } });
    expect(await admitted(a, action(f, a, 'session.projects.remove', { id: pid }))).toMatchObject({ state: 'done' });
    expect(index.projects.list({ includeHidden: true }).find((p) => p.id === pid)?.hidden).toBe(true);
  });

  it('run relocate on its checked path with its row, refuse one outside the home unrun, and answer resolve on its checked path', async () => {
    const { f, home, a } = await setup();
    const pid = ((await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: join(home, 'work/scrape') }))).result as { project: { id: string } }).project.id;
    const moved = join(home, 'work/moved');
    expect(await admitted(a, await stepped(f, a, 'session.projects.relocate', { id: pid, directory: `${home}/work/../work/moved` }))).toMatchObject({ state: 'done', result: { project: { id: pid, directory: moved }, merged: false } });
    expect(claimed(f, 'session.projects.relocate').map((c) => c.input)).toEqual([{ id: pid, directory: moved, opened: [] }]);
    const outside = tempDir('project-acts-outside-');
    expect(await act(a, await stepped(f, a, 'session.projects.relocate', { id: pid, directory: outside }))).toBe('outside-home');
    expect(claimed(f, 'session.projects.relocate')).toHaveLength(1);
    const resolved = await call(a, 'session.projects.resolve', { directory: `${home}/work/../work/moved` });
    expect(resolved).toMatchObject({ ok: true, output: { by: 'minted', at: moved } });
  });

  it('carry addFolder’s `into` to the machine, which refuses an id no verified record names `unknown-project`', async () => {
    const { f, home, a } = await setup();
    await until(() => f.endpoint.registry.statements().possible, 'statements possible');
    const folder = join(home, 'work/other');
    const outcome = await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: `${home}/work/../work/other`, into: 'id-nobody-has' }));
    expect(claimed(f, 'session.projects.addFolder').at(-1)?.input).toMatchObject({ directory: folder, into: 'id-nobody-has', opened: [] });
    expect(JSON.stringify(outcome)).toContain('unknown-project');
  });

  // M9's review 1, F1: the setup's checked reader, which a remote addFolder derives through, guards resolve and relocate
  it('read a folder’s `.smns` for resolve and relocate through the setup’s checked reader, never one linked into a folder macOS protects that was not opened', async () => {
    const { f, home, a, index } = await setup();
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    writeFileSync(join(home, 'Desktop/private-smns'), JSON.stringify({ project: 'private-id', name: 'private label' }));
    const linked = join(home, 'work/linked');
    mkdirSync(linked, { recursive: true });
    symlinkSync(join(home, 'Desktop/private-smns'), join(linked, '.smns'));
    const resolved = await call(a, 'session.projects.resolve', { directory: linked });
    expect(JSON.stringify(resolved)).not.toMatch(/private-id|private label/);
    const pid = ((await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: join(home, 'work/scrape') }))).result as { project: { id: string } }).project.id;
    const moved = await admitted(a, await stepped(f, a, 'session.projects.relocate', { id: pid, directory: linked }));
    for (let k = 0; k < 100; k++) await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.stringify(moved)).not.toMatch(/private-id|private label/);
    expect(JSON.stringify(index.projects.list({ includeHidden: true }))).not.toMatch(/private-id|private label/);
  });
});
