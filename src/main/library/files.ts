// A byte kind's stored file as the viewers and the library reach it (docs/doperpowers/plans/2026-10-12-p3-l-library.md,
// M5b; Decision Log 14): `library.exportFormats` (what main's exporter registry serves for a kind), `library.content`
// (the stored file at a revision, which names the `maws-artifact:` URL and the file a File artifact's code body reads),
// `library.openExternally` and `library.reveal`, and `library.saveAs` (an export's file, or the stored file, copied to
// where the owner chose). Every path is resolved here from the artifact's id through the engine host's
// `artifacts.content` (main's alone to send) or the export service's own naming rule, never taken from the window, so
// a window reaches the files of the store and of the exports and nothing beside them. Open externally hands the OS a
// document kind only, never a program (the files service's rule). Under MAWS_E2E=1 the seams the rest of the app
// uses stand in for the OS: MAWS_E2E_OPEN_LOG takes an open or a reveal as a line, MAWS_E2E_SAVE_PATH is the folder a
// save lands in without the dialog.
import { appendFile, copyFile, lstat, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SaveDialogOptions, WebContents } from 'electron';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { opensExternally } from '@shared/ipc/schema/files';
import { ARTIFACT_EXPORT_FORMATS, artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { CommandFailure, type registerMainHandler } from '../ipc/router';

export interface LibraryFilesDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  exporters: { get(kind: ArtifactKind, format: ArtifactExportFormat): unknown }; // startArtifacts().exporters
  root: string; // `<userData>/artifacts`, where the export service writes the library's exports
  downloads(): string; // app.getPath('downloads')
  showSaveDialog(options: SaveDialogOptions, sender: WebContents | undefined): Promise<{ canceled: boolean; filePath?: string }>;
  openPath(path: string): Promise<string>; // shell.openPath: '' on success, else the error text
  showItemInFolder(path: string): void;
  env: NodeJS.ProcessEnv;
}

type Out<N extends CommandName> = Promise<CommandOutput<N>>;

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
  const seamLog = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_OPEN_LOG : undefined;

  const content = async ({ artifactId, revision }: CommandInput<'library.content'>): Out<'library.content'> => {
    const found = await required('artifacts.content', { artifactId, ...(revision !== undefined && { revision }) });
    return { revision: found.revision, kind: found.kind, name: found.name, path: found.path };
  };

  // A regular file the OS may open as a document: a kind `opensExternally` admits, with no execute bit.
  const openable = async (path: string, name: string): Promise<boolean> => {
    const target = await lstat(path).catch(() => null);
    return target !== null && target.isFile() && (target.mode & 0o111) === 0 && opensExternally(name);
  };

  // Where the copy goes: the e2e seam's folder, else the dialog's choice (null when cancelled).
  const destination = async (defaultName: string, sender: WebContents | undefined): Promise<string | null> => {
    const seamDir = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_SAVE_PATH : undefined;
    if (seamDir) return join(seamDir, defaultName);
    const { canceled, filePath } = await deps.showSaveDialog({ defaultPath: join(deps.downloads(), defaultName) }, sender);
    return canceled || !filePath ? null : filePath;
  };

  return {
    exportFormats: ({ kind }: CommandInput<'library.exportFormats'>): CommandOutput<'library.exportFormats'> => ({
      formats: ARTIFACT_EXPORT_FORMATS.filter((format) => deps.exporters.get(kind, format) !== undefined),
    }),

    content,

    async openExternally(input: CommandInput<'library.openExternally'>): Out<'library.openExternally'> {
      const { name, path } = await content(input);
      if (!(await openable(path, name))) return { opened: false, message: `Not opened outside MAWS: ${name}` };
      if (seamLog) {
        await appendFile(seamLog, `${path}\n`);
        return { opened: true, message: null };
      }
      const message = await deps.openPath(path);
      return message === '' ? { opened: true, message: null } : { opened: false, message };
    },

    async reveal(input: CommandInput<'library.reveal'>): Out<'library.reveal'> {
      const { path } = await content(input);
      if (!(await lstat(path).catch(() => null))?.isFile()) return { revealed: false, message: `Not on disk any more: ${basename(path)}` };
      if (seamLog) {
        await appendFile(seamLog, `reveal ${path}\n`);
        return { revealed: true, message: null };
      }
      deps.showItemInFolder(path);
      return { revealed: true, message: null };
    },

    async saveAs({ artifactId, source }: CommandInput<'library.saveAs'>, sender?: WebContents): Out<'library.saveAs'> {
      const { artifact } = await required('artifacts.get', { artifactId });
      if (!artifact) throw new CommandFailure(ipcError('invalid_input', `no artifact ${artifactId}`, { reason: 'notFound', data: {} }));
      let from: string;
      let defaultName: string;
      if ('export' in source) {
        const name = artifactExportName(source.export.revision, source.export.format);
        from = join(deps.root, artifactId, 'exports', name);
        if (!(await lstat(from).catch(() => null))?.isFile()) throw new CommandFailure(ipcError('invalid_input', `no export ${name} of ${artifactId}; export it again`));
        defaultName = `${fileNameOf(artifact.title)}${extname(name)}`;
      } else {
        const stored = await content({ artifactId, ...(source.content.revision !== undefined && { revision: source.content.revision }) });
        from = stored.path;
        // a File artifact keeps its file's own name; a page is named by its title
        defaultName = artifact.kind === 'file' ? fileNameOf(stored.name) : `${fileNameOf(artifact.title)}${extname(stored.name)}`;
      }
      const to = await destination(defaultName, sender);
      if (to === null) return { saved: false };
      const temp = join(dirname(to), `.${randomUUID()}.tmp`);
      try {
        await copyFile(from, temp);
        await rename(temp, to);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      return { saved: true, path: to };
    },
  };
}

export function registerLibraryFiles(register: typeof registerMainHandler, deps: LibraryFilesDeps): void {
  const files = createLibraryFiles(deps);
  register('library.exportFormats', files.exportFormats);
  register('library.content', files.content);
  register('library.openExternally', files.openExternally);
  register('library.reveal', files.reveal);
  register('library.saveAs', (input, { sender }) => files.saveAs(input, sender));
}
