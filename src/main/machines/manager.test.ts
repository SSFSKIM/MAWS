// The connection manager (P5 O6 M3, "Machine links"): dispatch by machine, machines.changed on each transition with the
// generation of each welcome, events relayed with their link's machine, and known machines kept across launches.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext } from '../ipc/router';
import { KNOWN_MACHINES_FILE, writeKnownMachines } from './known-machines';
import { createLocalLink } from './local-link';
import { createConnectionManager, type LinkState, type MachineLink } from './manager';
import type { RemoteSource } from './remote/source';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const B = 'StandinBMachineRef0000' as MachineRef;
const C = 'StandinCMachineRef0000' as MachineRef;
const DIR_B = '/profiles/b/machine-serve';
const DIR_C = '/profiles/c/machine-serve';
const ctx: MainContext = { client: endableClientRef('page:1.1'), target: LOCAL };

// A link the test drives: `up(ref, name)` is a welcome whose identity answered, `down()` a close.
interface FakeLink extends MachineLink {
  up(ref: MachineRef, name: string): void;
  down(): void;
  emit(name: EventName, payload: unknown): void;
  calls: [CommandName, unknown][];
  closed: boolean;
}
function fakeLink(): FakeLink {
  let state: LinkState = 'connecting';
  let identity: { ref: MachineRef; name: string } | null = null;
  const stateListeners = new Set<(state: LinkState) => void>();
  const eventListeners = new Set<(name: EventName, payload: unknown) => void>();
  const set = (next: LinkState) => {
    state = next;
    for (const listener of stateListeners) listener(next);
  };
  const link: FakeLink = {
    get machine() {
      return identity?.ref ?? null;
    },
    get name() {
      return identity?.name ?? null;
    },
    state: () => state,
    calls: [],
    closed: false,
    async dispatch(name, input) {
      link.calls.push([name, input]);
      return { ok: true, value: { from: identity?.ref } } as unknown as CommandResult<CommandName>;
    },
    onState: (listener) => (stateListeners.add(listener), () => void stateListeners.delete(listener)),
    onEvent: (listener) => (eventListeners.add(listener), () => void eventListeners.delete(listener)),
    close() {
      link.closed = true;
      if (state !== 'down') set('down');
    },
    up(ref, name) {
      identity = { ref, name };
      set('up');
    },
    down: () => set('down'),
    emit: (name, payload) => eventListeners.forEach((listener) => listener(name, payload)),
  };
  return link;
}

const dirs: string[] = [];
afterEach(() => {
  for (const made of dirs.splice(0)) rmSync(made, { recursive: true, force: true });
});

// The RL2 source the test drives (P5 O7 M1): `roster` is what the org session lists; `set` changes it.
interface FakeRemote extends RemoteSource {
  set(roster: { ref: MachineRef; name: string }[]): void;
  links: Map<MachineRef, FakeLink & { carrierNow: string | null; refusalNow: string | null; carrier(): string | null; refusal(): string | null }>;
}
function fakeRemote(initial: { ref: MachineRef; name: string }[] = []): FakeRemote {
  let roster = initial;
  const listeners = new Set<() => void>();
  const links: FakeRemote['links'] = new Map();
  return {
    links,
    machines: () => roster,
    onChanged: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    connect(machine) {
      const base = fakeLink();
      const link = Object.assign(base, {
        carrierNow: null as string | null,
        refusalNow: null as string | null,
        carrier: () => link.carrierNow,
        refusal: () => link.refusalNow,
      });
      Object.defineProperty(link, 'machine', { get: () => machine.ref });
      links.set(machine.ref, link);
      return link;
    },
    set(next) {
      roster = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function manager(configured: string[], known?: Parameters<typeof writeKnownMachines>[1], remote?: RemoteSource) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-manager-'));
  dirs.push(dir);
  const knownMachinesFile = join(dir, KNOWN_MACHINES_FILE);
  if (known) writeKnownMachines(knownMachinesFile, known);
  const links = new Map<string, FakeLink>();
  const dispatchLocal = vi.fn<(name: CommandName, input: unknown, ctx: MainContext) => Promise<CommandResult<CommandName>>>(async () => ({ ok: true, value: 'local' }) as unknown as CommandResult<CommandName>);
  const emitFrom = vi.fn<(machine: MachineRef, name: EventName, payload: unknown) => boolean>(() => true);
  const log = vi.fn<(line: string) => void>();
  const made = createConnectionManager({
    local: LOCAL,
    localName: 'standin-a',
    localLink: createLocalLink({ ref: LOCAL, name: 'standin-a', dispatchLocal }),
    knownMachinesFile,
    configured,
    emitFrom,
    connect: (at) => {
      const link = fakeLink();
      links.set(at, link);
      return link;
    },
    remote,
    log,
  });
  const changes: MachineState[][] = [];
  made.onChanged((machines) => void changes.push(machines));
  const knownFile = () => JSON.parse(readFileSync(knownMachinesFile, 'utf8')) as { version: number; machines: unknown[] };
  return { manager: made, links, dispatchLocal, emitFrom, log, changes, knownFile, link: (at: string) => links.get(at)! };
}

const brief = (machines: MachineState[]) => machines.map(({ ref, state, generation, local }) => ({ ref, state, generation, local }));

describe('the connection manager', () => {
  it('holds only the local machine when none is configured, and dispatches it through the router’s local path', async () => {
    const m = manager([]);
    expect(brief(m.manager.list())).toEqual([{ ref: LOCAL, state: 'up', generation: 0, local: true }]);
    expect(m.manager.list()[0]!.name).toBe('standin-a');
    await expect(m.manager.dispatch(LOCAL, 'session.list', {}, ctx)).resolves.toEqual({ ok: true, value: 'local' });
    expect(m.dispatchLocal).toHaveBeenCalledWith('session.list', {}, { client: ctx.client, target: LOCAL });
  });

  it('dispatches by machine: an up machine through its link, an unknown or down one host_unavailable at once', async () => {
    const m = manager([DIR_B, DIR_C]);
    m.link(DIR_B).up(B, 'standin-b');
    await expect(m.manager.dispatch(B, 'session.list', {}, ctx)).resolves.toEqual({ ok: true, value: { from: B } });
    expect(m.link(DIR_B).calls).toEqual([['session.list', {}]]);
    await expect(m.manager.dispatch(C, 'session.list', {}, ctx)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    m.link(DIR_B).down();
    await expect(m.manager.dispatch(B, 'session.list', {}, ctx)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable', message: `session.list: machine ${B} is not connected` } });
    expect(m.link(DIR_B).calls).toHaveLength(1);
    expect(m.link(DIR_C).calls).toEqual([]);
    expect(m.dispatchLocal).not.toHaveBeenCalled();
  });

  it('sends machines.changed on each transition, a new generation on each up', () => {
    const m = manager([DIR_B]);
    expect(brief(m.manager.list())).toEqual([{ ref: LOCAL, state: 'up', generation: 0, local: true }]); // B is not known yet
    m.link(DIR_B).up(B, 'standin-b');
    m.link(DIR_B).down();
    m.link(DIR_B).up(B, 'standin-b');
    expect(m.changes.map((machines) => brief(machines)[1])).toEqual([
      { ref: B, state: 'up', generation: 1, local: false },
      { ref: B, state: 'down', generation: 1, local: false },
      { ref: B, state: 'up', generation: 2, local: false },
    ]);
    expect(m.changes.every((machines) => machines[0]!.ref === LOCAL)).toBe(true);
    expect(m.manager.list()[1]).toMatchObject({ name: 'standin-b', since: expect.any(String) });
  });

  it('relays a link’s events with that link’s machine, and none from a link not up', () => {
    const m = manager([DIR_B]);
    m.link(DIR_B).emit('session.changed', { a: 1 });
    expect(m.emitFrom).not.toHaveBeenCalled();
    m.link(DIR_B).up(B, 'standin-b');
    m.link(DIR_B).emit('session.changed', { a: 2 });
    expect(m.emitFrom).toHaveBeenCalledWith(B, 'session.changed', { a: 2 });
  });

  it('remembers a learned machine, lists it connecting at the next launch before its link is up, and forgets one no longer configured', () => {
    const first = manager([DIR_B]);
    first.link(DIR_B).up(B, 'standin-b');
    expect(first.knownFile()).toEqual({ version: 1, machines: [{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_B } }] });
    const known = first.knownFile().machines as Parameters<typeof writeKnownMachines>[1];

    const relaunch = manager([DIR_B], known);
    expect(brief(relaunch.manager.list())).toEqual([
      { ref: LOCAL, state: 'up', generation: 0, local: true },
      { ref: B, state: 'connecting', generation: 0, local: false },
    ]);
    relaunch.link(DIR_B).down();
    expect(brief(relaunch.manager.list())[1]).toEqual({ ref: B, state: 'down', generation: 0, local: false }); // known, and down: its tabs stay (M4)

    const unconfigured = manager([DIR_C], known);
    expect(brief(unconfigured.manager.list())).toEqual([{ ref: LOCAL, state: 'up', generation: 0, local: true }]);
    expect(unconfigured.knownFile()).toEqual({ version: 1, machines: [] });
  });

  it('adopts another ref answered from a known directory, saying it now holds another profile', () => {
    const m = manager([DIR_B], [{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_B } }]);
    m.link(DIR_B).up(C, 'standin-c');
    expect(brief(m.manager.list())[1]).toEqual({ ref: C, state: 'up', generation: 1, local: false });
    expect(m.log).toHaveBeenCalledWith(expect.stringContaining('holds another profile'));
    expect(m.knownFile().machines).toEqual([{ ref: C, name: 'standin-c', carrier: { kind: 'socket', dir: DIR_B } }]);
  });

  it('closes a link that reaches this machine or one another directory already reaches', () => {
    const m = manager([DIR_B, DIR_C]);
    m.link(DIR_B).up(B, 'standin-b');
    m.link(DIR_C).up(B, 'standin-b');
    expect(m.link(DIR_C).closed).toBe(true);
    expect(brief(m.manager.list()).map(({ ref }) => ref)).toEqual([LOCAL, B]);
    const self = manager([DIR_B]);
    self.link(DIR_B).up(LOCAL, 'standin-a');
    expect(self.link(DIR_B).closed).toBe(true);
    expect(brief(self.manager.list()).map(({ ref }) => ref)).toEqual([LOCAL]);
  });

  it('lets a live directory take over a remembered ref from one that is not up, whatever the order the directories are configured in', async () => {
    for (const configured of [[DIR_B, DIR_C], [DIR_C, DIR_B]]) {
      const m = manager(configured, [{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_B } }]);
      m.link(DIR_B).down(); // B's old directory is away
      m.link(DIR_C).up(B, 'standin-b'); // and B now answers from the new one
      expect(m.link(DIR_C).closed, configured.join(' ')).toBe(false);
      expect(brief(m.manager.list()), configured.join(' ')).toEqual([
        { ref: LOCAL, state: 'up', generation: 0, local: true },
        { ref: B, state: 'up', generation: 1, local: false }, // the old directory is kept, with no ref until it identifies
      ]);
      await expect(m.manager.dispatch(B, 'session.list', {}, ctx)).resolves.toEqual({ ok: true, value: { from: B } });
      expect(m.link(DIR_C).calls).toHaveLength(1);
      expect(m.knownFile().machines).toEqual([{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_C } }]);
      expect(m.log).toHaveBeenCalledWith(expect.stringContaining(`${DIR_C} now reaches machine ${B}`));

      m.link(DIR_B).up(C, 'standin-c'); // the old directory, back, holds another profile: listed as that one
      expect(brief(m.manager.list()).map(({ ref, state }) => `${ref} ${state}`)).toEqual(expect.arrayContaining([`${B} up`, `${C} up`]));
    }
  });

  it('counts a machine’s generations by its ref, whichever directory carries it: a carrier change is a new generation', () => {
    const m = manager([DIR_B, DIR_C]);
    m.link(DIR_B).up(B, 'standin-b');
    m.link(DIR_B).down();
    m.link(DIR_C).up(B, 'standin-b'); // B answers from a new directory
    m.link(DIR_C).down();
    m.link(DIR_C).up(B, 'standin-b');
    expect(m.changes.map((machines) => machines.find((machine) => machine.ref === B)).map((b) => b && `${b.state}:${b.generation}`)).toEqual(['up:1', 'down:1', 'up:2', 'down:2', 'up:3']);
  });

  it('still refuses a directory that reaches a machine another directory reaches while up', () => {
    const m = manager([DIR_B, DIR_C], [{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_B } }]);
    m.link(DIR_B).up(B, 'standin-b');
    m.link(DIR_C).up(B, 'standin-b');
    expect(m.link(DIR_C).closed).toBe(true);
    expect(m.knownFile().machines).toEqual([{ ref: B, name: 'standin-b', carrier: { kind: 'socket', dir: DIR_B } }]);
  });

  it('closes every link at close', () => {
    const m = manager([DIR_B, DIR_C]);
    m.manager.close();
    expect([m.link(DIR_B).closed, m.link(DIR_C).closed]).toEqual([true, true]);
  });
});

describe('RL2 machines (P5 O7 M1)', () => {
  const D = 'RemoteDMachineRef00000' as MachineRef;
  const E = 'RemoteEMachineRef00000' as MachineRef;

  it('lists an RL2 machine `connecting` from creation, `up` with its carrier, renamed on a rename, dropped when the roster drops it', () => {
    const remote = fakeRemote([{ ref: D, name: 'mini' }]);
    const m = manager([], undefined, remote);
    expect(m.manager.list().find((x) => x.ref === D)).toMatchObject({ ref: D, name: 'mini', state: 'connecting', local: false, generation: 0 });
    const link = remote.links.get(D)!;
    link.carrierNow = 'relay';
    link.up(D, 'mini');
    expect(m.manager.list().find((x) => x.ref === D)).toMatchObject({ state: 'up', carrier: 'relay', generation: 1 });
    link.carrierNow = 'direct';
    link.up(D, 'mini'); // the switch: heard, no new generation
    expect(m.changes.at(-1)!.find((x) => x.ref === D)).toMatchObject({ state: 'up', carrier: 'direct', generation: 1 });
    remote.set([{ ref: D, name: 'mini-2' }]);
    expect(m.manager.list().find((x) => x.ref === D)!.name).toBe('mini-2');
    remote.set([]);
    expect(link.closed).toBe(true);
    expect(m.manager.list().map((x) => x.ref)).toEqual([LOCAL]);
  });

  it('reports a link’s refusal while it holds', () => {
    const remote = fakeRemote([{ ref: D, name: 'mini' }]);
    const m = manager([], undefined, remote);
    const link = remote.links.get(D)!;
    link.refusalNow = 'removed';
    link.down();
    expect(m.manager.list().find((x) => x.ref === D)).toMatchObject({ state: 'down', refusal: 'removed' });
    expect(m.manager.list().find((x) => x.ref === D)!.carrier).toBeUndefined();
  });

  it('closes an RL2 link that comes up for a ref a socket link already reaches up', () => {
    const remote = fakeRemote([{ ref: B, name: 'standin-b' }]);
    const m = manager([DIR_B], undefined, remote);
    m.link(DIR_B).up(B, 'standin-b');
    remote.links.get(B)!.up(B, 'standin-b');
    expect(remote.links.get(B)!.closed).toBe(true);
    expect(m.manager.list().filter((x) => x.ref === B)).toEqual([expect.objectContaining({ state: 'up', carrier: 'socket' })]);
    expect(m.log).toHaveBeenCalledWith(expect.stringContaining('closing the RL2 link'));
  });

  it('dispatches to an RL2 entry by ref, and never to the local or an unknown one', async () => {
    const remote = fakeRemote([{ ref: D, name: 'mini' }, { ref: E, name: 'vm' }]);
    const m = manager([], undefined, remote);
    remote.links.get(D)!.up(D, 'mini');
    await expect(m.manager.dispatch(D, 'session.list', {}, ctx)).resolves.toEqual({ ok: true, value: { from: D } });
    expect(remote.links.get(D)!.calls).toEqual([['session.list', {}]]);
    await expect(m.manager.dispatch(E, 'session.list', {}, ctx)).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('closes RL2 links at close', () => {
    const remote = fakeRemote([{ ref: D, name: 'mini' }]);
    const m = manager([], undefined, remote);
    m.manager.close();
    expect(remote.links.get(D)!.closed).toBe(true);
  });
});
