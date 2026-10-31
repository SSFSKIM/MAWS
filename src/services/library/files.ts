// A byte kind's stored file as the viewers and the library reach it, the machine's half (P5 O4 M3,
// docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C; D19; the reads of P3-L M5b and M6b fix wave 2):
// `library.content` (the stored file at a revision, which names the `maws-artifact:` URL and the file a File artifact's
// code body reads), `library.read` (that file's bytes, by the artifact alone), `library.openExternally` and
// `library.reveal`. Composed by the spine's root after the checkouts, so they load, settle and stop with the spine
// wherever it runs (`mawsd` on the daemon shape, main on the embedded one). Every path is resolved here from the
// artifact's id through the engine host's `artifacts.content`, never taken from the window, so a window reaches the
// files of the store and nothing beside them; `library.read` reads through the files service in process (its
// `readResolved`, files.readResolved's handler, which stays served for OX1's window and is sent by no one). Open
// externally hands the OS a document kind only, never a program (the files service's rule); the open and the reveal go
// through the client port (OX4) to the asking client, `noClient` once that client has gone. Under MAWS_E2E=1 the files
// service's seam stands in for the OS: MAWS_E2E_OPEN_LOG takes an open or a reveal as a line. The export formats and
// Save as stay main's (src/main/library/files.ts) until O5 brings the exporters to the machine.
import { appendFile, lstat } from 'node:fs/promises';
import { basename } from 'node:path';
import { isNoClient, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import { HostCommandError } from '@shared/host/runtime';
import type { ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { opensExternally } from '@shared/ipc/schema/files';
import type { ServicesBus } from '@shared/spine/bus';
import type { FilesService } from '../files/service';
import type { SpineHosts } from '../spine-root';

export interface LibraryReadsDeps {
  hosts: Pick<SpineHosts, 'dispatch'>; // the engine host's `artifacts.content`
  files: Pick<FilesService, 'readResolved'>; // the checkouts' files service, in process
  port: Pick<ClientPort, 'openExternal' | 'reveal'>; // Open externally, Reveal
  env: NodeJS.ProcessEnv; // MAWS_E2E and MAWS_E2E_OPEN_LOG
}

type Out<N extends 'library.content' | 'library.read' | 'library.openExternally' | 'library.reveal'> = Promise<CommandOutput<N>>;

export function createLibraryReads(deps: LibraryReadsDeps) {
  const seamLog = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_OPEN_LOG : undefined;

  const content = async ({ artifactId, revision }: CommandInput<'library.content'>): Out<'library.content'> => {
    const found = (await deps.hosts.dispatch('engine-host', 'artifacts.content', { artifactId, ...(revision !== undefined && { revision }) })) as CommandResult<'artifacts.content'>;
    if (!found.ok) throw new HostCommandError(found.error);
    return { revision: found.value.revision, kind: found.value.kind, name: found.value.name, path: found.value.path };
  };

  // A regular file the OS may open as a document: a kind `opensExternally` admits, with no execute bit.
  const openable = async (path: string, name: string): Promise<boolean> => {
    const target = await lstat(path).catch(() => null);
    return target !== null && target.isFile() && (target.mode & 0o111) === 0 && opensExternally(name);
  };

  return {
    content,

    // M6b fix wave 2 (Decision Log 36i): a File artifact's stored file, read by the artifact alone (its path resolved
    // here, never taken from the window), so the owner's files read in their viewer with no session. The files
    // service's refusal (`not found: <path>`, `not a regular file: <path>`) is thrown as it is.
    async read({ artifactId, revision, ...chunk }: CommandInput<'library.read'>): Out<'library.read'> {
      const found = await content({ artifactId, revision });
      if (found.kind !== 'file') throw new HostCommandError(ipcError('invalid_input', `artifact ${artifactId} is not a file artifact`));
      return deps.files.readResolved({ path: found.path, ...chunk });
    },

    async openExternally(input: CommandInput<'library.openExternally'>, client: ClientRef | null): Out<'library.openExternally'> {
      const { name, path } = await content(input);
      if (!(await openable(path, name))) return { opened: false, message: `Not opened outside MAWS: ${name}` };
      if (seamLog) {
        await appendFile(seamLog, `${path}\n`);
        return { opened: true, message: null };
      }
      const answer = await deps.port.openExternal(client, { path });
      if (isNoClient(answer)) return { opened: false, message: NO_CLIENT_REASON };
      return answer.opened ? { opened: true, message: null } : { opened: false, message: answer.reason };
    },

    async reveal(input: CommandInput<'library.reveal'>, client: ClientRef | null): Out<'library.reveal'> {
      const { path } = await content(input);
      if (!(await lstat(path).catch(() => null))?.isFile()) return { revealed: false, message: `Not on disk any more: ${basename(path)}` };
      if (seamLog) {
        await appendFile(seamLog, `reveal ${path}\n`);
        return { revealed: true, message: null };
      }
      return isNoClient(await deps.port.reveal(client, path)) ? { revealed: false, message: NO_CLIENT_REASON } : { revealed: true, message: null };
    },
  };
}

export function registerLibraryReads(register: ServicesBus['register'], deps: LibraryReadsDeps): void {
  const reads = createLibraryReads(deps);
  register('library.content', reads.content);
  register('library.read', reads.read);
  register('library.openExternally', (input, { client }) => reads.openExternally(input, client));
  register('library.reveal', (input, { client }) => reads.reveal(input, client));
}
