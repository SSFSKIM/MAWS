// `maws project` (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces §K) over a stand-in daemon: each
// verb's output and exit code, `--into` by id or by name (a shared name lists the candidates and exits 1), a target on
// another machine sent as `projects.forward` with its refusals' exit codes, and a daemon that is not running (3).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { notCanonical } from '@shared/machine/maws-words';
import { runMaws, type MawsDeps } from './maws-cli';
import type { MachineLink, Reached } from './machine-client';

const MINI = 'MiniMachineRef0000000000';
const BOOK = 'BookMachineRef0000000000';
const SCRAPE = '0f6c7b1e-0000-4000-8000-000000000001';
const TOOLS_A = '0f6c7b1e-0000-4000-8000-00000000000a';
const TOOLS_B = '0f6c7b1e-0000-4000-8000-00000000000b';

let root: string;
let work: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-cli-')));
  work = join(root, 'scrape');
  mkdirSync(join(work, 'sub'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const location = (machine: string, path: string, extra: Record<string, unknown> = {}) => ({ pid: `p-${path.length}`, id: 'x', key: `folder:${machine}:${path}`, name: path.split('/').pop(), path, source: 'folder', machine, ...extra });
const registry = (over: Record<string, unknown> = {}) => ({
  enrolled: true,
  machine: { ref: BOOK, name: 'macbook' },
  machines: [{ ref: BOOK, name: 'macbook' }, { ref: MINI, name: 'mini' }],
  projects: [
    { id: SCRAPE, name: 'scrape', hub: true, renamable: true, locations: [location(MINI, '/srv/scrape', { stated: 'minted' }), location(BOOK, '/Users/me/scrape', { state: 'missing' })], known: [] },
    { id: TOOLS_A, name: 'tools', hub: true, renamable: true, locations: [location(MINI, '/srv/tools')], known: [] },
    { id: TOOLS_B, name: 'tools', hub: true, renamable: true, locations: [location(BOOK, '/Users/me/tools')], known: [] },
  ],
  ...over,
});
const record = (directory: string, smnsId: string | null, extra: Record<string, unknown> = {}) => ({ id: 'proj-1', name: directory.split('/').pop(), directory, order: 0, createdAt: 't', org: { key: `folder:${BOOK}:${directory}`, name: directory.split('/').pop(), source: 'folder', smnsId }, ...extra });

type Handler = (input: unknown) => { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
function daemon(handlers: Record<string, Handler>) {
  const calls: Array<[string, unknown]> = [];
  const link: MachineLink = {
    welcome: { t: 'welcome' } as never,
    async request(name, input) {
      calls.push([name, input]);
      const handler = handlers[name];
      const answer = handler === undefined ? { ok: false as const, error: { code: 'internal', message: `the stand-in serves no ${name}` } } : handler(input);
      return { t: 'res', id: 'x', ...answer } as HostResponse;
    },
    close() {},
  };
  return { calls, reach: async (): Promise<Reached> => ({ ok: true, link }) };
}
const ok = (value: unknown): Handler => () => ({ ok: true, value });

async function maws(argv: string[], reach: MawsDeps['reach'], cwd = work) {
  let out = '';
  let err = '';
  const code = await runMaws(argv, { env: { MAWS_USER_DATA: root }, platform: 'darwin', home: root, cwd, out: (t) => void (out += t), err: (t) => void (err += t), build: 'maws-test', reach });
  return { code, out, err };
}

describe('maws project add, on this machine', () => {
  it('declares the working directory and says a minted folder is a new project', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.addFolder': ok({ project: record(work, SCRAPE), location: { kind: 'directory', path: work }, by: 'minted', at: work, restated: true }) });
    expect(await maws(['project', 'add'], d.reach)).toEqual({ code: 0, out: `added scrape as a new project (${SCRAPE})\n`, err: '' });
    expect(d.calls.find(([name]) => name === 'session.projects.addFolder')).toEqual(['session.projects.addFolder', { directory: work }]);
  });

  it('renames with --name, makes a project of its own with --new, and links with --into by name', async () => {
    const d = daemon({
      'projects.registry': ok(registry()),
      'session.projects.addFolder': (input) => ok({ project: record(work, (input as { into?: string }).into ?? SCRAPE), location: { kind: 'directory', path: work }, by: (input as { into?: string }).into ? 'link' : 'minted', at: work, restated: true })(input),
      'session.projects.update': (input) => ok(record(work, SCRAPE, { name: (input as { patch: { name: string } }).patch.name }))(input),
    });
    expect((await maws(['project', 'add', '.', '--new', '--name', 'Scrape it'], d.reach)).out).toBe(`added Scrape it as a new project (${SCRAPE})\n`);
    expect(d.calls.filter(([name]) => name.startsWith('session.'))).toEqual([['session.projects.addFolder', { directory: work, own: true }], ['session.projects.update', { id: 'proj-1', patch: { name: 'Scrape it' } }]]);
    expect((await maws(['project', 'add', 'sub', '--into', 'scrape'], d.reach)).out).toBe(`added ${work} as a location of scrape (${SCRAPE})\n`);
    expect(d.calls.at(-1)).toEqual(['session.projects.addFolder', { directory: join(work, 'sub'), into: SCRAPE }]);
  });

  it('lists the candidates of a shared name and exits 1, sending nothing', async () => {
    const d = daemon({ 'projects.registry': ok(registry()) });
    const ran = await maws(['project', 'add', '--into', 'tools'], d.reach);
    expect(ran.code).toBe(1);
    expect(ran.err).toBe(`tools names 2 projects; give its id:\ntools  ${TOOLS_A}  mini:/srv/tools\ntools  ${TOOLS_B}  macbook:/Users/me/tools\n`);
    expect(d.calls.map(([name]) => name)).toEqual(['projects.registry']);
  });

  it('says a folder inside a project is its location, one sminos has not confirmed, and one that stays under the machine', async () => {
    const answers = [
      { project: record(work, SCRAPE), by: 'minted', at: root, restated: false },
      { project: record(work, null), by: 'machine', at: null, restated: true },
      { project: record(work, null) }, // statements not possible: no `by`
    ];
    let next = 0;
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.addFolder': () => ({ ok: true, value: { location: { kind: 'directory', path: work }, ...answers[next++] } }) });
    expect((await maws(['project', 'add'], d.reach)).out).toBe(`added ${work} as a location of scrape (${SCRAPE})\nsminos has not confirmed yet; a session started now may be filed under this machine for a moment\n`);
    expect((await maws(['project', 'add'], d.reach)).out).toBe(`added ${work}; it stays under this machine until sminos here is updated\n`);
    expect((await maws(['project', 'add'], d.reach)).out).toBe(`added ${work}; it stays under this machine until sminos here is updated\n`);
  });

  it('on a machine that is not enrolled, declares the folder as this machine’s alone', async () => {
    const d = daemon({ 'projects.registry': ok(registry({ enrolled: false, machines: [], projects: [] })), 'session.projects.addFolder': ok({ project: record(work, null), location: { kind: 'directory', path: work } }) });
    expect(await maws(['project', 'add'], d.reach)).toEqual({ code: 0, out: `added ${work}; this machine is not enrolled, so it is a project of this machine only\n`, err: '' });
  });

  it('prints a refusal’s code and sentence and exits 1', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.addFolder': () => ({ ok: false, error: { code: 'invalid_input', message: 'statements-unavailable: sminos-too-old: this machine makes no stored statement now' } }) });
    expect(await maws(['project', 'add', '--new'], d.reach)).toEqual({ code: 1, out: '', err: 'statements-unavailable: sminos-too-old: this machine makes no stored statement now\n' });
  });
});

describe('maws project list and show', () => {
  it('lists one line per project, its locations with their machine and state; --json the whole read', async () => {
    const d = daemon({ 'projects.registry': ok(registry()) });
    expect((await maws(['project', 'list'], d.reach)).out).toBe([`scrape  ${SCRAPE}  mini:/srv/scrape  macbook:/Users/me/scrape missing`, `tools  ${TOOLS_A}  mini:/srv/tools`, `tools  ${TOOLS_B}  macbook:/Users/me/tools`, ''].join('\n'));
    expect(JSON.parse((await maws(['project', 'list', '--json'], d.reach)).out)).toEqual(registry());
    const none = daemon({ 'projects.registry': ok(registry({ enrolled: false, machines: [], projects: [] })) });
    expect(await maws(['project', 'list'], none.reach)).toEqual({ code: 0, out: 'this machine is not enrolled, so it holds no project of an org\n', err: '' });
  });

  it('shows the project of a directory, what decided it and where, and its locations', async () => {
    const answers: Record<string, unknown>[] = [
      { project: SCRAPE, by: 'minted', at: work },
      { project: SCRAPE, by: 'link', at: work },
      { project: SCRAPE, by: 'smns', at: root },
      { project: SCRAPE, by: 'remote', at: null },
      { project: null, by: 'machine', at: null },
    ];
    let next = 0;
    const label = { key: `folder:${BOOK}:${work}`, name: 'scrape', source: 'folder', smnsId: null };
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.resolve': () => ({ ok: true, value: { ...answers[next++], label } }) });
    const tail = 'mini:/srv/scrape\nmacbook:/Users/me/scrape missing\n';
    expect((await maws(['project', 'show', 'sub'], d.reach)).out).toBe(`scrape  ${SCRAPE}\ndecided by a stored id at ${work}\n${tail}`);
    expect(d.calls.at(-1)).toEqual(['session.projects.resolve', { directory: join(work, 'sub') }]);
    expect((await maws(['project', 'show'], d.reach)).out).toBe(`scrape  ${SCRAPE}\ndecided by a link at ${work}\n${tail}`);
    expect((await maws(['project', 'show'], d.reach)).out).toBe(`scrape  ${SCRAPE}\ndecided by .smns at ${root}\n${tail}`);
    expect((await maws(['project', 'show'], d.reach)).out).toBe(`scrape  ${SCRAPE}\ndecided by the repository's remote\n${tail}`);
    expect((await maws(['project', 'show'], d.reach)).out).toBe(`${work}\nthis machine's own project\n`);
  });
});

describe('maws project remove and link, on this machine', () => {
  const rows = () => ({ projects: [], revision: 1, rows: [record(work, SCRAPE, { id: 'proj-9' }), record(join(root, 'gone'), null, { id: 'proj-8', hidden: true })] });

  it('remove hides the row at the folder; a folder that is no project here is refused', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.list': ok(rows()), 'session.projects.remove': ok(undefined) });
    expect(await maws(['project', 'remove'], d.reach)).toEqual({ code: 0, out: `removed ${work}\n`, err: '' });
    expect(d.calls.at(-1)).toEqual(['session.projects.remove', { id: 'proj-9' }]);
    const sub = await maws(['project', 'remove', 'sub'], d.reach);
    expect(sub).toEqual({ code: 1, out: '', err: `not-declared: ${join(work, 'sub')} is not a project folder on this machine\n` });
  });

  // review 1's finding 4: a folder deleted or renamed away is removed by the path its row was declared at
  it('remove takes a folder that is gone by the path it was declared at, spelled as typed; link still needs the folder', async () => {
    const gone = join(root, 'moved-away');
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.list': ok({ projects: [], revision: 1, rows: [record(gone, SCRAPE, { id: 'proj-7' })] }), 'session.projects.remove': ok(undefined) });
    expect(await maws(['project', 'remove', gone], d.reach)).toEqual({ code: 0, out: `removed ${gone}
`, err: '' });
    expect(d.calls.at(-1)).toEqual(['session.projects.remove', { id: 'proj-7' }]);
    expect((await maws(['project', 'remove', `${gone}/`], d.reach)).code, 'a trailing separator').toBe(0);
    expect((await maws(['project', 'remove', '../moved-away'], d.reach)).code, 'relative to the working directory').toBe(0);
    expect(await maws(['project', 'remove', join(root, 'never-here')], d.reach)).toEqual({ code: 1, out: '', err: `not-declared: ${join(root, 'never-here')} is not a project folder on this machine
` });
    expect(await maws(['project', 'link', gone, '--none'], d.reach)).toEqual({ code: 1, out: '', err: `not-a-directory: ${gone}
` });
  });

  it('link --into names the project; --none says which it is in again; one of the two is required', async () => {
    const d = daemon({
      'projects.registry': ok(registry()),
      'session.projects.list': ok(rows()),
      'session.projects.link': (input) => ok({ project: record(work, (input as { into: string | null }).into ?? SCRAPE), restated: (input as { into: string | null }).into !== null })(input),
    });
    expect((await maws(['project', 'link', '--into', TOOLS_A], d.reach)).out).toBe(`linked ${work} into tools (${TOOLS_A})\n`);
    expect(d.calls.at(-1)).toEqual(['session.projects.link', { id: 'proj-9', into: TOOLS_A }]);
    expect((await maws(['project', 'link', '--none'], d.reach)).out).toBe(`unlinked ${work}; its project is scrape (${SCRAPE})\nsminos has not confirmed yet; a session started now may be filed under this machine for a moment\n`);
    const neither = await maws(['project', 'link'], d.reach);
    expect(neither.code).toBe(1);
    expect(neither.err).toMatch(/^link takes --into <project> or --none\n/);
  });
});

describe('maws project aimed at another machine', () => {
  it('forwards the verb with the project resolved, and prints the app’s answer', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'projects.forward': ok({ ok: true, text: `added /srv/new as a location of scrape (${SCRAPE})` }) });
    expect(await maws(['project', 'add', 'mini:/srv/new', '--into', 'scrape', '--name', 'New'], d.reach)).toEqual({ code: 0, out: `added /srv/new as a location of scrape (${SCRAPE})\n`, err: '' });
    expect(d.calls.at(-1)).toEqual(['projects.forward', { verb: 'add', machine: 'mini', path: '/srv/new', into: SCRAPE, name: 'New' }]);
    await maws(['project', 'link', 'mini:/srv/new', '--none'], d.reach);
    expect(d.calls.at(-1)).toEqual(['projects.forward', { verb: 'link', machine: 'mini', path: '/srv/new', into: null }]);
    await maws(['project', 'remove', 'mini:/srv/new'], d.reach);
    expect(d.calls.at(-1)).toEqual(['projects.forward', { verb: 'remove', machine: 'mini', path: '/srv/new' }]);
  });

  // review 1's minor finding: another machine's path is sent in its one spelling, as its rows hold it
  it('sends another machine’s path normalized: no trailing separator, no dot segments, NFC', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'projects.forward': ok({ ok: true, text: 'removed /srv/new' }) });
    for (const spelled of ['mini:/srv/new/', 'mini:/srv/./new', 'mini://srv//new']) {
      await maws(['project', 'remove', spelled], d.reach);
      expect([spelled, d.calls.at(-1)]).toEqual([spelled, ['projects.forward', { verb: 'remove', machine: 'mini', path: '/srv/new' }]]);
    }
    await maws(['project', 'remove', 'mini:/srv/cafe\u0301'], d.reach);
    expect(d.calls.at(-1)).toEqual(['projects.forward', { verb: 'remove', machine: 'mini', path: '/srv/caf\u00e9' }]);
    // M12's re-review, finding 2: a `..` is that machine's to resolve (a symbolic link before it), so it is refused here
    const calls = d.calls.length;
    expect(await maws(['project', 'add', 'mini:/srv/link/../scrape'], d.reach)).toEqual({ code: 1, out: '', err: `${notCanonical('/srv/link/../scrape')}\n` });
    expect(d.calls.slice(calls).map(([name]) => name), 'nothing forwarded').toEqual(['projects.registry']);
  });

  it('exits 2 with no app, signed out or with no window, 1 when not confirmed', async () => {
    const text = 'MAWS is not running on this machine, so it cannot ask mini. Run this on mini: maws project add /srv/new';
    for (const [code, exit] of [['no-app', 2], ['signed-out', 2], ['no-window', 2], ['declined', 1]] as const) {
      const d = daemon({ 'projects.registry': ok(registry()), 'projects.forward': ok({ ok: false, code, text }) });
      expect([code, await maws(['project', 'add', 'mini:/srv/new'], d.reach)]).toEqual([code, { code: exit, out: '', err: `${text}\n` }]);
    }
  });

  it('acts here for this machine’s own name, refuses a machine the org does not have, and takes an existing folder named so as local', async () => {
    const d = daemon({ 'projects.registry': ok(registry()), 'session.projects.addFolder': ok({ project: record(work, SCRAPE), location: { kind: 'directory', path: work }, by: 'minted', at: work, restated: true }) });
    await maws(['project', 'add', `macbook:${work}`], d.reach);
    expect(d.calls.at(-1)).toEqual(['session.projects.addFolder', { directory: work }]);
    expect(await maws(['project', 'add', 'vm:/srv/new'], d.reach)).toEqual({ code: 1, out: '', err: 'unknown-machine: vm is no machine of this org\n' });
    mkdirSync(join(work, 'mini:'), { recursive: true });
    mkdirSync(join(work, 'mini:', 'srv'));
    await maws(['project', 'add', 'mini:/srv'], d.reach);
    expect(d.calls.at(-1)).toEqual(['session.projects.addFolder', { directory: join(work, 'mini:', 'srv') }]);
  });
});

describe('maws itself', () => {
  it('exits 3 when the daemon is not running, and 1 with its usage for what it does not take', async () => {
    const down = async (): Promise<Reached> => ({ ok: false, state: 'down', why: 'no daemon has served this profile, or it has exited' });
    expect(await maws(['project', 'list'], down)).toEqual({ code: 3, out: '', err: 'mawsd is not running (no daemon has served this profile, or it has exited)\n' });
    const d = daemon({ 'projects.registry': ok(registry()) });
    for (const argv of [[], ['project'], ['project', 'rename'], ['project', 'add', '--into', 'scrape', '--new'], ['project', 'list', 'extra']]) {
      const ran = await maws(argv, d.reach);
      expect([argv, ran.code, ran.err]).toEqual([argv, 1, expect.stringContaining('usage: maws project')]);
    }
  });
});
