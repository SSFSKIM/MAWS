// `mawsd`'s browser route per session (P5 O17 M5; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B,
// §G; acceptance 3, 4, 5): every row of §B's transition table over stand-in inputs, the render seam's operations and the
// cua sockets' notice; the epoch minted before any teardown; a splice only for the current epoch while `starting`; the
// inventory cache fed by the selected engine alone, reset at each epoch, and its watchers.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineInventory } from '@shared/ipc/schema/browser-engine';
import { createBrowserRoute, type BrowserRoute, type PeriodEnd } from './browser-route';
import type { BrowserDemand, BrowserTarget } from './cua-broker';

const S = 'S' as AppSessionId;
const T = 'T' as AppSessionId;
const ENGINE = { name: 'the render host’s connection' };
const OTHER = { name: 'another connection' };
const TAB = { tabId: 'b_0123456789ab', title: 'Dev', url: 'http://127.0.0.1:5173/', control: 'agent' as const };
const INVENTORY: EngineInventory = { tabs: [TAB], selected: TAB.tabId, state: 'ready' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => ((resolve = yes), (reject = no)));
  return { promise, resolve, reject };
}

function stand() {
  const inputs = { app: false, headless: null as string | null };
  const starts: { demand: BrowserDemand; answer: Deferred<BrowserTarget> }[] = [];
  const drops: AppSessionId[] = [];
  const changed: string[] = []; // the cua sockets' notices, with the epoch they read
  const ends: { id: AppSessionId; reason: PeriodEnd }[] = [];
  const served = new Map<AppSessionId, object>(); // the seam's: the connection each session is prepared on
  const route: BrowserRoute = createBrowserRoute({
    machine: 'mini',
    app: () => inputs.app,
    headless: () => inputs.headless,
    ensureBrowser: (demand) => {
      const answer = deferred<BrowserTarget>();
      starts.push({ demand, answer });
      return answer.promise;
    },
    dropBrowser: async (id) => {
      drops.push(id);
      served.delete(id);
    },
    engineOf: (id) => served.get(id) ?? null,
    socketPath: (id) => `/p/mawsd/render-cua/${id}.sock`,
    routeChanged: (id) => void changed.push(`${id} ${route.reading(id).epoch}`),
    log: () => {},
  });
  route.periodEnds((id, reason) => void ends.push({ id, reason }));
  const demand = (id: AppSessionId = S): BrowserDemand => ({ appSessionId: id, epoch: route.reading(id).epoch, deadline: 4_000, signal: new AbortController().signal });
  // A promotion through to `headless`, its prepare on ENGINE
  const promote = async (id: AppSessionId = S) => {
    const asked = route.ensureBrowser(demand(id));
    served.set(id, ENGINE);
    starts.at(-1)!.answer.resolve({ epoch: route.reading(id).epoch, socketPath: `/p/mawsd/render-cua/${id}.sock` });
    await asked;
    expect(route.reading(id).state).toBe('headless');
  };
  const live = (id: AppSessionId = S, pid: number | null = 4_321) => route.statusSeen(id, { process: 'ready', pid });
  return { route, inputs, starts, drops, changed, ends, served, demand, promote, live };
}

describe('the route’s state and epoch (§B)', () => {
  it('starts from its inputs, its epoch minted once and kept while nothing changes', () => {
    const t = stand();
    expect(t.route.reading(S)).toEqual({ state: 'cold', epoch: expect.any(String) });
    expect(t.route.reading(S).epoch).toBe(t.route.reading(S).epoch);
    t.inputs.app = true;
    expect(t.route.reading(T).state).toBe('relay');
    t.inputs.app = false;
    t.inputs.headless = 'the reason';
    expect(t.route.reading('U' as AppSessionId).state).toBe('none');
    expect(new Set([S, T, 'U'].map((id) => t.route.reading(id as AppSessionId).epoch)).size).toBe(3); // per session
  });

  it('cold listens while the engine is live: a live change without an exit moves no epoch, the sockets told', () => {
    const t = stand();
    const { epoch } = t.route.reading(S);
    expect(t.route.live(S)).toBe(false);
    t.live();
    expect(t.route.live(S)).toBe(true);
    expect(t.changed).toEqual([`S ${epoch}`]);
    t.route.statusSeen(S, { process: 'ready', pid: null }); // an adoption's first reading: no pid, no exit
    expect(t.route.reading(S)).toEqual({ state: 'cold', epoch });
    expect(t.changed).toHaveLength(1);
  });

  it('cold → starting at a demand, the start asked with the demand; starting → headless when it answers for the current epoch', async () => {
    const t = stand();
    t.live();
    const { epoch } = t.route.reading(S);
    const asked = t.route.ensureBrowser(t.demand());
    expect(t.route.reading(S)).toEqual({ state: 'starting', epoch });
    expect(t.starts.map(({ demand }) => demand.epoch)).toEqual([epoch]);
    expect(t.route.selection(S), 'nothing prepared yet').toBeNull();
    t.served.set(S, ENGINE);
    expect(t.route.selection(S), 'the prepare’s connection, under the epoch').toEqual({ engine: ENGINE, period: epoch });
    t.starts[0]!.answer.resolve({ epoch, socketPath: '/p/mawsd/render-cua/S.sock' });
    expect(await asked).toEqual({ epoch, socketPath: '/p/mawsd/render-cua/S.sock' });
    expect(t.route.reading(S)).toEqual({ state: 'headless', epoch });
    expect(t.route.target(S), 'later connections relayed straight to the render host').toBe('/p/mawsd/render-cua/S.sock');
  });

  it('starting → cold in the same epoch when the start fails, the failure passed on; a demand in any other state or epoch is refused', async () => {
    const t = stand();
    t.live();
    const { epoch } = t.route.reading(S);
    const asked = t.route.ensureBrowser(t.demand());
    t.starts[0]!.answer.reject(new Error('the browser on mini did not start within 4000 ms'));
    await expect(asked).rejects.toThrow('did not start within 4000 ms');
    expect(t.route.reading(S)).toEqual({ state: 'cold', epoch });
    await expect(t.route.ensureBrowser({ ...t.demand(), epoch: 'an older one' })).rejects.toThrow(/epoch/);
    t.inputs.app = true;
    t.route.inputsChanged();
    await expect(t.route.ensureBrowser(t.demand())).rejects.toThrow(/relay/);
    expect(t.starts).toHaveLength(1);
  });

  it('a retry in the same epoch owns the start: the aborted first demand’s failure leaves the retry’s start to finish headless', async () => {
    const t = stand();
    t.live();
    const { epoch } = t.route.reading(S);
    const first = t.route.ensureBrowser(t.demand());
    const retry = t.route.ensureBrowser(t.demand()); // the broker aborted the first and began again in the same epoch
    t.starts[0]!.answer.reject(new Error('aborted'));
    await expect(first).rejects.toThrow('aborted');
    expect(t.route.reading(S), 'the retry is still under way').toEqual({ state: 'starting', epoch });
    t.served.set(S, ENGINE);
    t.starts[1]!.answer.resolve({ epoch, socketPath: '/p/mawsd/render-cua/S.sock' });
    await retry;
    expect(t.route.reading(S)).toEqual({ state: 'headless', epoch });
  });

  it('a superseded demand’s late success decides nothing: the retry’s failure returns the route to cold', async () => {
    const t = stand();
    t.live();
    const { epoch } = t.route.reading(S);
    const first = t.route.ensureBrowser(t.demand());
    const retry = t.route.ensureBrowser(t.demand());
    t.starts[0]!.answer.resolve({ epoch, socketPath: '/p/mawsd/render-cua/S.sock' });
    await first;
    expect(t.route.reading(S).state).toBe('starting');
    t.starts[1]!.answer.reject(new Error('the browser on mini did not start within 4000 ms'));
    await expect(retry).rejects.toThrow('did not start');
    expect(t.route.reading(S)).toEqual({ state: 'cold', epoch });
  });

  it('a start answering after the epoch moved leaves the route where it moved: never headless, the target its own epoch', async () => {
    const t = stand();
    t.live();
    const before = t.route.reading(S).epoch;
    const asked = t.route.ensureBrowser(t.demand());
    t.inputs.app = true;
    t.route.inputsChanged();
    const after = t.route.reading(S);
    expect(after.state).toBe('relay');
    t.starts[0]!.answer.resolve({ epoch: before, socketPath: '/p/mawsd/render-cua/S.sock' });
    expect((await asked).epoch).toBe(before); // the broker compares it with the route's and never splices
    expect(t.route.reading(S)).toEqual(after);
    expect(t.route.target(S)).toBeNull();
  });

  it('any but relay → relay at an app’s arrival: the epoch minted before the sockets change, then the old route dropped', async () => {
    const t = stand();
    t.live();
    await t.promote();
    const before = t.route.reading(S).epoch;
    let seen: { epoch: string; drops: number } | null = null;
    t.inputs.app = true;
    t.route.inputsChanged(() => (seen = { epoch: t.route.reading(S).epoch, drops: t.drops.length }));
    expect(seen!.epoch, 'minted before anything of the old route is torn down').not.toBe(before);
    expect(seen!.drops, 'the drop after the sockets moved').toBe(0);
    expect(t.route.reading(S)).toEqual({ state: 'relay', epoch: seen!.epoch });
    expect(t.drops).toEqual([S]);
    expect(t.ends).toEqual([{ id: S, reason: 'engine_changed' }]);
    expect(t.changed.at(-1)).toBe(`S ${seen!.epoch}`);
    expect(t.route.selection(S)).toBeNull();
  });

  it('cold → relay drops nothing (nothing prepared); relay → cold or none at the departure, epoch+1', () => {
    const t = stand();
    t.live();
    const epochs = [t.route.reading(S).epoch];
    t.inputs.app = true;
    t.route.inputsChanged();
    epochs.push(t.route.reading(S).epoch);
    expect(t.drops).toEqual([]);
    t.inputs.app = false;
    t.route.inputsChanged();
    expect(t.route.reading(S).state).toBe('cold');
    epochs.push(t.route.reading(S).epoch);
    t.inputs.app = true;
    t.route.inputsChanged();
    t.inputs.headless = 'the reason';
    t.inputs.app = false;
    t.route.inputsChanged();
    expect(t.route.reading(S).state).toBe('none');
    epochs.push(t.route.reading(S).epoch);
    expect(new Set(epochs).size).toBe(4);
    expect(t.ends.map(({ reason }) => reason)).toEqual(['engine_changed', 'engine_changed', 'engine_changed', 'engine_changed']);
  });

  it('none ↔ cold as the headless browser becomes usable or not; from starting or headless the old route is dropped', async () => {
    const t = stand();
    t.inputs.headless = 'the engine host on mini predates browser work holds; it is replaced when idle';
    t.live();
    const none = t.route.reading(S);
    expect(none.state).toBe('none');
    t.inputs.headless = null;
    t.route.inputsChanged();
    const cold = t.route.reading(S);
    expect(cold.state).toBe('cold');
    expect(cold.epoch).not.toBe(none.epoch);
    expect(t.changed.at(-1)).toBe(`S ${cold.epoch}`); // listen, the engine live
    await t.promote();
    t.inputs.headless = 'the render service is unavailable on mini: it failed twice';
    t.route.inputsChanged();
    expect(t.route.reading(S).state).toBe('none');
    expect(t.drops).toEqual([S]);
    t.route.inputsChanged(); // nothing changed: nothing moves
    expect(t.drops).toEqual([S]);
  });

  it('starting or headless → cold, epoch+1, when the render host serving it ends (none when no longer usable): nothing to drop', async () => {
    const t = stand();
    t.live();
    await t.promote();
    const before = t.route.reading(S).epoch;
    t.served.delete(S);
    t.route.engineEnded(S);
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.route.reading(S).epoch).not.toBe(before);
    expect(t.drops).toEqual([]);
    expect(t.ends).toEqual([{ id: S, reason: 'engine_changed' }]);
    // a start whose prepare was under way
    void t.route.ensureBrowser(t.demand()).catch(() => {});
    t.inputs.headless = 'the render service is unavailable on mini: x';
    t.route.engineEnded(S);
    expect(t.route.reading(S).state).toBe('none');
    t.route.engineEnded(S); // not starting or headless: nothing
    expect(t.ends).toHaveLength(2);
  });

  it('headless → cold at the engine’s exit (exited, another pid, or the same pid running another engine), its tabs dropped; no exit at a missing pid or a lost link', async () => {
    const t = stand();
    t.live(S, 100);
    await t.promote();
    const epoch = t.route.reading(S).epoch;
    t.route.statusSeen(S, { process: 'ready', pid: null }); // an engine-host restart's adoption: no exit
    t.route.statusSeen(S, { process: 'ready', pid: 100 });
    expect(t.route.reading(S)).toEqual({ state: 'headless', epoch });
    t.route.statusSeen(S, { process: 'ready', pid: 200 }); // another engine: an exit
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.drops).toEqual([S]);
    expect(t.ends).toEqual([{ id: S, reason: 'tab_closed' }]);
    expect(t.route.live(S)).toBe(true);
    await t.promote(); // the resumed engine's next demand prepares again
    t.route.statusSeen(S, { process: 'exited', pid: null });
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.route.live(S), 'a released session’s listener stops').toBe(false);
    expect(t.drops).toEqual([S, S]);
    t.live(S, 100);
    await t.promote();
    const before = t.route.reading(S).epoch;
    t.route.statusSeen(S, { process: 'ready', pid: 100, replaced: true }); // the same pid running another engine: an exit
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.route.reading(S).epoch).not.toBe(before);
    expect(t.drops).toEqual([S, S, S]);
  });

  it('a start under way when the engine exits is dropped too: no prepared session outlives its engine', () => {
    const t = stand();
    t.live(S, 100);
    void t.route.ensureBrowser(t.demand()).catch(() => {});
    t.served.set(S, ENGINE);
    const epoch = t.route.reading(S).epoch;
    t.route.statusSeen(S, { process: 'exited', pid: null });
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.route.reading(S).epoch).not.toBe(epoch);
    expect(t.drops).toEqual([S]);
  });

  it('headless → cold at host.browserIdle with work held, its tabs dropped; ignored with nothing held or nothing headless', async () => {
    const t = stand();
    t.live();
    t.route.browserIdle(S, true); // cold: nothing to close
    expect(t.drops).toEqual([]);
    await t.promote();
    const epoch = t.route.reading(S).epoch;
    t.route.browserIdle(S, false); // nothing held for it
    expect(t.route.reading(S)).toEqual({ state: 'headless', epoch });
    t.route.browserIdle(S, true);
    expect(t.route.reading(S).state).toBe('cold');
    expect(t.route.reading(S).epoch).not.toBe(epoch);
    expect(t.drops).toEqual([S]);
    expect(t.ends).toEqual([{ id: S, reason: 'tab_closed' }]);
    expect(t.route.live(S), 'the session stays resumable: its socket listens cold').toBe(true);
  });

  it('a removed session goes: dropped when headless, its period ended', async () => {
    const t = stand();
    t.live();
    await t.promote();
    t.route.removed(S);
    expect(t.drops).toEqual([S]);
    expect(t.ends).toEqual([{ id: S, reason: 'tab_closed' }]);
    t.route.removed(T); // never seen: nothing
    expect(t.drops).toEqual([S]);
  });
});

describe('the inventory cache (§G, read by M6)', () => {
  it('takes browserEngine.state from the selected connection alone, stamps the epoch, and resets at each epoch', async () => {
    const t = stand();
    t.live();
    expect(t.route.inventory(S)).toEqual({ epoch: t.route.reading(S).epoch, tabs: [], selected: null, state: 'ready' });
    await t.promote();
    expect(t.route.state(OTHER, { appSessionId: S, inventory: INVENTORY }), 'not the selected connection').toBe(false);
    expect(t.route.state(ENGINE, { appSessionId: S, inventory: INVENTORY })).toBe(true);
    expect(t.route.inventory(S)).toEqual({ epoch: t.route.reading(S).epoch, ...INVENTORY });
    expect(t.route.counts()).toEqual({ browserSessions: 1, browserTabs: 1 });
    t.served.delete(S);
    t.route.engineEnded(S);
    expect(t.route.inventory(S)).toEqual({ epoch: t.route.reading(S).epoch, tabs: [], selected: null, state: 'ready' });
    expect(t.route.counts()).toEqual({ browserSessions: 0, browserTabs: 0 });
    expect(t.route.state(ENGINE, { appSessionId: S, inventory: INVENTORY }), 'a retired period’s late state').toBe(false);
  });

  it('reads the app’s and the unusable route’s reasons, and tells a watcher at once and at each change', async () => {
    const t = stand();
    t.live();
    const seen: unknown[] = [];
    const stop = t.route.watchInventory(S, (inventory) => void seen.push(inventory));
    expect(seen).toHaveLength(1);
    await t.promote();
    t.route.state(ENGINE, { appSessionId: S, inventory: INVENTORY });
    expect(seen.at(-1)).toMatchObject({ tabs: [TAB] });
    t.inputs.app = true;
    t.route.inputsChanged();
    expect(seen.at(-1)).toEqual({ epoch: t.route.reading(S).epoch, tabs: [], selected: null, state: 'unavailable', reason: "the agent's browser is in the MAWS app on mini" });
    t.inputs.app = false;
    t.inputs.headless = 'the reason';
    t.route.inputsChanged();
    expect(seen.at(-1)).toEqual({ epoch: t.route.reading(S).epoch, tabs: [], selected: null, state: 'unavailable', reason: 'the reason' });
    // still `none`, for another reason: told, in the same period; an unchanged reason tells nothing
    const { epoch } = t.route.reading(S);
    const before = seen.length;
    t.inputs.headless = 'another reason';
    t.route.inputsChanged();
    expect(seen.slice(before)).toEqual([{ epoch, tabs: [], selected: null, state: 'unavailable', reason: 'another reason' }]);
    expect(t.route.reading(S).epoch, 'no epoch minted').toBe(epoch);
    t.route.inputsChanged();
    expect(seen).toHaveLength(before + 1);
    stop();
    const count = seen.length;
    t.inputs.headless = null;
    t.route.inputsChanged();
    expect(seen).toHaveLength(count);
  });

  it('keeps its watchers across the entry’s replacement: an adopted engine’s exit, then its resume', async () => {
    const t = stand();
    t.live();
    const seen: { epoch: string; tabs: unknown[] }[] = [];
    t.route.watchInventory(S, (inventory) => void seen.push(inventory));
    await t.promote();
    t.route.state(ENGINE, { appSessionId: S, inventory: INVENTORY });
    t.route.statusSeen(S, { process: 'exited', pid: null });
    t.route.removed(S); // daemon.ts: an exited engine no launch of this daemon was told of
    const told = seen.length;
    t.live(S, 5_678); // resumed: a new entry for the same session
    expect(seen.slice(told), 'the new period’s epoch told').toEqual([{ epoch: t.route.reading(S).epoch, tabs: [], selected: null, state: 'ready' }]);
    await t.promote();
    t.route.state(ENGINE, { appSessionId: S, inventory: INVENTORY });
    expect(seen.at(-1)).toEqual({ epoch: t.route.reading(S).epoch, ...INVENTORY });
  });
});
