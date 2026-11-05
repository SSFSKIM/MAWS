// The machine's default route on disk (P5 O7 M9; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The
// default, without a v2"): through the real file store, `machine-route.json` beside an unchanged `machine-settings.json`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyRoute, Route } from '@shared/engine/route';
import { machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { settingsPaths, SETTINGS_FILES } from '@shared/settings/paths';
import { startMachineSettings } from './machine';
import { splitSettingsFiles } from './split';
import { migrateMachineSettings as masterMigrateMachineSettings } from '../../../test/fixtures/settings/master-828114952/migrate-machine-settings.mjs';

// An older build's reader: master's own `migrateMachineSettings` (src/shared/settings/defaults.ts at 828114952, the base
// M9 branched from), its executable source vendored with every refinement (test/fixtures/settings/master-828114952/)
const olderBuildReads = (text: string) => {
  try {
    masterMigrateMachineSettings(JSON.parse(text));
    return true;
  } catch {
    return false;
  }
};

let profile: string;
let paths: ReturnType<typeof settingsPaths>;
const routeFile = () => join(profile, SETTINGS_FILES.route);
const bytes = (file: string) => readFileSync(file, 'utf8');
const machineFileWith = (defaultRoute: LegacyRoute) => writeFileSync(paths.machine, JSON.stringify({ ...machineSettingsDefaults(), gateway: { ...machineSettingsDefaults().gateway, defaultRoute } }));
const open = (options: Partial<Parameters<typeof startMachineSettings>[1]> = {}) => startMachineSettings(paths.machine, { refused: null, ...options });

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'maws-machine-route-'));
  paths = settingsPaths(profile);
});
afterEach(() => rmSync(profile, { recursive: true, force: true }));

describe("the machine's default route on disk (P5 O7 M9)", () => {
  it('holds the M9 files to master’s own reader, refinements included', () => {
    const defaults = machineSettingsDefaults();
    expect(olderBuildReads(JSON.stringify(defaults))).toBe(true);
    // master's app MCP servers refuse the reserved name and a URL that is not one; a reconstructed schema did not
    expect(olderBuildReads(JSON.stringify({ ...defaults, engine: { ...defaults.engine, mcpServers: [{ name: 'maws', type: 'http', url: 'not-a-url' }] } }))).toBe(false);
    expect(olderBuildReads(JSON.stringify({ ...defaults, gateway: { ...defaults.gateway, defaultRoute: 'machine' } }))).toBe(false);
    expect(olderBuildReads(JSON.stringify({ ...defaults, route: 'machine' }))).toBe(false);
  });

  it('reads a v1 file holding gateway, the old default, as machine, and rewrites nothing', () => {
    machineFileWith('gateway');
    const before = bytes(paths.machine);
    expect(open().defaultRoute()).toBe('machine');
    expect(bytes(paths.machine)).toBe(before);
    expect(readdirSync(profile)).toEqual([SETTINGS_FILES.machine]);
  });

  it('reads a v1 file holding direct as direct, the owner’s choice', () => {
    machineFileWith('direct');
    expect(open().defaultRoute()).toBe('direct');
    expect(existsSync(routeFile())).toBe(false);
  });

  it.each([
    ['gateway', 'machine'],
    ['direct', 'direct'],
  ] as const)('reads a unified profile whose route was %s, split by splitSettingsFiles, as %s', (unified, expected) => {
    writeFileSync(paths.client, JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, gateway: { ...SETTINGS_DEFAULTS_V21.gateway, defaultRoute: unified } }));
    const split = splitSettingsFiles(paths, undefined, () => {});
    expect(split.outcome).toBe('split');
    const machine = startMachineSettings(paths.machine, { refused: split.machineRefused, unsplit: split.unsplit });
    expect(machine.state().gateway.defaultRoute).toBe(unified); // the split copied the old choice, unchanged
    expect(machine.defaultRoute()).toBe(expected);
    expect(existsSync(routeFile())).toBe(false);
  });

  it.each([
    ['machine', 'gateway', 'gateway'],
    ['machine', 'direct', 'direct'],
    ['gateway', 'direct', 'gateway'],
    ['direct', 'gateway', 'direct'],
  ] as const)('sets %s (the machine’s legacy route %s): machine-route.json holds it, machine-settings.json %s, and a reopen reads it', async (route, machineLegacy, legacy) => {
    machineFileWith('direct');
    const machine = open({ legacyOfMachine: async () => machineLegacy });
    const told: Route[] = [];
    machine.onChange(() => void told.push(machine.defaultRoute()));
    expect(await machine.setDefaultRoute(route)).toBe(route);
    expect(told).toEqual([route]);
    expect(JSON.parse(bytes(routeFile()))).toEqual({ version: 1, defaultRoute: route });
    const written = bytes(paths.machine);
    expect(JSON.parse(written)).toEqual({ ...machineSettingsDefaults(), gateway: { ...machineSettingsDefaults().gateway, defaultRoute: legacy } });
    expect(olderBuildReads(written)).toBe(true); // an older build on this machine reads a valid file with the nearest route
    expect(open().defaultRoute()).toBe(route);
  });

  it('refuses machine, writing neither file, when nothing resolves the machine’s legacy route; gateway and direct need none', async () => {
    machineFileWith('gateway');
    const before = bytes(paths.machine);
    const machine = open();
    const told = vi.fn();
    machine.onChange(told);
    await expect(machine.setDefaultRoute('machine')).rejects.toThrow('legacy route');
    expect(bytes(paths.machine)).toBe(before);
    expect(existsSync(routeFile())).toBe(false);
    expect(told).not.toHaveBeenCalled();
    expect(await machine.setDefaultRoute('direct')).toBe('direct');
    expect(open().defaultRoute()).toBe('direct');
  });

  it('leaves the default alone when a legacy patch repeats the value the file holds (an older client re-saving its form)', async () => {
    machineFileWith('gateway'); // a v1 profile with the old default, read as machine
    const machine = open();
    await machine.update({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'wait' } });
    expect(machine.defaultRoute()).toBe('machine');
    expect(existsSync(routeFile())).toBe(false);
    expect(open().defaultRoute()).toBe('machine');
  });

  it('takes a legacy patch that changes gateway.defaultRoute as a choice of the default, so an older client’s choice stands', async () => {
    machineFileWith('gateway');
    const machine = open();
    await machine.update({ gateway: { defaultRoute: 'direct' } }); // gateway → direct, chosen in an older UI
    expect(machine.defaultRoute()).toBe('direct');
    expect(JSON.parse(bytes(routeFile()))).toEqual({ version: 1, defaultRoute: 'direct' });
    await machine.update({ gateway: { defaultRoute: 'gateway' } }); // direct → gateway: not read back as machine by the rule
    expect(machine.defaultRoute()).toBe('gateway');
    expect(JSON.parse(bytes(routeFile()))).toEqual({ version: 1, defaultRoute: 'gateway' });
    await machine.update({ gateway: { relayUnreachable: 'wait' } }); // a patch that names no route chooses none
    expect(open().defaultRoute()).toBe('gateway');
  });

  it('refuses a set in a run that may not write the machine’s files, changing nothing', async () => {
    machineFileWith('gateway');
    const before = bytes(paths.machine);
    const machine = open({ refused: 'spine.lock is held by pid 4242', legacyOfMachine: async () => 'gateway' });
    const told = vi.fn();
    machine.onChange(told);
    await expect(machine.setDefaultRoute('direct')).rejects.toThrow('spine.lock is held by pid 4242');
    expect(bytes(paths.machine)).toBe(before);
    expect(existsSync(routeFile())).toBe(false);
    expect(machine.defaultRoute()).toBe('machine');
    expect(told).not.toHaveBeenCalled();
  });

  it('reads an invalid machine-route.json by the rule and refuses a set over it, writing neither file', async () => {
    machineFileWith('direct');
    const before = bytes(paths.machine);
    writeFileSync(routeFile(), JSON.stringify({ version: 2, defaultRoute: 'machine' })); // a later build's
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machine = open();
    expect(machine.defaultRoute()).toBe('direct');
    await expect(machine.setDefaultRoute('gateway')).rejects.toThrow();
    expect(JSON.parse(bytes(routeFile()))).toEqual({ version: 2, defaultRoute: 'machine' });
    expect(bytes(paths.machine)).toBe(before);
    expect(machine.defaultRoute()).toBe('direct');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('refuses a set over a machine-settings.json this build cannot own, writing no machine-route.json', async () => {
    writeFileSync(paths.machine, JSON.stringify({ ...machineSettingsDefaults(), version: 2 })); // a later build's
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const machine = open();
    await expect(machine.setDefaultRoute('direct')).rejects.toThrow();
    expect(existsSync(routeFile())).toBe(false);
  });
});
