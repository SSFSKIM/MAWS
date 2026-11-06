// The remote setup's rows (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup", §U), through
// the real gate: "+ Session" on a machine with no checkout of the project browses that machine's folders
// (`machine.folders.list`), registers the chosen one (`session.projects.addFolder`), reads its trust
// (`session.trust.check`), and spawns with the trust card's answer (`session.spawn`'s `trust: 'accepted'`). Each setup
// row is the machine's owners' alone (`owners-only` for a member, and for a grant-holder whatever the grant gives), and
// `trust` is a spawn field for an owner alone (`spec-field` for a grant-holder, whose spawn is otherwise as before). The
// registration is held to the setup policy: a folder that exists, under the machine's home, with no link out of it, and
// not in a protected folder the owner didn't open (by listing it with `open: true`).
//
// The machine's home is a fake one under a temp directory and the platform is injected as macOS: nothing here reads a
// real protected folder. The folder list is the real services' handler over that home.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import type { CommandName } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { OFFERS } from '../../src/endpoint/offers';
import { createGitRunner } from '../../src/services/git/runner';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerFolders } from '../../src/services/machine/folders';
import { registerSetupTrust, type SetupGuard } from '../../src/services/machine/setup';
import { trustStateOf } from '../../src/services/sessions/trust';
import { iso } from './org-fixtures';
import { act, CHECKOUT, makeOrg, openRemote, ORG, sminos, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

/** The machine with a fake macOS home, the folder list the services' own, the registration and trust read answering what they were asked. */
async function setup(owners?: string[]): Promise<{ f: Fixture; home: string; a: Remote; b: Remote; guard: SetupGuard }> {
  const home = tempDir('setup-rows-home-');
  for (const dir of ['Developer/GitHub/maws', 'Documents/proj']) mkdirSync(join(home, dir), { recursive: true });
  const f = await startEndpoint(org, started, { setup: { home, platform: 'darwin' }, ...(owners === undefined ? {} : { owners }) });
  const guard: SetupGuard = { where: { home, platform: 'darwin' } };
  registerFolders(f.spine.bus.register as never, guard);
  f.spine.handle('session.projects.addFolder', (input) => ({ registered: (input as { directory: string }).directory }));
  f.spine.handle('machine.setupTrust', (input) => ({ trustKey: (input as { directory: string }).directory, trusted: false })); // the endpoint's remote trust read
  f.spine.handle('session.spawn', () => ({ status: 'ok', appSessionId: 'app-new' }));
  return { f, home, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B), guard };
}

/** A grant of `rights` on the machine to `member`, signed by the owner's device. */
async function grant(f: Fixture, member: string, rights: Grant['rights']): Promise<void> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights, version: 1, issued: iso(Date.now()) };
  await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)));
}

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const stepped = (f: Fixture, r: Remote, action: string, args: Record<string, unknown>): Promise<Action> => r.device.stepUp(r.device.action({ machine: f.ref, action, args }));

/** An admitted act's outcome. */
async function admitted(r: Remote, action: Action): Promise<unknown> {
  const from = r.inbox.length;
  expect([action.action, await act(r, action)]).toEqual([action.action, 'ok']);
  return (await waitFor(r, (m) => m.t === 'done' && m.opId === action.opId, `the done of ${action.action}`, from)).outcome;
}

/**
 * What reached the machine's services by `name` from `from` on: a call's dispatch (a remote trust read is asked as
 * `machine.setupTrust`), or an act's claim under `machine.op`.
 */
const reached = (f: Fixture, from: number, name: string) =>
  f.host.calls.slice(from).filter((c) => c.name === name || (name === 'session.trust.check' && c.name === 'machine.setupTrust') || (c.name === 'machine.op' && (c.input as { name?: string }).name === name));

describe('the remote setup’s rows', () => {
  it('are offered as §U has them: two `list` calls and a `machine-admin` act, each the machine’s owners’ alone', () => {
    expect(OFFERS.commands['machine.folders.list']).toEqual({ kind: 'call', executor: 'machine', target: 'machine', grade: 'list', owners: true });
    expect(OFFERS.commands['session.trust.check']).toEqual({ kind: 'call', executor: 'machine', target: 'machine', grade: 'list', owners: true });
    expect(OFFERS.commands['session.projects.addFolder']).toEqual({ kind: 'act', executor: 'machine', target: 'machine', grade: 'machine-admin', owners: true });
    for (const [name, input] of [['machine.folders.list', {}], ['machine.folders.list', { path: '~/Documents', open: true, cursor: 'a' }], ['session.trust.check', { directory: '/x' }], ['session.projects.addFolder', { directory: '/x' }], ['session.spawn', { checkout: '/x', permission_mode: 'default', trust: 'accepted' }]] as const) {
      expect([name, validateCommandInput(name as CommandName, input).ok]).toEqual([name, true]);
    }
  });

  it('admit each setup action for an owner, and refuse it `owners-only`, unrun, to a member and to a grant-holder of every right', async () => {
    const { f, home, a, b } = await setup();
    const folder = join(home, 'Developer/GitHub/maws');
    const reads: Array<[string, Record<string, unknown>]> = [
      ['machine.folders.list', { path: '~/Developer' }],
      ['session.trust.check', { directory: folder }],
    ];
    for (const holder of ['a member', 'a grant-holder']) {
      if (holder === 'a grant-holder') await grant(f, org.B, ['spawn', 'shell', 'machine-admin']);
      const from = f.host.calls.length;
      for (const [name, input] of reads) expect([holder, name, code(await call(b, name, input))]).toEqual([holder, name, 'owners-only']);
      expect([holder, await act(b, await stepped(f, b, 'session.projects.addFolder', { directory: folder }))]).toEqual([holder, 'owners-only']);
      for (const name of [...reads.map(([n]) => n), 'session.projects.addFolder']) expect([holder, name, reached(f, from, name)]).toEqual([holder, name, []]);
    }

    const listed = await call(a, 'machine.folders.list', { path: '~/Developer' });
    expect(listed).toMatchObject({ ok: true, output: { entries: [{ name: 'GitHub', path: join(home, 'Developer/GitHub'), protected: false }], cursor: null } });
    expect(await call(a, 'machine.folders.list', {})).toMatchObject({ ok: true, output: { entries: [{ name: 'Developer', protected: false }, { name: 'Documents', protected: true }] } });
    expect(await call(a, 'session.trust.check', { directory: folder })).toMatchObject({ ok: true, output: { trustKey: folder, trusted: false } });
    // the registration always steps up, even for an owner
    expect(await act(a, a.device.action({ machine: f.ref, action: 'session.projects.addFolder', args: { directory: folder } }))).toBe('step-up');
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: folder }))).toEqual({ state: 'done', result: { registered: folder } });
    // an act of the reads is not offered, a call of the registration is an act's
    expect(code(await call(a, 'session.projects.addFolder', { directory: folder }))).toBe('act-required');
    expect(await act(a, await stepped(f, a, 'machine.folders.list', {}))).toBe('not-offered');
  });

  it('admit `trust: accepted` on a spawn for an owner, and refuse it `spec-field` to a grant-holder, whose spawn without it stands', async () => {
    const { f, a, b } = await setup();
    await sminos(f); // the machine's presence names CHECKOUT, a checkout a spawn may run in
    await grant(f, org.B, ['spawn']);
    const spawn = { checkout: CHECKOUT, permission_mode: 'default' };
    const from = f.host.calls.length;
    expect(await act(b, await stepped(f, b, 'session.spawn', { ...spawn, trust: 'accepted' }))).toBe('spec-field');
    expect(reached(f, from, 'session.spawn')).toEqual([]);
    expect(await admitted(b, await stepped(f, b, 'session.spawn', spawn))).toEqual({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
    expect(f.spine.claimed.at(-1)).toMatchObject({ name: 'session.spawn', input: spawn });
    expect(await admitted(a, await stepped(f, a, 'session.spawn', { ...spawn, trust: 'accepted' }))).toEqual({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
    expect(f.spine.claimed.at(-1)).toMatchObject({ name: 'session.spawn', input: { ...spawn, trust: 'accepted' } });
    // still the spawn guard's otherwise: a checkout the machine doesn't know
    expect(await act(a, await stepped(f, a, 'session.spawn', { checkout: '/elsewhere', permission_mode: 'default', trust: 'accepted' }))).toBe('unknown-checkout');
  });

  // 2026-11-06 (the New chat's machine first): a chat in the home has `~` as its checkout, so its trust card reads the
  // home's trust by that name, which the setup policy resolves as the folder list does.
  it('read the home’s trust by `~` for an owner, resolved to the home’s real path', async () => {
    const { f, home, a, b } = await setup();
    const from = f.host.calls.length;
    expect(await call(a, 'session.trust.check', { directory: '~' })).toMatchObject({ ok: true, output: { trustKey: home, trusted: false } });
    expect(reached(f, from, 'session.trust.check').map((c) => c.input)).toEqual([expect.objectContaining({ directory: home })]);
    expect(code(await call(b, 'session.trust.check', { directory: '~' }))).toBe('owners-only');
    expect(code(await call(a, 'session.trust.check', { directory: '~elsewhere' }))).toBe('no-folder');
  });

  it('hold the registration to the setup policy: a folder that exists, under the home, through no link out of it', async () => {
    const { f, home, a } = await setup();
    const outside = tempDir('setup-rows-out-');
    mkdirSync(join(outside, 'repo'));
    symlinkSync(outside, join(home, 'Developer/out'));
    const from = f.host.calls.length;
    const register = async (directory: string) => act(a, await stepped(f, a, 'session.projects.addFolder', { directory }));
    expect(await register(join(home, 'Developer/missing'))).toBe('no-folder');
    expect(await register('Developer/GitHub/maws')).toBe('no-folder'); // a relative path names no folder
    expect(await register(join(outside, 'repo'))).toBe('outside-home');
    expect(await register(join(home, '..'))).toBe('outside-home');
    expect(await register(join(home, 'Developer/out/repo'))).toBe('symlink-escape');
    expect(reached(f, from, 'session.projects.addFolder')).toEqual([]);
    // the trust read is held to it too: it looks inside the folder as the registration does
    expect(code(await call(a, 'session.trust.check', { directory: join(home, 'Developer/out/repo') }))).toBe('symlink-escape');
    expect(reached(f, from, 'session.trust.check')).toEqual([]);
  });

  it('refuse a folder in a protected folder until the owner opened it by listing it', async () => {
    const { f, home, a } = await setup();
    const proj = join(home, 'Documents/proj');
    const register = async (directory: string) => act(a, await stepped(f, a, 'session.projects.addFolder', { directory }));
    const from = f.host.calls.length;
    expect(await register(proj)).toBe('protected');
    expect(await register(join(home, 'Documents'))).toBe('protected'); // registering it looks inside it
    expect(code(await call(a, 'session.trust.check', { directory: proj }))).toBe('protected');
    // the list does not read inside it unasked
    expect(await call(a, 'machine.folders.list', { path: '~/Documents' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^protected: /) } });
    expect(await register(proj)).toBe('protected');
    expect(reached(f, from, 'session.projects.addFolder')).toEqual([]);
    // opened
    expect(await call(a, 'machine.folders.list', { path: '~/Documents', open: true })).toMatchObject({ ok: true, output: { entries: [{ name: 'proj', path: proj, protected: false }] } });
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: proj }))).toEqual({ state: 'done', result: { registered: proj } });
    expect(await call(a, 'session.trust.check', { directory: proj })).toMatchObject({ ok: true, output: { trustKey: proj } });
    // a link into it from elsewhere in the home is read as the folder it reaches
    symlinkSync(proj, join(home, 'Developer/proj'));
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: join(home, 'Developer/proj') }))).toMatchObject({ state: 'done' });
  });
});

// The task review's findings 1 to 3, with the machine's own handlers: the index's registration (`addFolder` under
// `machine.op`) and the guarded trust read (`machine.setupTrust`), over real git in the fake home. Each runs on the
// directory the endpoint checked, and checks it again before any git call or read.
describe('the remote setup with the machine’s own handlers', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
  const repo = (path: string) => {
    mkdirSync(path, { recursive: true });
    git(path, 'init', '-q', '-b', 'main');
    writeFileSync(join(path, 'README.md'), 'hello\n');
    git(path, 'add', '.');
    git(path, 'commit', '-q', '-m', 'one');
  };

  /** A script at `path` that appends its working directory and arguments to `marker` (then runs `then`, when given). */
  const script = (path: string, marker: string, then = '') => {
    writeFileSync(path, `#!/bin/sh\necho "$(pwd) $@" >> '${marker}'\n${then}`);
    chmodSync(path, 0o755);
    return path;
  };
  const was = { git: process.env.MAWS_GIT, home: process.env.HOME };
  afterEach(() => {
    for (const [key, value] of [['MAWS_GIT', was.git], ['HOME', was.home]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  /** `check` once it holds, within a few seconds (a new project's org derivation runs after its registration answers). */
  const eventually = async <T>(check: () => T | undefined): Promise<T> => {
    for (let tries = 0; tries < 200; tries++) {
      const value = check();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('it never held');
  };

  /** The machine's own handlers over a fake home, the index built as production builds it (its org refresh started). */
  async function real(configDir = '.claude-config', owners?: string[]): Promise<{ f: Fixture; home: string; a: Remote; b: Remote; index: Index }> {
    const { f, home, a, b, guard } = await setup(owners);
    const index = new Index(join(tempDir('setup-rows-index-'), 'index.sqlite'));
    indexes.push(index);
    void index.refreshOrgProjects({ machine: 'machine-test' as never, enrollment: () => null });
    registerIndexHandlers(index, f.spine.bus as never, guard);
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, configDir) };
    const runGit = createGitRunner({ env });
    registerSetupTrust(f.spine.bus.register as never, { trustCheck: (directory, guarded) => trustStateOf(directory, { git: runGit, env, ...guarded }) }, guard);
    return { f, home, a, b, index };
  }
  const register = async (f: Fixture, a: Remote, directory: string) => act(a, await stepped(f, a, 'session.projects.addFolder', { directory }));
  const open = async (a: Remote, path: string) => expect(await call(a, 'machine.folders.list', { path, open: true })).toMatchObject({ ok: true });

  it('register a checkout and read its trust on the machine', async () => {
    const { f, home, a } = await real();
    repo(join(home, 'Developer/GitHub/maws/repo'));
    const directory = join(home, 'Developer/GitHub/maws/repo');
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory }))).toMatchObject({ state: 'done', result: { project: { directory }, location: { kind: 'directory', path: directory } } });
    expect(await call(a, 'session.trust.check', { directory })).toMatchObject({ ok: true, output: { directory, trustKey: directory, keyKind: 'repo', trusted: false } });
  });

  it('refuse a linked worktree whose git lives in an unopened protected folder, before any git call, until it is opened', async () => {
    const { f, home, a } = await real();
    repo(join(home, 'Documents/main'));
    git(join(home, 'Documents/main'), 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    const from = f.host.calls.length;
    expect(await register(f, a, join(home, 'Developer/wt'))).toBe('protected');
    expect(code(await call(a, 'session.trust.check', { directory: join(home, 'Developer/wt') }))).toBe('protected');
    expect(reached(f, from, 'session.projects.addFolder')).toEqual([]);
    expect(reached(f, from, 'session.trust.check')).toEqual([]);
    await open(a, '~/Documents');
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: join(home, 'Developer/wt') }))).toMatchObject({ state: 'done', result: { project: { directory: join(home, 'Documents/main') }, location: { kind: 'existingWorktree', path: join(home, 'Developer/wt') } } });
  });

  // Round 2: the git the machine runs is hardened (src/services/git/runner.ts' `gitEnv`): a config's `core.fsmonitor`
  // never runs, whatever the setup asks.
  it('run nothing a folder’s config names: its fsmonitor never runs through the list, the registration or the trust read', async () => {
    const { f, home, a } = await real();
    const ran = join(home, 'fsmonitor-ran');
    const main = join(home, 'Developer/main');
    repo(main);
    git(main, 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    git(main, 'config', 'core.fsmonitor', script(join(tempDir('setup-rows-bin-'), 'fsmonitor'), ran));
    expect(await call(a, 'machine.folders.list', { path: '~/Developer' })).toMatchObject({ ok: true });
    for (const directory of [main, join(home, 'Developer/wt')]) {
      expect(await register(f, a, directory)).toBe('ok');
      expect(await call(a, 'session.trust.check', { directory })).toMatchObject({ ok: true });
    }
    expect(existsSync(ran)).toBe(false);
  });

  // Round 2: before trust the setup runs no git but one; git's files are read directly, each through the walk, and a
  // config's include is never followed (git would read it: here it would make the checkout a bare repository's, so the
  // worktree would fold nowhere and its trust read would fail). Round 3: the one is the new project's org derivation's
  // read of its remotes (`git config --file <common>/config --no-includes`), run from no checkout and reading no config of
  // git's own: a global config's include into an unopened protected folder (invalid there, so git would fail on it, and
  // the project would take no remote) is never read.
  it('run no git before trust but the org derivation’s isolated config read, and follow no config’s include', async () => {
    const ran = join(tempDir('setup-rows-ran-'), 'git-ran');
    process.env.MAWS_GIT = script(join(tempDir('setup-rows-bin-'), 'git'), ran, 'exec /usr/bin/git "$@"\n');
    const { f, home, a, index } = await real();
    const main = join(home, 'Developer/main');
    repo(main);
    git(main, 'remote', 'add', 'origin', 'https://github.com/example/main.git');
    git(main, 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    writeFileSync(join(home, 'Documents/included'), '[core]\n\tbare = true\n');
    git(main, 'config', 'include.path', join(home, 'Documents/included'));
    writeFileSync(join(home, 'Documents/global-included'), 'not a config line [[[\n');
    writeFileSync(join(home, '.gitconfig'), `[include]\n\tpath = ${join(home, 'Documents/global-included')}\n`);
    process.env.HOME = home; // the machine's git now finds that global config
    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: join(home, 'Developer/wt') }))).toMatchObject({ state: 'done', result: { project: { directory: main }, location: { kind: 'existingWorktree', path: join(home, 'Developer/wt') } } });
    expect(await call(a, 'session.trust.check', { directory: join(home, 'Developer/wt') })).toMatchObject({ ok: true, output: { trustKey: main, keyKind: 'repo' } });
    expect(await call(a, 'session.trust.check', { directory: main })).toMatchObject({ ok: true, output: { trustKey: main, keyKind: 'repo' } });
    const org = await eventually(() => index.projects.list({ includeHidden: true }).find((project) => project.directory === main)?.org);
    expect(org).toMatchObject({ key: 'remote:github.com/example/main', source: 'remote' });
    const calls = readFileSync(ran, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    const [cwd, ...args] = calls[0].split(' ');
    expect(args.join(' ')).toBe(`config --file ${join(main, '.git/config')} --no-includes -z --get-regexp ^remote\\.`);
    expect(cwd.startsWith(home) || cwd.startsWith(realpathSync(home))).toBe(false);
  });

  // m9-5, the architect's property (2026-11-04): a remote `session.projects.addFolder` needs no trust first (a folder is
  // registered, and trusted later), so on a folder the machine does not trust it spawns no git but the org derivation's
  // one isolated read (`git config --file <the checked config> --no-includes`, from outside the folder, with neither the
  // system's nor the global config), and reads nothing outside the checked resolver: the folder's config includes a file
  // in an unopened protected folder that would name another remote, and the global config includes one there git cannot
  // parse; neither is read. The index is production's, its org refresh installed; the folder's fsmonitor never runs.
  it('register an untrusted folder with no git but the isolated config read, reading nothing outside the checked resolver', async () => {
    const bin = tempDir('setup-rows-bin-');
    const ran = join(tempDir('setup-rows-ran-'), 'git-ran');
    const isolation = `${ran}-env`;
    process.env.MAWS_GIT = script(join(bin, 'git'), ran, `echo "NOSYSTEM=$GIT_CONFIG_NOSYSTEM GLOBAL=$GIT_CONFIG_GLOBAL DIR=$GIT_DIR WORK_TREE=$GIT_WORK_TREE" >> '${isolation}'\nexec /usr/bin/git "$@"\n`);
    const { f, home, a, index } = await real();
    const main = join(home, 'Developer/GitHub/project');
    repo(main);
    git(main, 'remote', 'add', 'origin', 'https://github.com/example/project.git');
    const fsmonitorRan = join(home, 'fsmonitor-ran');
    git(main, 'config', 'core.fsmonitor', script(join(bin, 'fsmonitor'), fsmonitorRan));
    writeFileSync(join(home, 'Documents/decoy'), '[remote "origin"]\n\turl = https://github.com/example/decoy.git\n');
    git(main, 'config', 'include.path', join(home, 'Documents/decoy'));
    writeFileSync(join(home, 'Documents/global-included'), 'not a config line [[[\n');
    writeFileSync(join(home, '.gitconfig'), `[include]\n\tpath = ${join(home, 'Documents/global-included')}\n`);
    process.env.HOME = home; // the machine's git would find that global config

    expect(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory: main }))).toMatchObject({ state: 'done', result: { project: { directory: main }, location: { kind: 'directory', path: main } } });
    const org = await eventually(() => index.projects.list({ includeHidden: true }).find((project) => project.directory === main)?.org);
    expect(org, 'the folder’s own remote: the protected include was never followed').toMatchObject({ key: 'remote:github.com/example/project', source: 'remote' });

    const calls = readFileSync(ran, 'utf8').trim().split('\n');
    expect(calls, 'one git process for the registration').toHaveLength(1);
    const [cwd, ...args] = calls[0].split(' ');
    expect(args.join(' ')).toBe(`config --file ${join(main, '.git/config')} --no-includes -z --get-regexp ^remote\\.`);
    expect(cwd.startsWith(home) || cwd.startsWith(realpathSync(home)), `run from outside the machine's home (${cwd})`).toBe(false);
    expect(readFileSync(isolation, 'utf8').trim(), 'no system or global config, and no repository named to git').toBe('NOSYSTEM=1 GLOBAL=/dev/null DIR= WORK_TREE=');
    expect(existsSync(fsmonitorRan), 'the folder’s fsmonitor never ran').toBe(false);

    // the folder was untrusted throughout: its trust read, after the registration, says so and runs no git either
    expect(await call(a, 'session.trust.check', { directory: main })).toMatchObject({ ok: true, output: { directory: main, trustKey: main, keyKind: 'repo', trusted: false } });
    expect(readFileSync(ran, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  // Round 4 (the review's case): a pointer's content is a path the kernel resolves, a `..` after a link climbing from
  // its target; the org derivation reads the common dir, and the config git is handed, where the check resolved them,
  // never at the lexical spelling (here `~/Documents`, a protected folder nobody opened, holding a decoy config)
  it('derive the org from the common dir the walk resolved, never a pointer’s lexical spelling', async () => {
    const { f, home, a, index } = await real();
    mkdirSync(join(home, 'safe/deep'), { recursive: true });
    symlinkSync(join(home, 'safe/deep'), join(home, 'shortcut'));
    git(home, 'init', '-q', '--bare', '-b', 'main', join(home, 'safe/Documents'));
    const seed = join(home, 'seed');
    repo(seed);
    git(seed, 'push', '-q', join(home, 'safe/Documents'), 'main');
    git(join(home, 'safe/Documents'), 'remote', 'add', 'origin', 'https://github.com/example/safe.git');
    git(join(home, 'safe/Documents'), 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    writeFileSync(join(home, 'safe/Documents/worktrees/wt/commondir'), `${home}/shortcut/../Documents\n`);
    writeFileSync(join(home, 'Documents/config'), '[remote "origin"]\n\turl = https://github.com/example/protected.git\n');
    expect(await register(f, a, join(home, 'Developer/wt'))).toBe('ok');
    const org = await eventually(() => index.projects.list({ includeHidden: true }).find((project) => project.directory === join(home, 'Developer/wt'))?.org);
    expect(org).toMatchObject({ key: 'remote:github.com/example/safe' });
  });

  // Round 3: the new project's org derivation reads a `.smns` through the walk too
  it('derive no org from a `.smns` linked into an unopened protected folder', async () => {
    const { f, home, a, index } = await real();
    mkdirSync(join(home, 'Developer/linked-smns'));
    writeFileSync(join(home, 'Documents/smns.json'), JSON.stringify({ project: 'hidden-id' }));
    symlinkSync(join(home, 'Documents/smns.json'), join(home, 'Developer/linked-smns/.smns'));
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((...line: unknown[]) => void errors.push(line.map(String).join(' ')));
    try {
      expect(await register(f, a, join(home, 'Developer/linked-smns'))).toBe('ok');
      await eventually(() => (errors.length > 0 ? true : undefined));
      expect(errors).toEqual([expect.stringMatching(/the org project of .*linked-smns failed: protected: .*\.smns/)]);
      expect(index.projects.list({ includeHidden: true }).find((project) => project.directory === join(home, 'Developer/linked-smns'))?.org).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });

  // Round 3: the trust read's store (the engine's global config) is read through the same guard. The review: an open is
  // the member's who listed it, so a second owner who opened nothing is still refused after the first opened it.
  it('refuse a trust read whose trust store lies in, or links into, a protected folder the asking owner did not open', async () => {
    for (const [configDir, linked] of [['Documents/cfg', false], ['cfg', true]] as const) {
      const { home, a, b } = await real(configDir, [org.A, org.B]);
      mkdirSync(join(home, 'Documents/cfg'), { recursive: true });
      mkdirSync(join(home, 'cfg'), { recursive: true });
      mkdirSync(join(home, 'Developer/proj'), { recursive: true });
      const store = join(home, 'Documents/cfg/.claude.json');
      writeFileSync(store, JSON.stringify({ projects: { [join(home, 'Developer/proj')]: { hasTrustDialogAccepted: true } } }));
      if (linked) symlinkSync(store, join(home, 'cfg/.claude.json'));
      const refused = await call(a, 'session.trust.check', { directory: join(home, 'Developer/proj') }); // the machine's refusal
      expect([configDir, (refused.error as { message?: string } | undefined)?.message]).toEqual([configDir, expect.stringMatching(/^protected: .*\.c(laude|onfig)\.json/)]);
      await open(a, '~/Documents');
      expect(await call(a, 'session.trust.check', { directory: join(home, 'Developer/proj') })).toMatchObject({ ok: true, output: { trusted: true } });
      const other = await call(b, 'session.trust.check', { directory: join(home, 'Developer/proj') }); // B opened nothing
      expect([configDir, (other.error as { message?: string } | undefined)?.message]).toEqual([configDir, expect.stringMatching(/^protected: .*\.c(laude|onfig)\.json/)]);
      await open(b, '~/Documents');
      expect(await call(b, 'session.trust.check', { directory: join(home, 'Developer/proj') })).toMatchObject({ ok: true, output: { trusted: true } });
    }
  });

  it('refuse a trust read whose trust file leads into an unopened protected folder', async () => {
    const { f, home, a } = await real();
    mkdirSync(join(home, 'Developer/proj'));
    writeFileSync(join(home, 'Documents/mcp.json'), '{"mcpServers":{"x":{}}}');
    symlinkSync(join(home, 'Documents/mcp.json'), join(home, 'Developer/proj/.mcp.json'));
    expect(code(await call(a, 'session.trust.check', { directory: join(home, 'Developer/proj') }))).toBe('protected');
    expect(await register(f, a, join(home, 'Developer/proj'))).toBe('ok'); // the registration reads no trust file
    await open(a, '~/Documents');
    expect(await call(a, 'session.trust.check', { directory: join(home, 'Developer/proj') })).toMatchObject({ ok: true, output: { found: [{ file: '.mcp.json' }] } });
  });

  it('run on the directory the policy resolved, a `..` after a link climbing from its target, the signed spelling kept with the claim', async () => {
    const { f, home, a } = await real();
    mkdirSync(join(home, 'Documents/sub'));
    mkdirSync(join(home, 'Documents/secret'));
    mkdirSync(join(home, 'secret'));
    symlinkSync(join(home, 'Documents/sub'), join(home, 'shortcut'));
    const spelled = `${home}/shortcut/../secret`; // the kernel's `~/Documents/secret`, never the lexical `~/secret`
    expect(await register(f, a, spelled)).toBe('protected');
    expect(code(await call(a, 'session.trust.check', { directory: spelled }))).toBe('protected');
    await open(a, '~/Documents');
    const action = await stepped(f, a, 'session.projects.addFolder', { directory: spelled });
    expect(await admitted(a, action)).toMatchObject({ state: 'done', result: { location: { path: join(home, 'Documents/secret') } } });
    expect(f.spine.claimed.at(-1)).toMatchObject({ name: 'session.projects.addFolder', input: { directory: join(home, 'Documents/secret') }, op: { action: { args: { directory: spelled } } } });
    expect(await call(a, 'session.trust.check', { directory: spelled })).toMatchObject({ ok: true, output: { directory: join(home, 'Documents/secret') } });
  });

  it('refuse on the machine a folder that changed after the endpoint checked it, reading nothing through the change', async () => {
    const { f, home, a } = await real();
    mkdirSync(join(home, 'Developer/moving'));
    mkdirSync(join(home, 'Developer/elsewhere'));
    mkdirSync(join(home, 'Documents/inside'));
    const registration = f.spine.handlers.get('session.projects.addFolder')!;
    let swap = (): void => {};
    f.spine.handle('session.projects.addFolder', (input, context) => (swap(), registration(input, context))); // between the check and the run
    const outcomeOf = async (directory: string) => JSON.stringify(await admitted(a, await stepped(f, a, 'session.projects.addFolder', { directory })));
    swap = () => {
      renameSync(join(home, 'Developer/moving'), join(home, 'Developer/moved'));
      symlinkSync(join(home, 'Developer/elsewhere'), join(home, 'Developer/moving'));
    };
    expect(await outcomeOf(join(home, 'Developer/moving'))).toContain('no-folder: ');
    rmSync(join(home, 'Developer/moving')); // the link the first swap left: a folder again for the endpoint's check
    mkdirSync(join(home, 'Developer/moving'));
    swap = () => {
      rmSync(join(home, 'Developer/moving'), { recursive: true });
      symlinkSync(join(home, 'Documents/inside'), join(home, 'Developer/moving'));
    };
    expect(await outcomeOf(join(home, 'Developer/moving'))).toContain('protected: ');
  });
});

