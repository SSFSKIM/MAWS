// The Open PR sheet (E6 execution document, Design §8): Title (HEAD's subject when the branch is one commit past the
// default base, else the branch name in words), Body (empty: the owner's open question, not prefilled), Base (the
// remote's HEAD branch, required) and Draft; main's plan for them, asked on open and again 300 ms after the last edit,
// shown as gh's repository (bound with `--repo`), the head and the exact command. Create sends only the plan's token,
// and stays off from the first edit until the plan answered is the one for the fields shown, so the token submitted is
// the plan shown (main also retires a superseded plan). The last plan stays in view, dimmed, while the next is asked.
// `not_pushed` offers Push first (the Push sheet in its place), `gh_missing` gh's install page, `gh_unauthenticated` a
// Terminal tool with `gh auth login` typed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, FIELD, PRIMARY, SECONDARY } from '../../sessions/ui';
import { openTerminal } from '../terminal';
import { SCM_COPY } from './copy';
import { PlanCommand, plannedOf, PlanProblem, PlanRow, PlanRows, SheetNote, useRunPlan, type Planned } from './plan-sheet';
import { prTitleDefault } from './remote-actions';
import { openLink, settled } from './store';
import type { ScmUi } from './view-state';

export const PR_REPLAN_MS = 300;

interface Fields {
  title: string;
  body: string;
  base: string;
  draft: boolean;
}

// The last plan answered and the fields it was asked for (null once the run spent its token: a fresh plan is due).
interface Answered {
  for: Fields | null;
  state: Planned;
}

export function PrSheet({ appSessionId, ui, status, scm, directory }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi>; status: GitStatus; scm: ScmStatus | undefined; directory: string }) {
  const branch = status.branch ?? ''; // the header opens the sheet only on a branch; main refuses a detached head
  const repoRoot = status.repoRoot;
  const defaultBase = scm?.defaultBase ?? null;
  const [fields, setFields] = useState<Fields | null>(null); // null until the title's default is read
  const [answered, setAnswered] = useState<Answered | null>(null);
  const asked = useRef(0);
  const first = useRef(true);
  const close = () => ui.setState({ sheet: null });

  // The title's default: HEAD's subject (C4's `git.log`) and the branch's distance from the main worktree's branch
  // (C10's `git.worktree.branch`); a failed read leaves the branch name.
  useEffect(() => {
    let live = true;
    void Promise.all([
      settled(ipc.invoke('git.log', { directory, limit: 1 })),
      branch === '' ? null : settled(ipc.invoke('git.worktree.branch', { repoRoot, branch })),
    ]).then(([log, distance]) => {
      if (!live) return;
      const subject = log.ok ? (log.value.commits[0]?.subject ?? null) : null;
      const title = prTitleDefault({ branch, defaultBase, branchStatus: distance?.ok ? distance.value : null, subject });
      setFields((current) => current ?? { title, body: '', base: defaultBase ?? '', draft: false });
    });
    return () => {
      live = false;
    };
  }, [directory, repoRoot, branch, defaultBase]);

  const plan = useCallback(
    async (asking: Fields) => {
      const ask = ++asked.current;
      const title = asking.title.trim();
      const base = asking.base.trim();
      const problem = title === '' ? SCM_COPY.needTitle : base === '' ? SCM_COPY.needBase : null;
      if (problem !== null) return setAnswered({ for: asking, state: { kind: 'invalid', message: problem } });
      const result = await settled(ipc.invoke('scm.pr.plan', { appSessionId, title, body: asking.body, base, draft: asking.draft }));
      if (ask === asked.current) setAnswered({ for: asking, state: plannedOf(result) }); // a newer ask supersedes it
    },
    [appSessionId],
  );
  // On open at once; after an edit, 300 ms after the last one.
  useEffect(() => {
    if (fields === null) return;
    const delay = first.current ? 0 : PR_REPLAN_MS;
    first.current = false;
    const timer = setTimeout(() => void plan(fields), delay);
    return () => clearTimeout(timer);
  }, [fields, plan]);

  const replan = () => {
    setAnswered((last) => (last === null ? null : { for: null, state: last.state }));
    if (fields !== null) void plan(fields);
  };
  const { submitting, note, run } = useRunPlan({ appSessionId, ui, replan });

  const edit = (change: Partial<Fields>) => setFields((current) => (current === null ? current : { ...current, ...change }));
  const current = answered !== null && fields !== null && answered.for === fields;
  const shown = answered?.state ?? { kind: 'planning' };
  const ready = current && shown.kind === 'plan' ? shown.plan : null;

  return (
    <Sheet title={SCM_COPY.prSheetTitle} width="w-[min(600px,92vw)]" onClose={close} data-scm-sheet="pr">
      <SheetForm canSubmit={ready !== null && !submitting} onSubmit={() => ready && void run(ready)} submitLabel={SCM_COPY.prSubmit} submitClass={PRIMARY}>
        <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
          {SCM_COPY.titleField}
          <input type="text" aria-label={SCM_COPY.titleField} maxLength={256} disabled={fields === null || submitting} value={fields?.title ?? ''} onChange={(event) => edit({ title: event.target.value })} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
          {SCM_COPY.bodyField}
          <textarea aria-label={SCM_COPY.bodyField} rows={4} maxLength={65536} disabled={fields === null || submitting} value={fields?.body ?? ''} onChange={(event) => edit({ body: event.target.value })} className={`${FIELD} resize-y`} />
        </label>
        <div className="flex items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-ui-sm text-fg-muted">
            {SCM_COPY.baseField}
            <input type="text" aria-label={SCM_COPY.baseField} maxLength={256} disabled={fields === null || submitting} value={fields?.base ?? ''} onChange={(event) => edit({ base: event.target.value })} className={`${FIELD} font-mono`} />
          </label>
          <label className="flex items-center gap-1.5 pb-1 text-ui-sm text-fg">
            <input type="checkbox" disabled={fields === null || submitting} checked={fields?.draft ?? false} onChange={(event) => edit({ draft: event.target.checked })} className={CHOICE} />
            {SCM_COPY.draftField}
          </label>
        </div>
        {note !== null ? <SheetNote notice={note} /> : null}
        <div aria-busy={!current} data-scm-plan-stale={current ? undefined : ''} className={`flex flex-col gap-2 ${current ? '' : 'opacity-60'}`}>
          {shown.kind === 'plan' ? (
            <PlanRows>
              <PlanRow name="repository" label={SCM_COPY.repository}>
                <span className="font-mono">{shown.plan.repository ?? ''}</span>
              </PlanRow>
              <PlanRow name="head" label={SCM_COPY.headRow}>
                <span className="font-mono">{shown.plan.branch}</span>
              </PlanRow>
              <PlanCommand plan={shown.plan} />
            </PlanRows>
          ) : (
            <PlanProblem planned={shown} action={refusalAction(shown, { appSessionId, directory, ui })} />
          )}
        </div>
      </SheetForm>
    </Sheet>
  );
}

// The way out a refusal offers, if any: Push first, the install page, or a terminal to sign in to gh.
function refusalAction(planned: Planned, { appSessionId, directory, ui }: { appSessionId: AppSessionId; directory: string; ui: StoreApi<ScmUi> }) {
  if (planned.kind !== 'refused') return null;
  const button = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={SECONDARY}>
      {label}
    </button>
  );
  switch (planned.refusal.refused) {
    case 'not_pushed':
      return button(SCM_COPY.pushFirst, () => ui.setState({ sheet: { kind: 'push' } }));
    case 'gh_missing':
      return button(SCM_COPY.installGh, () => openLink(SCM_COPY.ghInstallUrl));
    case 'gh_unauthenticated':
      return button(SCM_COPY.signInGh, () => {
        openTerminal({ appSessionId, cwd: directory, command: SCM_COPY.ghLoginCommand });
        ui.setState({ sheet: null });
      });
    default:
      return null;
  }
}
