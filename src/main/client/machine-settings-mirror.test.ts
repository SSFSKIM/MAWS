// The machine half of the settings over the services front (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §G; D20, D25): main's mirror of `mawsd`'s, over a fake `machine` host.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { readTolerant } from '@shared/ipc/tolerant';
import { MachineSettingsPatchSchema, type MachineSettings } from '@shared/ipc/schema/settings';
import { applyMachinePatch, machineSettingsDefaults } from '@shared/settings/defaults';
import { createMachineSettingsMirror } from './machine-settings-mirror';
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set'; // board ticket 421

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

  // M5b fix round 1: another client's change lands after this app's set persisted and before its answer arrives
  it('lets a change heard while its set was out win over that set’s answer', async () => {
    const host = machineHost();
    const set = deferred();
    host.answers.set('machineSettings.set', set.answer);
    const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
    const updating = mirror.update({ supervisor: { idleExitMinutes: 30 } });
    host.fire('machineSettings.changed', { settings: withIdle(30) }); // this app's own change, as mawsd tells every client
    host.fire('machineSettings.changed', { settings: withIdle(45) }); // another client's, after it
    set.release({ ok: true, value: { settings: withIdle(30) } });
    expect(await updating).toEqual(withIdle(45));
    expect(mirror.state()).toEqual(withIdle(45));
  });

  // P5 O3-D M5b follow-up: mawsd answers only from a loaded spine, and its load ran the settings split under its lock
  it('answered resolves at mawsd’s first answer (a read, a set or a change heard), never at a refusal', async () => {
    const answered = async (mirror: ReturnType<typeof createMachineSettingsMirror>) => {
      let heard = false;
      void mirror.answered().then(() => (heard = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return heard;
    };
    const host = machineHost();
    host.answers.set('machineSettings.get', async () => ({ ok: false, error: { code: 'host_unavailable', message: 'the spine is refused' } }));
    const read = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
    host.stream();
    expect(await answered(read)).toBe(false);
    host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withIdle(30), version: 1 } }));
    host.stream();
    expect(await answered(read)).toBe(true);
    read.stop();

    const other = machineHost();
    other.answers.set('machineSettings.set', async () => ({ ok: true, value: { settings: withIdle(5) } }));
    const set = createMachineSettingsMirror({ file, hosts: other.hosts, log: () => {} });
    expect(await answered(set)).toBe(false);
    await set.update({ supervisor: { idleExitMinutes: 5 } });
    expect(await answered(set)).toBe(true);
    set.stop();

    const third = machineHost();
    const heard = createMachineSettingsMirror({ file, hosts: third.hosts, log: () => {} });
    third.fire('machineSettings.changed', { settings: withIdle(7) });
    expect(await answered(heard)).toBe(true);
    heard.stop();
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

  // P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The default, without a v2"): the default route
  describe('the default route (P5 O7 M9)', () => {
    const withRoute = (defaultRoute: 'gateway' | 'direct'): MachineSettings => ({ ...machineSettingsDefaults(), gateway: { ...machineSettingsDefaults().gateway, defaultRoute } });

    it('starts from the files by the rule, reading machine-route.json and writing nothing', () => {
      const host = machineHost();
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).defaultRoute()).toBe('machine'); // a first run
      expect(readdirSync(dir)).toEqual([]);
      writeFileSync(file, JSON.stringify(withRoute('direct')));
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).defaultRoute()).toBe('direct');
      writeFileSync(join(dir, 'machine-route.json'), JSON.stringify({ version: 1, defaultRoute: 'gateway' }));
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).defaultRoute()).toBe('gateway');
      writeFileSync(join(dir, 'machine-route.json'), '{"version":1,');
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).defaultRoute()).toBe('direct'); // unreadable: the rule
    });

    it('takes mawsd’s resolved default from its answers and changes, telling its listeners when the route alone changed', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withRoute('gateway'), version: 1, defaultRoute: 'machine' } }));
      writeFileSync(join(dir, 'machine-route.json'), JSON.stringify({ version: 1, defaultRoute: 'gateway' })); // what the files said at the start
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      expect(mirror.defaultRoute()).toBe('gateway');
      const told: string[] = [];
      mirror.onChange(() => void told.push(mirror.defaultRoute()));
      host.stream();
      await mirror.answered();
      expect(mirror.defaultRoute()).toBe('machine');
      expect(told).toEqual(['machine']); // the settings are the defaults it started from: the route moved alone
      host.fire('machineSettings.changed', { settings: withRoute('gateway'), defaultRoute: 'machine' });
      expect(told).toEqual(['machine']); // nothing moved: nothing told
      host.fire('machineSettings.changed', { settings: withRoute('gateway'), defaultRoute: 'gateway' });
      expect(mirror.defaultRoute()).toBe('gateway');
      expect(told).toEqual(['machine', 'gateway']);
    });

    it('reads a mawsd that predates M9 by its legacy field, which is what its launches act on', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withRoute('gateway'), version: 1 } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      host.stream();
      await mirror.answered();
      expect(mirror.defaultRoute()).toBe('gateway'); // not the rule's machine: that mawsd's sessions start on gateway
    });

    it('sets the default as machineSettings.set’s defaultRoute and resolves with mawsd’s answer', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withRoute('gateway'), version: 1, defaultRoute: 'gateway' } }));
      host.answers.set('machineSettings.set', async () => ({ ok: true, value: { settings: withRoute('gateway'), defaultRoute: 'machine' } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      host.stream();
      await mirror.answered();
      expect(await mirror.setDefaultRoute('machine')).toBe('machine');
      expect(host.asked.at(-1)).toEqual({ name: 'machineSettings.set', input: { patch: {}, defaultRoute: 'machine' } });
      expect(mirror.defaultRoute()).toBe('machine');
      host.answers.set('machineSettings.set', async () => ({ ok: false, error: { code: 'host_unavailable', message: 'spine.lock is held by pid 4242' } }));
      await expect(mirror.setDefaultRoute('direct')).rejects.toThrow('spine.lock is held by pid 4242');
      expect(mirror.defaultRoute()).toBe('machine');
    });

    // A mawsd that predates M9, answering as its front does: `machineSettings.set`'s input read by the real tolerant
    // reader against that build's schema (an unknown key dropped, never refused), and no `defaultRoute` in any answer
    const OLDER_SET_INPUT = z.strictObject({ patch: MachineSettingsPatchSchema });
    function olderMawsd(host: ReturnType<typeof machineHost>, start: MachineSettings) {
      let settings = start;
      const read: unknown[] = [];
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings, version: 1 } }));
      host.answers.set('machineSettings.set', async () => {
        const input = readTolerant(OLDER_SET_INPUT, host.asked.at(-1)!.input);
        if (!input.ok) return { ok: false, error: { code: 'invalid_input', message: input.error.message } };
        read.push(input.value);
        settings = applyMachinePatch(settings, input.value.patch);
        return { ok: true, value: { settings } };
      });
      return read;
    }

    it('learns whether mawsd carries the route before its first route write, and never takes a dropped write for done', async () => {
      const host = machineHost();
      const read = olderMawsd(host, withRoute('gateway'));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }); // not streaming: no answer yet
      await expect(mirror.setDefaultRoute('machine')).rejects.toThrow('predates the machine route');
      expect(host.asked.map(({ name }) => name)).toEqual(['machineSettings.get']); // asked first; nothing written
      expect(read).toEqual([]);
      expect(mirror.defaultRoute()).toBe('gateway'); // what that mawsd's sessions start on

      const unanswered = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      expect(await unanswered.setDefaultRoute('direct')).toBe('direct');
      expect(read).toEqual([{ patch: { gateway: { defaultRoute: 'direct' } } }]);

      // a mawsd replaced by an older one between its read and the write: the write is dropped, and the set rejects
      const swapped = machineHost();
      swapped.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withRoute('gateway'), version: 1, defaultRoute: 'machine' } }));
      const mirrored = createMachineSettingsMirror({ file, hosts: swapped.hosts, log: () => {} });
      swapped.stream();
      await mirrored.answered();
      const dropped = olderMawsd(swapped, withRoute('gateway'));
      await expect(mirrored.setDefaultRoute('direct')).rejects.toThrow('predates the machine route');
      expect(dropped).toEqual([{ patch: {} }]); // the route was dropped by that build's reader
    });

    it('sets gateway or direct on a mawsd that predates M9 through the legacy field, and refuses machine there', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: withRoute('gateway'), version: 1 } }));
      host.answers.set('machineSettings.set', async () => ({ ok: true, value: { settings: withRoute('direct') } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      host.stream();
      await mirror.answered();
      expect(await mirror.setDefaultRoute('direct')).toBe('direct');
      expect(host.asked.at(-1)).toEqual({ name: 'machineSettings.set', input: { patch: { gateway: { defaultRoute: 'direct' } } } });
      const asked = host.asked.length;
      await expect(mirror.setDefaultRoute('machine')).rejects.toThrow('predates the machine route');
      expect(host.asked).toHaveLength(asked); // nothing sent
      expect(mirror.defaultRoute()).toBe('direct');
    });
  });

  // Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §G): the machine's default set of MAWS's
  // tools on the route's terms: from `machine-session-defaults.json` until mawsd answers, then from its answers'
  // `mawsTools`; a mawsd whose answers carry none predates the choice, and its launches are the full set
  describe("the machine's default set of MAWS's tools (board ticket 421)", () => {
    const PARTIAL: MawsToolSet = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'engine' };

    it('starts from machine-session-defaults.json, read and never written, or the full set without a readable one', () => {
      const host = machineHost();
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).mawsTools()).toEqual(FULL_MAWS_TOOL_SET);
      expect(readdirSync(dir)).toEqual([]);
      writeFileSync(join(dir, 'machine-session-defaults.json'), JSON.stringify({ version: 1, mawsTools: PARTIAL }));
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).mawsTools()).toEqual(PARTIAL);
      writeFileSync(join(dir, 'machine-session-defaults.json'), '{"version":1,');
      expect(createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }).mawsTools()).toEqual(FULL_MAWS_TOOL_SET);
    });

    it('takes mawsd’s set from its answers and changes, telling its listeners when the set alone changed', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine', mawsTools: PARTIAL } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      const told: MawsToolSet[] = [];
      mirror.onChange(() => void told.push(mirror.mawsTools()));
      host.stream();
      await mirror.answered();
      expect(mirror.mawsTools()).toEqual(PARTIAL);
      expect(told).toEqual([PARTIAL]); // the settings and the route as it started: the set moved alone
      host.fire('machineSettings.changed', { settings: machineSettingsDefaults(), defaultRoute: 'machine', mawsTools: PARTIAL });
      expect(told).toHaveLength(1); // nothing moved: nothing told
      host.fire('machineSettings.changed', { settings: machineSettingsDefaults(), defaultRoute: 'machine', mawsTools: FULL_MAWS_TOOL_SET });
      expect(told).toEqual([PARTIAL, FULL_MAWS_TOOL_SET]);
    });

    it('reads a mawsd whose answer carries no set as one that predates the choice: the full set, which its launches serve', async () => {
      const host = machineHost();
      writeFileSync(join(dir, 'machine-session-defaults.json'), JSON.stringify({ version: 1, mawsTools: PARTIAL })); // a newer build's file
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine' } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      host.stream();
      await mirror.answered();
      expect(mirror.mawsTools()).toEqual(FULL_MAWS_TOOL_SET);
      const asked = host.asked.length;
      await expect(mirror.setMawsTools(PARTIAL)).rejects.toThrow('predates');
      expect(host.asked).toHaveLength(asked); // nothing sent
    });

    // The review of M4: an older mawsd's missing key and a newer one's explicit full set serve the same set but not the
    // same choice, so a mawsd replaced by the other, all else equal, is told: the window then offers the rows, or stops
    it('tells its listeners when mawsd is replaced by one that knows the choice, or one that does not, at the full set alike', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine' } })); // predates
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      const told = vi.fn();
      mirror.onChange(told);
      host.stream();
      await mirror.answered();
      expect(told).not.toHaveBeenCalled(); // the first answer is the state it started from
      host.fire('machineSettings.changed', { settings: machineSettingsDefaults(), defaultRoute: 'machine', mawsTools: FULL_MAWS_TOOL_SET }); // upgraded
      expect(told).toHaveBeenCalledTimes(1);
      expect(mirror.mawsTools()).toEqual(FULL_MAWS_TOOL_SET);
      host.fire('machineSettings.changed', { settings: machineSettingsDefaults(), defaultRoute: 'machine', mawsTools: FULL_MAWS_TOOL_SET });
      expect(told).toHaveBeenCalledTimes(1); // nothing moved
      host.fire('machineSettings.changed', { settings: machineSettingsDefaults(), defaultRoute: 'machine' }); // downgraded
      expect(told).toHaveBeenCalledTimes(2);
      await expect(mirror.setMawsTools(FULL_MAWS_TOOL_SET)).rejects.toThrow('predates');
    });

    it('sets the default as machineSettings.set’s mawsTools and resolves with mawsd’s answer; a refusal changes nothing', async () => {
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine', mawsTools: FULL_MAWS_TOOL_SET } }));
      host.answers.set('machineSettings.set', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), defaultRoute: 'machine', mawsTools: PARTIAL } }));
      const mirror = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} });
      host.stream();
      await mirror.answered();
      expect(await mirror.setMawsTools(PARTIAL)).toEqual(PARTIAL);
      expect(host.asked.at(-1)).toEqual({ name: 'machineSettings.set', input: { patch: {}, mawsTools: PARTIAL } });
      expect(mirror.mawsTools()).toEqual(PARTIAL);
      host.answers.set('machineSettings.set', async () => ({ ok: false, error: { code: 'host_unavailable', message: 'spine.lock is held by pid 4242' } }));
      await expect(mirror.setMawsTools(FULL_MAWS_TOOL_SET)).rejects.toThrow('spine.lock is held by pid 4242');
      expect(mirror.mawsTools()).toEqual(PARTIAL);
    });

    it('learns whether mawsd carries the set before its first write, and never takes a dropped write for done', async () => {
      // a mawsd that predates the choice, its set input read tolerantly (an unknown key dropped), answering with no set
      const host = machineHost();
      host.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine' } }));
      const unanswered = createMachineSettingsMirror({ file, hosts: host.hosts, log: () => {} }); // not streaming: no answer yet
      await expect(unanswered.setMawsTools(PARTIAL)).rejects.toThrow('predates');
      expect(host.asked.map(({ name }) => name)).toEqual(['machineSettings.get']); // asked first; nothing written

      // a mawsd replaced by an older one between its read and the write
      const swapped = machineHost();
      swapped.answers.set('machineSettings.get', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine', mawsTools: FULL_MAWS_TOOL_SET } }));
      swapped.answers.set('machineSettings.set', async () => ({ ok: true, value: { settings: machineSettingsDefaults(), defaultRoute: 'machine' } }));
      const mirrored = createMachineSettingsMirror({ file, hosts: swapped.hosts, log: () => {} });
      swapped.stream();
      await mirrored.answered();
      await expect(mirrored.setMawsTools(PARTIAL)).rejects.toThrow('predates');
      expect(mirrored.mawsTools()).toEqual(FULL_MAWS_TOOL_SET);
    });
  });
});
