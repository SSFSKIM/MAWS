// The machine half of the settings in main on the daemon shape (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §G; D20, D25; contract O3X3): a mirror of `mawsd`'s, which holds `spine.lock` and alone writes
// `machine-settings.json`. It starts from that file, read and never written (the defaults when it is absent or
// unreadable), so the first window opens without waiting for `mawsd` (D20); then it reads `machineSettings.get` at each
// streaming of the `machine` host and follows `machineSettings.changed`, a change heard while a read or a set is out
// winning over its answer. `update` sends the patch as `machineSettings.set` and resolves once `mawsd` answered (its write persisted,
// its listeners told), rejecting on a refusal with nothing changed here. `state()` and `onChange` answer from memory.
// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The default, without a v2"): the default route
// too, from `machine-route.json` and the rule until `mawsd` answers, then from its answers' `defaultRoute`; a `mawsd`
// whose answers carry none predates M9 and acts on `gateway.defaultRoute`, which is then the default, set through the
// legacy field (`machine` refused, since that `mawsd` cannot launch it).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LegacyRoute, Route } from '@shared/engine/route';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { CommandOutput } from '@shared/ipc/schema';
import type { MachineRoute, MachineSettings, MachineSettingsPatch } from '@shared/ipc/schema/settings';
import { machineSettingsDefaults, migrateMachineRoute, migrateMachineSettings, resolveDefaultRoute } from '@shared/settings/defaults';
import { SETTINGS_FILES } from '@shared/settings/paths';
import type { MachineSettingsService } from '@shared/spine/machine-settings';

export interface MachineSettingsMirrorOptions {
  file: string; // <profile>/machine-settings.json
  hosts: Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onStreaming' | 'streaming'>;
  log(line: string): void;
}

export interface MachineSettingsMirror extends MachineSettingsService {
  // Resolves at `mawsd`'s first answer (a read, a set, a change heard): it answers only from a loaded spine, whose load
  // ran the settings split under `spine.lock` (D26), so the client file is converted by then if it could be
  answered(): Promise<void>;
  stop(): void;
}

export function createMachineSettingsMirror({ file, hosts, log }: MachineSettingsMirrorOptions): MachineSettingsMirror {
  let current = readOnly(file, log);
  let route = resolveDefaultRoute(readOnlyRoute(join(dirname(file), SETTINGS_FILES.route)), current.gateway.defaultRoute);
  let routeKnown: boolean | null = null; // whether mawsd's last answer carried `defaultRoute`; null before any
  const listeners = new Set<(state: MachineSettings) => void>();
  const take = (next: MachineSettings, nextRoute: Route | undefined) => {
    routeKnown = nextRoute !== undefined;
    const resolved = nextRoute ?? next.gateway.defaultRoute;
    if (JSON.stringify(next) === JSON.stringify(current) && resolved === route) return;
    current = next;
    route = resolved;
    for (const listener of [...listeners]) listener(current);
  };

  let markAnswered!: () => void;
  const firstAnswer = new Promise<void>((resolve) => (markAnswered = resolve));
  let heard = 0; // changes heard; a read that saw one land while it was out is dropped
  // a read; it resolves with the answer taken (or a newer change heard while it was out), rejects on a refusal
  const read = async () => {
    const before = heard;
    const answer = await hosts.dispatch('machine', 'machineSettings.get', undefined);
    if (!answer.ok) throw new Error(`machineSettings.get: ${answer.error.code} ${answer.error.message}`);
    markAnswered();
    const { settings, defaultRoute } = answer.value as CommandOutput<'machineSettings.get'>;
    if (heard === before) take(settings, defaultRoute);
  };
  const refresh = () => void read().catch((error: unknown) => log(`[settings] ${error instanceof Error ? error.message : String(error)}`));
  const offs = [
    hosts.onEvent('machineSettings.changed', ({ settings, defaultRoute }) => {
      heard += 1;
      markAnswered();
      take(settings, defaultRoute);
    }),
    hosts.onStreaming('machine', refresh),
  ];
  if (hosts.streaming('machine')) refresh();

  const set = async (input: { patch: MachineSettingsPatch; defaultRoute?: Route }): Promise<{ defaultRoute?: Route }> => {
    const before = heard;
    const answer = await hosts.dispatch('machine', 'machineSettings.set', input);
    if (!answer.ok) throw new Error(answer.error.message);
    markAnswered();
    // as a read: a change heard while the set was out is newer than its answer (mawsd tells every client of a change,
    // this set's own included, before it answers), so it stands
    const { settings, defaultRoute } = answer.value as CommandOutput<'machineSettings.set'>;
    if (heard === before) take(settings, defaultRoute);
    heard += 1;
    return { defaultRoute };
  };

  return {
    state: () => current,
    async update(patch) {
      await set({ patch: patch as MachineSettingsPatch });
      return current;
    },
    defaultRoute: () => route,
    // An older mawsd reads `set`'s input tolerantly and drops a `defaultRoute` it does not know, answering success, so
    // whether it carries the route is learned first: from its last answer, or a read sent now (under the request's own
    // deadline). A route write whose answer carries no `defaultRoute` was dropped, and rejects.
    async setDefaultRoute(next) {
      if (routeKnown === null) await read();
      if (routeKnown === true) {
        if ((await set({ patch: {}, defaultRoute: next })).defaultRoute === undefined) throw new Error(PREDATES);
      } else if (next === 'machine') throw new Error(PREDATES);
      else await set({ patch: { gateway: { defaultRoute: next satisfies LegacyRoute } } });
      return route;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    answered: () => firstAnswer,
    stop: () => offs.forEach((off) => off()),
  };
}

const PREDATES = 'This machine’s mawsd predates the machine route; choose gateway or direct until it runs this build.';

// The file as it is, never migrated in place nor written: the defaults when it is absent or this build cannot read it
function readOnly(file: string, log: (line: string) => void): MachineSettings {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return machineSettingsDefaults();
  }
  try {
    return migrateMachineSettings(JSON.parse(text));
  } catch (error) {
    log(`[settings] ${file} could not be read (${error instanceof Error ? error.message : String(error)}); the defaults stand until mawsd answers`);
    return machineSettingsDefaults();
  }
}

// P5 O7 M9: `machine-route.json` as it is, never written: null when it is absent or this build cannot read it (the rule
// then stands, as mawsd's own store reads it)
function readOnlyRoute(file: string): MachineRoute | null {
  try {
    return migrateMachineRoute(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}
