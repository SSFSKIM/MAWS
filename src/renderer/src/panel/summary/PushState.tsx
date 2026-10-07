// Push state (ruling 5): `N ahead of <upstream>`, `Up to date with <upstream>` or `Not pushed`, and "Open on GitHub"
// when the upstream's remote is GitHub's, on the upstream's branch (derive.ts `githubUrl`). Hidden with no status (Environment says why) and on a detached head, where
// ahead and upstream mean nothing.
//
// E6 (E6 execution document, Design §6): the push text opens the Source control tool, and a second row says the PR's
// state (pr-line.ts) from `scm.status` and `scm.pr.state`, the queries the tool's header shares by key. The PR state is
// polled every 2 minutes while the row is shown and there is something to ask (trusted, a remote), asked again when the
// repository's head or refs move or a session's setup records trust (the app-level listener, `connectPanelEvents`), and
// on demand by Refresh. The card hands this row its session and that session's checkout (E11 W-D).
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { queryClient } from '../../ipc/query';
import { useGit } from '../../stores/git';
import { prStateKey, scmStatusKey, usePrState, useScmStatus } from '../../tools/scm/queries';
import { openTerminal } from '../../tools/terminal';
import { SUMMARY_COPY } from '../copy';
import { panelHost, usePanelHost } from '../host';
import { githubUrl, pushState } from './derive';
import { prLine, prStateBehind } from './pr-line';
import { actionClass, Row, Section } from './Section';

const SCM_TOOL_ID = 'source-control'; // E6's tool id (the tool's module stays out of the summary's graph)
const GH_INSTALL_URL = 'https://cli.github.com';
const GH_SIGN_IN = 'gh auth login';

// Inline actions read as links within the row's sentence (`PR #12`, `Install`, `Sign in`).
const linkClass = 'rounded-sm text-accent outline-accent hover:underline focus-visible:outline-2';

export function PushState({ directory, appSessionId }: { directory: string; appSessionId: AppSessionId }) {
  const status = useGit((s) => s.entries.get(directory)?.status ?? null);
  const toolRegistered = usePanelHost((s) => s.tools.has(SCM_TOOL_ID));
  if (!status || status.branch === null) return null;
  const push = pushState(status);
  const url = githubUrl(status.remoteUrl, status.upstream);
  const text =
    push.kind === 'not_pushed'
      ? SUMMARY_COPY.notPushed
      : `${push.ahead > 0 ? SUMMARY_COPY.ahead(push.ahead, push.upstream) : SUMMARY_COPY.upToDate(push.upstream)}${push.behind > 0 ? SUMMARY_COPY.behind(push.behind) : ''}`;
  return (
    <Section id="push">
      <Row
        action={
          url && (
            <button type="button" className={actionClass} onClick={() => openExternal(url)}>
              {SUMMARY_COPY.openOnGitHub}
            </button>
          )
        }
      >
        {toolRegistered ? (
          // A-28 (WCAG 2.5.3): named by the text it shows; what it does is its title, the accessible description
          <button
            type="button"
            title={SUMMARY_COPY.openSourceControl}
            className="block w-full truncate rounded-sm text-left outline-accent hover:text-accent focus-visible:outline-2"
            onClick={() => panelHost.addTool(SCM_TOOL_ID, { appSessionId })}
          >
            {text}
          </button>
        ) : (
          <span className="block truncate">{text}</span>
        )}
      </Row>
      <PrRow appSessionId={appSessionId} directory={directory} branch={status.branch} />
    </Section>
  );
}

function PrRow({ appSessionId, directory, branch }: { appSessionId: AppSessionId; directory: string; branch: string }) {
  // The queries the tool's header shares (tools/scm/queries.ts): the bounded poll and the rule for asking.
  const scm = useScmStatus(appSessionId);
  const pr = usePrState(appSessionId, { branch, scm: scm.data });
  const [refreshing, setRefreshing] = useState(false);
  const behind = prStateBehind(scm.data, pr.data);
  useEffect(() => {
    if (behind) void queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId) });
  }, [behind, appSessionId]);

  const line = prLine({ branch, scm: { data: scm.data, error: scm.error?.message }, pr: { data: pr.data, error: pr.error?.message } });
  if (line.kind === 'hidden') return null;

  // gh is asked again (the probe re-runs on `refresh: true`, keeping only a ready answer), and scm.status, whose gh and
  // trust the row reads, is re-read after it so it finds the new probe. Untrusted, there is nothing to ask gh: only
  // scm.status is re-read (an `untrusted` PR answer cached now would outlive the trust that follows).
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (scm.data?.trusted) {
        const result = await ipc.invoke('scm.pr.state', { appSessionId, refresh: true });
        if (result.ok) queryClient.setQueryData(prStateKey(appSessionId), result.value);
        else await queryClient.invalidateQueries({ queryKey: prStateKey(appSessionId) });
      }
      await queryClient.invalidateQueries({ queryKey: scmStatusKey(appSessionId) });
    } finally {
      setRefreshing(false);
    }
  };
  const checkedAt = pr.data?.checkedAt ?? scm.data?.checkedAt;

  return (
    <Row
      action={
        <button
          type="button"
          aria-label={SUMMARY_COPY.refreshPrState}
          title={checkedAt ? SUMMARY_COPY.checkedAt(new Date(checkedAt).toLocaleTimeString()) : SUMMARY_COPY.refreshPrState}
          disabled={refreshing}
          onClick={() => void refresh()}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          <RefreshIcon />
        </button>
      }
    >
      <span data-testid="pr-line" className={`block truncate ${line.kind === 'pr' ? '' : 'text-fg-muted'}`} title={line.kind === 'gh_unauthenticated' ? line.detail : undefined}>
        {line.kind === 'untrusted' && SUMMARY_COPY.prUntrusted}
        {line.kind === 'gh_missing' && (
          <>
            {`${SUMMARY_COPY.ghMissing} · `}
            <button type="button" className={linkClass} onClick={() => openExternal(GH_INSTALL_URL)}>
              {SUMMARY_COPY.install}
            </button>
          </>
        )}
        {line.kind === 'gh_unauthenticated' && (
          <>
            {`${SUMMARY_COPY.ghSignedOut} · `}
            <button type="button" className={linkClass} onClick={() => openTerminal({ appSessionId, cwd: directory, command: GH_SIGN_IN })}>
              {SUMMARY_COPY.signIn}
            </button>
          </>
        )}
        {line.kind === 'no_pr' && SUMMARY_COPY.noPr(line.branch)}
        {line.kind === 'pr' && (
          <>
            <button type="button" className={linkClass} onClick={() => openExternal(line.url)}>
              {SUMMARY_COPY.prNumber(line.number)}
            </button>
            {` ${line.details}`}
          </>
        )}
        {line.kind === 'unavailable' && SUMMARY_COPY.prUnavailable(line.reason)}
      </span>
    </Row>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
    </svg>
  );
}

export function openExternal(url: string): void {
  void ipc.invoke('layout.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('[panel] layout.openExternal failed', result.error);
  });
}
