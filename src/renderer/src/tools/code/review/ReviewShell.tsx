// The Review surface both the panel tool and a diff tab render (C8c execution document, Interfaces *Copy* and M3's
// decisions): the scope chips (the tool only; a diff tab's ref fixes its scope), the header, the file list with counts,
// kinds and viewed marks, the selected file's header with Mark viewed and Open file ↗, the mode toggles and the hunk and
// file navigation, the diff body, the footer. Static and thin: the diff body (`ReviewView`, with the library, its
// stylesheet and the highlighter) loads on first use under the `Loading` fallback (ruled 2026-09-29, O2), while the
// list and the header draw at once. Review reads no file bytes (K4): an untracked file is a row without hunks that
// offers the viewer.
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { REFUSAL, REVIEW_COPY } from '../copy';
import { openFile } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import '../code.css';
import { blocksOf, defaultScope, firstChangedLine, tooLarge, totals, viewedSignature, type ReviewFile, type ReviewScope } from './review-model';
import { diffOf, fileDiffOf, useReview, useReviewData, type DiffTarget, type ReviewData, type ReviewStore } from './review-store';
import { decide, isViewed, selectFile, selectScope, toggleViewed, viewedKey, type ReviewUi } from './view-state';

const ReviewView = lazy(() => import('./ReviewView'));

const chip = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent';
const quiet = 'rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
const toggle = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg';

export interface ReviewShellProps {
  appSessionId: AppSessionId;
  directory: string; // session.worktree?.path ?? session.directory
  ui: StoreApi<ReviewUi>;
  chips: boolean; // the panel tool's scope chips; a diff tab's scope is its ref's
  focusRequest?: number; // the panel tool's: a growth re-reads the scope
  visible?: boolean; // the panel tool's: becoming visible re-reads the scope
}

const Loading = () => <p className="p-3 text-ui-sm text-fg-muted">{REVIEW_COPY.loading}</p>;

// A path the list does not hold that names nothing in the repository: shown as the refusal, never opened.
const outside = (path: string, status: GitStatus | null, scope: ReviewScope | null) =>
  scope !== 'turn' && path.startsWith('/') && status !== null && path !== status.repoRoot && !path.startsWith(`${status.repoRoot.replace(/\/+$/, '')}/`);

export function ReviewShell({ appSessionId, directory, ui, chips, focusRequest = 0, visible = true }: ReviewShellProps) {
  const scope = useStore(ui, (s) => s.scope);
  const turnId = useStore(ui, (s) => s.turnId);
  const redecide = useStore(ui, (s) => s.redecide);
  const requested = useStore(ui, (s) => s.request !== null); // an open() the tool applies next: decide nothing before it
  const data = useReviewData({ appSessionId, directory, scope, turnId });
  const files = data.list.phase === 'ready' ? data.list.files : null;

  // The default scope, once the status and This branch's availability are known (a new tool, a pinned tool's new
  // session, an open() with no scope), or once the watch failed; never on a later change, so a chosen scope stays.
  useEffect(() => {
    if (requested || (scope !== null && redecide === null)) return;
    if (data.status === null ? !data.gitFailed : !data.branch.settled) return;
    ui.setState((s) => decide(s, defaultScope(data.status, data.branch.base !== null)));
  }, [requested, scope, redecide, data.status, data.gitFailed, data.branch, ui]);

  // The selection follows the list: a requested path is matched by its identity or its absolute path; a file gone from
  // a refreshed list gives way to the first; a path outside the repository stays, to be shown refused.
  const selected = useStore(ui, (s) => s.selected);
  const file = files ? findFile(files, selected) : null;
  const refused = files !== null && file === null && selected !== null && outside(selected, data.status, scope);
  useEffect(() => {
    if (files === null || refused) return;
    if (file && file.path !== selected) ui.setState({ selected: file.path });
    else if (!file && files.length > 0) ui.setState(selectFile(files[0].path));
  }, [files, file, selected, refused, ui]);

  // Shown again, or asked for focus: read the scope afresh (a stale hunk never outlives a glance away).
  const seen = useRef({ focusRequest, visible });
  const target = data.target;
  useEffect(() => {
    const before = seen.current;
    seen.current = { focusRequest, visible };
    if (target && ((focusRequest > before.focusRequest && visible) || (visible && !before.visible))) useReview.getState().refresh(target);
  }, [focusRequest, visible, target]);

  const key = scope ? viewedKey(directory, scope, turnId) : '';
  return (
    <div data-review data-scope={scope ?? ''} className="flex h-full min-h-0 flex-col bg-bg">
      {chips ? <ScopeChips ui={ui} data={data} scope={scope} turnId={turnId !== null} /> : null}
      <Header scope={scope} files={files} />
      {data.list.phase === 'unavailable' ? (
        <p role="status" data-review-unavailable className="px-3 py-2 text-ui text-fg-muted">
          {data.list.message}
        </p>
      ) : data.list.phase === 'pending' ? (
        <Loading />
      ) : files && files.length === 0 ? (
        <p data-review-empty className="px-3 py-2 text-ui text-fg-muted">
          {emptyOf(scope, data)}
        </p>
      ) : files ? (
        <>
          <FileList files={files} selected={file?.path ?? null} ui={ui} viewedKey={key} target={data.target} />
          {file ? <FileSection file={file} files={files} ui={ui} appSessionId={appSessionId} data={data} viewedKey={key} /> : null}
          {refused && selected !== null ? <RefusedPath path={selected} /> : null}
        </>
      ) : null}
      <Footer scope={scope} data={data} />
    </div>
  );
}

function findFile(files: readonly ReviewFile[], selected: string | null): ReviewFile | null {
  if (selected === null) return null;
  return files.find((f) => f.path === selected) ?? files.find((f) => f.openPath === selected) ?? null;
}

function emptyOf(scope: ReviewScope | null, data: ReviewData): string {
  const branch = data.status?.branch ?? '';
  switch (scope) {
    case 'branch':
      return REVIEW_COPY.nothingOnBranch(branch, data.branch.base ?? '');
    case 'staged':
      return REVIEW_COPY.nothingStaged;
    case 'turn':
      return REVIEW_COPY.turnChangedNothing;
    default:
      return REVIEW_COPY.noUncommitted;
  }
}

function ScopeChips({ ui, data, scope, turnId }: { ui: StoreApi<ReviewUi>; data: ReviewData; scope: ReviewScope | null; turnId: boolean }) {
  const pick = (next: ReviewScope) => ui.setState((s) => selectScope(s, next));
  const branchReason = data.branch.settled && data.branch.base === null ? data.branch.reason : null;
  const stagedShown = data.staged || scope === 'staged';
  const chipOf = (id: ReviewScope, disabled: boolean, reason: string | null) => (
    <button key={id} type="button" data-chip={id} className={chip} aria-pressed={scope === id} disabled={disabled} title={reason ?? undefined} onClick={() => pick(id)}>
      {REVIEW_COPY.scopes[id]}
    </button>
  );
  return (
    <div role="group" aria-label={REVIEW_COPY.title} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
      {chipOf('uncommitted', false, null)}
      {chipOf('branch', !data.branch.settled || data.branch.base === null, branchReason)}
      {turnId ? chipOf('turn', false, null) : null}
      {stagedShown ? chipOf('staged', !data.staged, data.staged ? null : REVIEW_COPY.indexMatchesHead) : null}
    </div>
  );
}

function Header({ scope, files }: { scope: ReviewScope | null; files: readonly ReviewFile[] | null }) {
  if (scope === null || files === null) return null;
  const sum = totals(files);
  return (
    <p data-review-header className="shrink-0 px-3 pt-2 pb-1 text-ui font-medium text-fg">
      {REVIEW_COPY.header(sum.files, sum.added, sum.removed, REVIEW_COPY.scopes[scope])}
    </p>
  );
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function Counts({ file }: { file: ReviewFile }) {
  if (file.kind === 'untracked' || file.kind === 'binary') return <span className="shrink-0 text-ui-sm text-fg-faint">{REVIEW_COPY.kinds[file.kind]}</span>;
  return (
    <span className="shrink-0 font-mono text-ui-sm">
      <span className="text-success">+{file.added}</span> <span className="text-danger">−{file.removed}</span>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

// A file's hunks: its own, or those fetched for it when its scope is past the cap.
function hunksOf(file: ReviewFile, target: DiffTarget | null, fetched: Pick<ReviewStore, 'files'>): string[] | null {
  if (file.hunks !== null || target === null) return file.hunks;
  const load = fileDiffOf(fetched, target, file.path);
  return load?.status === 'ok' ? (load.file?.hunks ?? []) : null;
}

// A file's patch header: its own, or the one fetched for it when its scope is past the cap (what a binary's viewed mark
// signs: its `index` line names both blobs, so a new blob drops the mark within the cap or past it).
function headerOf(file: ReviewFile, target: DiffTarget | null, fetched: Pick<ReviewStore, 'files'>): string | null {
  if (file.header !== null || target === null) return file.header;
  const load = fileDiffOf(fetched, target, file.path);
  return load?.status === 'ok' ? (load.file?.header ?? null) : null;
}

function FileList({ files, selected, ui, viewedKey: key, target }: { files: readonly ReviewFile[]; selected: string | null; ui: StoreApi<ReviewUi>; viewedKey: string; target: DiffTarget | null }) {
  const marks = useStore(ui, (s) => s.viewed);
  const fetched = useReview((s) => s.files);
  return (
    <ul role="listbox" aria-label={REVIEW_COPY.title} className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1">
      {files.map((file) => {
        const signed = { kind: file.kind, header: headerOf(file, target, { files: fetched }) };
        const viewed = isViewed(marks, key, file.path, viewedSignature(signed, hunksOf(file, target, { files: fetched })));
        return (
          <li key={file.path} role="option" aria-selected={file.path === selected}>
            <button
              type="button"
              data-path={file.path}
              data-kind={file.kind}
              data-viewed={viewed || undefined}
              title={file.path}
              onClick={() => ui.setState(selectFile(file.path))}
              className={`flex h-6 w-full items-center gap-1.5 px-3 text-left text-ui hover:bg-bg-hover ${file.path === selected ? 'bg-bg-active text-fg' : 'text-fg'}`}
            >
              {viewed ? <CheckIcon /> : <span className="size-3 shrink-0" />}
              <span className="truncate">{basename(file.path)}</span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-fg-faint">{dirOf(file.path)}</span>
              <Counts file={file} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const kindLabel = (file: ReviewFile) => (file.kind === 'renamed' ? REVIEW_COPY.renamedFrom(file.oldPath ?? '') : REVIEW_COPY.kinds[file.kind]);

function FileSection({ file, files, ui, appSessionId, data, viewedKey: key }: { file: ReviewFile; files: readonly ReviewFile[]; ui: StoreApi<ReviewUi>; appSessionId: AppSessionId; data: ReviewData; viewedKey: string }) {
  const mode = useStore(ui, (s) => s.mode);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = useStore(ui, (s) => s.hunk);
  const marks = useStore(ui, (s) => s.viewed);
  const wrap = useViewer((s) => s.wrap);
  // A scope past its cap fetches the selected file's hunks on selection, and a binary's header (what its mark signs).
  const target = data.target;
  const binary = file.kind === 'binary';
  const fetch = target !== null && (binary ? file.header === null : file.hunks === null && file.kind !== 'untracked');
  const fetched = useReview((s) => (fetch && target ? fileDiffOf(s, target, file.path) : undefined));
  // Keyed on the scope's diff too: a re-read of the scope drops the per-file loads, and the selected file asks again.
  const scopeDiff = useReview((s) => (fetch && target ? diffOf(s, target) : undefined));
  useEffect(() => {
    if (fetch && target) useReview.getState().loadFile(target, file.path);
  }, [fetch, target, file.path, scopeDiff]);
  const hunks = useMemo(() => (binary ? null : (file.hunks ?? (fetched?.status === 'ok' ? (fetched.file?.hunks ?? []) : null))), [binary, file.hunks, fetched]);
  const header = file.header ?? (fetched?.status === 'ok' ? (fetched.file?.header ?? null) : null);
  // Stable while the file's hunks are, so the diff body does not re-parse on every render.
  const blocks = useMemo(() => (hunks === null ? [] : blocksOf(hunks, file.hunks === null ? [hunks.length] : file.blocks)), [hunks, file.hunks, file.blocks]);
  const signature = viewedSignature({ kind: file.kind, header }, hunks);
  const large = hunks !== null && tooLarge({ hunks });
  const count = hunks === null || large ? 0 : hunks.length;
  const hunk = Math.min(current, Math.max(0, count - 1));
  const index = files.indexOf(file);

  const lineOf = (i: number): number | null => (file.kind === 'untracked' ? 1 : hunks && hunks.length > 0 ? firstChangedLine(hunks[Math.min(i, hunks.length - 1)]) : null);
  const open = (line: number | null) => file.openPath !== null && openFile(appSessionId, file.openPath, line);
  const goHunk = (next: number) => ui.setState((s) => ({ hunk: next, navigate: s.navigate + 1 }));
  const goFile = (next: ReviewFile) => ui.setState((s) => ({ ...selectFile(next.path), navigate: s.navigate + 1 }));
  const viewed = isViewed(marks, key, file.path, signature);

  return (
    <section data-review-file={file.path} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
        <span data-review-file-header className="min-w-0 flex-1 truncate text-ui-sm text-fg" title={file.path}>
          {REVIEW_COPY.fileHeader(file.path, kindLabel(file))}
        </span>
        {(binary ? header !== null : file.kind !== 'untracked' && hunks !== null) ? (
          <button type="button" className={toggle} aria-pressed={viewed} onClick={() => ui.setState((s) => toggleViewed(s, key, file.path, signature))}>
            {viewed ? REVIEW_COPY.viewed : REVIEW_COPY.markViewed}
          </button>
        ) : null}
        {file.openPath !== null ? (
          <button type="button" data-open-file className={quiet} onClick={() => open(lineOf(hunk))}>
            {REVIEW_COPY.openFile}
          </button>
        ) : null}
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
          <button type="button" className={toggle} aria-pressed={wrap} onClick={() => useViewer.getState().setWrap(!wrap)}>
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
      {file.kind === 'untracked' ? (
        <p data-review-note className="px-3 py-2 text-ui-sm text-fg-muted">
          {REVIEW_COPY.untrackedNote}
        </p>
      ) : hunks === null ? (
        file.kind === 'binary' ? null : fetched?.status === 'error' ? (
          <p role="status" className="px-3 py-2 text-ui-sm text-fg-muted">
            {REVIEW_COPY.unavailable(fetched.message)}
          </p>
        ) : (
          <Loading />
        )
      ) : large ? (
        <p data-review-too-large className="px-3 py-2 text-ui-sm text-fg-muted">
          {REVIEW_COPY.tooLarge}{' '}
          {file.openPath !== null ? (
            <button type="button" className="text-accent hover:underline" onClick={() => open(lineOf(0))}>
              {REVIEW_COPY.openTheFile}
            </button>
          ) : (
            REVIEW_COPY.openTheFile
          )}
        </p>
      ) : hunks.length > 0 ? (
        <Suspense fallback={<Loading />}>
          <ReviewView
            key={file.path}
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
      ) : null}
    </section>
  );
}

function RefusedPath({ path }: { path: string }) {
  return (
    <div role="alert" data-review-refused className="flex flex-col gap-0.5 px-3 py-2">
      <span className="text-ui-sm text-danger">{REVIEW_COPY.refused(REFUSAL)}</span>
      <span className="truncate font-mono text-ui-sm text-fg-muted">{path}</span>
    </div>
  );
}

function Footer({ scope, data }: { scope: ReviewScope | null; data: ReviewData }) {
  if (scope === null) return null;
  const status = data.status;
  const branch = status === null ? null : (status.branch ?? REVIEW_COPY.detachedAt(status.head));
  const text =
    scope === 'turn'
      ? REVIEW_COPY.footer.turn(branch)
      : branch === null
        ? null
        : scope === 'branch'
          ? data.branch.base !== null
            ? REVIEW_COPY.footer.branch(branch, data.branch.base)
            : null
          : scope === 'staged'
            ? REVIEW_COPY.footer.staged(branch)
            : REVIEW_COPY.footer.uncommitted(branch);
  if (text === null) return null;
  return (
    <p data-review-footer className="mt-auto shrink-0 truncate border-t border-border px-3 py-1.5 text-ui-sm text-fg-faint">
      {text}
    </p>
  );
}
