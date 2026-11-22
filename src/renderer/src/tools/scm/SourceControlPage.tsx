// Source control's page (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M10 and
// §H; the frames the owner chose, as the frames' rulings S1 to S14 amend them, Decision Log 30 and 31): a page that is read
// and changes nothing, in four parts always in this order: Where (the branch, "· worktree", the machine), Uncommitted (the
// card's change line, `changeLine`), Commits (the branch read, review/branch-read.ts) and Pull request (`prLine` and the
// answer's pull request). The Where line stays at the top and every part beneath it scrolls as one (frames' S3).
//
// What it holds: the git store's watch while mounted, as Review holds it, and the branch read while in view
// (`visible`, the tool's `ctx.visible`), where the machine serves the reads; the two scm queries the card shares
// (queries.ts). Nothing else: no store of the acting pane, no run, and no command that changes a repository (constraint 6).
import { useEffect, useRef } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import { useMachineMark, type MachineMark } from '../../app/machine-mark';
import { checkoutKey, machineFor } from '../../ipc/machine';
import { panelHost } from '../../panel/host';
import { changeLine } from '../../panel/summary/derive';
import { NOT_A_REPOSITORY } from '../../sessions/branch-label';
import { useGit, type GitEntry } from '../../stores/git';
import { branchReadOf, useBranchReads } from '../code/review/branch-read';
import { useServesReads } from '../code/review/reads';
import { REVIEW_TOOL_ID } from '../code/review/ReviewTool';
import { CommitsPart } from './CommitsPart';
import { SCM_COPY } from './copy';
import { QuietSpinner } from '../../ui/spinner';
import { Tip } from '../../ui/tip';
import { conflictCount, uncommittedFit, whereFit } from './page-model';
import { CountBadge, fixedWidth, Measured, measuredWidth, Part, quietControl, shortest, useLineFit } from './page-parts';
import { PullRequestPart } from './PullRequestPart';

/** The tool's state (§H): the page's own two folds, kept for one session's working folder and reset when either changes. */
export interface PageUi {
  session: AppSessionId | null;
  directory: string | null;
  commitsWhole: boolean; // the commit list shown whole
  passedOpen: boolean; // the passed and skipped checks listed
}
export const FOLDED: Pick<PageUi, 'commitsWhole' | 'passedOpen'> = { commitsWhole: false, passedOpen: false };
export const createPageUi = (session: AppSessionId | null, directory: string | null): StoreApi<PageUi> => createStore<PageUi>()(() => ({ session, directory, ...FOLDED }));

export interface SourceControlPageProps {
  appSessionId: AppSessionId;
  directory: string; // the checkout: the session's working folder, workingFolder(session).path
  ui: StoreApi<PageUi>;
  visible: boolean; // in view: the branch read is held only then
}

const Message = ({ children }: { children: string }) => (
  <div data-scm-page className="h-full bg-bg">
    <p role="status" className="m-0 px-3 py-2 text-ui text-fg-muted">
      {children}
    </p>
  </div>
);

const Waiting = () => (
  <div data-scm-page className="h-full bg-bg">
    <div className="flex h-9 items-center px-3">
      <QuietSpinner label={SCM_COPY.loading} />
    </div>
  </div>
);

export function SourceControlPage({ appSessionId, directory, ui, visible }: SourceControlPageProps) {
  const machine = machineFor(appSessionId);
  const mark = useMachineMark(appSessionId);
  const serves = useServesReads(machine);
  useEffect(() => useGit.getState().watch(machine, directory, appSessionId), [machine, directory, appSessionId]);
  const entry = useGit((s) => s.entries.get(checkoutKey(machine, directory)));
  const status = entry?.status ?? null;
  const repoRoot = status?.repoRoot ?? null;
  useEffect(() => {
    if (serves !== true || repoRoot === null || !visible) return;
    return useBranchReads.getState().hold({ machine, repoRoot, directory, session: appSessionId });
  }, [serves, repoRoot, visible, machine, directory, appSessionId]);
  const read = useBranchReads((s) => (repoRoot !== null ? branchReadOf(s, machine, repoRoot) : undefined));

  if (status === null || entry === undefined) {
    const error = entry?.error ?? null;
    if (error === null) return <Waiting />; // the word cut (P211): the first git read, as the quiet spinner
    return <Message>{error === NOT_A_REPOSITORY ? SCM_COPY.notRepository : SCM_COPY.gitUnavailable(error)}</Message>;
  }
  const retry = () => useBranchReads.getState().retry(machine, status.repoRoot);
  return (
    <div data-scm-page className="flex h-full min-h-0 flex-col bg-bg">
      <Where status={status} mark={mark} directory={directory} />
      <div data-scm-scroll className="min-h-0 flex-1 overflow-y-auto">
        <Uncommitted appSessionId={appSessionId} entry={entry} status={status} />
        <CommitsPart appSessionId={appSessionId} serves={serves} read={read} mark={mark} ui={ui} retry={retry} />
        <PullRequestPart appSessionId={appSessionId} directory={directory} status={status} mark={mark} ui={ui} />
      </div>
    </div>
  );
}

// Where (§H; frames' S4): `⎇ <branch>` or `detached at <sha7>`, "· worktree" for a linked worktree, and the machine's
// label (with "· offline") when the session is not on this Mac; the folder's path as its title. It gives way in a fixed
// order and never by cutting its end: the branch's name shortens to eight characters and an ellipsis, then "· worktree"
// is left out, then the machine's label moves to a second line, where it breaks anywhere and is never cut. A detached
// HEAD's words never shorten. On the first line the label is one unbreakable piece. The folder's path is the line's
// tooltip and description, the line taking the keyboard so the path has a way there (the word cut, N57).
function Where({ status, mark, directory }: { status: GitStatus; mark: MachineMark; directory: string }) {
  const line = useRef<HTMLDivElement>(null);
  const detached = status.branch === null;
  const words = detached ? SCM_COPY.detached(status.head) : SCM_COPY.branch(status.branch!);
  const least = detached ? words : SCM_COPY.branch(shortest(status.branch!));
  const worktree = status.isWorktree ? `· ${SCM_COPY.worktree}` : null;
  const label = mark.local ? null : mark.offline ? `${mark.name} · ${SCM_COPY.offline}` : mark.name;
  const fit = useLineFit(line, whereOf, sameWhere, WHOLE_WHERE, `${words}\0${worktree}\0${label}`);
  return (
    <div className="shrink-0 border-b border-border px-3 py-1.5 text-ui">
      <Tip content={directory} description={directory}>
        <div ref={line} data-scm-where tabIndex={0} className="relative flex min-w-0 flex-col rounded-sm outline-accent focus-visible:outline-2">
          <div className="flex min-h-6 min-w-0 items-center">
            <span data-scm-where-branch className={detached ? 'shrink-0 whitespace-nowrap text-fg' : 'min-w-0 truncate text-fg'} style={fit.shorten && fit.branchMin > 0 ? { minWidth: fit.branchMin } : undefined}>
              {words}
            </span>
            {worktree !== null && fit.worktree && (
              <>
                {' '}
                <span data-scm-where-worktree className="shrink-0 whitespace-nowrap pl-1 text-fg-muted">
                  {worktree}
                </span>
              </>
            )}
            {label !== null && !fit.machineBelow && (
              <>
                {' '}
                <span data-scm-where-machine className="shrink-0 whitespace-nowrap pl-1 text-fg-muted">
                  {`· ${label}`}
                </span>
              </>
            )}
          </div>
          {label !== null && fit.machineBelow && (
            <span data-scm-where-below className="wrap-anywhere text-fg-muted">
              {label}
            </span>
          )}
          <Measured name="branch" text={words} />
          <Measured name="branch-min" text={least} />
          {worktree !== null && <Measured name="worktree" text={worktree} className="pl-1" />}
          {label !== null && <Measured name="machine" text={`· ${label}`} className="pl-1" />}
        </div>
      </Tip>
    </div>
  );
}

type WhereShape = ReturnType<typeof whereFit> & { branchMin: number };
const WHOLE_WHERE: WhereShape = { shorten: false, worktree: true, machineBelow: false, branchMin: 0 };
const sameWhere = (a: WhereShape, b: WhereShape) => a.shorten === b.shorten && a.worktree === b.worktree && a.machineBelow === b.machineBelow && a.branchMin === b.branchMin;
function whereOf(line: HTMLElement, room: number): WhereShape {
  const branchMin = measuredWidth(line, 'branch-min');
  return { ...whereFit({ room, branch: measuredWidth(line, 'branch'), branchMin, worktree: measuredWidth(line, 'worktree'), machine: measuredWidth(line, 'machine') }), branchMin };
}

// Uncommitted (§H): the card's change line (`changeLine`), so the two never disagree: "Uncommitted N", `+A −R`, "· N
// conflicts" in the danger colour, and "Review ›" on the Uncommitted scope; clean, "Uncommitted 0" and no button. The
// conflicts always stand whole: where the line lacks room the counts are left out whole first (frames' S6).
function Uncommitted({ appSessionId, entry, status }: { appSessionId: AppSessionId; entry: GitEntry; status: GitStatus }) {
  const line = useRef<HTMLDivElement>(null);
  const change = changeLine(status, entry.uncommitted?.files ?? null);
  const conflicts = conflictCount(status);
  const counts = change.kind === 'change' ? `+${SCM_COPY.count(change.insertions)} −${SCM_COPY.count(change.deletions)}` : null;
  const conflictWords = conflicts > 0 ? SCM_COPY.conflicts(conflicts) : null;
  const files = change.kind === 'change' ? SCM_COPY.count(change.files) : null;
  const fit = useLineFit(line, uncommittedOf, sameUncommitted, WHOLE_UNCOMMITTED, `${change.kind}\0${files}\0${counts}\0${conflictWords}`);
  return (
    <Part name="uncommitted" label={SCM_COPY.uncommitted}>
      <div ref={line} data-scm-uncommitted className="relative flex min-h-6 min-w-0 items-center">
        <span data-scm-fixed className="shrink-0 whitespace-nowrap pr-1.5 text-fg-muted">
          {SCM_COPY.uncommitted}
        </span>
        {change.kind === 'clean' && (
          <>
            {' '}
            <CountBadge n={0} fixed />
          </>
        )}
        {change.kind === 'change' && (
          <>
            {' '}
            <CountBadge n={change.files} fixed />
            {counts !== null && fit.counts && (
              <>
                {' '}
                <span data-scm-counts className="shrink-0 whitespace-nowrap pl-1.5 text-ui-sm">
                  <span className="text-success">{`+${SCM_COPY.count(change.insertions)}`}</span> <span className="text-danger">{`−${SCM_COPY.count(change.deletions)}`}</span>
                </span>
              </>
            )}
            {conflictWords !== null && (
              <>
                {' '}
                <span data-scm-conflicts className="shrink-0 whitespace-nowrap pl-1.5 text-ui-sm text-danger">
                  {conflictWords}
                </span>
              </>
            )}{' '}
            <button type="button" data-scm-fixed className={`${quietControl} ml-auto`} onClick={() => panelHost.addTool(REVIEW_TOOL_ID, { appSessionId, params: { scope: 'uncommitted' } })}>
              {SCM_COPY.review}
            </button>
          </>
        )}
        {counts !== null && <Measured name="counts" text={counts} className="pl-1.5 text-ui-sm" />}
        {conflictWords !== null && <Measured name="conflicts" text={conflictWords} className="pl-1.5 text-ui-sm" />}
      </div>
    </Part>
  );
}

type UncommittedShape = ReturnType<typeof uncommittedFit>;
const WHOLE_UNCOMMITTED: UncommittedShape = { counts: true };
const sameUncommitted = (a: UncommittedShape, b: UncommittedShape) => a.counts === b.counts;
const uncommittedOf = (line: HTMLElement, room: number): UncommittedShape => uncommittedFit({ room, fixed: fixedWidth(line), counts: measuredWidth(line, 'counts'), conflicts: measuredWidth(line, 'conflicts') });
