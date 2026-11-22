// Source control's Commits part (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §H; the frames' S1, S2, S6, S8, S9, S12 and S13): the branch read's commits since the base, newest first, under "Not
// pushed" and "Pushed to <upstream>"; eight rows, then the control; a row opens its commit in Review by the one act
// Review's folder exports (`openCommit`, the transcript's chip's too). A failed read keeps the bare heading and its
// sentence, told apart by `readFailure`, with the refresh control where a new read can change the answer. The word cut:
// while the first read is out, the quiet spinner under the heading (N63); a failure's sentence no longer repeats the
// heading (N68 to N71); with no base the heading reads "Commits · latest", the Where line naming the branch (N62).
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatDateTime } from '@shared/app/date-format';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitBranchCommit } from '@shared/ipc/schema/git';
import type { MachineMark } from '../../app/machine-mark';
import { useNow } from '../../app/use-now';
import { SUMMARY_COPY } from '../../panel/copy';
import { panelHost } from '../../panel/host';
import type { BranchRead } from '../code/review/branch-read';
import { reviewLayout } from '../code/review/measure';
import { openCommit } from '../code/review/open-commit';
import type { ReadFailure } from '../code/review/reads';
import { REVIEW_TOOL_ID } from '../code/review/ReviewTool';
import { REVIEW_COPY } from '../code/copy';
import { QuietSpinner } from '../../ui/spinner';
import { SCM_COPY } from './copy';
import { ageColumnChars, commitAge, commitList, commitsHeadingFit, commitsState, type CommitGroup, type CommitList, type CommitsHeading } from './page-model';
import { CountBadge, fixedWidth, Measured, measuredWidth, Part, quietControl, RefreshButton, shortest, useLineFit } from './page-parts';
import type { PageUi } from './SourceControlPage';

export interface CommitsPartProps {
  appSessionId: AppSessionId;
  serves: boolean | null; // the machine serves the reads (`servesReads`)
  read: BranchRead | undefined;
  mark: MachineMark;
  ui: StoreApi<PageUi>;
  retry(): void; // asks the branch read again
}

export function CommitsPart({ appSessionId, serves, read, mark, ui, retry }: CommitsPartProps) {
  const state = commitsState(serves, read, mark.offline);
  if (state.kind !== 'ready') {
    return (
      <Part name="commits" label={SCM_COPY.commitsPart}>
        <div data-scm-commits-heading className="flex min-h-6 min-w-0 items-center">
          <span className="shrink-0 text-fg-muted">{SCM_COPY.commitsPart}</span>
          {state.kind === 'failed' && state.refresh && <RefreshButton label={REVIEW_COPY.retry} title={REVIEW_COPY.retry} onClick={retry} />}
        </div>
        {state.kind === 'failed' && (
          <p data-scm-failure className="m-0 wrap-anywhere text-ui-sm text-fg-muted">
            {failureWords(state.failure, mark)}
          </p>
        )}
        {state.kind === 'outstanding' && (
          <div data-scm-commits-wait className="flex h-6 items-center">
            <QuietSpinner label={SCM_COPY.commitsPart} />
          </div>
        )}
      </Part>
    );
  }
  return <CommitsList appSessionId={appSessionId} answer={state.answer} ui={ui} />;
}

// §H's Commits column of "Refusals told apart"; a refusal's code word is no tooltip (frames' S14).
function failureWords(failure: ReadFailure, mark: MachineMark): string {
  switch (failure.kind) {
    case 'older':
      return SCM_COPY.commitsOlder(mark.local ? null : mark.name);
    case 'offline':
      return SCM_COPY.commitsOffline(mark.name);
    case 'refused':
      return SCM_COPY.commitsRefused(mark.name);
    case 'failed':
      return SCM_COPY.commitsFailed(failure.message);
  }
}

function CommitsList({ appSessionId, answer, ui }: { appSessionId: AppSessionId; answer: NonNullable<BranchRead['answer']>; ui: StoreApi<PageUi> }) {
  const whole = useStore(ui, (s) => s.commitsWhole);
  const list = commitList(answer, whole);
  const heading = useRef<HTMLDivElement>(null);
  const folding = useRef(false);
  const now = useNow(); // the shared clock for ages, ticking every 30 s while read
  const ages = new Map(list.sections.flatMap((section) => section.commits).map((commit) => [commit.sha, commitAge(commit.authoredAt, now)]));
  const ageChars = ageColumnChars([...ages.values()]);

  // "Show fewer" (frames' S2): once folded, the heading is brought to the top of the scrolling part where the page can
  // scroll that far; on a page that no longer scrolls nothing moves.
  useLayoutEffect(() => {
    if (!folding.current || whole) return;
    folding.current = false;
    const top = heading.current;
    if (top) headingToTop(top);
  }, [whole]);

  return (
    <Part name="commits" label={SCM_COPY.commitsPart}>
      <Heading ref={heading} heading={list.heading} review={list.review} appSessionId={appSessionId} />
      {list.sections.map((section, i) => (
        <div key={section.group?.kind ?? i} className="flex min-w-0 flex-col">
          {section.group !== null && <GroupLine group={section.group} />}
          {section.commits.map((commit) => (
            <CommitRow key={commit.sha} appSessionId={appSessionId} commit={commit} age={ages.get(commit.sha)!} ageChars={ageChars} />
          ))}
        </div>
      ))}
      <Control
        list={list}
        onWhole={() => ui.setState({ commitsWhole: true })}
        onFewer={() => {
          folding.current = true;
          ui.setState({ commitsWhole: false });
        }}
      />
    </Part>
  );
}

// The page's scrolling part brought to the Commits heading, as far as it scrolls (frames' S2): the heading's place in the
// content, clamped to how far the part can scroll; nothing is written where it no longer scrolls.
function headingToTop(heading: HTMLElement): void {
  const box = heading.closest<HTMLElement>('[data-scm-scroll]');
  if (!box) return;
  const room = box.scrollHeight - box.clientHeight;
  if (room <= 0) return;
  box.scrollTop = Math.min(room, Math.max(0, box.scrollTop + reviewLayout.offsetWithin(heading, box)));
}

// "Commits N since <base>" with "· N behind" and "Review ›" on This branch; with no base "Commits · latest" and no
// "Review ›" (frames' S8; the word cut, N62). The base's name shortens at its end to eight characters, "· N behind" stays whole, and
// where even that does not fit "since <base>" is left out whole (frames' S6).
function Heading({ ref, heading, review, appSessionId }: { ref: RefObject<HTMLDivElement | null>; heading: CommitsHeading; review: boolean; appSessionId: AppSessionId }) {
  const since = heading.kind === 'since' ? SCM_COPY.since(heading.base) : null;
  const sinceMin = heading.kind === 'since' ? SCM_COPY.since(shortest(heading.base)) : null;
  const behind = heading.kind === 'since' && heading.behind > 0 ? `· ${SCM_COPY.behind(heading.behind)}` : null;
  const count = heading.kind === 'since' ? SCM_COPY.count(heading.count) : null;
  const fit = useLineFit(ref, headingOf, sameHeading, WHOLE_HEADING, `${count}\0${since}\0${behind}\0${review}`);
  return (
    <div ref={ref} data-scm-commits-heading className="relative flex min-h-6 min-w-0 items-center">
      <span data-scm-fixed className="shrink-0 whitespace-nowrap pr-1.5 text-fg-muted">
        {SCM_COPY.commitsPart}
      </span>
      {heading.kind === 'since' ? (
        <>
          {' '}
          <CountBadge n={heading.count} fixed />
          {since !== null && fit.since !== 'left-out' && (
            <>
              {' '}
              <span data-scm-since data-fit={fit.since} className="min-w-0 truncate pl-1.5 text-ui-sm text-fg-muted" style={fit.since === 'shortened' && fit.sinceMin > 0 ? { minWidth: fit.sinceMin } : undefined}>
                {since}
              </span>
            </>
          )}
          {behind !== null && (
            <>
              {' '}
              <span data-scm-behind className="shrink-0 whitespace-nowrap pl-1 text-ui-sm text-fg-muted">
                {behind}
              </span>
            </>
          )}
        </>
      ) : (
        <>
          {' '}
          <span className="min-w-[9ch] truncate text-ui-sm text-fg-muted">{SCM_COPY.latest}</span>
        </>
      )}
      {review && (
        <>
          {' '}
          <button type="button" data-scm-fixed className={`${quietControl} ml-auto`} onClick={() => panelHost.addTool(REVIEW_TOOL_ID, { appSessionId, params: { scope: 'branch' } })}>
            {SCM_COPY.review}
          </button>
        </>
      )}
      {since !== null && <Measured name="since" text={since} className="pl-1.5 text-ui-sm" />}
      {sinceMin !== null && <Measured name="since-min" text={sinceMin} className="pl-1.5 text-ui-sm" />}
      {behind !== null && <Measured name="behind" text={behind} className="pl-1 text-ui-sm" />}
    </div>
  );
}

type HeadingShape = ReturnType<typeof commitsHeadingFit> & { sinceMin: number };
const WHOLE_HEADING: HeadingShape = { since: 'whole', sinceMin: 0 };
const sameHeading = (a: HeadingShape, b: HeadingShape) => a.since === b.since && a.sinceMin === b.sinceMin;
function headingOf(line: HTMLElement, room: number): HeadingShape {
  const sinceMin = measuredWidth(line, 'since-min');
  return { ...commitsHeadingFit({ room, fixed: fixedWidth(line), since: measuredWidth(line, 'since'), sinceMin, behind: measuredWidth(line, 'behind') }), sinceMin };
}

// "Not pushed N" (the card's word) or "Pushed to <upstream> N": the upstream shortens at its end, the count stays whole;
// a count only where it is known (frames' S6, S8)
function GroupLine({ group }: { group: CommitGroup }) {
  return (
    <div data-scm-commit-group={group.kind} className="flex min-h-6 min-w-0 items-center text-ui-sm text-fg-muted">
      <span className={group.kind === 'pushed' ? 'min-w-[9ch] truncate pr-1.5' : 'shrink-0 whitespace-nowrap pr-1.5'}>{group.kind === 'pushed' ? SCM_COPY.pushedTo(group.upstream ?? '') : SUMMARY_COPY.notPushed}</span>
      {group.count !== null && (
        <>
          {' '}
          <CountBadge n={group.count} />
        </>
      )}
    </div>
  );
}

// A commit's row (§H; frames' S12, S13): a button with the subject (which shortens first), the seven-character hash and
// the age, in a column as wide as the widest age drawn; its title the author, the date and the full hash.
function CommitRow({ appSessionId, commit, age, ageChars }: { appSessionId: AppSessionId; commit: GitBranchCommit; age: string; ageChars: number }) {
  const sha7 = commit.sha.slice(0, 7);
  return (
    <button
      type="button"
      data-scm-commit
      aria-label={SCM_COPY.openCommit(sha7)}
      title={SCM_COPY.commitTitle(commit.author, formatDateTime(Date.parse(commit.authoredAt)), commit.sha)}
      onClick={() => openCommit(appSessionId, commit.sha)}
      className="-mx-1 flex h-6 min-w-0 items-center gap-2 rounded-sm px-1 text-left text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
    >
      <span className="min-w-0 flex-1 truncate">{commit.subject}</span>{' '}
      <span className="shrink-0 font-mono text-ui-sm text-fg-muted">{sha7}</span>{' '}
      <span data-scm-age className="shrink-0 text-right text-ui-sm text-fg-muted tabular-nums" style={{ width: `${ageChars}ch` }}>
        {age}
      </span>
    </button>
  );
}

// The line after the list (frames' S1, S2; card 3): "Show all N commits" or "Show 50 of N commits"; shown whole, "M older
// commits not shown" where some are not, then "Show fewer" directly after.
function Control({ list, onWhole, onFewer }: { list: CommitList; onWhole(): void; onFewer(): void }) {
  const { control } = list;
  if (control.kind === 'none') return null;
  if (control.kind === 'fewer') {
    return (
      <div className="flex flex-col items-start">
        {control.older > 0 && (
          <p data-scm-older className="m-0 flex h-6 items-center text-ui-sm text-fg-muted">
            {SCM_COPY.olderNotShown(control.older)}
          </p>
        )}
        <button type="button" data-scm-commits-control className={`${quietControl} -mx-1`} onClick={onFewer}>
          {SCM_COPY.showFewer}
        </button>
      </div>
    );
  }
  return (
    <button type="button" data-scm-commits-control className={`${quietControl} -mx-1 self-start`} onClick={onWhole}>
      {control.kind === 'show-all' ? SCM_COPY.showAll(control.total) : SCM_COPY.showSome(control.shown, control.total)}
    </button>
  );
}
