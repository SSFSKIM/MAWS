// The Review surface both the panel tool and a diff tab render (C8c execution document, Interfaces *Copy*; UX wave U5b,
// the execution document's §F): the scope chips (the tool only; a diff tab's ref fixes its scope), the toolbar, the
// stack of every changed file and the footer. Static and thin: a section's diff (`FileBody`, with the library, its
// stylesheet and the highlighter) loads on first use under the `Loading` fallback (ruled 2026-09-29, O2), while the
// chips, the toolbar and the headers draw at once. Review reads no file bytes (K4): an untracked file is read as
// Source control reads it, its diff against /dev/null.
//
// UX wave U5b, M5 (§B, §G; decision 4): the surface's comment card host is mounted once, for as long as the surface is,
// and shown in the toolbar, where its chip ("N unsent comments") and its place line belong, or in a line where the
// toolbar stands while the scope draws no stack; the card is drawn through a portal into the row the stack opens under
// the commented line. `hostId` is the surface's own (the tool's tab id, a diff tab's id).
//
// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §E, §G and §I): This branch is the
// working tree against the merge base with the default branch, its footer naming that base; a commit is a scope of its
// own, its chip listed while `ReviewUi.commit` is set, its footer the commit's; its kept read is asked again only by Retry,
// Review shown again and the machine heard again; the totals name the new files not counted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { useLinkPhase } from '../../../app/machine-mark';
import { machineFor } from '../../../ipc/machine';
import { CommentCardHost, type CardFrame } from '../../../side/card/CardHost';
import { focusAtEnd } from '../../../side/card/CommentCard';
import { leaveCard, useCommentCard } from '../../../side/card/store';
import { useTranscriptStore } from '../../../transcript';
import { REFUSAL, REVIEW_COPY } from '../copy';
import { useViewer } from '../viewer/viewer-store';
import '../code.css';
import { reviewLayout, SPLIT_MIN_WIDTH } from './measure';
import { defaultScope, latestTurnWithFiles, totals, uncountedFiles, type ReviewFile, type ReviewScope } from './review-model';
import { diffOf, useReview, useReviewData, type ReviewData } from './review-store';
import { CardSlot, LineCommentsContext, rowsIn, useCardSlot, useLineComments, type LineCommentsValue } from './LineComments';
import { UnplacedComments } from './UnplacedComments';
import { Stack, useStack, type HeldFile, type StackSection } from './Stack';
import { everyFolded } from './stack-model';
import { Toolbar, totalsWords } from './Toolbar';
import { commitSubject, decide, foldAll, placeKey, selectLastTurn, selectScope, type ReviewMode, type ReviewUi } from './view-state';

const retryButton = 'inline-flex h-6 min-w-6 shrink-0 items-center whitespace-nowrap rounded-sm border border-border px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
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

const NO_SECTIONS: readonly StackSection[] = [];

// The card's frame in Review: nothing is located or pinned (the `inline` layout).
const CARD_FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'review' };
const acceptsNone = () => false; // a Review card is opened on its host by id, never claimed (`targetOf` is null for a line)

export function ReviewShell({ appSessionId, directory, ui, hostId, hostMode, chips, focusRequest = 0, visible = true }: ReviewShellProps) {
  const scope = useStore(ui, (s) => s.scope);
  const turnId = useStore(ui, (s) => s.turnId);
  const redecide = useStore(ui, (s) => s.redecide);
  const requested = useStore(ui, (s) => s.request !== null); // an open() the tool applies next: decide nothing before it
  const listed = useStore(ui, (s) => s.commit?.sha ?? null); // UX wave U5b-2: the commit whose chip is listed
  const data = useReviewData({ appSessionId, directory, scope, turnId, commit: listed, visible, tab: ui }); // the tab's view state: what the tab keeps (Decision Log 49)
  const files = data.list.phase === 'ready' ? data.list.files : null;

  // The default scope, once the status and This branch's availability are known (a new tool, a pinned tool's new
  // session, an open() with no scope), or once the watch failed; never on a later change, so a chosen scope stays. UX
  // wave U5b-2: where the window cannot tell whether the machine serves the reads (no roster, as on the `#panel` harness
  // page), This branch stays unsettled and the default is decided without it.
  useEffect(() => {
    if (requested || (scope !== null && redecide === null)) return;
    if (data.status === null ? !data.gitFailed : !data.branch.settled && data.servesReads !== null) return;
    ui.setState((s) => decide(s, defaultScope(data.status, data.branch.base !== null)));
  }, [requested, scope, redecide, data.status, data.gitFailed, data.branch, data.servesReads, ui]);

  // UX wave U5b-2: the listed commit's subject, the chip's title, once its read answered
  const answered = data.commit.commit;
  useEffect(() => {
    if (answered) ui.setState((s) => commitSubject(s, answered.sha, answered.subject));
  }, [answered, ui]);

  // Shown again, or asked for focus: read the scope afresh (a stale hunk never outlives a glance away). UX wave U5b-2
  // (§G, decision 17): a commit's diff is kept; shown again asks only what of it failed, the scope's read or a file's.
  const seen = useRef({ focusRequest, visible });
  const target = data.target;
  const commitTarget = data.commit.target;
  useEffect(() => {
    const before = seen.current;
    seen.current = { focusRequest, visible };
    if (!((focusRequest > before.focusRequest && visible) || (visible && !before.visible))) return;
    if (target && target.read !== 'git.commitDiff') useReview.getState().refresh(target);
    if (commitTarget) useReview.getState().retryFailed(commitTarget);
  }, [focusRequest, visible, target, commitTarget]);

  // UX wave U5b-2 (§G): the session's machine heard again after its link was down asks again what of the commit failed
  const phase = useLinkPhase(machineFor(appSessionId));
  const phaseSeen = useRef(phase);
  useEffect(() => {
    const before = phaseSeen.current;
    phaseSeen.current = phase;
    if (phase === 'up' && before !== 'up' && commitTarget) useReview.getState().retryFailed(commitTarget);
  }, [phase, commitTarget]);

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
  const key = scope ? placeKey(directory, scope, turnId, listed) : '';
  const commentCommit = scope === 'commit' ? listed : null; // UX wave U5b-2: a commit's scope takes its own commit's comments

  // The comment card's host (M5, §B), mounted for as long as the surface is: in the toolbar while the stack is drawn, in
  // a line of its own where the toolbar stands while it is not; the card in the row under its line (`row`), or in the
  // row under the toolbar for a comment the surface cannot place (`UnplacedComments`; with no files, every comment).
  const slot = useCardSlot();
  const [row, setRow] = useState<HTMLElement | null>(null);
  const stacked = files !== null && files.length > 0;
  const noLines = data.list.phase === 'unavailable' || (files !== null && files.length === 0);
  const bare = useLineComments({ appSessionId, hostId, repoRoot: data.status?.repoRoot ?? null, commit: commentCommit, state: noLines ? 'none' : 'reading', sections: NO_SECTIONS });
  // Escape, Close or a send that dismissed the card: the keyboard goes back to the comment's row under the toolbar when
  // the card stood there, else to the stack's scroller; a kept draft's card goes (its comment stays, the chip stands for it).
  const rowToFocus = useRef<string | null>(null);
  const claimFocus = useCallback((commentId: string) => {
    if (rowToFocus.current !== commentId) return false;
    rowToFocus.current = null;
    return true;
  }, []);
  const restoreFocus = useCallback(() => {
    slot.closest('[data-review]')?.querySelector<HTMLElement>('[data-review-stack]')?.focus({ preventScroll: true });
    const open = useCommentCard.getState().open;
    if (open?.hostId !== hostId || open.phase.kind !== 'composing') return;
    rowToFocus.current = row?.hasAttribute('data-review-unplaced-item') ? open.phase.comment : null;
    leaveCard(open.serial);
  }, [slot, hostId, row]);
  // The keyboard follows the card into another row (Refresh, its line's return, the scope emptied under it): the row it
  // left is taken out of the page before the card is, so the card's own remount rule cannot tell the keyboard was there.
  const typing = useRef(false);
  useEffect(() => {
    const note = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      typing.current = target !== null && target.closest('[data-comment-card]') !== null && (slot.closest('[data-review]')?.contains(target) ?? false);
    };
    document.addEventListener('focusin', note);
    return () => document.removeEventListener('focusin', note);
  }, [slot]);
  const keyboardToCard = useCallback(() => {
    typing.current = true;
  }, []);
  useEffect(() => {
    const field = row?.querySelector<HTMLTextAreaElement>('[data-comment-card] textarea');
    if (!field || !typing.current || row!.contains(document.activeElement)) return;
    focusAtEnd(field);
  }, [row]);
  return (
    <div ref={measured} data-review data-scope={scope ?? ''} data-mode={drawnMode(mode, width)} className="flex h-full min-h-0 flex-col bg-bg">
      {createPortal(<CommentCardHost hostId={hostId} host="review" mode={hostMode} layout="inline" row={row} accepts={acceptsNone} frame={CARD_FRAME} visible={visible} restoreFocus={restoreFocus} subject={appSessionId} />, slot)}
      {chips ? <ScopeChips ui={ui} data={data} scope={scope} appSessionId={appSessionId} /> : null}
      {stacked ? null : (
        <div data-review-card-bar className="flex shrink-0 items-center border-b border-border px-3 py-1.5">
          <CardSlot element={slot} />
        </div>
      )}
      {!stacked && bare.unplaced.length > 0 ? <UnplacedComments appSessionId={appSessionId} passKey={bare.key} hostId={hostId} unplaced={bare.unplaced} opened={bare.opened} onRow={setRow} claimFocus={claimFocus} /> : null}
      {data.list.phase === 'unavailable' ? (
        data.list.retry ? (
          // UX wave U5b-2 (S22; M9 fix 2): a commit's diff, or a first branch read, that failed, with Retry in its row
          <div role="status" data-review-unavailable className="flex items-start gap-2 px-3 py-2">
            <p className="m-0 min-w-0 flex-1 text-ui text-fg-muted">{data.list.message}</p>
            <button type="button" data-review-retry className={retryButton} onClick={data.list.retry}>
              {REVIEW_COPY.retry}
            </button>
          </div>
        ) : (
          <p role="status" data-review-unavailable className="px-3 py-2 text-ui text-fg-muted">
            {data.list.message}
          </p>
        )
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
          cardSlot={slot}
          setRow={setRow}
          keyboardToCard={keyboardToCard}
          claimFocus={claimFocus}
          ui={ui}
          data={data}
          files={files}
          placeKey={key}
          commit={commentCommit}
          width={width}
          reveal={revealed && reveal ? { path: revealed.path, n: reveal.n } : null}
          onRevealed={onRevealed}
          refused={refused && reveal !== null ? reveal.path : null}
        />
      ) : null}
      <Footer scope={scope} data={data} listed={listed} />
    </div>
  );
}

// What the stack draws: the stored choice, but Unified where it is too narrow for Split (D9).
const drawnMode = (mode: ReviewMode, width: number): ReviewMode => (mode === 'split' && (width <= 0 || width >= SPLIT_MIN_WIDTH) ? 'split' : 'unified');

interface StackViewProps {
  appSessionId: AppSessionId;
  hostId: string;
  cardSlot: HTMLElement; // the card host's element, shown in the toolbar
  setRow(row: HTMLElement | null): void; // the row the card is drawn in: under its line, or under the toolbar
  keyboardToCard(): void; // Refresh asked for the card again: the keyboard goes to it once it is drawn
  claimFocus(commentId: string): boolean; // a row under the toolbar its card left on Escape takes the keyboard
  ui: StoreApi<ReviewUi>;
  data: ReviewData;
  files: readonly ReviewFile[];
  placeKey: string;
  commit: string | null; // UX wave U5b-2: the commit whose diff the stack shows, which its comments name
  width: number;
  reveal: { path: string; n: number } | null;
  onRevealed(): void;
  refused: string | null;
}

// The toolbar over the stack, both from one resolution of the scope's files; the comment card's host shown in the
// toolbar, and the comments on lines over the stack (M5).
function StackView({ appSessionId, hostId, cardSlot, setRow, keyboardToCard, claimFocus, ui, data, files, placeKey: key, commit, width, reveal, onRevealed, refused }: StackViewProps) {
  const [held, setHeld] = useState<HeldFile | null>(null);
  const { sections, order } = useStack({ files, target: data.target, placeKey: key, pastCap: data.pastCap, ui, held });
  const scopeDiff = useReview((s) => (data.target ? diffOf(s, data.target) : undefined));
  const mode = useStore(ui, (s) => s.mode);
  const hunk = useStore(ui, (s) => s.hunk);
  const wrap = useViewer((s) => s.wrap);
  const allFolded = everyFolded(sections.map((section) => section.folded));
  const current = Math.min(hunk, Math.max(0, order.length - 1));

  // The file held still under the open card: its hunks as the card found them in this scope, taken when the card opens
  // on it and let go when the card goes or another scope is drawn (§G, decision 10).
  const comments = useLineComments({ appSessionId, hostId, repoRoot: data.status?.repoRoot ?? null, commit, state: 'ready', sections });
  const holdPath = comments.holdPath;
  if (holdPath === null ? held !== null : held?.path !== holdPath || held.placeKey !== key) {
    const section = holdPath === null ? undefined : sections.find((each) => each.file.path === holdPath);
    if (holdPath === null) setHeld(null);
    else if (section?.hunks) setHeld({ placeKey: key, path: holdPath, hunks: section.hunks, blocks: section.blocks });
    else if (held !== null) setHeld(null);
  }
  // Refresh: the held file takes its latest hunks, and the card is drawn again at its comment's place there, the
  // keyboard back in its field once it is.
  const onRefresh = useCallback(
    (path: string) => {
      keyboardToCard();
      setHeld((was) => (was?.path === path ? null : was));
    },
    [keyboardToCard],
  );
  const { rows, card, waiting, addable, add } = comments;
  const value = useMemo<LineCommentsValue>(() => ({ key: comments.key, hostId, card, waiting, rowsOf: (path) => rowsIn(rows, path), addable, add, setRow }), [comments.key, hostId, card, waiting, rows, addable, add, setRow]);

  return (
    <LineCommentsContext.Provider value={value}>
      <Toolbar
        totals={totalsWords(totals(files), data.servesReads === null ? 0 : uncountedFiles(files)) /* UX wave U5b-2 (§I; Decision Log 29, 4): never while the reads are not known */}
        chip={<CardSlot element={cardSlot} />}
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
      {comments.unplaced.length > 0 ? <UnplacedComments appSessionId={appSessionId} passKey={comments.key} hostId={hostId} unplaced={comments.unplaced} opened={comments.opened} onRow={setRow} claimFocus={claimFocus} /> : null}
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
    case 'commit':
      return REVIEW_COPY.emptyCommit; // UX wave U5b-2 (Decision Log 37): no change against its first parent
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
  const commit = useStore(ui, (s) => s.commit); // UX wave U5b-2: listed while set, its title the subject
  const chipOf = (id: ReviewScope, disabled: boolean, reason: string | null, words: string = REVIEW_COPY.scopes[id]) => (
    <button key={id} type="button" data-chip={id} className={chip} aria-pressed={scope === id} disabled={disabled} title={reason ?? undefined} onClick={() => pick(id)}>
      {words}
    </button>
  );
  return (
    <div role="group" aria-label={REVIEW_COPY.title} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
      {chipOf('uncommitted', false, null)}
      {chipOf('branch', !data.branch.settled || (data.branch.base === null && data.branch.failure === null), branchReason)}
      {chipOf('turn', !turnAvailable, turnAvailable ? null : REVIEW_COPY.noTurnChangedFiles)}
      {stagedShown ? chipOf('staged', !data.staged, data.staged ? null : REVIEW_COPY.indexMatchesHead) : null}
      {commit ? chipOf('commit', false, commit.subject, REVIEW_COPY.commitChip(commit.sha)) : null}
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

function Footer({ scope, data, listed }: { scope: ReviewScope | null; data: ReviewData; listed: string | null }) {
  if (scope === null) return null;
  if (scope === 'commit') return listed === null ? null : <CommitFooter sha={listed} data={data} />;
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

// UX wave U5b-2 (§I; D8): `Commit <sha7> · <subject>`, then `· against its first parent` for a merge commit, then `· not on
// <branch> now` once HEAD no longer holds it (`· not in HEAD now` on a detached HEAD). The subject is a span of its own
// and shortens first, so the words after it stay whole.
function CommitFooter({ sha, data }: { sha: string; data: ReviewData }) {
  const commit = data.commit.commit;
  const after = `${commit !== null && commit.parents.length > 1 ? REVIEW_COPY.footer.firstParent : ''}${data.commit.onHead === false ? REVIEW_COPY.footer.notOnBranch(data.status?.branch ?? null) : ''}`;
  return (
    <p data-review-footer className="mt-auto flex min-w-0 shrink-0 border-t border-border px-3 py-1.5 text-ui-sm whitespace-nowrap text-fg-faint">
      <span className="shrink-0">{REVIEW_COPY.footer.commit(sha)}</span>
      <span data-review-footer-subject className="min-w-0 truncate">
        {commit?.subject ?? ''}
      </span>
      {after !== '' && <span className="shrink-0">{after}</span>}
    </p>
  );
}
