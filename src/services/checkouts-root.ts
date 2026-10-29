// The checkouts' root (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D; O3 §5): what
// O3-E moves into `mawsd`, composed from injected dependencies alone: git's read service and watcher (`git.*`,
// `git.changed`), `git.lsFiles`, files (`files.*`) and scm (`scm.*`). Until O3-E they run beside the app and read the
// spine through its view, like staying code: a session's directories, its intent's, every project row, the File
// artifacts linked to it. Main's embedded root calls it once the spine's view exists.
import type { ClientPort } from '@shared/client/port';
import type { ServicesBus } from '@shared/spine/bus';
import type { SpineView } from '@shared/spine/view';
import { fileAdmission } from './files/admission';
import { allowlistOf } from './files/allowlist';
import { registerFilesHandlers } from './files/register';
import type { FilesService } from './files/service';
import { FileLister, followSpineRoots, spineRoots } from './git/ls-files';
import { createMutatingRunner } from './git/mutate';
import { registerGitHandlers } from './git/register';
import { createGitRunner } from './git/runner';
import { GitService } from './git/service';
import { registerScmHandlers } from './scm/register';
import { ScmService } from './scm/service';

export interface CheckoutsDeps {
  view: SpineView;
  bus: ServicesBus;
  clientPort: ClientPort;
  engineEnv: Promise<Record<string, string>>; // the login-shell capture: scm's trust reader's environment, its runners' base
  env: NodeJS.ProcessEnv;
}

export interface CheckoutsRoot {
  readonly files: Pick<FilesService, 'readResolved'>; // library.read's reach (O4's library files), in process until O3-E
  stop(): void;
}

export function startCheckouts({ view, bus, clientPort, engineEnv, env }: CheckoutsDeps): CheckoutsRoot {
  // The read-only git service (C4 M6): git.* for any directory in a repository, and git.changed for watched roots
  const git = new GitService({ emit: (change) => void bus.emit('git.changed', change) });
  registerGitHandlers(git, bus);
  // C7: the `@` menu's listing. Listable roots: the directories of every unarchived session, every setup intent and every
  // project row, through the view (reader R13), read again after any record, project or intent change it reports
  const lister = new FileLister({ run: createGitRunner(), roots: () => spineRoots(view) });
  const unfollowRoots = followSpineRoots(view, lister);
  bus.register('git.lsFiles', (input) => lister.list(input));
  // C8c: files.* over each session's own directories (the allowlist through the view, reader R12: the record, else an
  // unstarted session's setup intent); watches are released per client inside the handlers. E2, P3-L M6b: a File
  // artifact's file outside the roots, admitted by the library's index through the view (reader R14).
  const files = registerFilesHandlers(allowlistOf(view), {
    bus,
    emit: (payload) => void bus.emit('files.changed', payload),
    port: clientPort, // files.openExternal; E1: files.reveal
    admitted: fileAdmission(view),
  });
  // E6: source control over the session's checkout (reader R15); mutations through the mutating runner under the
  // login-shell capture, which is also the environment its trust gate reads (the engine's); after each mutation git's
  // watcher re-reads the root, so git.changed tells every surface. Push and gh stream as scm.remote.output; the stop ends
  // them. The process's environment serves only MAWS_GIT and MAWS_GH.
  const scm = new ScmService({
    view,
    read: createGitRunner(),
    status: (directory) => git.status(directory),
    mutate: createMutatingRunner({ captured: () => engineEnv }),
    refresh: (directory) => git.refresh(directory),
    captured: () => engineEnv,
    env,
    emit: (event) => void bus.emit('scm.remote.output', event),
  });
  registerScmHandlers(scm, bus);
  return {
    files,
    stop: () => {
      git.dispose();
      unfollowRoots();
      files.dispose();
      scm.dispose();
    },
  };
}
