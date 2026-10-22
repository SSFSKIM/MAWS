// The depth column's Diff tab: the session's one diff, its working tree against its base branch (DX4 `diff`), drawn
// through MAWS's `splitPatch` and `ReviewView`. A copy-and-adapt of MAWS's `ReviewShell` (the renderer survey's Diff
// review row): its header, file list, file section with the mode, wrap, hunk and file navigation, and its diff body, with
// none of its four scopes, its git store, its viewed marks, or its Open file (the desk has no files to open). The diff is
// asked for when the tab opens and again on the reader's Refresh, never polled; the last answer stays drawn while a new
// one is on its way. An answer the machine could not take says why: its `error` when git failed, and no base when the
// session's directory is no git working tree. The body (the diff library, its stylesheet, and the highlighter) loads on
// first use.
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { loadChunk } from '../../pwa/load-chunk';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { REVIEW_COPY } from '../../../../../src/renderer/src/tools/code/copy';
import '../../../../../src/renderer/src/tools/code/code.css';
import { tooLarge } from '../../../../../src/renderer/src/tools/code/review/review-model';
import { createReviewUi, selectFile, type ReviewUi } from '../../../../../src/renderer/src/tools/code/review/view-state';
import { diffFiles, diffTotals, type DiffFile } from '../diff/files';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';

const ReviewView = lazy(() => loadChunk(() => import('../../../../../src/renderer/src/tools/code/review/ReviewView')));

const quiet = 'rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

const Loading = () => <p className="p-3 text-ui-sm text-fg-muted">{REVIEW_COPY.loading}</p>;

/** The Diff tab's own view state (selection, hunk, mode, scroll, wrap), kept by the column so it outlives the tab. */
export type DiffView = { ui: StoreApi<ReviewUi>; wrap: StoreApi<{ wrap: boolean }> };

export function createDiffView(): DiffView {
  return { ui: createReviewUi({ session: null }), wrap: createStore<{ wrap: boolean }>()(() => ({ wrap: false })) };
}

type Props = { controller: DeskTranscript; state: DepthTranscriptState; view: DiffView };

export function DiffPane({ controller, state, view }: Props) {
  // Asked for when the tab opens; the reader's Refresh asks again.
  useEffect(() => controller.requestDiff(), [controller]);
  const answer = state.diff?.answer ?? null;
  const pending = state.diff?.pending ?? true;
  const machine = controller.target.machine;
  const failed = answer?.error ? answer.error : null;
  // A diff against a base: the machine took it. Otherwise it says why it could not.
  const based = answer !== null && failed === null && answer.base !== '';
  const files = useMemo(() => (answer && based ? diffFiles(answer.text) : null), [answer, based]);

  const selected = useStore(view.ui, (s) => s.selected);
  const file = files?.find((f) => f.path === selected) ?? files?.[0] ?? null;
  useEffect(() => {
    if (file && file.path !== selected) view.ui.setState(selectFile(file.path));
  }, [file, selected, view.ui]);

  return (
    <div data-review data-testid="depth-diff" className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-baseline gap-2 px-3 pt-2 pb-1">
        <p data-review-header className="m-0 min-w-0 flex-1 truncate text-ui font-medium text-fg">
          {files && answer && based ? REVIEW_COPY.header(diffTotals(files).files, diffTotals(files).added, diffTotals(files).removed, `Since ${answer.base}`) : 'Diff'}
        </p>
        <button type="button" className={quiet} data-testid="depth-diff-refresh" disabled={pending} onClick={() => controller.requestDiff()}>
          {pending && answer ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {state.phase === 'ended' && !answer ? (
        <p role="status" className="px-3 py-2 text-ui text-fg-muted">
          The diff is unavailable while the transcript is.
        </p>
      ) : failed !== null ? (
        <p role="status" className="px-3 py-2 text-ui text-warning">
          The diff failed on {machine}: {failed}
        </p>
      ) : answer !== null && !based ? (
        <p role="status" className="px-3 py-2 text-ui text-fg-muted">
          No diff: the session's directory on {machine} is not in a git working tree.
        </p>
      ) : files === null ? (
        <Loading />
      ) : files.length === 0 ? (
        <p data-review-empty className="px-3 py-2 text-ui text-fg-muted">
          No changes against {answer!.base}
        </p>
      ) : (
        <>
          <FileList files={files} selected={file?.path ?? null} ui={view.ui} />
          {file ? <FileSection file={file} files={files} view={view} /> : null}
        </>
      )}
      {answer && based ? (
        <p data-review-footer className="mt-auto shrink-0 truncate border-t border-border px-3 py-1.5 text-ui-sm text-fg-faint">
          Working tree · Since {answer.base}
        </p>
      ) : null}
    </div>
  );
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function Counts({ file }: { file: DiffFile }) {
  if (file.kind === 'binary') return <span className="shrink-0 text-ui-sm text-fg-faint">{REVIEW_COPY.kinds.binary}</span>;
  return (
    <span className="shrink-0 font-mono text-ui-sm">
      <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
    </span>
  );
}

function FileList({ files, selected, ui }: { files: readonly DiffFile[]; selected: string | null; ui: StoreApi<ReviewUi> }) {
  return (
    <ul role="listbox" aria-label="Changed files" className="m-0 max-h-[40%] shrink-0 list-none overflow-y-auto border-b border-border p-0 py-1">
      {files.map((file) => (
        <li key={file.path} role="option" aria-selected={file.path === selected}>
          <button
            type="button"
            data-path={file.path}
            data-kind={file.kind}
            title={file.path}
            onClick={() => ui.setState(selectFile(file.path))}
            className={`flex h-6 w-full items-center gap-1.5 px-3 text-left text-ui hover:bg-bg-hover ${file.path === selected ? 'bg-bg-active text-fg' : 'text-fg'}`}
          >
            <span className="truncate">{basename(file.path)}</span>
            <span className="min-w-0 flex-1 truncate text-ui-sm text-fg-faint">{dirOf(file.path)}</span>
            <Counts file={file} />
          </button>
        </li>
      ))}
    </ul>
  );
}

const kindLabel = (file: DiffFile) => (file.kind === 'renamed' ? REVIEW_COPY.renamedFrom(file.oldPath ?? '') : REVIEW_COPY.kinds[file.kind]);

function FileSection({ file, files, view }: { file: DiffFile; files: readonly DiffFile[]; view: DiffView }) {
  const { ui } = view;
  const mode = useStore(ui, (s) => s.mode);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = useStore(ui, (s) => s.hunk);
  const wrap = useStore(view.wrap, (s) => s.wrap);
  // One block per file (a git diff numbers every hunk against the same versions), kept while the file is the same.
  const fileBlocks = useMemo(() => [file.hunks], [file]);
  const large = tooLarge(file);
  const count = large ? 0 : file.hunks.length;
  const hunk = Math.min(current, Math.max(0, count - 1));
  const index = files.indexOf(file);
  const goHunk = (next: number) => ui.setState((s) => ({ hunk: next, navigate: s.navigate + 1 }));
  const goFile = (next: DiffFile) => ui.setState((s) => ({ ...selectFile(next.path), navigate: s.navigate + 1 }));

  return (
    <section data-review-file={file.path} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <span data-review-file-header className="min-w-0 flex-1 truncate text-ui-sm text-fg" title={file.path}>
          {REVIEW_COPY.fileHeader(file.path, kindLabel(file))}
        </span>
        <span className="flex shrink-0 items-center">
          <button type="button" className={quiet} aria-label={REVIEW_COPY.previousFile} title={REVIEW_COPY.previousFile} disabled={index <= 0} onClick={() => goFile(files[index - 1])}>
            ‹
          </button>
          <button type="button" className={quiet} aria-label={REVIEW_COPY.nextFile} title={REVIEW_COPY.nextFile} disabled={index >= files.length - 1} onClick={() => goFile(files[index + 1])}>
            ›
          </button>
        </span>
      </div>
      {count > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 pb-1.5">
          <button type="button" className={toggle} aria-pressed={mode === 'unified'} onClick={() => ui.setState({ mode: 'unified' })}>
            {REVIEW_COPY.unified}
          </button>
          <button type="button" className={toggle} aria-pressed={mode === 'split'} onClick={() => ui.setState({ mode: 'split' })}>
            {REVIEW_COPY.split}
          </button>
          <button type="button" className={toggle} aria-pressed={wrap} onClick={() => view.wrap.setState({ wrap: !wrap })}>
            {REVIEW_COPY.wrap}
          </button>
          <span className="flex-1" />
          <span data-review-hunk className="text-ui-sm text-fg-muted">
            {REVIEW_COPY.hunkOf(hunk + 1, count)}
          </span>
          <button type="button" className={quiet} aria-label={REVIEW_COPY.previousHunk} title={REVIEW_COPY.previousHunk} disabled={hunk === 0} onClick={() => goHunk(hunk - 1)}>
            ↑
          </button>
          <button type="button" className={quiet} aria-label={REVIEW_COPY.nextHunk} title={REVIEW_COPY.nextHunk} disabled={hunk >= count - 1} onClick={() => goHunk(hunk + 1)}>
            ↓
          </button>
        </div>
      ) : (
        <div className="shrink-0 border-b border-border" />
      )}
      {large ? (
        <p data-review-too-large className="px-3 py-2 text-ui-sm text-fg-muted">
          {REVIEW_COPY.tooLarge}
        </p>
      ) : count > 0 ? (
        <Suspense fallback={<Loading />}>
          <ReviewView
            key={file.path}
            file={{ path: file.path, oldPath: file.oldPath, blocks: fileBlocks }}
            mode={mode}
            wrap={wrap}
            hunk={hunk}
            navigate={navigate}
            initialScrollTop={ui.getState().scrollTop}
            onHunk={(next) => ui.setState({ hunk: next })}
            onLeave={(scrollTop) => ui.setState({ scrollTop })}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
