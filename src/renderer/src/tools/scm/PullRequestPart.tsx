// Source control's Pull request part (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §H; S5, S6, S10; the frames' S5, S6, S7, S10, S11): the part's state is the card's (`prLine` over the two scm queries
// the card's row shares, queries.ts), its content the answer's pull request: the title, one state line, the checks by
// name, and "Open on GitHub ↗", where the person merges or closes. Absent for `prLine`'s hidden kind and on a detached
// HEAD. The GitHub CLI's sentences are the card's, naming the machine when it is not this Mac; Sign in there by the
// `shell` right (decision 21).
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { formatClock } from '@shared/app/date-format';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmPrState } from '@shared/ipc/schema/scm';
import type { MachineMark } from '../../app/machine-mark';
import { ipc } from '../../ipc/client';
import { machineFor } from '../../ipc/machine';
import { queryClient } from '../../ipc/query';
import { SUMMARY_COPY } from '../../panel/copy';
import { GH_INSTALL_URL, GH_SIGN_IN, INLINE_LINK, prLine, prStateBehind } from '../../panel/summary/pr-line';
import { openExternal } from '../../panel/summary/PushState';
import { useMachines } from '../../stores/machines';
import { openTerminal } from '../terminal';
import { SCM_COPY } from './copy';
import { bucketWord, checksOf, mergeWords, signInWay, stateLine, type Check, type Tone } from './page-model';
import { Part, RefreshButton } from './page-parts';
import { Tip } from '../../ui/tip';
import { NamedGlyph } from '../../ui/glyph';
import { prStateKey, refreshPrState, scmStatusKey, usePrState, useScmStatus } from './queries';
import type { PageUi } from './SourceControlPage';

export interface PullRequestPartProps {
  appSessionId: AppSessionId;
  directory: string;
  status: GitStatus;
  mark: MachineMark;
  ui: StoreApi<PageUi>;
}

export function PullRequestPart(props: PullRequestPartProps) {
  if (props.status.branch === null) return null; // nothing to ask about on a detached HEAD (prLine's hidden kind)
  return <Branch {...props} branch={props.status.branch} />;
}

const TONE: Record<Tone, string> = { fg: 'text-fg', success: 'text-success', danger: 'text-danger', muted: 'text-fg-muted' };

function Branch({ appSessionId, directory, mark, ui, branch }: PullRequestPartProps & { branch: string }) {
  const scm = useScmStatus(appSessionId);
  const pr = usePrState(appSessionId, { checkout: directory, branch, scm: scm.data });
  const rights = useMachines((s) => s.machines.get(machineFor(appSessionId))?.rights);
  const [refreshing, setRefreshing] = useState(false);
  // The card's rule (PushState's row): an answer older than scm.status that says what it no longer says is asked again
  const behind = prStateBehind(scm.data, pr.data);
  useEffect(() => {
    if (behind) void queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId, directory) });
  }, [behind, appSessionId, directory]);

  const line = prLine({ branch, scm: { data: scm.data, error: scm.error?.message }, pr: { data: pr.data, error: pr.error?.message } });
  if (line.kind === 'hidden') return null;

  // The card's Refresh: gh asked again past main's kept answer, then scm.status, whose gh and trust the part reads
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (scm.data?.trusted) await refreshPrState(appSessionId, directory, ipc);
      await queryClient.invalidateQueries({ queryKey: scmStatusKey(appSessionId) });
    } finally {
      setRefreshing(false);
    }
  };
  const checkedAt = pr.data?.checkedAt ?? scm.data?.checkedAt;
  const onMachine = (sentence: string) => (mark.local ? sentence : SCM_COPY.on(sentence, mark.name));
  const answer = line.kind === 'pr' ? (pr.data?.pr ?? null) : null;

  return (
    <Part name="pr" label={SCM_COPY.pullRequest}>
      <div data-scm-pr-heading className="flex min-h-6 min-w-0 items-center">
        <span className="shrink-0 pr-1.5 text-fg-muted">{SCM_COPY.pullRequest}</span>
        {answer !== null && (
          <>
            {' '}
            <span data-scm-pr-number className="shrink-0 rounded-sm bg-bg-active px-1 text-ui-sm text-fg-muted tabular-nums">
              {SCM_COPY.prNumber(answer.number)}
            </span>
          </>
        )}
        <RefreshButton label={SUMMARY_COPY.refreshPrState} tip={checkedAt ? SUMMARY_COPY.checkedAt(formatClock(Date.parse(checkedAt))) : SUMMARY_COPY.refreshPrState} disabled={refreshing} onClick={() => void refresh()} />
      </div>
      {line.kind === 'untrusted' && <Sentence>{SUMMARY_COPY.prUntrusted}</Sentence>}
      {line.kind === 'gh_missing' && (
        <Sentence>
          {`${onMachine(SUMMARY_COPY.ghMissing)} · `}
          <button type="button" className={INLINE_LINK_24} onClick={() => openExternal(GH_INSTALL_URL)}>
            {SUMMARY_COPY.install}
          </button>
        </Sentence>
      )}
      {line.kind === 'gh_unauthenticated' && <SignedOut appSessionId={appSessionId} directory={directory} mark={mark} rights={rights} sentence={onMachine(SUMMARY_COPY.ghSignedOut)} detail={line.detail} />}
      {line.kind === 'no_pr' && <Sentence>{SUMMARY_COPY.noPr(line.branch)}</Sentence>}
      {line.kind === 'unavailable' && <Sentence wrap>{SUMMARY_COPY.prUnavailable(line.reason)}</Sentence>}
      {answer !== null && <PullRequest pr={answer} ui={ui} />}
    </Part>
  );
}

// An inline link of a sentence ("Install", "Sign in"): the card's look, its pressed area 24 px tall by an ::after over the
// word (frames' S13), so the sentence's line keeps its height
const INLINE_LINK_24 = `relative ${INLINE_LINK} after:absolute after:inset-x-0 after:top-1/2 after:h-6 after:-translate-y-1/2 after:content-['']`;

// A sentence of the part; a message from git or the GitHub CLI breaks anywhere inside its box (frames' S7)
function Sentence({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return <p data-scm-pr-line className={`m-0 min-h-6 py-0.5 text-ui-sm text-fg-muted ${wrap ? 'wrap-anywhere' : ''}`}>{children}</p>;
}

// The GitHub CLI signed out (S10; decision 21; frames' S10): Sign in where a terminal can be opened there (this Mac, or a
// machine whose rights hold `shell`); the second line where the rights are known without it; neither while they are not.
function SignedOut({ appSessionId, directory, mark, rights, sentence, detail }: { appSessionId: AppSessionId; directory: string; mark: MachineMark; rights: readonly string[] | undefined; sentence: string; detail: string }) {
  const way = signInWay(mark.local, rights);
  return (
    <>
      <p data-scm-pr-line className="m-0 min-h-6 py-0.5 text-ui-sm text-fg-muted">
        {/* board ticket 815: the CLI's own words, the sentence's tip and description, the sentence taking Tab for them */}
        {detail ? (
          <Tip content={detail} description={detail}>
            <span tabIndex={0} className="rounded-sm outline-accent focus-visible:outline-2">
              {sentence}
            </span>
          </Tip>
        ) : (
          sentence
        )}
        {way === 'button' && (
          <>
            {' · '}
            <button type="button" className={INLINE_LINK_24} onClick={() => openTerminal({ appSessionId, cwd: directory, command: GH_SIGN_IN })}>
              {SUMMARY_COPY.signIn}
            </button>
          </>
        )}
      </p>
      {way === 'needs-shell' && <Sentence>{SCM_COPY.signInNeedsShell(mark.name)}</Sentence>}
    </>
  );
}

// The answer's pull request: the title, the state line (broken only between its phrases, each whole: frames' S5), a merge
// state GitHub adds later in a muted line under it, the checks of an open pull request (the counts line only where a row
// is listed or nothing folds, Decision Log 41; the first line of the checks opens with "Checks" in every state, so the
// folded line standing alone carries it outside its button, Decision Log 45), and "Open on GitHub ↗".
function PullRequest({ pr, ui }: { pr: NonNullable<ScmPrState['pr']>; ui: StoreApi<PageUi> }) {
  const phrases = stateLine(pr);
  const merge = mergeWords(pr);
  const checks = checksOf(pr);
  const open = useStore(ui, (s) => s.passedOpen);
  return (
    <>
      <p data-scm-pr-title className="m-0 py-0.5 text-ui text-fg">
        {pr.title}
      </p>
      <p data-scm-pr-state className="m-0 text-ui-sm">
        {phrases.map((phrase, i) => (
          <span key={i}>
            <span data-scm-phrase className={`whitespace-nowrap ${TONE[phrase.tone]}`}>
              {i < phrases.length - 1 ? `${phrase.words} ·` : phrase.words}
            </span>
            {i < phrases.length - 1 && ' '}
          </span>
        ))}
      </p>
      {merge.kind === 'unknown' && pr.state === 'OPEN' && (
        <p data-scm-merge-unknown className="m-0 text-ui-sm text-fg-muted">
          {SCM_COPY.unknownMergeState(merge.value)}
        </p>
      )}
      {checks !== null && (
        <>
          {checks.countsLine && (
            <p data-scm-checks className="m-0 flex flex-wrap items-baseline gap-x-1 pt-1 text-ui-sm text-fg-muted">
              <ChecksLabel />{' '}
              {checks.countParts.map((count, i) => (
                <span key={count}>
                  <span className="whitespace-nowrap">
                    <span data-scm-check-count>{count}</span>
                    {i < checks.countParts.length - 1 && ' ·'}
                  </span>
                  {i < checks.countParts.length - 1 && ' '}
                </span>
              ))}
            </p>
          )}
          {checks.attention.map((check, i) => (
            <CheckRow key={`${check.name}\0${i}`} check={check} />
          ))}
          {checks.foldWords !== null && (
            <div data-scm-fold-line className="flex min-w-0 items-center gap-x-1 text-ui-sm">
              {!checks.countsLine && (
                <>
                  <ChecksLabel />{' '}
                </>
              )}
              <button type="button" aria-expanded={open} onClick={() => ui.setState({ passedOpen: !open })} className="-mx-1 inline-flex h-6 items-center gap-1.5 rounded-sm px-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
                <span aria-hidden className="w-2 text-center">
                  {open ? '⌄' : '›'}
                </span>{' '}
                {checks.foldWords}
              </button>
            </div>
          )}
          {open && checks.folded.map((check, i) => <CheckRow key={`${check.name}\0${i}`} check={check} />)}
        </>
      )}
      <button type="button" onClick={() => openExternal(pr.url)} className="mt-1.5 inline-flex h-6 items-center self-start rounded-sm border border-border px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
        {SCM_COPY.openOnGitHub}
      </button>
    </>
  );
}

// The checks' label, the muted "Checks" that opens their first line: the counts line's, or the folded line's where it
// stands alone (Decision Log 45)
function ChecksLabel() {
  return (
    <span data-scm-checks-label className="text-fg-muted">
      {SCM_COPY.checks}
    </span>
  );
}

// A check's row (§H; frames' S11): the Background tasks row's 6 px dot, the name, the state's word, and "↗" to its run;
// a failed row's dot and word in the danger colour, a passed dot in the success token, every other neutral; a row with
// no link keeps the link's 20 px place empty, so the words stand in one column.
function CheckRow({ check }: { check: Check }) {
  const failed = check.bucket === 'fail';
  const dot = failed ? 'bg-danger' : check.bucket === 'pass' ? 'bg-success' : 'bg-border-strong';
  return (
    <div data-scm-check data-bucket={check.bucket} className="flex h-6 min-w-0 items-center gap-2 text-ui-sm">
      <span data-scm-dot aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />{' '}
      <span className="min-w-0 flex-1 truncate text-fg">{check.name}</span>{' '}
      <span data-scm-check-word className={`shrink-0 whitespace-nowrap ${failed ? 'text-danger' : 'text-fg-muted'}`}>
        {bucketWord(check.bucket)}
      </span>{' '}
      {check.link !== null ? (
        <NamedGlyph data-scm-check-link="" label={SCM_COPY.openCheck(check.name)} onClick={() => openExternal(check.link!)} className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
          {SCM_COPY.checkLink}
        </NamedGlyph>
      ) : (
        <span data-scm-check-link className="w-5 shrink-0" />
      )}
    </div>
  );
}
