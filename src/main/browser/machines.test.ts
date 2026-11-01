// P5 O7 M3: the browser's events for a session on another machine (machines.ts). Every browser event whose payload can
// name a session (the registry's addressed paths) has a sample here holding a remote session's key at each such path,
// and leaves main from that session's machine with the bare id, valid and liftable. A new event naming a session, or a
// new place a tab sits in one, fails the enumeration until it has a sample.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REGISTRY } from '@shared/ipc/registry';
import type { EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { addressedPaths, addressingOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { SessionMachines } from './machines';

const LOCAL = 'LocalMachineRef0000' as MachineRef;
const OTHER = 'OtherMachineRef0000' as MachineRef;
const THIRD = 'ThirdMachineRef0000' as MachineRef;
const BARE = 'App-R' as AppSessionId;
const TAB_ID = 'b_0123456789ab';

const tab = (appSessionId: string) => ({
  tabId: TAB_ID, appSessionId, partition: 'persist:maws-browser', url: 'http://127.0.0.1:49152/', title: 'Dev', favicon: null,
  loading: false, canGoBack: false, canGoForward: false, zoom: 1, control: 'idle', controlSince: '2026-11-01T00:00:00.000Z',
  suspended: false, loadError: null, crashed: null, failed: null, unresponsive: false, blockedPopups: 0, find: null, denied: [],
  download: null, memoryKiB: null, placedIn: null, covered: false, createdAt: '2026-11-01T00:00:00.000Z', lastShownAt: '2026-11-01T00:00:00.000Z',
  agentBadge: null, internal: null, forward: { machine: OTHER, port: 5173, localPort: 49152 },
});

/** Each browser event naming a session, with payloads holding `key` wherever the event names one. */
const SAMPLES: Record<string, (key: string) => unknown[]> = {
  'browser.tabs.changed': (key) => [{ appSessionId: key, tabs: [tab(key)], selected: TAB_ID }],
  'browser.notice': (key) => [{ appSessionId: key, tabId: TAB_ID, kind: 'tabsCap', count: 3 }],
  'browser.comment.picked': (key) => [{ tabId: TAB_ID, appSessionId: key, anchor: { kind: 'browser-element', locator: '#a', label: 'a', css: '#a', role: 'button', name: 'a', box: { x: 0, y: 0, width: 1, height: 1 } }, crop: 'none' }],
  'browser.agent.acting': (key) => [{ appSessionId: key, tabId: TAB_ID, actingSessionId: key }],
  'browser.agent.activity': (key) => [{ appSessionId: key, tabId: TAB_ID, at: '2026-11-01T00:00:00.000Z', activity: { kind: 'screenshot' } }],
  'browser.extensions.reveal': (key) => [
    { tabId: TAB_ID, show: { kind: 'tab', tab: tab(key) } },
    { tabId: TAB_ID, show: { kind: 'replacement', tab: tab(key) } },
  ],
};

function lab() {
  const machines = new SessionMachines(LOCAL);
  const key = machines.keyOf(BARE, OTHER);
  const here: Array<[string, unknown]> = [];
  const there: Array<[MachineRef, string, unknown]> = [];
  const emit = machines.stamped(
    ((name: string, payload: unknown) => void here.push([name, payload])) as never,
    ((machine: MachineRef, name: string, payload: unknown) => void there.push([machine, name, payload])) as never,
  );
  return { machines, key, emit: (name: string, payload: unknown) => emit(name as EventName, payload as never), here, there };
}

describe('browser events for a session on another machine (machines.ts)', () => {
  it('has a sample for every browser event whose payload can name a session', () => {
    const naming = Object.keys(REGISTRY.events).filter((name) => name.startsWith('browser.') && addressedPaths(REGISTRY.events[name as EventName], 'lift').length > 0);
    expect(Object.keys(SAMPLES).sort()).toEqual(naming.sort());
  });

  for (const [name, samples] of Object.entries(SAMPLES)) {
    it(`says ${name} from the session's machine with its bare id, wherever it names the session`, () => {
      const l = lab();
      for (const payload of samples(l.key)) {
        expect(validateEventPayload(name as EventName, payload).ok, 'the sample, keyed').toBe(true);
        l.emit(name, payload);
      }
      expect(l.here).toEqual([]);
      expect(l.there.map(([machine, said]) => [machine, said])).toEqual(samples(l.key).map(() => [OTHER, name]));
      for (const [, , payload] of l.there) {
        expect(JSON.stringify(payload)).not.toContain(l.key);
        expect(validateEventPayload(name as EventName, payload).ok).toBe(true);
        const lifted = JSON.stringify(addressingOf(REGISTRY).event(name).lift(payload, OTHER));
        expect(lifted).toContain(`"${OTHER}/${BARE}"`);
        expect(lifted).not.toContain(`${OTHER}/${OTHER}`);
      }
    });
  }

  it('says this machine’s sessions’ events here, untouched', () => {
    const l = lab();
    const [payload] = SAMPLES['browser.tabs.changed']!('App-Local');
    l.emit('browser.tabs.changed', payload);
    expect([l.here, l.there]).toEqual([[['browser.tabs.changed', payload]], []]);
  });

  it('sends nothing for an event naming sessions of two machines, which no one machine can say', () => {
    const l = lab();
    const third = l.machines.keyOf(BARE, THIRD);
    const errors: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      l.emit('browser.agent.acting', { appSessionId: l.key, tabId: TAB_ID, actingSessionId: third });
    } finally {
      console.error = error;
    }
    expect([l.here, l.there, errors.length]).toEqual([[], [], 1]);
  });
});
