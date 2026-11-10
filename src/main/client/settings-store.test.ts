// The client half on the daemon shape at the first launch on a profile before the split (P5 O3-D M5b follow-up;
// docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, acceptance 1, D24, D26): the split is `mawsd`'s, at its spine's
// first load, so main opens a unified settings.json that is converted moments later in the same run. A client change
// made in that window waits for the split and is written into the converted file; the wait is bounded, and a change it
// cannot hold fails saying why, writing nothing.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS_V21, splitSettings } from '@shared/settings/defaults';
import { settingsPaths } from '@shared/settings/paths';
import { startMachineSettings } from '../../services/settings/machine';
import { splitSettingsFiles } from '../../services/settings/split';
import { composeSettings, SPLIT_WAIT_MS } from './settings-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-client-split-wait-'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const CHOSEN = { ...SETTINGS_DEFAULTS_V21, theme: 'dark' as const, usage: { nearLimitPercent: 75 } };
const unifiedText = JSON.stringify({ ...CHOSEN, version: 20 });

// The split as `mawsd` runs it, and a signal the test lets go of: what main hears once `mawsd` answered
function splitSignal() {
  let done!: () => void;
  const promise = new Promise<void>((resolve) => (done = resolve));
  return { split: () => promise, done };
}

describe('a client change while mawsd has not split settings.json yet', () => {
  it('waits for the split and is written into the converted file, the machine fields left to mawsd', async () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, unifiedText);
    const signal = splitSignal();
    const settings = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }), split: signal.split });
    let settled = false;
    const changing = settings.update({ theme: 'light' }).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(readFileSync(paths.client, 'utf8')).toBe(unifiedText);

    splitSettingsFiles(paths, undefined, () => {});
    signal.done();
    expect(await changing).toMatchObject({ theme: 'light', usage: { nearLimitPercent: 75 } });
    expect(JSON.parse(readFileSync(paths.client, 'utf8'))).toEqual({ ...splitSettings(CHOSEN).client, theme: 'light' });
    expect(JSON.parse(readFileSync(paths.machine, 'utf8'))).toEqual(splitSettings(CHOSEN).machine);
  });

  it('waits at most the cold start’s bound, then fails saying why and writes nothing', async () => {
    vi.useFakeTimers();
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, unifiedText);
    const settings = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }), split: () => new Promise<void>(() => {}) });
    const changing = settings.update({ theme: 'light' });
    const failed = expect(changing).rejects.toThrow(`the machine daemon has not converted settings.json to this version's format within ${SPLIT_WAIT_MS / 1000} s`);
    await vi.advanceTimersByTimeAsync(SPLIT_WAIT_MS);
    await failed;
    expect(readFileSync(paths.client, 'utf8')).toBe(unifiedText);
    expect(settings.settings.theme).toBe('dark');
  });

  it('fails with the file’s own reason when the split ran but could not convert it', async () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, unifiedText);
    const settings = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }), split: async () => {} });
    await expect(settings.update({ theme: 'light' })).rejects.toThrow('it is a unified settings file the split has not converted');
    expect(readFileSync(paths.client, 'utf8')).toBe(unifiedText);
  });

  it('never waits on a file already split, nor for a machine field', async () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, unifiedText);
    splitSettingsFiles(paths, undefined, () => {});
    const never = () => new Promise<void>(() => {});
    const settings = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }), split: never });
    expect(await settings.update({ theme: 'light', sessions: { archiveInactiveDays: 30 } })).toMatchObject({ theme: 'light', sessions: { archiveInactiveDays: 30 } });

    rmSync(paths.client);
    rmSync(paths.machine);
    writeFileSync(paths.client, unifiedText);
    const waiting = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }), split: never });
    expect(await waiting.update({ sessions: { archiveInactiveDays: 30 } })).toMatchObject({ theme: 'dark', sessions: { archiveInactiveDays: 30 } });
  });
});

// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, "Settings"): `supervisor.shape` is retired. It
// stays in the schema, so every saved file parses, and reads and is stored as `daemon` whatever the file or a caller
// says; every other setting, `keepRunningDefault` among them, is kept as stored, and the version stays 21.
describe('the retired supervisor.shape', () => {
  const SAVED = { ...SETTINGS_DEFAULTS_V21, theme: 'dark' as const, usage: { nearLimitPercent: 75 }, supervisor: { ...SETTINGS_DEFAULTS_V21.supervisor, keepRunningDefault: false, shape: 'embedded' as const } };
  const onDisk = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  const open = (paths: ReturnType<typeof settingsPaths>) => composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: null }) });

  it('reads `daemon` from a client file saved on the embedded shape, every other setting as written', () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, JSON.stringify(splitSettings(SAVED).client));
    expect(open(paths).settings).toEqual({ ...SAVED, supervisor: { ...SAVED.supervisor, shape: 'daemon' } });
    expect(onDisk(paths.client).supervisor.shape, 'a read writes nothing').toBe('embedded');
  });

  it('reads `daemon` from a unified file the split has not converted', () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, JSON.stringify({ ...SAVED, version: 20 }));
    expect(open(paths).settings).toMatchObject({ theme: 'dark', supervisor: { keepRunningDefault: false, shape: 'daemon' } });
  });

  it('stores `daemon` at the first write, at version 21, the other settings kept', async () => {
    const paths = settingsPaths(dir);
    writeFileSync(paths.client, JSON.stringify(splitSettings(SAVED).client));
    await open(paths).update({ voice: { locale: 'ko-KR' } });
    expect(onDisk(paths.client)).toEqual({ ...splitSettings(SAVED).client, voice: { locale: 'ko-KR' }, supervisor: { keepRunningDefault: false, shape: 'daemon' } });
  });

  it('stores `daemon` when a caller sets `embedded`', async () => {
    const paths = settingsPaths(dir);
    const settings = open(paths);
    expect((await settings.update({ supervisor: { shape: 'embedded' } })).supervisor.shape).toBe('daemon');
    expect(onDisk(paths.client)).toMatchObject({ version: 21, supervisor: { shape: 'daemon' } });
  });
});
