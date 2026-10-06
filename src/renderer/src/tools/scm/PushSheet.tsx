// The Push sheet (E6 execution document, Design §8): main's plan for the chosen remote (main's default, or the one
// picked when the checkout has several; a pick re-plans), shown as the remote, every destination the push goes to, the
// branch and what it tracks after, the count, and the exact command; Push sends only the plan's token. "sets upstream"
// is read from the plan's argv (task 3's rule): a branch with no upstream of its own name is published with
// `--set-upstream`, and one tracking another branch (git's default for a branch made from `origin/main`) is re-pointed,
// which the sheet says. Rendered inside the tool through C10's `Sheet` with the tool's own close.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmStatus } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { FIELD, PRIMARY } from '../../sessions/ui';
import { destinationLabel, SCM_COPY } from './copy';
import { PlanCommand, plannedOf, PlanProblem, PlanRow, PlanRows, SheetNote, useRunPlan, type Planned } from './plan-sheet';
import { settled } from './store';
import type { ScmUi } from './view-state';

export function PushSheet({ appSessionId, ui, status, scm }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; status: GitStatus; scm: ScmStatus | undefined }) {
  const [remote, setRemote] = useState<string | undefined>(undefined); // undefined: main's default
  const [planned, setPlanned] = useState<Planned>({ kind: 'planning' }); // back to planning by whatever asks again
  const asked = useRef(0);

  const plan = useCallback(
    async (picked: string | undefined) => {
      const ask = ++asked.current;
      const result = await settled(ipc.invoke('scm.push.plan', { appSessionId, ...(picked !== undefined ? { remote: picked } : {}) }));
      if (ask === asked.current) setPlanned(plannedOf(result)); // an answer for an earlier pick is dropped
    },
    [appSessionId],
  );
  useEffect(() => void plan(remote), [plan, remote]);
  const { submitting, note, setNote, run } = useRunPlan({
    appSessionId,
    ui,
    replan: () => {
      setPlanned({ kind: 'planning' });
      void plan(remote);
    },
  });

  const remotes = scm?.remotes ?? [];
  const shown = planned.kind === 'plan' ? planned.plan : null;
  const pick = (value: string) => {
    setNote(null);
    setPlanned({ kind: 'planning' });
    setRemote(value);
  };
  return (
    <Sheet title={SCM_COPY.pushSheetTitle} width="w-[min(560px,92vw)]" onClose={() => ui.setState({ sheet: null })} data-scm-sheet="push">
      <SheetForm canSubmit={shown !== null && !submitting} onSubmit={() => shown && void run(shown)} submitLabel={SCM_COPY.pushSubmit} submitClass={PRIMARY}>
        {note !== null ? <SheetNote notice={note} /> : null}
        <PlanRows>
          <PlanRow name="remote" label={SCM_COPY.remote}>
            {remotes.length > 1 ? (
              <select aria-label={SCM_COPY.remote} disabled={submitting} value={remote ?? shown?.remote ?? scm?.defaultRemote ?? ''} onChange={(event) => pick(event.target.value)} className={`${FIELD} py-0.5 text-ui-sm`}>
                {remotes.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono">{shown?.remote ?? remote ?? scm?.defaultRemote ?? ''}</span>
            )}
          </PlanRow>
          {shown !== null ? <PlanDetails plan={shown} status={status} /> : null}
        </PlanRows>
        <PlanProblem planned={planned} />
      </SheetForm>
    </Sheet>
  );
}

function PlanDetails({ plan, status }: { plan: RemotePlan; status: GitStatus }) {
  const setsUpstream = plan.argv.includes('--set-upstream');
  const tracked = setsUpstream && status.upstream !== null && status.upstream !== plan.upstream ? status.upstream : null;
  const upstream = plan.upstream ?? `${plan.remote}/${plan.branch}`;
  return (
    <>
      <PlanRow name="destination" label={SCM_COPY.destination}>
        <ul className="m-0 list-none p-0">
          {plan.pushUrls.map((url) => (
            <li key={url} data-scm-destination title={url} className="font-mono break-all">
              {destinationLabel(url)}
            </li>
          ))}
        </ul>
      </PlanRow>
      <PlanRow name="branch" label={SCM_COPY.branchRow}>
        <span className="font-mono">{SCM_COPY.branchTo(plan.branch, upstream)}</span>
        {setsUpstream ? <span className="text-fg-muted">{` · ${tracked !== null ? SCM_COPY.repointsUpstream(tracked) : SCM_COPY.setsUpstream}`}</span> : null}
      </PlanRow>
      {/* The count is against the branch's own upstream; a push that sets one has none to count against yet. */}
      {!setsUpstream ? (
        <PlanRow name="commits" label={SCM_COPY.commitsRow}>
          {SCM_COPY.commits(status.ahead)}
        </PlanRow>
      ) : null}
      <PlanCommand plan={plan} />
    </>
  );
}
