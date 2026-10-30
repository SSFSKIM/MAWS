// The machine half of the settings in main on the daemon shape (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §G; D20, D25; contract O3X3): a mirror of `mawsd`'s, which holds `spine.lock` and alone writes
// `machine-settings.json`. It starts from that file, read and never written (the defaults when it is absent or
// unreadable), so the first window opens without waiting for `mawsd` (D20); then it reads `machineSettings.get` at each
// streaming of the `machine` host and follows `machineSettings.changed`, a change heard while a read is out winning over
// that read. `update` sends the patch as `machineSettings.set` and resolves once `mawsd` answered (its write persisted,
// its listeners told), rejecting on a refusal with nothing changed here. `state()` and `onChange` answer from memory.
import { readFileSync } from 'node:fs';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { CommandOutput } from '@shared/ipc/schema';
import type { MachineSettings, MachineSettingsPatch } from '@shared/ipc/schema/settings';
import { machineSettingsDefaults, migrateMachineSettings } from '@shared/settings/defaults';
import type { MachineSettingsService } from '@shared/spine/machine-settings';

export interface MachineSettingsMirrorOptions {
  file: string; // <profile>/machine-settings.json
  hosts: Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onStreaming' | 'streaming'>;
  log(line: string): void;
}

export interface MachineSettingsMirror extends MachineSettingsService {
  stop(): void;
}

export function createMachineSettingsMirror({ file, hosts, log }: MachineSettingsMirrorOptions): MachineSettingsMirror {
  let current = readOnly(file, log);
  const listeners = new Set<(state: MachineSettings) => void>();
  const take = (next: MachineSettings) => {
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    for (const listener of [...listeners]) listener(current);
  };

  let heard = 0; // changes heard; a read that saw one land while it was out is dropped
  const refresh = () => {
    const before = heard;
    void hosts.dispatch('machine', 'machineSettings.get', undefined).then((answer) => {
      if (!answer.ok) return log(`[settings] machineSettings.get: ${answer.error.code} ${answer.error.message}`);
      if (heard === before) take((answer.value as CommandOutput<'machineSettings.get'>).settings);
    });
  };
  const offs = [
    hosts.onEvent('machineSettings.changed', ({ settings }) => {
      heard += 1;
      take(settings);
    }),
    hosts.onStreaming('machine', refresh),
  ];
  if (hosts.streaming('machine')) refresh();

  return {
    state: () => current,
    async update(patch) {
      const answer = await hosts.dispatch('machine', 'machineSettings.set', { patch: patch as MachineSettingsPatch });
      if (!answer.ok) throw new Error(answer.error.message);
      heard += 1;
      take((answer.value as CommandOutput<'machineSettings.set'>).settings);
      return current;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop: () => offs.forEach((off) => off()),
  };
}

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
