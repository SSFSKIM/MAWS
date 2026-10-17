// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 11 and 12, the architect's watch
// priority ruling): at the app's 64-watch cap, a watch asked for by a visible surface, H's or E3's, takes the slot of the
// oldest dormant E3 dataset-sink watch (one whose surface is hidden and that runs nothing); H's generic watches and
// visible watches never yield, and a hidden surface's request evicts nothing. The evicted handle answers
// `refreshWatch: false` once shown, so its dashboard registers it again. A dataset watch whose refresh is in flight
// answers true (that refresh is the one asked), so a running handle is never mistaken for an evicted one; H's generic
// watches keep their answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_WATCH_LIMIT, type ConnectorAuthorization, type ConnectorGrant, type ConnectorGrantRequest, type ConnectorToolRef, type ConnectorWatchStart } from '@shared/artifacts/connectors';
import { ConnectorBroker } from './broker';
import type { ConnectorGrantAuthority, ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteTarget } from './route';

const ART = 'dash-1';
const ME = 'window-1';
const ROWS: ConnectorToolRef = { server: 'fixture', tool: 'rows' };
const META = { status: 'dataset', artifactId: ART, id: 'live', revision: 7, columns: [{ name: 'v', type: 'number' }], rows: 2 };
const WATCH = { ...ROWS, args: {}, intervalMs: 60_000 };

class Grants implements ConnectorGrantAuthority {
  async list(): Promise<ConnectorGrant[]> {
    return [{ ...ROWS, fingerprint: 'fp-1', mode: 'read', grantedAt: 1 }];
  }
  async grant(_artifactId: string, request: ConnectorGrantRequest) {
    return { ...request, grantedAt: 1 };
  }
  async revoke() {
    return true;
  }
  async check(): Promise<ConnectorAuthorization> {
    return { granted: true, mode: 'read' };
  }
}

class Route implements ConnectorRoute {
  readonly route = 'engine' as const;
  calls = 0;
  pending: ((answer: ConnectorRouteAnswer) => void)[] = [];
  async resolve(): Promise<ConnectorRouteTarget | null> {
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
}

let route: Route;
let broker: ConnectorBroker;
beforeEach(() => {
  vi.useFakeTimers();
  route = new Route();
  broker = new ConnectorBroker({ routes: [route], grants: new Grants(), log: () => {}, recheckWindow: (owner) => broker.setWindowShown(owner, true) });
  broker.setWindowShown(ME, true);
});
afterEach(() => {
  broker.stop();
  vi.useRealTimers();
});

function lease(visible: boolean): string {
  const id = broker.open(ME, ART);
  broker.declareTools(ME, id, [ROWS]);
  if (visible) broker.setVisible(ME, id, true);
  return id;
}
const started = (start: ConnectorWatchStart): string => {
  if (!start.ok) throw new Error(`watch refused: ${start.reason}`);
  return start.watchId;
};
const dataset = (id = 'live') => ({ dataset: { id } });

// Fills the cap: `datasets` dormant dataset watches on hidden leases (oldest first), then generic hidden ones.
function fill(datasets: number): { leases: string[]; watches: string[] } {
  const leases: string[] = [];
  const watches: string[] = [];
  for (let i = 0; i < CONNECTOR_WATCH_LIMIT; i += 1) {
    const hidden = lease(false);
    leases.push(hidden);
    watches.push(started(broker.watchTool(ME, hidden, WATCH, () => {}, i < datasets ? dataset(`d${i}`) : undefined)));
  }
  return { leases, watches };
}

describe('the watch cap yields dormant E3 dataset watches to a visible request (E3 M3 fix)', () => {
  it('a visible generic H request takes the oldest dormant dataset watch’s slot; the evicted handle answers false once shown', () => {
    const { leases, watches } = fill(3);
    const shown = lease(true);
    expect(broker.watchTool(ME, shown, WATCH, () => {}).ok).toBe(true);
    broker.setVisible(ME, leases[0]!, true);
    broker.setVisible(ME, leases[1]!, true);
    expect(broker.refreshWatch(ME, leases[0]!, watches[0]!)).toBe(false); // evicted: its dashboard registers it again
    expect(broker.refreshWatch(ME, leases[1]!, watches[1]!)).toBe(true); // the next oldest kept its slot
    // its shown dashboard registers it again: the oldest dormant dataset watch left (d2) yields; d1, shown, does not
    expect(broker.watchTool(ME, leases[0]!, WATCH, () => {}, dataset('d0')).ok).toBe(true);
    expect(broker.refreshWatch(ME, leases[1]!, watches[1]!)).toBe(true);
    broker.setVisible(ME, leases[2]!, true);
    expect(broker.refreshWatch(ME, leases[2]!, watches[2]!)).toBe(false);
  });

  it('a visible dataset request yields the oldest dormant one too, in order', () => {
    const { leases, watches } = fill(2);
    const shown = lease(true);
    expect(broker.watchTool(ME, shown, WATCH, () => {}, dataset('a')).ok).toBe(true);
    expect(broker.watchTool(ME, shown, WATCH, () => {}, dataset('b')).ok).toBe(true);
    expect(broker.watchTool(ME, shown, WATCH, () => {})).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    for (const i of [0, 1]) {
      broker.setVisible(ME, leases[i]!, true);
      expect(broker.refreshWatch(ME, leases[i]!, watches[i]!)).toBe(false);
    }
  });

  it('never evicts H’s generic watches, a visible dataset watch, or for a hidden surface’s request', () => {
    fill(0); // all generic
    expect(broker.watchTool(ME, lease(true), WATCH, () => {}, dataset())).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    broker.stop();
    broker = new ConnectorBroker({ routes: [route], grants: new Grants(), log: () => {}, recheckWindow: (owner) => broker.setWindowShown(owner, true) });
    broker.setWindowShown(ME, true);
    const shown = lease(true);
    for (let i = 0; i < CONNECTOR_WATCH_LIMIT; i += 1) started(broker.watchTool(ME, shown, WATCH, () => {}, dataset(`v${i}`))); // visible dataset watches
    expect(broker.watchTool(ME, lease(true), WATCH, () => {})).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    broker.stop();
    broker = new ConnectorBroker({ routes: [route], grants: new Grants(), log: () => {}, recheckWindow: (owner) => broker.setWindowShown(owner, true) });
    broker.setWindowShown(ME, true);
    fill(CONNECTOR_WATCH_LIMIT); // all dormant dataset watches, but the request is a hidden surface's
    expect(broker.watchTool(ME, lease(false), WATCH, () => {}, dataset())).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
  });

  it('a dataset watch whose refresh runs answers refreshWatch true without a second call; H’s generic one keeps false', async () => {
    const shown = lease(true);
    const live = started(broker.watchTool(ME, shown, WATCH, () => {}, dataset()));
    const generic = started(broker.watchTool(ME, shown, WATCH, () => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(route.calls).toBe(2); // both refreshing at once
    expect(broker.refreshWatch(ME, shown, live)).toBe(true);
    expect(broker.refreshWatch(ME, shown, generic)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(route.calls).toBe(2);
    for (const answer of route.pending.splice(0)) answer({ ok: true, result: META });
    await vi.advanceTimersByTimeAsync(0);
    expect(broker.refreshWatch(ME, shown, live)).toBe(true); // idle and shown: a refresh now, as H's
    await vi.advanceTimersByTimeAsync(0);
    expect(route.calls).toBe(3);
  });
});
