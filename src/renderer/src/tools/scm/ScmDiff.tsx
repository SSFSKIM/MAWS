// The Source control tool's diff body (E6 execution document, Design §5 and §7): the selected file's change in C8c's
// `ReviewView`, behind the same `React.lazy` boundary ReviewShell uses, so the library loads with the first diff drawn.
// The selection's group decides what is read and held while it shows: Staged the index against HEAD, Unstaged the
// working tree against the index, Untracked the one file as `git add` would stage it (`git.diff`'s `untracked` scope);
// a conflict has no drawable diff (git writes it as a combined diff, which the split drops) and a directory entry none.
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { openFile } from '../code/open-file';
import { firstChangedLine, tooLarge, type PatchFile } from '../code/review/review-model';
import type { FileDiff } from '../code/review/review-store';
import { useViewer } from '../code/viewer/viewer-store';
import '../code/code.css';
import { SCM_COPY } from './copy';
import { changeWords, openable } from './FileRow';
import { checkoutPath, type ScmEntry, type ScmGroupName } from './groups';
import { diffOf, fileDiffOf, useScm, type ScmDiffTarget } from './store';
import { selectionKey, type ScmUi } from './view-state';

const ReviewView = lazy(() => import('../code/review/ReviewView'));

const quiet = 'rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

const Note = ({ children, role }: { children: ReactNode; role?: 'status' }) => (
  <p role={role} data-scm-note className="px-3 py-2 text-ui-sm text-fg-muted">
    {children}
  </p>
);

// What the selection reads: null for a conflict and for a directory entry, which have no diff to draw.
const NOT_UNTRACKED = 'not an untracked file:'; // C4's refusal of the `untracked` scope (src/main/git/service.ts)

export function diffTarget(directory: string, group: ScmGroupName, path: string): ScmDiffTarget | null {
  if (group === 'staged') return { directory, scope: 'staged' };
  if (group === 'unstaged') return { directory, scope: 'worktree' };
  if (group === 'untracked' && !path.endsWith('/')) return { directory, scope: 'untracked', path };
  return null;
}

// The selected file's patch: undefined while it is read, null when its scope's diff does not hold it (nothing to draw).
// An untracked read answers the one file; a scope's split is keyed by path; past the scope's cap, the file read alone.
// (An untracked read past the cap answers no split at all; the body says it is too large before asking here.)
function fileOf(target: ScmDiffTarget | null, split: ReadonlyMap<string, PatchFile> | null | undefined, fetched: FileDiff | undefined, path: string): PatchFile | null | undefined {
  if (target === null) return null;
  if (split === undefined) return undefined;
  if (split === null) return fetched?.status === 'ok' ? fetched.file : undefined;
  if (target.scope === 'untracked') return [...split.values()][0] ?? null;
  return split.get(path) ?? null;
}

export function ScmDiff({ appSessionId, directory, repoRoot, ui, group, entry }: { appSessionId: AppSessionId; directory: string; repoRoot: string; ui: StoreApi<ScmUi>; group: ScmGroupName; entry: ScmEntry }) {
  const { path } = entry;
  const target = useMemo(() => diffTarget(directory, group, path), [directory, group, path]);
  // Held while the selection shows; a new selection releases it before the scope's next re-read can ask for it.
  useEffect(() => (target ? useScm.getState().hold(target) : undefined), [target]);
  const scope = useScm((s) => (target ? diffOf(s, target) : undefined));
  // Past the scope's cap the list alone came back: the file is fetched on its own.
  const split = scope?.status === 'ok' ? scope.patch : undefined;
  const fetchOne = target !== null && target.scope !== 'untracked' && split === null;
  const fetched = useScm((s) => (fetchOne && target ? fileDiffOf(s, target, path) : undefined));
  useEffect(() => {
    if (fetchOne && target) useScm.getState().loadFile(target, path);
  }, [fetchOne, target, path, scope]);

  const file = fileOf(target, split, fetched, path);
  // An untracked file past the scope cap came back as the list alone, and is whole or nothing: too large to draw.
  const untrackedPastCap = target?.scope === 'untracked' && split === null;
  const failure = scope?.status === 'error' ? scope.message : fetched?.status === 'error' ? fetched.message : null;
  const open = openable(entry) ? (line: number | null) => openFile(appSessionId, checkoutPath(repoRoot, path), line) : null;
  const tooLargeNote = (line: number | null) => (
    <Note>
      {SCM_COPY.tooLarge}{' '}
      {open ? (
        <button type="button" className="text-accent hover:underline" onClick={() => open(line)}>
          {SCM_COPY.openTheFile}
        </button>
      ) : null}
    </Note>
  );

  return (
    <section data-scm-diff={selectionKey({ group, path })} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <span data-scm-file-header className="min-w-0 flex-1 truncate text-ui-sm text-fg" title={path}>
          {SCM_COPY.fileHeader(path, changeWords(entry))}
        </span>
        {open ? (
          <button type="button" data-open-file className={quiet} onClick={() => open(file && file.hunks.length > 0 ? firstChangedLine(file.hunks[0]) : null)}>
            {SCM_COPY.openFile}
          </button>
        ) : null}
      </div>
      {group === 'conflicts' ? (
        <Note>{SCM_COPY.conflictNote}</Note>
      ) : target === null ? (
        <Note>{SCM_COPY.directoryNote}</Note>
      ) : failure !== null ? (
        // C4 refuses an untracked path its fresh status does not list: no diff to show. Any other failure says itself.
        <Note role="status">{failure.startsWith(NOT_UNTRACKED) ? SCM_COPY.noDiff : SCM_COPY.unavailable(failure)}</Note>
      ) : untrackedPastCap ? (
        tooLargeNote(1)
      ) : file === undefined ? (
        <Note>{SCM_COPY.loading}</Note>
      ) : file === null ? (
        <Note>{SCM_COPY.noContent}</Note>
      ) : file.kind === 'binary' ? (
        <Note>{SCM_COPY.binary}</Note>
      ) : file.hunks.length === 0 ? (
        <Note>{SCM_COPY.noContent}</Note>
      ) : tooLarge(file) ? (
        tooLargeNote(firstChangedLine(file.hunks[0]))
      ) : (
        <Hunks key={selectionKey({ group, path })} ui={ui} file={file} />
      )}
    </section>
  );
}

// The mode, wrap and hunk controls over the diff view. Wrap is every code view's toggle (C8c's viewer store); the mode
// and the hunk are the tool's.
function Hunks({ ui, file }: { ui: StoreApi<ScmUi>; file: PatchFile }) {
  const mode = useStore(ui, (s) => s.mode);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = useStore(ui, (s) => s.hunk);
  const wrap = useViewer((s) => s.wrap);
  const count = file.hunks.length;
  const hunk = Math.min(current, count - 1);
  const blocks = useMemo(() => [file.hunks], [file.hunks]);
  const goHunk = (next: number) => ui.setState((s) => ({ hunk: next, navigate: s.navigate + 1 }));
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 pb-1.5">
        <button type="button" className={toggle} aria-pressed={mode === 'unified'} onClick={() => ui.setState({ mode: 'unified' })}>
          {SCM_COPY.unified}
        </button>
        <button type="button" className={toggle} aria-pressed={mode === 'split'} onClick={() => ui.setState({ mode: 'split' })}>
          {SCM_COPY.split}
        </button>
        <button type="button" className={toggle} aria-pressed={wrap} onClick={() => useViewer.getState().setWrap(!wrap)}>
          {SCM_COPY.wrap}
        </button>
        <span className="flex-1" />
        <span className="text-ui-sm text-fg-muted">{SCM_COPY.hunkOf(hunk + 1, count)}</span>
        <button type="button" className={quiet} aria-label={SCM_COPY.previousHunk} title={SCM_COPY.previousHunk} disabled={hunk === 0} onClick={() => goHunk(hunk - 1)}>
          ↑
        </button>
        <button type="button" className={quiet} aria-label={SCM_COPY.nextHunk} title={SCM_COPY.nextHunk} disabled={hunk >= count - 1} onClick={() => goHunk(hunk + 1)}>
          ↓
        </button>
      </div>
      <Suspense fallback={<Note>{SCM_COPY.loading}</Note>}>
        <ReviewView
          file={{ path: file.path, oldPath: file.oldPath, blocks }}
          mode={mode}
          wrap={wrap}
          hunk={hunk}
          navigate={navigate}
          initialScrollTop={ui.getState().scrollTop}
          onHunk={(next) => ui.setState({ hunk: next })}
          onLeave={(scrollTop) => ui.setState({ scrollTop })}
        />
      </Suspense>
    </>
  );
}
