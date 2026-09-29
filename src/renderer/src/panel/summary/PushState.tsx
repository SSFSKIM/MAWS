// Push state (ruling 5): `N ahead of <upstream>`, `Up to date with <upstream>` or `Not pushed`, and "Open on GitHub"
// when the upstream's remote is GitHub's, on the upstream's branch (derive.ts `githubUrl`). Hidden with no status (Environment says why) and on a detached head, where
// ahead and upstream mean nothing.
import { ipc } from '../../ipc/client';
import { useGit } from '../../stores/git';
import { SUMMARY_COPY } from '../copy';
import { githubUrl, pushState } from './derive';
import { actionClass, Row, Section } from './Section';

export function PushState({ directory }: { directory: string }) {
  const status = useGit((s) => s.entries.get(directory)?.status ?? null);
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
        <span className="block truncate">{text}</span>
      </Row>
    </Section>
  );
}

export function openExternal(url: string): void {
  void ipc.invoke('layout.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('[panel] layout.openExternal failed', result.error);
  });
}
