// Environment (C8 spec *The summary*): the branch with Review, the uncommitted change line, and the model row that opens
// Session info. The git facts are the git store's for the summary's directory (Summary.tsx holds the watch); a failed
// watch says why in words and draws no branch, a failed diff keeps the branch and says the change is unavailable.
import { EffortSchema } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { aliasOf, chipLabel } from '@shared/sessions/model-label';
import { useCommand } from '../../ipc/query';
import { NOT_A_REPOSITORY } from '../../sessions/branch-label'; // C4's message (W9: one constant for every reader)
import { useGit, type GitEntry } from '../../stores/git';
import { SUMMARY_COPY } from '../copy';
import { changeLine } from './derive';
import { Row, Section, ToolButton, ToolSummary, useToolSummary } from './Section';

export function Environment({ appSessionId, record, directory }: { appSessionId: AppSessionId; record: SessionRecord; directory: string }) {
  const entry = useGit((s) => s.entries.get(directory));
  const reviewSummary = useToolSummary('review');
  const status = entry?.status ?? null;
  return (
    <Section id="environment">
      {status ? (
        <>
          <Row action={<ToolButton toolId="review" label={SUMMARY_COPY.review} appSessionId={appSessionId} />}>
            <span className="block truncate">{status.branch === null ? SUMMARY_COPY.detached(status.head) : SUMMARY_COPY.branch(status.branch)}</span>
          </Row>
          {reviewSummary ? <ToolSummary toolId="review" appSessionId={appSessionId} component={reviewSummary} /> : <ChangeLine entry={entry!} />}
        </>
      ) : (
        <Row>
          <span className="text-fg-muted">{watchFailure(entry)}</span>
        </Row>
      )}
      <Row action={<ToolButton toolId="session-info" label={SUMMARY_COPY.sessionInfo} appSessionId={appSessionId} />}>
        <ModelLine record={record} directory={directory} />
      </Row>
    </Section>
  );
}

// W9 (H4): the model as the composer's chip names it, `<alias> <effort>` over the route's catalogue (the same
// `engine.models` read the chip makes), with the exact id the engine reported in the tooltip; Session info has the rest.
function ModelLine({ record, directory }: { record: SessionRecord; directory: string }) {
  const route = record.gateway.routed === null ? null : record.gateway.routed ? 'gateway' : 'direct';
  const catalogue = useCommand('engine.models', route === null ? { refresh: false } : { refresh: false, gateway: route, cwd: directory }, { staleTime: 60_000 });
  const id = record.model.resolved ?? record.model.requested;
  const alias = aliasOf(id, catalogue.data?.models ?? []);
  return (
    <span className="block truncate text-fg-muted" title={id ?? undefined}>
      {alias === null ? SUMMARY_COPY.modelUnknown : chipLabel(alias, EffortSchema.safeParse(record.effort).data ?? null)}
    </span>
  );
}

// No status: git has not answered yet, or the watch failed.
function watchFailure(entry: GitEntry | undefined): string {
  if (!entry?.error) return SUMMARY_COPY.pending;
  return entry.error === NOT_A_REPOSITORY ? SUMMARY_COPY.notRepository : SUMMARY_COPY.gitUnavailable;
}

function ChangeLine({ entry }: { entry: GitEntry }) {
  const line = changeLine(entry.status, entry.uncommitted?.files ?? null);
  return (
    <p data-testid="change-line" className="text-ui-sm text-fg-muted">
      {line.kind === 'clean' && SUMMARY_COPY.clean}
      {line.kind === 'unknown' && (entry.error ? SUMMARY_COPY.changeUnavailable : SUMMARY_COPY.pending)}
      {line.kind === 'change' && (
        <>
          <span className="text-success">+{line.insertions}</span> <span className="text-danger">−{line.deletions}</span>{' '}
          {SUMMARY_COPY.across(line.files)}
          {line.untracked > 0 && SUMMARY_COPY.untracked(line.untracked)}
          {line.binary > 0 && SUMMARY_COPY.binary(line.binary)}
        </>
      )}
    </p>
  );
}
