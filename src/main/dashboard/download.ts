// A dashboard's source sheet Download (P3-E2 M3; the ledger's X23 amendment, E's Decision Log 18): main-owned and
// renderer-callable `artifacts.downloadAsset {artifactId, ref, name?}`. The asset is the artifact's own: main resolves
// it through the engine host's `artifacts.content` (main's alone to send), which answers a ref only from that
// artifact's assets, so an unowned ref is refused before any dialog; the renderer never fetches the bytes, and the
// store scheme's download ban (src/main/artifacts/policies.ts `shouldCancelDownload`) and the CSP stand. The client
// port's Save dialog (OX4) opens under Downloads with the displayed descriptor's source name cut to a basename
// (same-bytes CSV and TSV share one ref, never one extension); the copy lands whole through a temporary file beside it.
// Under MAWS_E2E=1, MAWS_E2E_SAVE_PATH is the folder a save lands in without the dialog (the library's Save as seam).
import { copyFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { CommandFailure, type registerMainHandler } from '../ipc/router';

export interface AssetDownloadDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): main's own hold over the snapshot, taken before
  // the path and the dialog and kept through the copy (holds.ts `holdAsset` in the app), whatever the sheet does meanwhile
  hold?: (artifactId: string, ref: string) => Promise<{ release(): Promise<void> }>;
  downloads(): string; // app.getPath('downloads')
  port: Pick<ClientPort, 'save'>;
  env: NodeJS.ProcessEnv;
}

const NAME_MAX = 200;
const FALLBACK = 'dataset';

/**
 * A suggested name the dialog can take: its last path segment (either separator), control characters and colons
 * replaced, leading dots dropped (no `.`, `..` or hidden name), at most 200 characters; else the stored asset's name
 * made safe the same way; else "dataset".
 */
export function safeDownloadName(suggested: string | undefined, stored: string): string {
  const clean = (name: string | undefined): string | null => {
    // eslint-disable-next-line no-control-regex
    const base = (name ?? '').split(/[/\\]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').replace(/:/g, '-').trim().replace(/^\.+/, '').trim();
    if (base === '') return null;
    if (base.length <= NAME_MAX) return base;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : '';
    return base.slice(0, NAME_MAX - ext.length) + ext;
  };
  return clean(suggested) ?? clean(stored) ?? FALLBACK;
}

export function createAssetDownload(deps: AssetDownloadDeps) {
  // the e2e seam's folder, else the dialog's choice (null when cancelled or no client could ask)
  const destination = async (name: string, client: ClientRef | null): Promise<string | null> => {
    const seamDir = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_SAVE_PATH : undefined;
    if (seamDir) return join(seamDir, name);
    const answer = await deps.port.save(client, { defaultPath: join(deps.downloads(), name) });
    return 'path' in answer ? answer.path : null;
  };
  return {
    async downloadAsset({ artifactId, ref, name }: CommandInput<'artifacts.downloadAsset'>, client: ClientRef | null): Promise<CommandOutput<'artifacts.downloadAsset'>> {
      const held = await deps.hold?.(artifactId, ref); // E3: before anything else, released however the Download ends
      try {
        const found = await deps.call('artifacts.content', { artifactId, path: ref });
        if (!found.ok) throw new CommandFailure(found.error);
        const to = await destination(safeDownloadName(name, found.value.name), client);
        if (to === null) return { path: null };
        const temp = join(dirname(to), `.${randomUUID()}.tmp`);
        try {
          await copyFile(found.value.path, temp);
          await rename(temp, to);
        } catch (error) {
          await rm(temp, { force: true }).catch(() => {});
          throw error;
        }
        return { path: to };
      } finally {
        await held?.release();
      }
    },
  };
}

export function registerAssetDownload(register: typeof registerMainHandler, deps: AssetDownloadDeps): void {
  const download = createAssetDownload(deps);
  register('artifacts.downloadAsset', (input, { client }) => download.downloadAsset(input, client));
}
