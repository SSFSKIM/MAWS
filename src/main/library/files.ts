// A byte kind's export formats and a stored file's or an export's copy, the app's half of the library's files
// (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; Decision Log 14): `library.exportFormats` (what main's
// exporter registry serves for a kind) and `library.saveAs` (an export's file, or the stored file, copied to where the
// owner chose). P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D19): the reads of a stored file
// (`library.content`, `library.read`, `library.openExternally`, `library.reveal`) are the machine's
// (src/services/library/files.ts); these two stay main's, beside the exporters, until O5 moves them. Every path is
// resolved here from the artifact's id through the engine host's `artifacts.content` (main's alone to send) or the export
// service's own naming rule, never taken from the window, so a window reaches the files of the store and of the exports
// and nothing beside them. The dialogs and the Replace question go through the client port (OX4), asked through the
// requesting client. Under MAWS_E2E=1 MAWS_E2E_SAVE_PATH is the folder a save lands in without the dialog.
//
// UX wave U5 (l6-artifacts-20; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 14): the dialog
// opens in the folder the last export saved to, kept across launches under main's layout key `library.exportFolder`
// (written once a copy is in place, the e2e seam's included; a failed write is logged and the save stands). With none,
// or one that is no longer a directory: for an artifact of this Mac, its Space's linked folder, else the working folder
// of the session that made it, each only while it is a directory; else Downloads.
//
// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Open a copy, and Save As of a remote artifact"):
// `library.saveAs` is answered here for any machine (the router's allow-list). For an artifact on another machine
// (`ctx.target`), its row, its stored file's name and the file itself (an export the renderer made there with
// `artifacts.export {machine}`, or the stored file) come over that machine's link (`remote`, remote lane B's): the file is
// paged into a temporary directory, then saved through the port as a local one is. A remote export is never removed after
// (the renderer asks no `ownFile` of another machine: its export stays a row of that machine's library).
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { BigIntStats } from 'node:fs';
import JSZip from 'jszip';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { isNoClient, type ClientPort } from '@shared/client/port';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import { ExportFolderSchema, type ExportFolder } from '@shared/ipc/schema/layout';
import type { MachineRef } from '@shared/machine/ref';
import { ARTIFACT_EXPORT_FORMATS, artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import type { LayoutStore } from '../layout/store';

export interface LibraryFilesDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  exporters: { get(kind: ArtifactKind, format: ArtifactExportFormat): unknown }; // startArtifacts().exporters
  root: string; // `<userData>/artifacts`, where the export service writes the library's exports
  downloads(): string; // app.getPath('downloads')
  port: Pick<ClientPort, 'save' | 'confirm'>; // Save as…, Replace?
  env: NodeJS.ProcessEnv;
  local?: MachineRef; // P5 O7 M5a: this Mac; a Save As for another machine reads through `remote`
  remote?(machine: MachineRef): RemoteLibraryFiles | null; // P5 O7 M5a: remote lane B's, null while no link reaches it
  layout: Pick<LayoutStore, 'get' | 'set'>; // UX wave U5: where the last export's folder is kept (main's layout store)
  sessionFolder(appSessionId: AppSessionId): string | null; // UX wave U5: a session's working folder, null when this Mac knows none
}

/** P5 O7 M5a: what Save As reads of an artifact on another machine, over its link; a refusal throws `CommandFailure`. */
export interface RemoteLibraryFiles {
  get(artifactId: string): Promise<ArtifactRow | null>;
  content(input: CommandInput<'library.content'>): Promise<CommandOutput<'library.content'>>;
  /** The stored file at a revision, or an export, paged into `to`. */
  fetch(source: { artifactId: string; revision?: number } | { artifactId: string; export: NonNullable<CommandInput<'library.read'>['export']> }, to: string): Promise<void>;
}

type Out<N extends CommandName> = Promise<CommandOutput<N>>;
const EXPORT_FOLDER_KEY = 'library.exportFolder'; // UX wave U5: main's own layout key

// A title as a file name: no path separator, colon or control character, at most 120 characters, never empty.
export function fileNameOf(title: string): string {
  // eslint-disable-next-line no-control-regex
  const name = title.replace(/[/\\:\u0000-\u001f\u007f]/g, '-').trim().slice(0, 120).trim();
  return name === '' || name === '.' || name === '..' ? 'Artifact' : name;
}

export function createLibraryFiles(deps: LibraryFilesDeps) {
  const required = async <N extends CommandName>(name: N, input: CommandInput<N>): Out<N> => {
    const result = await deps.call(name, input);
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  };
  // The stored file a copy of the content is made from (the machine resolves it the same way for its reads)
  const content = async ({ artifactId, revision }: CommandInput<'library.content'>): Out<'library.content'> => {
    const found = await required('artifacts.content', { artifactId, ...(revision !== undefined && { revision }) });
    return { revision: found.revision, kind: found.kind, name: found.name, path: found.path };
  };

  // UX wave U5: the folder the dialog opens in (above); `here` is the artifact when it is this Mac's, else null.
  const storedFolder = (): string | null => ExportFolderSchema.safeParse(deps.layout.get(EXPORT_FOLDER_KEY)).data?.path ?? null;
  const spaceFolder = async ({ spaceId }: ArtifactRow): Promise<string | null> => {
    if (spaceId === undefined) return null;
    const listed = await deps.call('spaces.list', undefined);
    if (!listed.ok) return null;
    return listed.value.spaces.find((space) => space.id === spaceId)?.linkedDir ?? null;
  };
  const makerFolder = ({ createdBy }: ArtifactRow): string | null => (createdBy.kind === 'session' ? deps.sessionFolder(createdBy.appSessionId) : null);
  const startFolder = async (here: ArtifactRow | null): Promise<string> => {
    const candidates = [storedFolder, ...(here === null ? [] : [() => spaceFolder(here), () => makerFolder(here)])];
    for (const candidate of candidates) {
      const folder = await candidate();
      if (folder !== null && (await stat(folder).catch(() => null))?.isDirectory()) return folder;
    }
    return deps.downloads();
  };
  const remember = (folder: string): void => {
    try {
      deps.layout.set(EXPORT_FOLDER_KEY, { path: folder } satisfies ExportFolder);
    } catch (error) {
      console.error(`[library] cannot keep the export folder (${EXPORT_FOLDER_KEY}): ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Where the copy goes: the e2e seam's folder, else the dialog's choice (null when cancelled or no client could ask).
  const destination = async (defaultName: string, client: ClientRef | null, here: ArtifactRow | null): Promise<string | null> => {
    const seamDir = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_SAVE_PATH : undefined;
    if (seamDir) return join(seamDir, defaultName);
    const answer = await deps.port.save(client, { defaultPath: join(await startFolder(here), defaultName) });
    return 'path' in answer ? answer.path : null;
  };
  // The owner's Replace for a slide folder already at the destination; no client to ask is no.
  const confirmReplaceFolder = async (path: string, client: ClientRef | null): Promise<boolean> => {
    const answer = await deps.port.confirm(client, {
      kind: 'warning',
      message: `Replace “${basename(path)}”?`,
      detail: `The folder at ${path} and everything in it will be replaced with the exported slides.`,
      confirm: 'Replace',
      cancel: 'Cancel',
    });
    return !isNoClient(answer) && answer.confirmed;
  };

  return {
    exportFormats: ({ kind }: CommandInput<'library.exportFormats'>): CommandOutput<'library.exportFormats'> => ({
      formats: ARTIFACT_EXPORT_FORMATS.filter((format) => deps.exporters.get(kind, format) !== undefined),
    }),

    async saveAs({ artifactId, source }: CommandInput<'library.saveAs'>, client: ClientRef | null, target?: MachineRef): Out<'library.saveAs'> {
      if (target !== undefined && deps.local !== undefined && target !== deps.local) return saveRemote({ artifactId, source }, client, target);
      // P3-E (E1 M5; Decision Log 33): an export's save reads the row alone (`prepare: false`, Decision Log 22), so a
      // retained version's file saves whatever the live document's state
      const { artifact } = await required('artifacts.get', { artifactId, ...('export' in source && { prepare: false }) });
      if (!artifact) throw new CommandFailure(ipcError('invalid_input', `no artifact ${artifactId}`, { reason: 'notFound', data: {} }));
      let from: string;
      let defaultName: string;
      if ('export' in source) {
        const name = artifactExportName(source.export.revision, source.export.format, source.export.exportId); // P3-E: the managed name, the id a UUID (the schema's)
        from = join(deps.root, artifactId, 'exports', name);
        if (!(await lstat(from).catch(() => null))?.isFile()) throw new CommandFailure(ipcError('invalid_input', `no export ${name} of ${artifactId}; export it again`));
        defaultName = exportedName(artifact.title, source.export);
      } else {
        const stored = await content({ artifactId, ...(source.content.revision !== undefined && { revision: source.content.revision }) });
        from = stored.path;
        defaultName = storedName(artifact, stored.name);
      }
      // P4 (W1, L302): an export of its own file (`exportId`) is this save's alone, and nothing else collects the exports
      // directory, so it goes once the save is done with it, copied, declined or failed; the cache name's never does
      const own = 'export' in source && source.export.exportId !== undefined ? from : null;
      try {
        return await save(from, defaultName, 'export' in source && source.export.format === 'pngs', client, artifact);
      } finally {
        if (own !== null) await rm(own, { force: true }).catch(() => {});
      }
    },
  };

  // The file at `from` copied to where the owner chose (a slide export's folder in place of its bundle).
  async function save(from: string, defaultName: string, slides: boolean, client: ClientRef | null, here: ArtifactRow | null): Out<'library.saveAs'> {
    const to = await destination(defaultName, client, here);
    if (to === null) return { saved: false };
    if (slides) {
      if (!(await savePngFolder(from, to, () => confirmReplaceFolder(to, client)))) return { saved: false };
    } else {
      const temp = join(dirname(to), `.${randomUUID()}.tmp`);
      try {
        await copyFile(from, temp);
        await rename(temp, to);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    }
    remember(dirname(to));
    return { saved: true, path: to };
  }

  // P5 O7 M5a: an artifact on another machine, its file paged over the link into a temporary directory, then saved as above.
  async function saveRemote({ artifactId, source }: CommandInput<'library.saveAs'>, client: ClientRef | null, machine: MachineRef): Out<'library.saveAs'> {
    const remote = deps.remote?.(machine) ?? null;
    if (remote === null) throw new CommandFailure(ipcError('host_unavailable', `library.saveAs: machine ${machine} is not connected`));
    const artifact = await remote.get(artifactId);
    if (!artifact) throw new CommandFailure(ipcError('invalid_input', `no artifact ${artifactId}`, { reason: 'notFound', data: {} }));
    const dir = await mkdtemp(join(tmpdir(), 'maws-remote-save-'));
    try {
      if ('export' in source) {
        const from = join(dir, artifactExportName(source.export.revision, source.export.format, source.export.exportId));
        await remote.fetch({ artifactId, export: source.export }, from);
        return await save(from, exportedName(artifact.title, source.export), source.export.format === 'pngs', client, null); // another machine's: no folder of this Mac's names it
      }
      const revision = source.content.revision;
      const stored = await remote.content({ artifactId, ...(revision !== undefined && { revision }) });
      const from = join(dir, fileNameOf(stored.name));
      await remote.fetch({ artifactId, ...(revision !== undefined && { revision }) }, from);
      return await save(from, storedName(artifact, stored.name), false, client, null);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// An export saved by the artifact's title (a slide export as a folder of that name); a stored file a File artifact keeps
// its own name, a page is named by its title.
const exportedName = (title: string, at: { revision: number; format: ArtifactExportFormat; exportId?: string }) =>
  at.format === 'pngs' ? `${fileNameOf(title)} slides` : `${fileNameOf(title)}${extname(artifactExportName(at.revision, at.format, at.exportId))}`;
const storedName = (artifact: { kind: ArtifactKind; title: string }, name: string) => (artifact.kind === 'file' ? fileNameOf(name) : `${fileNameOf(artifact.title)}${extname(name)}`);

/** Stage the whole bundle, then ask about the directory actually present, not what the save dialog saw. */
async function savePngFolder(from: string, to: string, confirmReplace: () => Promise<boolean>): Promise<boolean> {
  const zip = await JSZip.loadAsync(await readFile(from), { checkCRC32: true });
  const entries = Object.values(zip.files);
  if (!entries.length || entries.some((entry) => entry.dir || !/^slide-\d+\.png$/.test(entry.name) || ((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name) !== entry.name)) {
    throw new Error('The slide export contains invalid file names; export it again.');
  }
  // An exclusively-created private directory owns both names; an un-restorable backup is kept here, never collected.
  const temp = await mkdtemp(join(dirname(to), '.maws-slides-'));
  const staged = join(temp, 'staged');
  const backup = join(temp, 'previous');
  const changed = () => new Error('The destination folder changed while saving; save again to review it.');
  const at = async (path: string): Promise<BigIntStats | null> => {
    try { return await lstat(path, { bigint: true }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const same = (a: BigIntStats | null, b: BigIntStats | null) => a === null || b === null ? a === b : a.dev === b.dev && a.ino === b.ino;
  let moved = false;
  try {
    await mkdir(staged);
    for (const entry of entries) await writeFile(join(staged, entry.name), await entry.async('nodebuffer'));
    const approved = await at(to);
    if (approved !== null && !approved.isDirectory()) throw new Error('Choose a folder, not a file or symbolic link, for the slides.');
    if (approved !== null && !(await confirmReplace())) return false;
    if (!same(approved, await at(to))) throw changed();
    if (approved !== null) {
      await rename(to, backup);
      moved = true;
      // A swap in the check-to-move interval must never become permission to recursively remove another folder.
      if (!same(approved, await at(backup))) throw changed();
    }
    if (await at(to) !== null) throw changed();
    // Node has no exclusive directory rename: a creator in this last syscall window can still lose an empty folder.
    // POSIX refuses a nonempty directory; the vacancy checks also protect rollback from known intervening writers.
    await rename(staged, to);
    if (moved) {
      if (!same(approved, await at(backup))) throw changed();
      await rm(backup, { recursive: true });
      moved = false;
    }
    return true;
  } catch (error) {
    if (moved) {
      try {
        if (await at(to) === null) {
          await rename(backup, to);
          moved = false;
        }
      } catch { /* Keep the backup if restoration fails; never remove an intervening destination to restore it. */ }
      if (moved) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} The previous folder is preserved at ${backup}.`, { cause: error });
      }
    }
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => {});
    // Non-recursive cleanup cannot collect a retained backup or any unexpected entry beside the staging folder.
    await rmdir(temp).catch(() => {});
  }
}

export function registerLibraryFiles(register: typeof registerMainHandler, deps: LibraryFilesDeps): void {
  const files = createLibraryFiles(deps);
  register('library.exportFormats', files.exportFormats);
  register('library.saveAs', (input, { client, target }) => files.saveAs(input, client, target)); // P5 O7 M5a: any machine's
}
