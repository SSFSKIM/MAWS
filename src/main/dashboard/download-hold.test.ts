// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3)): the source sheet's
// Download takes main's own hold over the snapshot before it resolves the path or opens the Save dialog, and keeps it
// through the copy, whatever the sheet does meanwhile; it is released on success, cancel and failure alike. A snapshot
// already unavailable is refused before any dialog.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { createAssetDownload, type AssetDownloadDeps } from './download';
import { holdAsset } from './holds';

const ID = '00000000-0000-4000-8000-000000000001';
let dir: string;
let blob: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-download-hold-'));
  mkdirSync(join(dir, 'Downloads'));
  blob = join(dir, 'blob');
  writeFileSync(blob, '[{"v":1}]');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function world(over: Partial<AssetDownloadDeps> = {}) {
  const log: string[] = [];
  let held = 0;
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    log.push(name);
    if (name === 'artifacts.holdAssets') {
      if ((input as CommandInput<'artifacts.holdAssets'>).refs[0] === 'assets/gone.json') return { ok: false, error: ipcError('invalid_input', 'the snapshot assets/gone.json is unavailable', { reason: 'notFound', data: { snapshotUnavailable: true } }) } as never;
      held += 1;
      return { ok: true, value: { assetHoldId: '00000000-0000-4000-8000-0000000000a1' } } as never;
    }
    if (name === 'artifacts.releaseAssets') {
      held -= 1;
      return { ok: true, value: { released: true } } as never;
    }
    if (name === 'artifacts.content') return { ok: true, value: { revision: 4, kind: 'dashboard', name: 'query-1.json', size: 9, sha256: 'x', path: blob } } as never;
    throw new Error(`unexpected ${name}`);
  };
  let dialogOpen: (() => void) | null = null;
  const deps: AssetDownloadDeps = {
    call,
    hold: (artifactId, ref) => holdAsset(call, artifactId, ref),
    downloads: () => join(dir, 'Downloads'),
    showSaveDialog: vi.fn(async (options: { defaultPath?: string }) => {
      log.push(`dialog (held ${held})`);
      await new Promise<void>((resolve) => (dialogOpen = resolve));
      return { canceled: false, filePath: options.defaultPath };
    }),
    env: {},
    ...over,
  };
  return { deps, log, held: () => held, closeDialog: () => dialogOpen?.() };
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  expect(check()).toBe(true);
};

describe('the Download’s hold (E3)', () => {
  it('is taken before the path and the dialog and kept through the copy, then released', async () => {
    const w = world();
    const saving = createAssetDownload(w.deps).downloadAsset({ artifactId: ID, ref: 'assets/query-1.json', name: 'live.json' });
    await until(() => w.log.some((entry) => entry.startsWith('dialog')));
    expect(w.log).toEqual(['artifacts.holdAssets', 'artifacts.content', 'dialog (held 1)']);
    expect(w.held()).toBe(1); // whatever the sheet does meanwhile (it may close), the Download holds its own
    w.closeDialog();
    const { path } = await saving;
    expect(readFileSync(path!, 'utf8')).toBe('[{"v":1}]');
    await until(() => w.held() === 0);
    expect(w.log.at(-1)).toBe('artifacts.releaseAssets');
  });

  it('is released when the owner cancels, and when the copy fails', async () => {
    const cancel = world({ showSaveDialog: vi.fn(async () => ({ canceled: true })) });
    expect(await createAssetDownload(cancel.deps).downloadAsset({ artifactId: ID, ref: 'assets/query-1.json' })).toEqual({ path: null });
    await until(() => cancel.held() === 0);
    const failing = world({ showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: join(dir, 'missing-folder', 'x.json') })) });
    await expect(createAssetDownload(failing.deps).downloadAsset({ artifactId: ID, ref: 'assets/query-1.json' })).rejects.toThrow();
    await until(() => failing.held() === 0);
  });

  it('refuses a snapshot already unavailable before any dialog', async () => {
    const w = world();
    await expect(createAssetDownload(w.deps).downloadAsset({ artifactId: ID, ref: 'assets/gone.json' })).rejects.toMatchObject({ error: { issues: { data: { snapshotUnavailable: true } } } });
    expect(w.log).toEqual(['artifacts.holdAssets']);
    expect(w.deps.showSaveDialog).not.toHaveBeenCalled();
  });
});
