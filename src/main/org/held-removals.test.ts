// The held removals (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I, "A held
// removal"; design §6, "Remove from sidebar"; M10's Proves): a removal for a location on a machine that is off is kept
// bound to the location as it was when asked, listed, and sent as `session.projects.remove` with that expectation when
// the machine's link is next up; `changed` drops it and tells the person, `unresolved` keeps it for the next link-up or a
// minute later, a removal can be cancelled, and the file outlives a relaunch. A fake session, links and machine.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import type { MachineRef } from '@shared/machine/ref';
import { memoryFiles, World } from '../../../test/org/rows-world';
import { createHeldRemovals, HELD_REMOVALS_FILE, type HeldRemovals, type RemovalAnswer } from './held-removals';

const running: HeldRemovals[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of running.splice(0)) await r.close();
});

const PATH = '/srv/scrape';
const PROJECT = '1b3c2f0e-6a4d-4a36-9f53-2d2f1d0c1a01';
const ok: RemovalAnswer = { ok: true, value: undefined };
const refused = (code: string): RemovalAnswer => ({ ok: false, error: ipcError('invalid_input', `${code}: the machine says so`) });

async function start(w: World, options: { files?: ReturnType<typeof memoryFiles>; up?: Set<string>; answers?: RemovalAnswer[] } = {}) {
  const files = options.files ?? memoryFiles();
  const up = options.up ?? new Set<string>();
  const answers = options.answers ?? [];
  const sent: Array<{ machine: string; input: unknown }> = [];
  const told: string[] = [];
  let located: { path: string; project: string } | null = { path: PATH, project: PROJECT };
  const removals = createHeldRemovals({
    session: w.session,
    files,
    locate: () => located,
    ready: (machine) => up.has(machine),
    name: (machine) => (machine === w.m1.ref ? 'mini' : machine),
    send: async (machine, input) => {
      sent.push({ machine, input });
      return answers.shift() ?? ok;
    },
    notify: (text) => told.push(text),
    now: () => w.clock,
    retryMs: 60_000,
    log: () => {},
  });
  running.push(removals);
  await removals.loaded;
  return {
    removals,
    files,
    up,
    answers,
    sent,
    told,
    relocate: (next: typeof located) => void (located = next),
    async linkUp(machine: string) {
      up.add(machine);
      removals.linkUp(machine as MachineRef);
      await removals.settled();
    },
  };
}

describe('a held removal', () => {
  it('is kept bound to the location as it was, listed, and sent with that expectation when its machine is next up', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    h.relocate({ path: '/srv/elsewhere', project: 'another' }); // what the registry says later is not what was asked
    expect(h.removals.list()).toEqual([{ id: expect.any(String), project: PROJECT, machine: w.m1.ref, pid: 'p1', path: PATH, askedAt: new Date(w.clock).toISOString() }]);
    expect(h.removals.holds(w.m1.ref, 'p1')).toBe(true);
    expect(h.sent).toEqual([]);
    await h.linkUp(w.m1.ref);
    expect(h.sent).toEqual([{ machine: w.m1.ref, input: { id: 'p1', expect: { path: PATH, project: PROJECT } } }]);
    expect(h.removals.list()).toEqual([]);
    expect(h.removals.holds(w.m1.ref, 'p1')).toBe(false);
  });

  it('is sent at once when its machine is up already, and held once for one location', async () => {
    const w = await World.make();
    const h = await start(w, { up: new Set([w.m1.ref]), answers: [refused('unresolved')] });
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.removals.settled();
    expect(h.sent).toHaveLength(1);
    expect(h.removals.list()).toHaveLength(1);
  });

  it('is refused for a location no verified record names', async () => {
    const w = await World.make();
    const h = await start(w);
    h.relocate(null);
    await expect(h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' })).rejects.toThrow(/not in the registry/);
    expect(h.removals.list()).toEqual([]);
  });

  it('is cancelled on request, and nothing is sent', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.removals.cancel({ id: h.removals.list()[0].id });
    await h.linkUp(w.m1.ref);
    expect(h.sent).toEqual([]);
    expect(h.removals.list()).toEqual([]);
  });

  it('refused `changed` is dropped and the person told; refused `unresolved` stays, sent again a minute later and at the next link-up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await World.make();
    const h = await start(w, { answers: [refused('changed')] });
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.linkUp(w.m1.ref);
    expect(h.removals.list()).toEqual([]);
    expect(h.told).toEqual([`${PATH} on mini was not removed: it changed after you asked.`]);

    h.answers.push(refused('unresolved'), refused('unresolved'), ok);
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p2' });
    await h.removals.settled();
    expect(h.sent).toHaveLength(2);
    expect(h.removals.list()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await h.removals.settled();
    expect(h.sent).toHaveLength(3);
    expect(h.removals.list()).toHaveLength(1);
    await h.linkUp(w.m1.ref);
    expect(h.sent).toHaveLength(4);
    expect(h.removals.list()).toEqual([]);
    expect(h.told).toHaveLength(1);
  });

  it('stays through a machine that does not answer, and is dropped, the person told, on another refusal', async () => {
    const w = await World.make();
    const h = await start(w, { answers: [{ ok: false, error: ipcError('host_unavailable', 'not reachable') }, { ok: false, error: ipcError('internal', 'refused owners-only by machine mini', { refusal: 'owners-only' }) }] });
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.linkUp(w.m1.ref);
    expect(h.removals.list()).toHaveLength(1);
    await h.linkUp(w.m1.ref);
    expect(h.removals.list()).toEqual([]);
    expect(h.told).toEqual([`${PATH} on mini was not removed: refused owners-only by machine mini.`]);
  });

  it('outlives a relaunch, and is the asking member’s alone', async () => {
    const w = await World.make();
    let h = await start(w);
    await h.removals.hold({ machine: w.m1.ref as MachineRef, pid: 'p1' });
    await h.removals.close();
    running.splice(0);
    expect(JSON.parse(h.files.store.get(HELD_REMOVALS_FILE)!)).toMatchObject({ version: 1, removals: [{ pid: 'p1', member: w.A }] });
    h = await start(w, { files: h.files });
    expect(h.removals.list()).toHaveLength(1);
    // another member signed in on this device: not theirs to see or send
    w.session.set(w.signedIn(w.B));
    await h.removals.settled();
    expect(h.removals.list()).toEqual([]);
    expect(h.removals.holds(w.m1.ref, 'p1')).toBe(false);
    await h.linkUp(w.m1.ref);
    expect(h.sent).toEqual([]);
    w.session.set(w.signedIn(w.A));
    await h.linkUp(w.m1.ref);
    expect(h.sent).toHaveLength(1);
  });
});
