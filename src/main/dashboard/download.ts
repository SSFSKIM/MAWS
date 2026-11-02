// A dashboard's source sheet Download (P3-E2 M3; the ledger's X23 amendment, E's Decision Log 18): main-owned and
// renderer-callable `artifacts.downloadAsset {artifactId, ref, name?}`. The asset is the artifact's own: main resolves
// it through the engine host's `artifacts.content` (main's alone to send), which answers a ref only from that
// artifact's assets, so an unowned ref is refused before any dialog; the renderer never fetches the bytes, and the
// store scheme's download ban (src/main/artifacts/policies.ts `shouldCancelDownload`) and the CSP stand. The client
// port's Save dialog (OX4) opens under Downloads with the displayed descriptor's source name cut to a basename
// (same-bytes CSV and TSV share one ref, never one extension); the copy lands whole through a temporary file beside it.
// Under MAWS_E2E=1, MAWS_E2E_SAVE_PATH is the folder a save lands in without the dialog (the library's Save as seam).
//
// P5 O7 M5b (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Open a copy, and Save As of a remote artifact"):
// answered here for any machine (the router's allow-list). An asset of an artifact on another machine (`ctx.target`) is
// fetched through the scheme's remote responder over that machine's link (`remote`, remote lane B's), whole into a
// temporary file before any dialog (the machine's 404 is the asset not found; a body short of its length is an error and
// saves nothing, and the file written is checked against the length said besides), then saved as a local one is. The machine's own hold is not taken: the one request reads one file.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';
import type { ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { CommandFailure, type registerMainHandler } from '../ipc/router';

/** P5 O7 M5b: another machine's assets, as the scheme's remote responder answers them (src/main/artifacts/remote-scheme.ts). */
export interface RemoteAssets {
  fetch(artifactId: string, ref: string): Promise<Response>;
}

export interface AssetDownloadDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): main's own hold over the snapshot, taken before
  // the path and the dialog and kept through the copy (holds.ts `holdAsset` in the app), whatever the sheet does meanwhile
  hold?: (artifactId: string, ref: string) => Promise<{ release(): Promise<void> }>;
  downloads(): string; // app.getPath('downloads')
  port: Pick<ClientPort, 'save'>;
  env: NodeJS.ProcessEnv;
  local?: MachineRef; // P5 O7 M5b: this Mac; an asset of another machine's artifact is fetched through `remote`
  remote?(machine: MachineRef): RemoteAssets | null; // P5 O7 M5b: remote lane B's, null while no link reaches the machine
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
  // the file at `from` copied to `to` whole: through a temporary file beside it, renamed into place
  const place = async (from: string, to: string): Promise<void> => {
    const temp = join(dirname(to), `.${randomUUID()}.tmp`);
    try {
      await copyFile(from, temp);
      await rename(temp, to);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };
  // P5 O7 M5b: the asset over the machine's link, whole here before the dialog, then placed as a local one is
  const downloadRemote = async ({ artifactId, ref, name }: CommandInput<'artifacts.downloadAsset'>, client: ClientRef | null, machine: MachineRef): Promise<CommandOutput<'artifacts.downloadAsset'>> => {
    const remote = deps.remote?.(machine) ?? null;
    if (remote === null) throw new CommandFailure(ipcError('host_unavailable', `artifacts.downloadAsset: machine ${machine} is not connected`));
    const response = await remote.fetch(artifactId, ref);
    if (response.status !== 200) {
      const words = await response.text().catch(() => '');
      if (response.status === 404) throw new CommandFailure(ipcError('invalid_input', `no asset ${ref} in artifact ${artifactId}`, { reason: 'notFound', data: {} }));
      throw new CommandFailure(ipcError('host_unavailable', words === '' ? `artifacts.downloadAsset: ${machine} answered ${response.status}` : words));
    }
    const dir = await mkdtemp(join(tmpdir(), 'maws-remote-asset-'));
    try {
      const from = join(dir, 'asset');
      await pipeline(response.body === null ? Readable.from([]) : Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(from, { mode: 0o600 }));
      // M5b's milestone review: the file is the length the machine said, or nothing is saved
      const said = response.headers.get('Content-Length');
      const wrote = (await stat(from)).size;
      if (said !== null && Number(said) !== wrote) throw new CommandFailure(ipcError('host_unavailable', `artifacts.downloadAsset: ${machine} sent ${wrote} of ${said} bytes; nothing was saved`));
      const to = await destination(safeDownloadName(name, basename(ref)), client);
      if (to === null) return { path: null };
      await place(from, to);
      return { path: to };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
  return {
    async downloadAsset({ artifactId, ref, name }: CommandInput<'artifacts.downloadAsset'>, client: ClientRef | null, target?: MachineRef): Promise<CommandOutput<'artifacts.downloadAsset'>> {
      if (target !== undefined && deps.local !== undefined && target !== deps.local) return downloadRemote({ artifactId, ref, ...(name !== undefined && { name }) }, client, target);
      const held = await deps.hold?.(artifactId, ref); // E3: before anything else, released however the Download ends
      try {
        const found = await deps.call('artifacts.content', { artifactId, path: ref });
        if (!found.ok) throw new CommandFailure(found.error);
        const to = await destination(safeDownloadName(name, found.value.name), client);
        if (to === null) return { path: null };
        await place(found.value.path, to);
        return { path: to };
      } finally {
        await held?.release();
      }
    },
  };
}

export function registerAssetDownload(register: typeof registerMainHandler, deps: AssetDownloadDeps): void {
  const download = createAssetDownload(deps);
  register('artifacts.downloadAsset', (input, { client, target }) => download.downloadAsset(input, client, target)); // P5 O7 M5b: any machine's
}
