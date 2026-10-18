// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (6) and 17, the architect's
// non-forcing probe): `refreshWatch(..., {probe: true})` answers whether the owner's dataset watch still lives, and does
// nothing else: no wake, no grant read or check, no call and no change to its schedule. A dashboard shown again asks it,
// so a catch-up the broker already ran (shown, an overdue watch refreshes once) is never followed by a second refresh,
// as a forced one would be. Without the option H's forced semantics stand, unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectorAuthorization, type ConnectorGrant, type ConnectorGrantRequest, type ConnectorToolRef, type ConnectorWatchStart } from '@shared/artifacts/connectors';
import { ConnectorBroker } from './broker';
import type { ConnectorGrantAuthority, ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteTarget } from './route';

const ART = 'dash-1';
const ME = 'window-1';
const ROWS: ConnectorToolRef = { server: 'fixture', tool: 'rows' };
const META = { status: 'dataset', artifactId: ART, id: 'live', revision: 7, columns: [{ name: 'v', type: 'number' }], rows: 2 };
const WATCH = { ...ROWS, args: {}, intervalMs: 60_000 };
const PROBE = { probe: true } as const;

class Grants implements ConnectorGrantAuthority {
  granted = true;
  lists = 0;
  checks = 0;
  async list(): Promise<ConnectorGrant[]> {
    this.lists += 1;
    return this.granted ? [{ ...ROWS, fingerprint: 'fp-1', mode: 'read', grantedAt: 1 }] : [];
  }
  async grant(_artifactId: string, request: ConnectorGrantRequest) {
    return { ...request, grantedAt: 1 };
  }
  async revoke() {
    return true;
  }
  async check(): Promise<ConnectorAuthorization> {
    this.checks += 1;
    return this.granted ? { granted: true, mode: 'read' } : { granted: false, refusal: 'notGranted' };
  }
}

class Route implements ConnectorRoute {
  readonly route = 'engine' as const;
  calls = 0;
  resolves = 0;
  pending: ((answer: ConnectorRouteAnswer) => void)[] = [];
  async resolve(): Promise<ConnectorRouteTarget | null> {
    this.resolves += 1;
    return {
      fingerprint: 'fp-1',
      readOnly: true,
      call: () =>
        new Promise((resolve) => {
          this.calls += 1;
          this.pending.push(resolve);
        }),
    };
  }
  answerAll(): void {
    for (const answer of this.pending.splice(0)) answer({ ok: true, result: META });
  }
}

let route: Route;
let grants: Grants;
let broker: ConnectorBroker;
beforeEach(() => {
  vi.useFakeTimers();
  route = new Route();
  grants = new Grants();
  broker = new ConnectorBroker({ routes: [route], grants, log: () => {}, recheckWindow: (owner) => broker.setWindowShown(owner, true) });
  broker.setWindowShown(ME, true);
});
afterEach(() => {
  broker.stop();
  vi.useRealTimers();
});

function lease(owner = ME): string {
  const id = broker.open(owner, ART);
  broker.declareTools(owner, id, [ROWS]);
  broker.setVisible(owner, id, true);
  return id;
}
const started = (start: ConnectorWatchStart): string => {
  if (!start.ok) throw new Error(`watch refused: ${start.reason}`);
  return start.watchId;
};
const dataset = { dataset: { id: 'live' } };
const turn = () => vi.advanceTimersByTimeAsync(0);

describe('a non-forcing probe of a dataset watch (E3 panel)', () => {
  it('after the catch-up of an overdue watch shown again, answers true and calls nothing more; a forced refresh would call again', async () => {
    const shown = lease();
    const watch = started(broker.watchTool(ME, shown, WATCH, () => {}, dataset));
    await turn();
    route.answerAll(); // its first refresh ended
    await turn();
    expect(route.calls).toBe(1);
    broker.setVisible(ME, shown, false);
    await vi.advanceTimersByTimeAsync(120_000); // hidden past its interval: overdue
    expect(route.calls).toBe(1);
    broker.setVisible(ME, shown, true); // shown: the broker's own catch-up, once
    await turn();
    route.answerAll();
    await turn();
    expect(route.calls).toBe(2);

    // the dashboard's recovery arrives after that catch-up ended: the probe finds the handle and starts nothing
    expect(broker.refreshWatch(ME, shown, watch, PROBE)).toBe(true);
    await turn();
    expect(route.calls).toBe(2);
    // its schedule is untouched: the next refresh an interval after the catch-up, not before
    await vi.advanceTimersByTimeAsync(59_000);
    expect(route.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(route.calls).toBe(3);
    route.answerAll();
    await turn();

    // the race the probe closes: H's forced refresh of an idle watch runs another call at once
    expect(broker.refreshWatch(ME, shown, watch)).toBe(true);
    await turn();
    expect(route.calls).toBe(4);
  });

  it('answers liveness alone: true while it waits for a grant, runs, or is hidden; no wake, grant read or route', async () => {
    grants.granted = false;
    const shown = lease();
    const watch = started(broker.watchTool(ME, shown, WATCH, () => {}, dataset));
    await turn();
    expect(route.calls).toBe(0); // denied by the check: it waits, timerless, for a grant
    const before = { lists: grants.lists, checks: grants.checks, resolves: route.resolves };
    grants.granted = true; // granted in the store, unannounced: only a forced refresh would re-read it
    expect(broker.refreshWatch(ME, shown, watch, PROBE)).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect({ lists: grants.lists, checks: grants.checks, resolves: route.resolves }).toEqual(before);
    expect(route.calls).toBe(0);

    // H's forced refresh, by contrast, re-reads the grant, wakes the watch and calls
    expect(broker.refreshWatch(ME, shown, watch)).toBe(true);
    await turn();
    expect(grants.lists).toBe(before.lists + 1);
    expect(route.calls).toBe(1);
    expect(broker.refreshWatch(ME, shown, watch, PROBE)).toBe(true); // running: it lives
    broker.setVisible(ME, shown, false);
    expect(broker.refreshWatch(ME, shown, watch, PROBE)).toBe(true); // hidden: it still lives
    await turn();
    expect(route.calls).toBe(1);
  });

  it('answers false for a handle that is gone, another owner’s, or H’s generic watch, which it never refreshes', async () => {
    const shown = lease();
    const generic = started(broker.watchTool(ME, shown, WATCH, () => {}));
    const live = started(broker.watchTool(ME, shown, WATCH, () => {}, dataset));
    await turn();
    route.answerAll();
    await turn();
    expect(route.calls).toBe(2);
    expect(broker.refreshWatch(ME, shown, generic, PROBE)).toBe(false);
    expect(broker.refreshWatch('window-2', shown, live, PROBE)).toBe(false);
    broker.unwatch(ME, shown, live);
    expect(broker.refreshWatch(ME, shown, live, PROBE)).toBe(false);
    await turn();
    expect(route.calls).toBe(2);
  });
});
