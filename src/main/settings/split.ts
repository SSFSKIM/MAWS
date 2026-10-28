// The settings split (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3): the one migration that turns a
// unified `settings.json` (version 1 to 20) into the machine's `machine-settings.json` and the client's `settings.json`
// at version 21. Run by the process that holds `spine.lock`, after the launch's shape is settled and before either
// settings file is opened (§2); a run refused the spine never runs it. Once and idempotent: the machine file is written
// first from the unified file's machine fields (migrated to the last unified version first), then `settings.json` is
// rewritten as the client file. Each write is atomic, so a crash between the two leaves the machine file present and
// authoritative, and the next start finishes the client file from the unified one. Electron-free (the spine's).
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clientSettingsDefaults, isUnifiedSettings, machineSettingsDefaults, migrateClientSettings, migrateSettings, settingsVersionOf, splitSettings } from '@shared/settings/defaults';
import type { MachineSettings } from '@shared/ipc/schema/settings';
import { atomicWriteFileSync } from '../files/atomic-write';

// The profile's two settings files (§1: `settings.json` the client's, written by main; `machine-settings.json` the
// machine's, written by the spine under `spine.lock`).
export const SETTINGS_FILES = { client: 'settings.json', machine: 'machine-settings.json' } as const;
export interface SettingsPaths {
  client: string;
  machine: string;
}
export const settingsPaths = (profile: string): SettingsPaths => ({ client: join(profile, SETTINGS_FILES.client), machine: join(profile, SETTINGS_FILES.machine) });

// The files' reads and writes, a seam for the fault-injection tests: `read` answers null for an absent file and throws
// for one that cannot be read; `write` replaces a file whole.
export interface SplitIo {
  read(path: string): string | null;
  write(path: string, text: string): void;
}
export const nodeSplitIo: SplitIo = {
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(path, text);
  },
};

// What the start found and did: `split` (a unified file became the two), `finished` (the client file finished after a
// crash between the two writes), `machine` (no unified file: the machine file written with its defaults, so that a
// profile any split build has started always has one), `none` (both files already there). `machineRefused` is why the
// machine file must not be written this run: a `settings.json` this build cannot read (unreadable, invalid, or a
// version it does not know) may still hold the person's machine fields, so nothing creates a machine file that would
// then outrank them, as today's rule refuses writes over such a file. A write that fails is logged and repeated at the
// next start: the machine file's, with `unsplit` the unified file's machine fields, held in memory for this run with
// writes refused (as a store keeps a migration it cannot persist); the client file's, with the machine file already
// written, leaves `settings.json` unified, which its store reads and does not write this run.
export interface SplitOutcome {
  outcome: 'split' | 'finished' | 'machine' | 'none';
  machineRefused: string | null;
  unsplit: MachineSettings | null;
}

export function splitSettingsFiles(paths: SettingsPaths, io: SplitIo = nodeSplitIo, log: (line: string) => void = (line) => console.log(line)): SplitOutcome {
  const done = (outcome: SplitOutcome['outcome']): SplitOutcome => ({ outcome, machineRefused: null, unsplit: null });
  const failed = (path: string, error: unknown) => `${path} could not be written (${error instanceof Error ? error.message : String(error)}); the split is tried again at the next start`;
  let machinePresent: boolean;
  try {
    machinePresent = io.read(paths.machine) !== null;
  } catch {
    machinePresent = true; // there but unreadable: its store says so, and keeps its defaults with writes refused
  }
  let unified: ReturnType<typeof migrateSettings> | null = null;
  let unreadable: string | null = null;
  let clientText: string | null;
  try {
    clientText = io.read(paths.client);
  } catch (error) {
    clientText = null;
    unreadable = `${paths.client} cannot be read (${error instanceof Error ? error.message : String(error)})`;
  }
  let version: unknown;
  if (clientText !== null) {
    try {
      const raw: unknown = JSON.parse(clientText);
      version = settingsVersionOf(raw);
      if (isUnifiedSettings(raw)) unified = migrateSettings(raw);
      else migrateClientSettings(raw); // a client file this build reads, or it throws
    } catch (error) {
      unreadable = `${paths.client} is not a settings file this build reads (${error instanceof Error ? error.message : String(error)})`;
    }
  }
  const writeClient = (text: string): boolean => {
    try {
      io.write(paths.client, text);
      return true;
    } catch (error) {
      console.warn(`[settings] ${failed(paths.client, error)}`);
      return false;
    }
  };
  // The version fence (§2): a profile whose settings were never changed has no settings.json, which a build before the
  // split would take for a first run and write a unified file into, later read here as a split in progress whose
  // machine fields lose to the machine file. The client file at 21 makes such a build run on its defaults with writes
  // refused, so it is written whenever the machine file is (a write that fails is tried again at the next start).
  const clientAbsent = clientText === null && unreadable === null;
  if (machinePresent) {
    if (clientAbsent) writeClient(JSON.stringify(clientSettingsDefaults()));
    if (unified === null) return done('none');
    if (writeClient(JSON.stringify(splitSettings(unified).client)))
      log(`[settings] finished the split of ${paths.client} (version ${String(version)}): rewritten as the client file; ${SETTINGS_FILES.machine} was already written`);
    return done('finished');
  }
  if (unreadable !== null) return { outcome: 'none', machineRefused: `${unreadable}; ${SETTINGS_FILES.machine} is not created over it`, unsplit: null };
  const { client, machine } = unified === null ? { client: clientAbsent ? clientSettingsDefaults() : null, machine: machineSettingsDefaults() } : splitSettings(unified);
  try {
    io.write(paths.machine, JSON.stringify(machine));
  } catch (error) {
    console.warn(`[settings] ${failed(paths.machine, error)}`);
    // the defaults alone are a first run's, which the machine store writes on its first update as any store does
    return unified === null ? done('none') : { outcome: 'none', machineRefused: failed(paths.machine, error), unsplit: machine };
  }
  if (client === null) return done('machine'); // a client file already there
  if (writeClient(JSON.stringify(client)) && unified !== null)
    log(`[settings] split ${paths.client} (version ${String(version)}) into ${SETTINGS_FILES.machine} (version ${machine.version}) and the client file (version ${client.version})`);
  return done(unified === null ? 'machine' : 'split');
}
