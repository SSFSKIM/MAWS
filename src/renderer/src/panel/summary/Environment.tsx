// Environment (C8 spec *The summary*): the branch, the uncommitted change line (Review's own control, the card's one way
// into Review; UX wave U8b, l5-code-16), and the model row that opens Session info. The git facts are the git store's for
// the summary's directory (Summary.tsx holds the watch); a failed watch says why in words and draws no branch, a failed
// diff keeps the branch and says the change is unavailable.
// UX wave U8c-2 (§H; the owner's answers, Decision Log 14 of docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md):
// the folder row shows the agent's own folder (the selector's `cwd`), cut at its start when it does not fit and whole in
// its tooltip, so after a move it names the worktree; while the working folder is not the launch folder, one muted line
// "moved from <the launch folder's name>" sits directly under it. Every other row describes the checkout (`path`).
import { EffortSchema } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { aliasOf, chipLabel } from '@shared/sessions/model-label';
import type { WorkingFolder } from '@shared/sessions/working-folder';
import { useMachineMark } from '../../app/machine-mark';
import { catalogueRoute } from '../../gateway/observed-route'; // P5 O7 M9
import { checkoutKey, machineFor } from '../../ipc/machine';
import { useCommand } from '../../ipc/query';
import { NOT_A_REPOSITORY } from '../../sessions/branch-label'; // C4's message (W9: one constant for every reader)
import { useGit, type GitEntry } from '../../stores/git';
import { SUMMARY_COPY } from '../copy';
import { changeLine } from './derive';
import { FloatingCard, type CardFold } from './FloatingCard';
import { PushState } from './PushState';
import { Row, ToolButton, ToolSummary, useToolSummary } from './Section';

export function Environment({ appSessionId, record, folder, fold }: { appSessionId: AppSessionId; record: SessionRecord; folder: WorkingFolder; fold: CardFold }) {
  const directory = folder.path; // the checkout
  const entry = useGit((s) => s.entries.get(checkoutKey(machineFor(appSessionId), directory)));
  const reviewSummary = useToolSummary('review');
  const status = entry?.status ?? null;
  const machine = useMachineMark(appSessionId); // P5 O6 M5: where it runs, this Mac's as before, another's by name
  return (
    <FloatingCard title="Environment" summary={status ? (status.branch ?? SUMMARY_COPY.detached(status.head)) : watchFailure(entry)} {...fold}>
      <Row><span className="text-fg-muted">{machine.local ? 'This Mac' : machine.offline ? `${machine.name} · offline` : machine.name}</span></Row>
      <Row action={<ToolButton toolId="files" label="Files" appSessionId={appSessionId} />}>
        {/* the plain CSS cut at the start: right to left, the browser's ellipsis falls at the path's start; the path itself is isolated left to right */}
        <span data-testid="card-folder" dir="rtl" className="block truncate text-left" title={folder.cwd}>
          <bdi dir="ltr">{folder.cwd}</bdi>
        </span>
      </Row>
      {folder.moved && (
        <p data-testid="moved-from" className="m-0 truncate text-ui-sm text-fg-muted" title={folder.launch}>
          {SUMMARY_COPY.movedFrom(lastSegment(folder.launch))}
        </p>
      )}
      {status ? (
        <>
          <Row>
            <span className="block truncate">{status.branch === null ? SUMMARY_COPY.detached(status.head) : SUMMARY_COPY.branch(status.branch)}</span>
          </Row>
          {reviewSummary ? <ToolSummary toolId="review" appSessionId={appSessionId} component={reviewSummary} /> : <ChangeLine entry={entry!} />}
        </>
      ) : (
        <Row>
          <span className="text-fg-muted">{watchFailure(entry)}</span>
        </Row>
      )}
      <PushState directory={directory} appSessionId={appSessionId} embedded />
      <Row action={<ToolButton toolId="session-info" label={SUMMARY_COPY.sessionInfo} appSessionId={appSessionId} />}>
        <ModelLine record={record} directory={directory} />
      </Row>
    </FloatingCard>
  );
}

// W9 (H4): the model as the composer's chip names it, `<alias> <effort>` over the route's catalogue (the same
// `engine.models` read the chip makes), with the exact id the engine reported in the tooltip; Session info has the rest.
function ModelLine({ record, directory }: { record: SessionRecord; directory: string }) {
  const route = catalogueRoute(null, record); // P5 O7 M9: the catalogue of what the session was observed reaching
  const catalogue = useCommand('engine.models', route === null ? { refresh: false } : { refresh: false, gateway: route, cwd: directory }, { staleTime: 60_000 }, { machine: machineFor(record.appId) });
  const id = record.model.resolved ?? record.model.requested;
  const alias = aliasOf(id, catalogue.data?.models ?? []);
  return (
    <span className="block truncate text-fg-muted" title={id ?? undefined}>
      {alias === null ? SUMMARY_COPY.modelUnknown : chipLabel(alias, EffortSchema.safeParse(record.effort).data ?? null)}
    </span>
  );
}

const lastSegment = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

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
