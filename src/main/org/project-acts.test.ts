// Main's half of `maws` aimed at another machine (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces
// §K; Decision Logs 20 and 21): `mawsd`'s `projects.act.request` is held for the page's sheet (`org.projectActs`,
// `.changed`, `.decide`), sent on Confirm as remote lane B's act over the machine's link, and answered with the words
// `maws` prints. A request the app cannot show is refused at once: signed out, with no window open; one the person
// dismisses is `declined`. Idle, it holds nothing but its listener and its two handlers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import type { OrgProjects, ProjectActAsks } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { registerAppWindow } from '../windows';
import { startProjectActs } from './project-acts';

const MINI = 'MiniMachineRef0000000000' as MachineRef;
const BOOK = 'BookMachineRef0000000000' as MachineRef;
const SCRAPE = '0f6c7b1e-0000-4000-8000-000000000001';

const location = (machine: MachineRef, pid: string, path: string) => ({ machine, pid, path, key: `folder:${machine}:${path}`, name: path.split('/').pop()!, source: 'folder' as const, stated: 'minted' as const, acts: true });
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

function scene(options: { signedIn?: boolean; links?: MachineRef[] } = {}) {
  let request: (payload: EventPayload<'projects.act.request'>) => void = () => {};
  const subscribed: string[] = [];
  const answers: unknown[] = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const emitted: ProjectActAsks[] = [];
  const sent: Array<[string, unknown]> = [];
  const replies = new Map<string, (input: unknown) => CommandResult<CommandName>>();
  const links = options.links ?? [MINI];
  const stop = startProjectActs({
    hosts: {
      onEvent: ((name: string, listener: (payload: EventPayload<'projects.act.request'>) => void) => (subscribed.push(name), (request = listener), () => {})) as never,
      dispatch: (async (_owner: string, name: string, input: unknown) => (answers.push([name, input]), { ok: true, value: undefined })) as never,
    },
    registry: { projects: () => PROJECTS, machines: () => (options.signedIn === false ? null : [{ ref: BOOK, name: 'macbook' }, { ref: MINI, name: 'mini' }]) },
    roster: () => links,
    link: (ref) => (links.includes(ref) ? { machine: ref } : null),
    send: async (_link, name, input) => (sent.push([name, input]), replies.get(name)?.(input) ?? { ok: false, error: { code: 'internal', message: `no reply for ${name}` } }),
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    emit: (value) => void emitted.push(value),
    log: () => {},
  });
  const ask = (payload: Omit<EventPayload<'projects.act.request'>, 'id'>, id = 'pa-1') => request({ id, ...payload } as EventPayload<'projects.act.request'>);
  const decide = (id: string, confirm: boolean) => handlers.get('org.projectActs.decide')!({ id, confirm }) as Promise<void>;
  const reply = (name: string, value: unknown) => replies.set(name, () => ({ ok: true, value }) as CommandResult<CommandName>);
  return { stop, subscribed, answers, handlers, emitted, sent, replies, ask, decide, reply };
}

const answered = (id: string, result: unknown) => ['projects.act.answer', { id, result }];

describe('the act request, idle', () => {
  it('holds only its listener and its two handlers: no timer, no emission, nothing sent', () => {
    vi.useFakeTimers();
    const s = scene();
    expect(s.subscribed).toEqual(['projects.act.request']);
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
    out.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect(out.answers).toEqual([answered('pa-1', { ok: false, code: 'signed-out', text: 'MAWS is not signed in on this Mac, so it cannot ask mini. Run this on mini: maws project add /srv/new' })]);
    windows.splice(0).forEach((w) => w.close());
    const none = scene();
    none.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    expect(none.answers).toEqual([answered('pa-1', { ok: false, code: 'no-window', text: 'MAWS has no window open to confirm this. Open MAWS and run the command again.' })]);
    openWindow();
    const unknown = scene();
    unknown.ask({ verb: 'add', machine: 'vm', path: '/srv/new' });
    expect(unknown.answers).toEqual([answered('pa-1', { ok: false, code: 'unknown-machine', text: 'unknown-machine: vm is no machine of this org' })]);
    for (const s of [out, none, unknown]) expect(s.emitted).toEqual([]);
  });
});

describe('a request shown in the page', () => {
  it('is listed with its machine’s ref and the project’s name, the window focused, and sent on Confirm as lane B’s act', async () => {
    const win = openWindow();
    const s = scene();
    s.ask({ verb: 'add', machine: 'mini', path: '/srv/new', into: SCRAPE, name: 'New one' });
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
    s.ask({ verb: 'add', machine: 'mini', path: '/srv/new', own: true });
    await s.decide('pa-1', true);
    expect(s.sent).toEqual([['session.projects.addFolder', { directory: '/srv/new', own: true }]]);
    s.reply('session.projects.addFolder', { project: record('/srv/other', null), location: { kind: 'directory', path: '/srv/other' } });
    s.ask({ verb: 'add', machine: 'mini', path: '/srv/other' }, 'pa-2');
    await s.decide('pa-2', true);
    expect(s.answers).toEqual([answered('pa-1', { ok: true, text: `added new as a new project (${SCRAPE})` }), answered('pa-2', { ok: true, text: 'added /srv/other; it stays under mini until sminos there is updated' })]);
  });

  it('is declined when the person dismisses it, and sends nothing', async () => {
    openWindow();
    const s = scene();
    s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' });
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
    s.ask({ verb: 'remove', machine: 'mini', path: '/srv/scrape' });
    await s.decide('pa-1', true);
    s.ask({ verb: 'link', machine: 'mini', path: '/srv/scrape', into: null }, 'pa-2');
    await s.decide('pa-2', true);
    s.ask({ verb: 'link', machine: 'mini', path: '/srv/elsewhere', into: SCRAPE }, 'pa-3');
    await s.decide('pa-3', true);
    expect(s.sent).toEqual([['session.projects.remove', { id: 'p-scrape' }], ['session.projects.link', { id: 'p-scrape', into: null }]]);
    expect(s.answers).toEqual([
      answered('pa-1', { ok: true, text: 'removed /srv/scrape' }),
      answered('pa-2', { ok: true, text: `unlinked /srv/scrape; its project is scrape (${SCRAPE})` }),
      answered('pa-3', { ok: false, code: 'not-declared', text: 'not-declared: /srv/elsewhere is not a project folder on mini' }),
    ]);
  });

  it('answers the machine’s refusal by its code, and a machine this Mac cannot reach now', async () => {
    openWindow();
    const s = scene({ links: [] });
    s.ask({ verb: 'add', machine: 'mini', path: '/srv/new' });
    await s.decide('pa-1', true);
    const r = scene();
    r.replies.set('session.projects.addFolder', () => ({ ok: false, error: { code: 'internal', message: 'unknown-project: abc is in no verified projects record' } }));
    r.ask({ verb: 'add', machine: 'mini', path: '/srv/new', into: 'abc' });
    await r.decide('pa-1', true);
    expect(s.answers).toEqual([answered('pa-1', { ok: false, code: 'host_unavailable', text: 'host_unavailable: mini is not reachable from this Mac now' })]);
    expect(r.answers).toEqual([answered('pa-1', { ok: false, code: 'unknown-project', text: 'unknown-project: abc is in no verified projects record' })]);
  });
});
