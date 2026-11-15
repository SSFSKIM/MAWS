// The Review surface both the panel tool and a diff tab render (C8c execution document, Interfaces *Copy*; UX wave U5b,
// the execution document's §F): the scope chips (the tool only; a diff tab's ref fixes its scope), the toolbar, the
// stack of every changed file and the footer. Static and thin: a section's diff (`FileBody`, with the library, its
// stylesheet and the highlighter) loads on first use under the `Loading` fallback (ruled 2026-09-29, O2), while the
// chips, the toolbar and the headers draw at once. Review reads no file bytes (K4): an untracked file is read as
// Source control reads it, its diff against /dev/null.
//
// UX wave U5b, M5 (§B, §G; decision 4): the surface's comment card host is mounted once, in the toolbar, where its chip
// ("N unsent comments") and its place line belong; the card is drawn through a portal into the row the stack opens
// under the commented line. `hostId` is the surface's own (the tool's tab id, a diff tab's id).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { CommentCardHost, type CardFrame } from '../../../side/card/CardHost';
import { useTranscriptStore } from '../../../transcript';
import { REFUSAL, REVIEW_COPY } from '../copy';
import { useViewer } from '../viewer/viewer-store';
import '../code.css';
import { reviewLayout, SPLIT_MIN_WIDTH } from './measure';
import { defaultScope, latestTurnWithFiles, totals, type ReviewFile, type ReviewScope } from './review-model';
import { diffOf, useReview, useReviewData, type ReviewData } from './review-store';
import { LineCommentsContext, rowsIn, useLineComments, type LineCommentsValue } from './LineComments';
import { Stack, useStack, type HeldFile } from './Stack';
import { everyFolded } from './stack-model';
import { Toolbar, totalsWords } from './Toolbar';
import { decide, foldAll, placeKey, selectLastTurn, selectScope, type ReviewMode, type ReviewUi } from './view-state';

const chip = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg aria-pressed:bg-bg-active aria-pressed:text-fg disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent';

export interface ReviewShellProps {
  appSessionId: AppSessionId;
  directory: string; // the session's working folder: workingFolder(session).path
  ui: StoreApi<ReviewUi>;
  hostId: string; // the surface's own id, its comment card host's (UX wave U5b, M5)
  hostMode: 'panel' | 'tab';
  chips: boolean; // the panel tool's scope chips; a diff tab's scope is its ref's
  focusRequest?: number; // the panel tool's: a growth re-reads the scope
  visible?: boolean; // the panel tool's: becoming visible re-reads the scope
}

const Loading = () => <p className="p-3 text-ui-sm text-fg-muted">{REVIEW_COPY.loading}</p>;

// A path the list does not hold that names nothing in the repository: shown as the refusal, never opened.
const outside = (path: string, status: GitStatus | null, scope: ReviewScope | null) =>
  scope !== 'turn' && path.startsWith('/') && status !== null && path !== status.repoRoot && !path.startsWith(`${status.repoRoot.replace(/\/+$/, '')}/`);

// A requested path, by its identity in the scope or by its absolute path.
const findFile = (files: readonly ReviewFile[], path: string): ReviewFile | null => files.find((f) => f.path === path) ?? files.find((f) => f.openPath === path) ?? null;

// The stack's width, which decides Split's room and a header's narrow form: 0 until the page lays it out.
function useWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(reviewLayout.width(element));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

export function ReviewShell({ appSessionId, directory, ui, hostId, hostMode, chips, focusRequest = 0, visible = true }: ReviewShellProps) {
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

  // Shown again, or asked for focus: read the scope afresh (a stale hunk never outlives a glance away).
  const seen = useRef({ focusRequest, visible });
  const target = data.target;
  useEffect(() => {
    const before = seen.current;
    seen.current = { focusRequest, visible };
    if (target && ((focusRequest > before.focusRequest && visible) || (visible && !before.visible))) useReview.getState().refresh(target);
  }, [focusRequest, visible, target]);

  // A requested file: brought into view by the stack when the list holds it; a path outside the repository stays, to be
  // shown refused; any other is dropped (the file has no change in this scope).
  const reveal = useStore(ui, (s) => s.reveal);
  const revealed = files !== null && reveal !== null ? findFile(files, reveal.path) : null;
  const refused = files !== null && reveal !== null && revealed === null && outside(reveal.path, data.status, scope);
  useEffect(() => {
    if (files !== null && reveal !== null && revealed === null && !refused) ui.setState({ reveal: null });
  }, [files, reveal, revealed, refused, ui]);
  const onRevealed = useCallback(() => ui.setState({ reveal: null }), [ui]);

  const [measured, width] = useWidth();
  const mode = useStore(ui, (s) => s.mode);
  const key = scope ? placeKey(directory, scope, turnId, null) : '';
  return (
    <div ref={measured} data-review data-scope={scope ?? ''} data-mode={drawnMode(mode, width)} className="flex h-full min-h-0 flex-col bg-bg">
      {chips ? <ScopeChips ui={ui} data={data} scope={scope} appSessionId={appSessionId} /> : null}
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
        <StackView
          appSessionId={appSessionId}
          hostId={hostId}
          hostMode={hostMode}
          visible={visible}
          ui={ui}
          data={data}
          files={files}
          placeKey={key}
          width={width}
          reveal={revealed && reveal ? { path: revealed.path, n: reveal.n } : null}
          onRevealed={onRevealed}
          refused={refused && reveal !== null ? reveal.path : null}
        />
      ) : null}
      <Footer scope={scope} data={data} />
    </div>
  );
}

// What the stack draws: the stored choice, but Unified where it is too narrow for Split (D9).
const drawnMode = (mode: ReviewMode, width: number): ReviewMode => (mode === 'split' && (width <= 0 || width >= SPLIT_MIN_WIDTH) ? 'split' : 'unified');

interface StackViewProps {
  appSessionId: AppSessionId;
  hostId: string;
  hostMode: 'panel' | 'tab';
  visible: boolean;
  ui: StoreApi<ReviewUi>;
  data: ReviewData;
  files: readonly ReviewFile[];
  placeKey: string;
  width: number;
  reveal: { path: string; n: number } | null;
  onRevealed(): void;
  refused: string | null;
}

// The card's frame in Review: nothing is located or pinned (the `inline` layout).
const CARD_FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'review' };
const acceptsNone = () => false; // a Review card is opened on its host by id, never claimed (`targetOf` is null for a line)

// The toolbar over the stack, both from one resolution of the scope's files; the comment card's host in the toolbar,
// and the comments on lines over the stack (M5).
function StackView({ appSessionId, hostId, hostMode, visible, ui, data, files, placeKey: key, width, reveal, onRevealed, refused }: StackViewProps) {
  const [held, setHeld] = useState<HeldFile | null>(null);
  const { sections, order } = useStack({ files, target: data.target, placeKey: key, pastCap: data.pastCap, ui, held });
  const scopeDiff = useReview((s) => (data.target ? diffOf(s, data.target) : undefined));
  const mode = useStore(ui, (s) => s.mode);
  const hunk = useStore(ui, (s) => s.hunk);
  const wrap = useViewer((s) => s.wrap);
  const allFolded = everyFolded(sections.map((section) => section.folded));
  const current = Math.min(hunk, Math.max(0, order.length - 1));

  // The row under the commented line the card is drawn in, and the file held still under the open card: its hunks as
  // the card found them, taken when the card opens on it and let go when the card goes (§G, decision 10).
  const [row, setRow] = useState<HTMLElement | null>(null);
  const comments = useLineComments({ appSessionId, hostId, repoRoot: data.status?.repoRoot ?? null, sections });
  const holdPath = comments.holdPath;
  if (holdPath === null ? held !== null : held?.path !== holdPath) {
    const section = holdPath === null ? undefined : sections.find((each) => each.file.path === holdPath);
    if (holdPath === null) setHeld(null);
    else if (section?.hunks) setHeld({ path: holdPath, hunks: section.hunks, blocks: section.blocks });
  }
  // Refresh: the held file takes its latest hunks, and the card is drawn again at its comment's place there. The keyboard
  // is put in the card's field first, so the card drawn again takes it back (CardComposer's remount rule).
  const onRefresh = useCallback(
    (path: string) => {
      row?.querySelector<HTMLTextAreaElement>('[data-comment-card] textarea')?.focus();
      setHeld((was) => (was?.path === path ? null : was));
    },
    [row],
  );
  const { rows, card, add } = comments;
  const value = useMemo<LineCommentsValue>(() => ({ key: comments.key, hostId, card, rowsOf: (path) => rowsIn(rows, path), add, setRow }), [comments.key, hostId, card, rows, add]);

  return (
    <LineCommentsContext.Provider value={value}>
      <Toolbar
        totals={totalsWords(totals(files))}
        chip={<CommentCardHost hostId={hostId} host="review" mode={hostMode} layout="inline" row={row} accepts={acceptsNone} frame={CARD_FRAME} visible={visible} subject={appSessionId} />}
        allFolded={allFolded}
        onFoldAll={() => ui.setState((s) => foldAll(s, key, files.map((file) => file.path), allFolded ? 'open' : 'closed'))}
        counter={order.length > 0 ? { index: current, count: order.length } : null}
        onHunk={(next) => ui.setState((s) => ({ hunk: next, navigate: s.navigate + 1 }))}
        mode={mode}
        splitRoom={width <= 0 || width >= SPLIT_MIN_WIDTH}
        onMode={(next) => ui.setState({ mode: next })}
        wrap={wrap}
        onWrap={() => useViewer.getState().setWrap(!wrap)}
      />
      {refused !== null ? <RefusedPath path={refused} /> : null}
      <Stack
        key={key}
        appSessionId={appSessionId}
        ui={ui}
        sections={sections}
        order={order}
        placeKey={key}
        target={data.target}
        scopeDiff={scopeDiff}
        width={width}
        mode={drawnMode(mode, width)}
        wrap={wrap}
        reveal={reveal}
        onRevealed={onRevealed}
        onRefresh={onRefresh}
      />
    </LineCommentsContext.Provider>
  );
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

// Last turn is always listed (l5-code-12 c): chosen with no turn set, it shows the latest turn of the session's own
// transcript whose divider lists files; with none it is disabled with its reason.
function ScopeChips({ ui, data, scope, appSessionId }: { ui: StoreApi<ReviewUi>; data: ReviewData; scope: ReviewScope | null; appSessionId: AppSessionId }) {
  const turnId = useStore(ui, (s) => s.turnId);
  const latest = useTranscriptStore((s) => latestTurnWithFiles(s.rows(appSessionId)));
  const pick = (next: ReviewScope) => ui.setState((s) => (next === 'turn' ? selectLastTurn(s, latest) : selectScope(s, next)));
  const branchReason = data.branch.settled && data.branch.base === null ? data.branch.reason : null;
  const turnAvailable = turnId !== null || latest !== null;
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
      {chipOf('turn', !turnAvailable, turnAvailable ? null : REVIEW_COPY.noTurnChangedFiles)}
      {stagedShown ? chipOf('staged', !data.staged, data.staged ? null : REVIEW_COPY.indexMatchesHead) : null}
    </div>
  );
}

function RefusedPath({ path }: { path: string }) {
  return (
    <div role="alert" data-review-refused className="flex shrink-0 flex-col gap-0.5 px-3 py-2">
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
