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

function manager(configured: string[], known?: Parameters<typeof writeKnownMachines>[1]) {
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

  it('closes every link at close', () => {
    const m = manager([DIR_B, DIR_C]);
    m.manager.close();
    expect([m.link(DIR_B).closed, m.link(DIR_C).closed]).toEqual([true, true]);
  });
});
