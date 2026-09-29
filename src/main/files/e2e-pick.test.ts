import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDialogFor } from './e2e-pick';
import { pickFiles, type OpenDialog } from './pick';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-e2e-pick-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const native = () => vi.fn<OpenDialog>(async () => ({ canceled: false, filePaths: ['/from/the/native/panel'] }));

describe('the e2e seam for layout.pickFiles', () => {
  it('outside MAWS_E2E=1 is the native panel itself, whatever MAWS_E2E_PICK_PATHS says', () => {
    const panel = native();
    expect(openDialogFor({}, panel)).toBe(panel);
    expect(openDialogFor({ MAWS_E2E_PICK_PATHS: dir }, panel)).toBe(panel);
    expect(openDialogFor({ MAWS_E2E: '0', MAWS_E2E_PICK_PATHS: dir }, panel)).toBe(panel);
  });

  it('under MAWS_E2E=1 without MAWS_E2E_PICK_PATHS answers as cancelled and never opens the panel', async () => {
    const panel = native();
    const open = openDialogFor({ MAWS_E2E: '1' }, panel);
    expect(await open({ properties: ['openDirectory'] })).toEqual({ canceled: true, filePaths: [] });
    expect(await pickFiles({ kind: 'directory', directory: null, multiple: false }, { showOpenDialog: open })).toEqual({ files: [] });
    expect(openDialogFor({ MAWS_E2E: '1', MAWS_E2E_PICK_PATHS: '' }, panel)).not.toBe(panel);
    expect(await openDialogFor({ MAWS_E2E: '1', MAWS_E2E_PICK_PATHS: '' }, panel)({ properties: ['openFile'] })).toEqual({ canceled: true, filePaths: [] });
    expect(panel).not.toHaveBeenCalled();
  });

  it('under MAWS_E2E=1 answers the listed paths, read at each pick, and never opens the panel', async () => {
    const project = join(dir, 'project');
    mkdirSync(project);
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    const panel = native();
    const env: NodeJS.ProcessEnv = { MAWS_E2E: '1', MAWS_E2E_PICK_PATHS: project };
    const open = openDialogFor(env, panel);
    expect(await pickFiles({ kind: 'directory', directory: null, multiple: false }, { showOpenDialog: open })).toEqual({
      files: [{ path: project, name: 'project', bytes: 0, mediaType: 'inode/directory', data: null }],
    });
    env.MAWS_E2E_PICK_PATHS = [a, b].join(delimiter); // a driver sets the next pick's answer
    expect((await pickFiles({ kind: 'files', directory: null, multiple: true }, { showOpenDialog: open })).files.map((f) => f.path)).toEqual([a, b]);
    expect(panel).not.toHaveBeenCalled();
  });

  it('refuses a listed path that does not exist, is relative, or is not what the pick asks for', async () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'a');
    const panel = native();
    const pick = (paths: string, properties: ('openFile' | 'openDirectory' | 'multiSelections')[]) => openDialogFor({ MAWS_E2E: '1', MAWS_E2E_PICK_PATHS: paths }, panel)({ properties });
    await expect(pick(join(dir, 'missing'), ['openDirectory'])).rejects.toThrow(/MAWS_E2E_PICK_PATHS: no such path: .*missing/);
    await expect(pick('relative/path', ['openFile'])).rejects.toThrow(/MAWS_E2E_PICK_PATHS: not an absolute path: relative\/path/);
    await expect(pick(file, ['openDirectory'])).rejects.toThrow(/MAWS_E2E_PICK_PATHS: not a directory: .*a\.ts/);
    await expect(pick(dir, ['openFile'])).rejects.toThrow(/MAWS_E2E_PICK_PATHS: a directory where the pick asks for a file: /);
    await expect(pick([file, file].join(delimiter), ['openFile'])).rejects.toThrow(/MAWS_E2E_PICK_PATHS: 2 paths for a single pick/);
    expect(panel).not.toHaveBeenCalled();
  });
});
