// The checkouts' root (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §D; O3 §5),
// composed from injected dependencies alone: git's read service and watcher (`git.*`, `git.changed`), `git.lsFiles`,
// files (`files.*`) and scm (`scm.*`). They read the spine through its view: a session's directories, its intent's,
// every project row, the File artifacts linked to it. P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md,
// Interfaces §D; D4): the spine's root composes them as its last parts, over its in-process view and its counting bus,
// so they load, settle, stop and re-execute with the spine wherever it runs (`mawsd` on the daemon shape, main on the
// embedded one); a release or a yield also waits for scm's runs in flight (D14).
import type { ClientPort } from '@shared/client/port';
import type { ServicesBus } from '@shared/spine/bus';
import type { SpineView } from '@shared/spine/view';
import { fileAdmission } from './files/admission';
import { allowlistOf } from './files/allowlist';
import { registerFilesHandlers } from './files/register';
import type { FilesService } from './files/service';
import { createUpload, scheduleUploadSweep } from './files/upload';
import { FileLister, followSpineRoots, spineRoots } from './git/ls-files';
import { createMutatingRunner } from './git/mutate';
import { registerGitHandlers } from './git/register';
import { createGitRunner } from './git/runner';
import { GitService } from './git/service';
import { registerScmHandlers } from './scm/register';
import { ScmService } from './scm/service';
import type { UploadRecords } from './fs/upload-roots';
import { stopParts } from './stop-parts';
import type { Settling } from './work';

export interface CheckoutsDeps {
  view: SpineView;
  bus: ServicesBus;
  clientPort: ClientPort;
  engineEnv: Promise<Record<string, string>>; // the login-shell capture: scm's trust reader's environment, its runners' base
  env: NodeJS.ProcessEnv;
  uploadRoots: UploadRecords | null; // P5 O3-E (Interfaces §F): files.upload's root record (<profile>/sessions/uploads.json); null in a run refused the spine, where every upload is refused
}

export interface CheckoutsRoot extends Settling {
  readonly files: Pick<FilesService, 'readResolved'>; // files.readResolved's handler (library.read's reach), for the composition test
  stop(): void;
}

export function startCheckouts({ view, bus, clientPort, engineEnv, env, uploadRoots }: CheckoutsDeps): CheckoutsRoot {
  // The read-only git service (C4 M6): git.* for any directory in a repository, and git.changed for watched roots
  const git = new GitService({ emit: (change) => void bus.emit('git.changed', change), log: (line) => console.log(line) }); // P5 O3-E: [git] lines in mawsd's log
  registerGitHandlers(git, bus);
  // C7: the `@` menu's listing. Listable roots: the directories of every unarchived session, every setup intent and every
  // project row, through the view (reader R13), read again after any record, project or intent change it reports
  const lister = new FileLister({ run: createGitRunner(), roots: () => spineRoots(view) });
  const unfollowRoots = followSpineRoots(view, lister);
  bus.register('git.lsFiles', (input) => lister.list(input));
  // C8c: files.* over each session's own directories (the allowlist through the view, reader R12: the record, else an
  // unstarted session's setup intent); watches are released per client inside the handlers. E2, P3-L M6b: a File
  // artifact's file outside the roots, admitted by the library's index through the view (reader R14).
  // P5 O3-E M3 (Interfaces §F): files.upload into the session's attachments directory, its roots recorded under the
  // spine's lock and swept at the start and hourly while the checkouts run
  const uploadLog = (line: string) => console.warn(`[files] ${line}`);
  const files = registerFilesHandlers(allowlistOf(view), {
    bus,
    emit: (payload) => void bus.emit('files.changed', payload),
    port: clientPort, // files.openExternal; E1: files.reveal
    admitted: fileAdmission(view),
    upload: uploadRoots ? createUpload({ sessions: view, roots: uploadRoots, git: createGitRunner(), log: uploadLog }) : undefined,
  });
  const stopUploadSweep = uploadRoots ? scheduleUploadSweep(uploadRoots, { log: uploadLog }) : () => {};
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
    busy: () => scm.runs.busy(),
    settled: () => scm.runs.settled(),
    // each part stopped whatever an earlier one threw (D21)
    stop: () =>
      stopParts('checkouts', [
        ['git', () => git.dispose()],
        ['git.lsFiles roots', unfollowRoots],
        ['files', () => files.dispose()],
        ['upload sweep', stopUploadSweep],
        ['scm', () => scm.dispose()],
      ]),
  };
}
