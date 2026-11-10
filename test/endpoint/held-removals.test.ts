// Main's held removals against the machine that decides them (the project registry, docs/doperpowers/plans/2026-11-10-
// project-registry.md, M10's Proves "over the endpoint's harness"; Interfaces §G's checked `remove`, §I): a removal held
// with the location as the app's last record stated it goes as `session.projects.remove` with that expectation through the
// real gate to a real index. A row the machine relocated or relinked since is refused `changed` and nothing is hidden; so
// is a declared subfolder whose parent was relinked, with the subfolder's own derivation held back (its kept project
// stale, the rule's answer not); one whose rule gets no answer is refused `unresolved`, nothing hidden, and stays held.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Action } from 'org-protocol';
import { outcomeAsResult } from '../../src/main/lane-b/remote-outcomes';
import { createHeldRemovals, type RemovalAnswer, type RemovalInput } from '../../src/main/org/held-removals';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerFolders } from '../../src/services/machine/folders';
import type { SetupGuard } from '../../src/services/machine/setup';
import type { MachineRef } from '../../src/shared/machine/ref';
import { memoryFiles, World } from '../org/rows-world';
import { act, done, makeOrg, openRemote, ORG, sminos, startEndpoint, stopAll, until, type Fixture, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];
const indexes: Index[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  vi.restoreAllMocks();
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
async function setup(): Promise<{ f: Fixture; home: string; index: Index; a: Remote }> {
  const home = tempDir('held-removals-home-');
  for (const dir of ['work/scrape', 'work/moved', 'work/scrape/sub']) mkdirSync(join(home, dir), { recursive: true });
  const f = await startEndpoint(org, started, { setup: { home, platform: 'darwin' } });
  const index = new Index(join(tempDir('held-removals-index-'), 'index.sqlite'), { registry: f.endpoint.registry });
  indexes.push(index);
  const guard: SetupGuard = { where: { home, platform: 'darwin' } };
  registerIndexHandlers(index, f.spine.bus as never, guard);
  registerFolders(f.spine.bus.register as never, guard);
  await sminos(f, [], ['audience', 'record', 'locations']);
  await index.refreshOrgProjects({ machine: f.services.machine.ref, enrollment: () => ({ org: ORG, machine: 'mini' }), home });
  await until(() => f.endpoint.registry.statements().possible, 'statements possible');
  return { f, home, index, a: await openRemote(f, org.a1, org.A) };
}

const action = (f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Action => r.device.action({ machine: f.ref, action: name, args });
const stepped = (f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Promise<Action> => r.device.stepUp(action(f, r, name, args));
async function admitted(r: Remote, a: Action): Promise<{ state: string; result?: unknown; error?: { message?: string } }> {
  const from = r.inbox.length;
  expect([a.action, await act(r, a)]).toEqual([a.action, 'ok']);
  return (await done(r, a, from)) as never;
}
const added = async (f: Fixture, a: Remote, directory: string) => ((await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory }))).result as { project: { id: string; org?: { smnsId: string | null } } }).project;
const hidden = (index: Index, pid: string) => index.projects.list({ includeHidden: true }).find((p) => p.id === pid)?.hidden === true;

/**
 * Main's held removals for this machine, its location as the app's last record stated it (`stated`), sent as main's lane
 * B sends a machine act: the device's signed act over the channel, its outcome read as lane B reads one.
 */
async function held(f: Fixture, a: Remote, stated: { pid: string; path: string; project: string }) {
  const w = await World.make();
  const told: string[] = [];
  const answers: RemovalAnswer[] = [];
  const removals = createHeldRemovals({
    session: w.session,
    files: memoryFiles(),
    locate: () => ({ path: stated.path, project: stated.project }),
    ready: () => true,
    name: () => 'mini',
    send: async (_machine, input: RemovalInput): Promise<RemovalAnswer> => {
      const from = a.inbox.length;
      const sent = action(f, a, 'session.projects.remove', input);
      const admission = await act(a, sent);
      const answer = (admission === 'ok' ? outcomeAsResult('session.projects.remove', 'mini', (await done(a, sent, from)) as never) : outcomeAsResult('session.projects.remove', 'mini', { state: 'refused', reason: admission })) as RemovalAnswer;
      answers.push(answer);
      return answer;
    },
    notify: (text) => told.push(text),
    retryMs: 3_600_000,
    log: () => {},
  });
  await removals.loaded;
  await removals.hold({ machine: f.ref as MachineRef, pid: stated.pid });
  await removals.settled();
  /** The refusals' codes, as the machine words them (`<code>: …`). */
  const codes = () => answers.map((answer) => (answer.ok ? 'done' : answer.error.message.split(':')[0]));
  return { removals, told, codes };
}

describe('a held removal, decided by the machine', () => {
  it('of a row relocated since the app’s last record: refused `changed`, nothing hidden, dropped and told', async () => {
    const { f, home, index, a } = await setup();
    const folder = join(home, 'work/scrape');
    const row = await added(f, a, folder);
    const stated = { pid: row.id, path: folder, project: row.org!.smnsId! };
    expect(await admitted(a, await stepped(f, a, 'session.projects.relocate', { id: row.id, directory: join(home, 'work/moved') }))).toMatchObject({ state: 'done' });
    const { removals, told, codes } = await held(f, a, stated);
    expect(codes()).toEqual(['changed']);
    expect(hidden(index, row.id)).toBe(false);
    expect(removals.list()).toEqual([]);
    expect(told).toEqual([`${folder} on mini was not removed: it changed after you asked.`]);
    await removals.close();
  });

  it('of a row relinked since: refused `changed`, nothing hidden', async () => {
    const { f, home, index, a } = await setup();
    const folder = join(home, 'work/scrape');
    const row = await added(f, a, folder);
    vi.spyOn(f.endpoint.registry, 'project').mockImplementation((id) => (id === 'other-project' ? { hub: true, nameRev: 0 } : null));
    expect(await admitted(a, await stepped(f, a, 'session.projects.link', { id: row.id, into: 'other-project' }))).toMatchObject({ state: 'done' });
    const { removals, codes } = await held(f, a, { pid: row.id, path: folder, project: row.org!.smnsId! });
    expect(hidden(index, row.id)).toBe(false);
    expect([removals.list(), codes()]).toEqual([[], ['changed']]);
    await removals.close();
  });

  it('of a declared subfolder whose parent was relinked, its own derivation held back: refused `changed`, nothing hidden', async () => {
    const { f, home, index, a } = await setup();
    const parent = await added(f, a, join(home, 'work/scrape'));
    const minted = parent.org!.smnsId!;
    const sub = join(home, 'work/scrape/sub');
    const child = await added(f, a, sub);
    expect(child.org?.smnsId).toBe(minted); // inside the parent's project, not minted
    // the rows beneath a changed folder are derived again after the act answers (M8): held back here, so the
    // subfolder's kept project stays the parent's old one while the rule's answer moves
    const statements = index.statements as unknown as { queue: { rederive(rows: readonly unknown[]): void } };
    vi.spyOn(statements.queue, 'rederive').mockImplementation(() => {});
    vi.spyOn(f.endpoint.registry, 'project').mockImplementation((id) => (id === 'other-project' ? { hub: true, nameRev: 0 } : null));
    expect(await admitted(a, await stepped(f, a, 'session.projects.link', { id: parent.id, into: 'other-project' }))).toMatchObject({ state: 'done' });
    expect(index.projects.record(child.id as never).org?.smnsId).toBe(minted);
    const { removals, codes } = await held(f, a, { pid: child.id, path: sub, project: minted });
    expect(hidden(index, child.id)).toBe(false);
    expect([removals.list(), codes()]).toEqual([[], ['changed']]);
    await removals.close();
  });

  it('whose rule gets no answer: refused `unresolved`, nothing hidden, and still held', async () => {
    const { f, home, index, a } = await setup();
    // a linked worktree whose owning checkout's `.smns` is a link into an unopened ~/Desktop: the asker's rule has no answer
    const main = join(home, 'work/main');
    const wt = join(home, 'work/side');
    const admin = join(main, '.git/worktrees/side');
    for (const dir of [join(main, '.git/objects'), join(main, '.git/refs'), admin, wt]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(main, '.git/config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
    writeFileSync(join(main, '.git/HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(admin, 'HEAD'), 'ref: refs/heads/side\n');
    writeFileSync(join(admin, 'commondir'), '../..\n');
    writeFileSync(join(admin, 'gitdir'), `${join(wt, '.git')}\n`);
    writeFileSync(join(wt, '.git'), `gitdir: ${admin}\n`);
    const pid = index.projects.add(wt).id;
    writeFileSync(join(main, '.smns'), JSON.stringify({ project: 'root-project', name: 'Root', hub: { org: ORG } }));
    await index.refreshOrgProjects({ machine: f.services.machine.ref, enrollment: () => ({ org: ORG, machine: 'mini' }), home });
    await until(() => index.projects.record(pid).org?.smnsId === 'root-project', 'the row derived');
    for (let k = 0; k < 100; k++) await new Promise((resolve) => setImmediate(resolve));
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    writeFileSync(join(home, 'Desktop/private-smns'), JSON.stringify({ project: 'private-id', name: 'private label', hub: { org: ORG } }));
    rmSync(join(main, '.smns'));
    symlinkSync(join(home, 'Desktop/private-smns'), join(main, '.smns'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { removals, told, codes } = await held(f, a, { pid, path: wt, project: 'root-project' });
    warn.mockRestore();
    expect(codes()).toEqual(['unresolved']);
    expect(hidden(index, pid)).toBe(false);
    expect(removals.list()).toEqual([expect.objectContaining({ pid, path: wt, project: 'root-project' })]);
    expect(told).toEqual([]);
    await removals.close();
  });
});
