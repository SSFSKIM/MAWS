// What the Push and Open PR sheets share (E6 execution document, Design §4 and §8): main's plan as the sheet shows it,
// and the confirm that sends main only the plan's token, so the command that runs is the one the sheet showed (main
// runs its stored plan, never anything the renderer sends back). A refusal to plan shows in main's words with nothing to
// submit. A refusal to run spends the token (main consumed it), so the sheet asks for a fresh plan and keeps main's
// sentence of what changed above it; `busy` alone leaves the token unspent (main decides it first), and the plan stays.
import { useState, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import type { RemotePlan, ScmRefusal } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { SCM_COPY, shellWords } from './copy';
import { noticeText, PrintedOutput } from './Notice';
import { settled, useScm } from './store';
import type { ScmNotice, ScmUi } from './view-state';

export type Planned =
  | { kind: 'planning' }
  | { kind: 'plan'; plan: RemotePlan }
  | { kind: 'refused'; refusal: ScmRefusal }
  | { kind: 'error'; message: string }
  | { kind: 'invalid'; message: string }; // a field main would refuse to plan for (the PR sheet's)

export function plannedOf(result: CommandResult<'scm.push.plan'>): Planned {
  if (!result.ok) return { kind: 'error', message: result.error.message };
  return 'refused' in result.value ? { kind: 'refused', refusal: result.value } : { kind: 'plan', plan: result.value };
}

// The confirm: `scm.push` or `scm.pr.create` with the plan's token alone. Started: the session's run takes the plan and
// the sheet closes (the Output opens itself on the new run). Otherwise the sheet stays with main's words, and asks for a
// new plan unless the token was not spent.
export function useRunPlan({ appSessionId, ui, replan }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; replan(): void }) {
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<ScmNotice | null>(null);
  const run = async (plan: RemotePlan) => {
    setSubmitting(true);
    setNote(null);
    const input = { appSessionId, token: plan.token };
    const result = await settled(plan.kind === 'push' ? ipc.invoke('scm.push', input) : ipc.invoke('scm.pr.create', input));
    setSubmitting(false);
    if (ui.getState().session !== appSessionId) return; // a pinned tool moved on: its sheet is already gone
    if (!result.ok) return setNote({ kind: 'error', text: result.error.message, output: '' });
    const answer = result.value;
    if ('started' in answer) {
      useScm.getState().started(appSessionId, plan);
      ui.setState({ sheet: null });
      return;
    }
    setNote({ kind: answer.refused, text: answer.detail, output: answer.output });
    if (answer.refused !== 'busy') replan();
  };
  return { submitting, note, setNote, run };
}

export function PlanRows({ children }: { children: ReactNode }) {
  return <dl className="m-0 flex flex-col gap-1.5">{children}</dl>;
}

export function PlanRow({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div data-scm-plan-row={name} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 text-ui-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

// The exact command, rendered from the plan's program and argv (quoted for display only), and where it runs.
export function PlanCommand({ plan }: { plan: RemotePlan }) {
  return (
    <>
      <PlanRow name="command" label={SCM_COPY.command}>
        <pre data-scm-plan-command className="m-0 rounded-sm border border-border bg-bg-raised px-2 py-1 font-mono text-ui-sm break-all whitespace-pre-wrap text-fg">
          {shellWords(plan.program, plan.argv)}
        </pre>
      </PlanRow>
      <p className="m-0 text-ui-sm text-fg-muted">{SCM_COPY.runsIn(plan.cwd)}</p>
    </>
  );
}

// Why there is no plan to confirm (main's refusal, a failed call, a field to fill), with the way out a refusal offers.
export function PlanProblem({ planned, action }: { planned: Planned; action?: ReactNode }) {
  if (planned.kind === 'planning') return <p className="m-0 text-ui-sm text-fg-muted">{SCM_COPY.planning}</p>;
  if (planned.kind === 'plan') return null;
  if (planned.kind === 'invalid') return <p className="m-0 text-ui-sm text-fg-muted">{planned.message}</p>;
  const notice: ScmNotice = planned.kind === 'error' ? { kind: 'error', text: planned.message, output: '' } : { kind: planned.refusal.refused, text: planned.refusal.detail, output: planned.refusal.output };
  return <SheetNote notice={notice} action={action} />;
}

export function SheetNote({ notice, action }: { notice: ScmNotice; action?: ReactNode }) {
  return (
    <div role="alert" data-scm-sheet-note={notice.kind} className="flex flex-col gap-1">
      <p className="m-0 text-ui-sm break-words text-danger">{noticeText(notice)}</p>
      {notice.output !== '' ? <PrintedOutput text={notice.output} /> : null}
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
