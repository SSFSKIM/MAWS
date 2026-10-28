// The machine's role (P5 O2 M2: docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 "The role"; P5 §2 "Idle release"),
// read once at the engine host's start: the idle release's time is a laptop's idle setting (20 idle sessions are several
// GB the owner gets back) and a server's 24 hours (the mini, a VM: no app may attach for days). MAWS_MACHINE_ROLE wins
// when it names a role (the e2e harness pins `laptop`); otherwise a machine with a battery is a laptop and any other a
// server. Not a setting the app pushes: a VM has no app.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type MachineRole = 'laptop' | 'server';

export interface RoleProbes {
  pmset(): string | null; // `pmset -g batt` on macOS, null when it did not answer
  powerSupplyTypes(): string[]; // every /sys/class/power_supply/*/type on Linux
}

export function machineRole(env: Record<string, string | undefined>, platform: NodeJS.Platform, probes: RoleProbes): MachineRole {
  const named = env.MAWS_MACHINE_ROLE;
  if (named === 'laptop' || named === 'server') return named;
  if (platform === 'darwin') return /InternalBattery/.test(probes.pmset() ?? '') ? 'laptop' : 'server';
  if (platform === 'linux') return probes.powerSupplyTypes().some((type) => type.trim() === 'Battery') ? 'laptop' : 'server';
  return 'server';
}

const POWER_SUPPLY = '/sys/class/power_supply';

export const MACHINE_PROBES: RoleProbes = {
  pmset: () => {
    try {
      return execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  },
  powerSupplyTypes: () => {
    try {
      return readdirSync(POWER_SUPPLY).flatMap((name) => {
        try {
          return [readFileSync(join(POWER_SUPPLY, name, 'type'), 'utf8')];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  },
};

export const readMachineRole = (env: Record<string, string | undefined> = process.env): MachineRole => machineRole(env, process.platform, MACHINE_PROBES);
