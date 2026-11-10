// Main's half of `maws` aimed at another machine (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces
// §K; Decision Logs 20 and 21): `mawsd`'s `projects.act.request` is held for the page's sheet (`org.projectActs`,
// `.changed`, `.decide`), sent on Confirm as remote lane B's act over the machine's link, and answered with the words
// `maws` prints. A request the app cannot show is refused at once: signed out, with no window open; one the person
// dismisses is `declined`. Idle, it holds nothing but its listener and its two handlers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import type { OrgProjects, ProjectActAsks } from '@shared/ipc/schema/org';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { registerAppWindow } from '../windows';
import { startProjectActs } from './project-acts';

const MINI = 'MiniMachineRef0000000000' as MachineRef;
const BOOK = 'BookMachineRef0000000000' as MachineRef;
const SCRAPE = '0f6c7b1e-0000-4000-8000-000000000001';

const location = (machine: MachineRef, pid: string, path: string) => ({ machine, pid, path, key: `folder:${machine}:${path}` as OrgKey, name: path.split('/').pop()!, source: 'folder' as const, stated: 'minted' as const, acts: true });
const PROJECTS: OrgProjects = { projects: [{ id: SCRAPE, name: 'scrape', hub: true, renamable: true, locations: [location(MINI, 'p-scrape', '/srv/scrape')] }], keys: {}, moved: {}, removals: [], seen: {} };
const record = (directory: string, smnsId: string | null, name = directory.split('/').pop()!) => ({ id: `${MINI}/p-new`, name, directory, order: 0, createdAt: 't', org: { key: `folder:${MINI}:${directory}`, name, source: 'folder', smnsId } });

type Window = { focus: ReturnType<typeof vi.fn>; close(): void };
const windows: Window[] = [];
function openWindow(): Window {
  let closed = () => {};
  const win = { focus: vi.fn(), isDestroyed: () => false, once: (_event: string, listener: () => void) => void (closed = listener) };
  registerAppWindow(win as never);
  const handle = { focus: win.focus, close: () => closed() };
  windows.push(handle);
  return handle;
}
afterEach(() => {
  for (const win of windows.splice(0)) win.close();
  vi.useRealTimers();
});

type Machines = { machines: Array<{ ref: MachineRef; name: string }>; contested: string[] } | null;
/** A macrotask's turn: the registry's read of the machines (a promise) settled, and what follows it. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function scene(options: { signedIn?: boolean; links?: MachineRef[]; machines?: () => Promise<Machines> } = {}) {
  const heard = new Map<string, (payload: unknown) => void>();
  const subscribed: string[] = [];
  const watching = new Set<(state: { state: string }) => void>(); // main's machine link, watched while an ask is held
  const answers: unknown[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: ProjectActAsks[] = [];
  const sent: Array<[string, unknown]> = [];
  const replies = new Map<string, (input: unknown) => CommandResult<CommandName>>();
  const links = options.links ?? [MINI];
  const stop = startProjectActs({
    hosts: {
      onEvent: ((name: string, listener: (payload: unknown) => void) => (subscribed.push(name), heard.set(name, listener), () => {})) as never,
      onState: ((owner: string, listener: (state: { state: string }) => void) => {
        expect(owner).toBe('machine');
        watching.add(listener);
        return () => watching.delete(listener);
      }) as never,
      dispatch: (async (_owner: string, name: string, input: unknown) => (answers.push([name, input]), { ok: true, value: undefined })) as never,
    },
    registry: { projects: () => PROJECTS, machines: options.machines ?? (async () => (options.signedIn === false ? null : { machines: [{ ref: BOOK, name: 'macbook' }, { ref: MINI, name: 'mini' }], contested: ['vm-2'] })) },
    roster: () => links,
    link: (ref) => (links.includes(ref) ? { machine: ref } : null),
    send: async (_link, name, input) => (sent.push([name, input]), replies.get(name)?.(input) ?? { ok: false, error: { code: 'internal', message: `no reply for ${name}` } }),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    emit: (value) => void emitted.push(value),
    log: () => {},
  });
  /** The daemon's request, and its machine read: shown or refused when this settles. */
  const ask = async (payload: Omit<EventPayload<'projects.act.request'>, 'id'>, id = 'pa-1') => {
    heard.get('projects.act.request')!({ id, ...payload });
    await turn();
  };
  const withdraw = (id: string) => heard.get('projects.act.withdrawn')!({ id });
  const linkState = (state: string) => [...watching].forEach((listener) => listener({ state }));
  const decide = (id: string, confirm: boolean) => handlers.get('org.projectActs.decide')!({ id, confirm }) as Promise<void>;
  const reply = (name: string, value: unknown) => replies.set(name, () => ({ ok: true, value }) as CommandResult<CommandName>);
  return { stop, subscribed, watching, answers, handlers, emitted, sent, replies, ask, withdraw, linkState, decide, reply };
}

const answered = (id: string, result: unknown) => ['projects.act.answer', { id, result }];

describe('the act request, idle', () => {
  it('holds only its listener and its two handlers: no timer, no emission, nothing sent', () => {
    vi.useFakeTimers();
    const s = scene();
    expect(s.subscribed).toEqual(['projects.act.request', 'projects.act.withdrawn']);
    expect(s.watching.size, 'the machine link is watched only while an ask is held').toBe(0);
    expect([...s.handlers.keys()].sort()).toEqual(['org.projectActs', 'org.projectActs.decide']);
    expect(vi.getTimerCount()).toBe(0);
    expect([s.emitted, s.answers, s.sent]).toEqual([[], [], []]);
    expect(s.handlers.get('org.projectActs')!(undefined)).toEqual({ asks: [] });
  });
});

describe('a request the app cannot show', () => {
  it('is refused at once signed out, with no window open, and for a machine the org does not have', async () => {
    const out = scene({ signedIn: false });
    openWindow();
    await out.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect(out.answers).toEqual([answered('pa-1', { ok: false, code: 'signed-out', text: 'MAWS is not signed in on this Mac, so it cannot ask mini. Run this on mini: maws project add /srv/new' })]);
    windows.splice(0).forEach((w) => w.close());
    const none = scene();
    await none.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect(none.answers).toEqual([answered('pa-1', { ok: false, code: 'no-window', text: 'MAWS has no window open to confirm this. Open MAWS and run the command again.' })]);
    openWindow();
    const unknown = scene();
    await unknown.ask({ verb: 'add', machine: 'vm', path: '/srv/new' });
    expect(unknown.answers).toEqual([answered('pa-1', { ok: false, code: 'unknown-machine', text: 'unknown-machine: vm is no machine of this org' })]);
    // branch fix 2: a name claimed by more than one machine is no target, and is not called unknown
    const contested = scene();
    await contested.ask({ verb: 'add', machine: 'vm-2', path: '/srv/new' });
    expect(contested.answers).toEqual([answered('pa-1', { ok: false, code: 'contested', text: 'contested: vm-2 is in dispute in this org (two claims to its name or its identity); an admin settles it' })]);
    for (const s of [out, none, unknown, contested]) expect(s.emitted).toEqual([]);
  });
});

describe('a request shown in the page', () => {
  it('is listed with its machine’s ref and the project’s name, the window focused, and sent on Confirm as lane B’s act', async () => {
    const win = openWindow();
    const s = scene();
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/new', into: SCRAPE, name: 'New one' });
    const ask = { id: 'pa-1', verb: 'add', machine: MINI, machineName: 'mini', path: '/srv/new', into: SCRAPE, intoName: 'scrape', name: 'New one', askedAt: expect.any(String) };
    expect(s.emitted).toEqual([{ asks: [ask] }]);
    expect(s.handlers.get('org.projectActs')!(undefined)).toEqual({ asks: [ask] });
    expect(win.focus).toHaveBeenCalled();
    expect(s.answers).toEqual([]);
    s.reply('session.projects.addFolder', { project: record('/srv/new', SCRAPE), location: { kind: 'directory', path: '/srv/new' }, by: 'link', at: '/srv/new', restated: false });
    s.reply('session.projects.update', record('/srv/new', SCRAPE, 'New one'));
    await s.decide('pa-1', true);
    expect(s.sent).toEqual([['session.projects.addFolder', { directory: '/srv/new', into: SCRAPE }], ['session.projects.update', { id: `${MINI}/p-new`, patch: { name: 'New one' } }]]);
    expect(s.answers).toEqual([answered('pa-1', { ok: true, text: `added /srv/new as a location of scrape (${SCRAPE})\nsminos has not confirmed yet; a session started now may be filed under mini for a moment` })]);
    expect(s.emitted.at(-1)).toEqual({ asks: [] });
  });

  it('a new project there, and one the rule leaves under that machine, in its words', async () => {
    openWindow();
    const s = scene();
    s.reply('session.projects.addFolder', { project: record('/srv/new', SCRAPE), location: { kind: 'directory', path: '/srv/new' }, by: 'minted', at: '/srv/new', restated: true });
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/new', own: true });
    await s.decide('pa-1', true);
    expect(s.sent).toEqual([['session.projects.addFolder', { directory: '/srv/new', own: true }]]);
    s.reply('session.projects.addFolder', { project: record('/srv/other', null), location: { kind: 'directory', path: '/srv/other' } });
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/other' }, 'pa-2');
    await s.decide('pa-2', true);
    expect(s.answers).toEqual([answered('pa-1', { ok: true, text: `added new as a new project (${SCRAPE})` }), answered('pa-2', { ok: true, text: 'added /srv/other; it stays under mini until sminos there is updated' })]);
  });

  it('is declined when the person dismisses it, and sends nothing', async () => {
    openWindow();
    const s = scene();
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' });
    await s.decide('pa-1', false);
    expect(s.sent).toEqual([]);
    expect(s.answers).toEqual([answered('pa-1', { ok: false, code: 'declined', text: 'Not confirmed in MAWS.' })]);
    await expect(s.decide('pa-1', true), 'decided once').rejects.toMatchObject({ ipcError: { code: 'invalid_input' } });
  });

  it('removes and links a location by the row the registry names at that path; another path is refused', async () => {
    openWindow();
    const s = scene();
    s.reply('session.projects.remove', undefined);
    s.reply('session.projects.link', { project: record('/srv/scrape', SCRAPE), restated: true });
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' });
    await s.decide('pa-1', true);
    await s.ask({ verb: 'link', machine: 'mini', path: '/srv/scrape', into: null }, 'pa-2');
    await s.decide('pa-2', true);
    await s.ask({ verb: 'link', machine: 'mini', path: '/srv/elsewhere', into: SCRAPE }, 'pa-3');
    await s.decide('pa-3', true);
    expect(s.sent).toEqual([['session.projects.remove', { id: 'p-scrape' }], ['session.projects.link', { id: 'p-scrape', into: null }]]);
    expect(s.answers).toEqual([
      answered('pa-1', { ok: true, text: 'removed /srv/scrape' }),
      answered('pa-2', { ok: true, text: `unlinked /srv/scrape; its project is scrape (${SCRAPE})` }),
      answered('pa-3', { ok: false, code: 'not-declared', text: 'not-declared: /srv/elsewhere is not a project folder on mini' }),
    ]);
  });

  // review 1's minor finding: a path spelled otherwise names the same location
  it('finds the location under the path as its rows hold it, however the request spells it', async () => {
    openWindow();
    const s = scene();
    s.reply('session.projects.remove', undefined);
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape/' });
    await s.decide('pa-1', true);
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv//./scrape' }, 'pa-2');
    await s.decide('pa-2', true);
    expect(s.sent).toEqual([['session.projects.remove', { id: 'p-scrape' }], ['session.projects.remove', { id: 'p-scrape' }]]);
    expect(s.answers).toEqual([answered('pa-1', { ok: true, text: 'removed /srv/scrape' }), answered('pa-2', { ok: true, text: 'removed /srv/scrape' })]);
  });

  // M12's re-review, finding 2: a `..` is that machine's to resolve, so main refuses it at once and never shows it
  it('refuses a path with a `..` segment at once: `not-canonical`', async () => {
    openWindow();
    const s = scene();
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/link/../scrape' });
    expect(s.answers).toEqual([answered('pa-1', { ok: false, code: 'not-canonical', text: 'not-canonical: /srv/link/../scrape has a ".." segment, which only that machine can resolve; give the folder\'s path without ".."' })]);
    expect([s.emitted, s.sent]).toEqual([[], []]);
  });

  it('answers the machine’s refusal by its code, and a machine this Mac cannot reach now', async () => {
    openWindow();
    const s = scene({ links: [] });
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    await s.decide('pa-1', true);
    const r = scene();
    r.replies.set('session.projects.addFolder', () => ({ ok: false, error: { code: 'internal', message: 'unknown-project: abc is in no verified projects record' } }));
    await r.ask({ verb: 'add', machine: 'mini', path: '/srv/new', into: 'abc' });
    await r.decide('pa-1', true);
    expect(s.answers).toEqual([answered('pa-1', { ok: false, code: 'host_unavailable', text: 'host_unavailable: mini is not reachable from this Mac now' })]);
    expect(r.answers).toEqual([answered('pa-1', { ok: false, code: 'unknown-project', text: 'unknown-project: abc is in no verified projects record' })]);
  });
});

// Decision Log 22: a request whose terminal has gone, or whose daemon's connection ended, is taken off the page unacted
describe('a request withdrawn', () => {
  it('when its terminal leaves: off the page, and a later Confirm sends nothing', async () => {
    openWindow();
    const s = scene();
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/other' }, 'pa-2');
    s.withdraw('pa-1');
    expect(s.emitted.at(-1)).toEqual({ asks: [expect.objectContaining({ id: 'pa-2' })] });
    await expect(s.decide('pa-1', true)).rejects.toMatchObject({ ipcError: { code: 'invalid_input' } });
    expect([s.sent, s.answers]).toEqual([[], []]);
    s.withdraw('pa-unknown'); // nothing held under it: nothing changes
    expect(s.emitted).toHaveLength(3);
  });

  it('goes on once confirmed: its act may be under way', async () => {
    openWindow();
    const s = scene();
    s.reply('session.projects.remove', undefined);
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' });
    const deciding = s.decide('pa-1', true);
    s.withdraw('pa-1');
    await deciding;
    expect(s.sent).toEqual([['session.projects.remove', { id: 'p-scrape' }]]);
    expect(s.answers).toEqual([answered('pa-1', { ok: true, text: 'removed /srv/scrape' })]);
  });

  it('all of them when the daemon’s connection ends, and the link is watched only while one is held', async () => {
    openWindow();
    const s = scene();
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    await s.ask({ verb: 'add', machine: 'mini', path: '/srv/other' }, 'pa-2');
    expect(s.watching.size).toBe(1);
    s.linkState('ready');
    expect(s.emitted.at(-1)?.asks).toHaveLength(2);
    s.linkState('restarting');
    expect(s.emitted.at(-1)).toEqual({ asks: [] });
    expect(s.watching.size).toBe(0);
    await expect(s.decide('pa-2', true)).rejects.toMatchObject({ ipcError: { code: 'invalid_input' } });
    expect([s.sent, s.answers]).toEqual([[], []]);
    await s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' }, 'pa-3');
    await s.decide('pa-3', false);
    expect(s.watching.size, 'released once none is held').toBe(0);
  });

  // branch review 1, P1: its machine is read on demand, the certificates verified, so a request waits on that read
  it('while its machine is read: never shown, the link watched meanwhile; a read that fails is answered', async () => {
    openWindow();
    let release: (machines: Machines) => void = () => {};
    const s = scene({ machines: () => new Promise<Machines>((resolve) => (release = resolve)) });
    void s.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect(s.watching.size, 'watched while it is read').toBe(1);
    s.withdraw('pa-1');
    expect(s.watching.size).toBe(0);
    release({ machines: [{ ref: MINI, name: 'mini' }], contested: [] });
    await turn();
    expect([s.emitted, s.answers, s.watching.size]).toEqual([[], [], 0]);
    void s.ask({ verb: 'add', machine: 'mini', path: '/srv/other' }, 'pa-2');
    s.linkState('restarting'); // the daemon's connection ends while it is read
    release({ machines: [{ ref: MINI, name: 'mini' }], contested: [] });
    await turn();
    expect([s.emitted, s.answers, s.watching.size]).toEqual([[{ asks: [] }], [], 0]);
    const failing = scene({ machines: () => Promise.reject(new Error('the head could not be read')) });
    await failing.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect([failing.emitted, failing.answers, failing.watching.size]).toEqual([[], [answered('pa-1', { ok: false, code: 'internal', text: 'the head could not be read' })], 0]);
  });
});
