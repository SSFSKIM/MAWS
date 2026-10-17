// The source sheet's Download (P3-E2 M3; parent Decision Log 18, ledger X23's `downloadAsset` amendment): main resolves
// the artifact's own immutable asset through the host's `artifacts.content`, shows Save under Downloads with a
// basename-only suggestion, copies the bytes and answers the path, null on cancel.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema/artifacts';
import { createAssetDownload, safeDownloadName, type AssetDownloadDeps } from './download';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
let dir: string;
let blob: string;
const BYTES = new Uint8Array([0x72, 0x65, 0x67, 0x69, 0x6f, 0x6e, 0x0a, 0xff, 0x00, 0xea, 0xb0, 0x80]); // not UTF-8 clean on purpose

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-dashboard-download-'));
  mkdirSync(join(dir, 'Downloads'));
  blob = join(dir, 'blob');
  writeFileSync(blob, BYTES);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function deps(over: Partial<AssetDownloadDeps> = {}): AssetDownloadDeps & { asked: CommandInput<'artifacts.content'>[] } {
  const asked: CommandInput<'artifacts.content'>[] = [];
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    if (name !== 'artifacts.content') throw new Error(`unexpected ${name}`);
    const content = input as CommandInput<'artifacts.content'>;
    asked.push(content);
    // the host answers only this artifact's own assets (its `listAssets`), whatever the ref names
    if (content.artifactId !== ID || content.path !== 'assets/sales.csv') return { ok: false, error: ipcError('invalid_input', `no asset ${content.path} in ${content.artifactId}`, { reason: 'notFound', data: {} }) } as never;
    return { ok: true, value: { revision: 4, kind: 'dashboard', name: 'sales.csv', size: BYTES.length, sha256: 'x', path: blob } } as never;
  };
  return { call, downloads: () => join(dir, 'Downloads'), showSaveDialog: vi.fn(async (options: { defaultPath?: string }) => ({ canceled: false, filePath: options.defaultPath })), env: {}, asked, ...over };
}

describe('downloadAsset', () => {
  it('saves the artifact\'s own asset byte for byte where the owner chose, suggesting the descriptor\'s name under Downloads', async () => {
    const d = deps();
    const { path } = await createAssetDownload(d).downloadAsset({ artifactId: ID, ref: 'assets/sales.csv', name: 'sales.tsv' });
    expect(d.showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(dir, 'Downloads', 'sales.tsv') }, undefined);
    expect(path).toBe(join(dir, 'Downloads', 'sales.tsv'));
    expect(new Uint8Array(readFileSync(path!))).toEqual(BYTES);
    expect(readdirSync(join(dir, 'Downloads'))).toEqual(['sales.tsv']); // no temporary file left beside it
    expect(d.asked).toEqual([{ artifactId: ID, path: 'assets/sales.csv' }]);
  });

  it('takes the stored asset\'s name when none is suggested', async () => {
    const d = deps();
    await createAssetDownload(d).downloadAsset({ artifactId: ID, ref: 'assets/sales.csv' });
    expect(d.showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(dir, 'Downloads', 'sales.csv') }, undefined);
  });

  it('answers null and writes nothing when the owner cancels', async () => {
    const d = deps({ showSaveDialog: vi.fn(async () => ({ canceled: true })) });
    expect(await createAssetDownload(d).downloadAsset({ artifactId: ID, ref: 'assets/sales.csv', name: 'sales.csv' })).toEqual({ path: null });
    expect(readdirSync(join(dir, 'Downloads'))).toEqual([]);
  });

  it('refuses a ref the artifact does not hold before any dialog', async () => {
    const d = deps();
    await expect(createAssetDownload(d).downloadAsset({ artifactId: OTHER, ref: 'assets/sales.csv' })).rejects.toThrow(/no asset/);
    await expect(createAssetDownload(d).downloadAsset({ artifactId: ID, ref: 'assets/other.csv' })).rejects.toThrow(/no asset/);
    expect(d.showSaveDialog).not.toHaveBeenCalled();
  });

  it('saves into the e2e seam\'s folder without a dialog under MAWS_E2E', async () => {
    mkdirSync(join(dir, 'seam'));
    const d = deps({ env: { MAWS_E2E: '1', MAWS_E2E_SAVE_PATH: join(dir, 'seam') } });
    const { path } = await createAssetDownload(d).downloadAsset({ artifactId: ID, ref: 'assets/sales.csv', name: 'sales.csv' });
    expect(path).toBe(join(dir, 'seam', 'sales.csv'));
    expect(d.showSaveDialog).not.toHaveBeenCalled();
    expect(new Uint8Array(readFileSync(path!))).toEqual(BYTES);
  });
});

describe('safeDownloadName', () => {
  it('keeps a basename only: no separator, no dot-directory, no control character', () => {
    expect(safeDownloadName('../../etc/passwd', 'sales.csv')).toBe('passwd');
    expect(safeDownloadName('C:\\Users\\x\\data.tsv', 'sales.csv')).toBe('data.tsv');
    expect(safeDownloadName('..', 'sales.csv')).toBe('sales.csv');
    expect(safeDownloadName('a/..', 'sales.csv')).toBe('sales.csv');
    expect(safeDownloadName('.', 'sales.csv')).toBe('sales.csv');
    expect(safeDownloadName('.hidden.csv', 'sales.csv')).toBe('hidden.csv');
    expect(safeDownloadName('re\u0000port\u0007:1.csv', 'sales.csv')).toBe('report-1.csv');
    expect(safeDownloadName('   ', 'sales.csv')).toBe('sales.csv');
    expect(safeDownloadName(undefined, '../x/..')).toBe('dataset');
    expect(safeDownloadName('매출 2026.csv', 'sales.csv')).toBe('매출 2026.csv');
    expect(safeDownloadName(`${'a'.repeat(300)}.csv`, 'sales.csv')).toHaveLength(200);
  });
});

describe('the command', () => {
  it('is main\'s, renderer-callable, and takes an asset ref only', async () => {
    expect(commands['artifacts.downloadAsset'].owner).toBe('main');
    const input = commands['artifacts.downloadAsset'].input;
    expect(input.safeParse({ artifactId: ID, ref: 'assets/sales.csv', name: 'sales.csv' }).success).toBe(true);
    expect(input.safeParse({ artifactId: ID, ref: 'index.html' }).success).toBe(false);
    expect(input.safeParse({ artifactId: ID, ref: 'assets/x', name: '' }).success).toBe(false);
    const { mainOnlyCommands } = await import('@shared/ipc/names/artifacts');
    expect(mainOnlyCommands as readonly string[]).not.toContain('artifacts.downloadAsset');
  });
});
