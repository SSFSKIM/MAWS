// The machine half of the settings over the services front (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §G; D20, D25): main's mirror of `mawsd`'s, over a fake `machine` host.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineSettings } from '@shared/ipc/schema/settings';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { createMachineSettingsMirror } from './machine-settings-mirror';

type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-machine-mirror-'));
  file = join(dir, 'machine-settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const withIdle = (minutes: number | null): MachineSettings => ({ ...machineSettingsDefaults(), supervisor: { idleExitMinutes: minutes } });

function machineHost() {
  const asked: { name: string; input: unknown }[] = [];
  const answers = new Map<string, () => Promise<Answer>>();
  const events = new Map<string, Set<(payload: never) => void>>();
  const streamingListeners = new Set<() => void>();
  let isStreaming = false;
  return {
    asked,
    answers,
    hosts: {
      dispatch: async (_owner: string, name: string, input: unknown) => {
        asked.push({ name, input });
        return ((await answers.get(name)?.()) ?? { ok: false, error: { code: 'internal', message: `no answer for ${name}` } }) as never;
      },
      onEvent: (name: string, listener: (payload: never) => void) => {
        const set = events.get(name) ?? new Set();
        events.set(name, set);
        set.add(listener);
        return () => void set.delete(listener);
      },
      onStreaming: (_owner: string, listener: () => void) => {
        streamingListeners.add(listener);
        return () => void streamingListeners.delete(listener);
      },
      streaming: () => isStreaming,
    },
    fire: (name: string, payload: unknown) => events.get(name)?.forEach((listener) => listener(payload as never)),
    stream() {
      isStreaming = true;
      for (const listener of streamingListeners) listener();
    },
  };
}

// An answer the test lets go of later
function deferred() {
  let release!: (answer: Answer) => void;
  const promise = new Promise<Answer>((resolve) => (release = resolve));
  return { answer: () => promise, release };
}

describe('the machine settings mirror (Interfaces §G)', () => {
  it('starts from machine-settings.json, read and never written, or the defaults with no file', () => {
    const host = machineHost();
    expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).state()).toEqual(machineSettingsDefaults());
    const text = JSON.stringify(withIdle(30));
    writeFileSync(file, text);
    expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).state()).toEqual(withIdle(30));
    expect(readFileSync(file, 'utf8')).toBe(text);
    writeFileSync(file, '{"version":1,');
    expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).state()).toEqual(machineSettingsDefaults()); // unreadable: the defaults
  });

  it('reads machineSettings.get at each streaming and follows machineSettings.changed, telling its listeners each change once', async () => {
    const host = machineHost();
    host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withIdle(30), version: 3 } }));
    const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
    const told: (number | null)[] = [];
    mirror.onChange((settings) => void told.push(settings.supervisor.idleExitMinutes));
    host.stream();
    await vi.waitFor(() => expect(mirror.state()).toEqual(withIdle(30)));
    host.fire('machineSettings.changed', { settings: withIdle(45) });
    host.fire('machineSettings.changed', { settings: withIdle(45) }); // no change: nothing told
    expect(mirror.state()).toEqual(withIdle(45));
    expect(told).toEqual([30, 45]);
  });

  it('lets a change heard while its read was out win over that read', async () => {
    const host = machineHost();
    const read = deferred();
    host.answers.set('machineSettings.get', read.answer);
    const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
    host.stream();
    host.fire('machineSettings.changed', { settings: withIdle(45) });
    read.release({ ok: true, value: { settings: withIdle(30), version: 3 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mirror.state()).toEqual(withIdle(45));
  });

  it('update resolves on machineSettings.set’s answer, however late, with the state its listeners were told; a refusal rejects and changes nothing', async () => {
    const host = machineHost();
    const set = deferred();
    host.answers.set('machineSettings.set', set.answer);
    const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
    const told: (number | null)[] = [];
    mirror.onChange((settings) => void told.push(settings.supervisor.idleExitMinutes));
    let settled = false;
    const updating = mirror.update({ supervisor: { idleExitMinutes: 30 } }).then((settings) => ((settled = true), settings));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(host.asked).toEqual([{ name: 'machineSettings.set', input: { patch: { supervisor: { idleExitMinutes: 30 } } } }]);
    set.release({ ok: true, value: { settings: withIdle(30) } });
    expect(await updating).toEqual(withIdle(30));
    expect(mirror.state()).toEqual(withIdle(30));
    expect(told).toEqual([30]);

    host.answers.set('machineSettings.set', async () => ({ ok: false, error: { code: 'host_unavailable', message: 'spine.lock is held by pid 4242 (build 0.0.0+old)' } }));
    await expect(mirror.update({ supervisor: { idleExitMinutes: 5 } })).rejects.toThrow('spine.lock is held by pid 4242');
    expect(mirror.state()).toEqual(withIdle(30));
    expect(told).toEqual([30]);
  });
});
