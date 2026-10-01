// The memory budget's two sheets (C12 execution document, Interfaces "Surfaces of the budget"; charter §4.4, D1): the
// banner's Review… lists every live session holding work, with why, and each one's Stop…; Stop… confirms in the pattern
// of C10's archive sheet (title, what stop does, C10's disclosure of the background work it would end, Stop and
// Cancel) and calls `session.stop { reason: 'stop' }`. C10 ships no standalone stop, so this sheet is the per-session
// stop D1 names. Nothing is stopped unasked; Cancel goes back to the list. Built on C10's `Sheet`, tokens only. W7: never
// while the host reports the budget off.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { BackgroundWorkDisclosure } from '../sessions/BackgroundWorkDisclosure';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { DANGER, QUIET, SECONDARY } from '../sessions/ui';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { BUDGET, reasonWords } from './copy';
import { useBudget } from './store';

export function BudgetSheets({ client = ipc }: { client?: MawsBridge }) {
  const sheet = useBudget((s) => s.sheet);
  const off = useBudget((s) => s.state?.enabled === false); // W7
  if (sheet === null || off) return null;
  return sheet.kind === 'blocked' ? <BlockedSessionsSheet /> : <StopSessionSheet key={sheet.appSessionId} appSessionId={sheet.appSessionId} client={client} />;
}

const titleOf = (appSessionId: AppSessionId) => useSessions.getState().records.get(appSessionId)?.title.text ?? appSessionId;

export function BlockedSessionsSheet() {
  const state = useBudget((s) => s.state);
  const statuses = useSessions((s) => s.engine);
  const records = useSessions((s) => s.records);
  const stateful = new Set(useSettings((s) => s.state?.settings.engine.statefulMcpServers) ?? []);
  const close = () => useBudget.getState().close();
  const blocked = state?.blocked ?? [];
  return (
    <Sheet title={BUDGET.blockedTitle} width="w-[min(560px,92vw)]" onClose={close} data-budget-sheet="blocked">
      {state && <p className="m-0 mb-2 text-fg-muted">{BUDGET.blockedBody(state.totalKiB, state.limitKiB)}</p>}
      {blocked.length === 0 ? (
        <p className="m-0 text-fg-muted">{BUDGET.noneBlocked}</p>
      ) : (
        <ul aria-label={BUDGET.blockedTitle} className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
          {blocked.map(({ appSessionId, reasons }) => {
            const title = records.get(appSessionId)?.title.text ?? appSessionId;
            const status = statuses.get(appSessionId) ?? null;
            return (
              <li key={appSessionId} aria-label={title} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-fg">{title}</span>
                  <span className="truncate text-ui-sm text-fg-muted">{reasons.map((reason) => reasonWords(reason, status, stateful)).join(' · ')}</span>
                </div>
                <button type="button" onClick={() => useBudget.getState().open({ kind: 'stop', appSessionId })} className={QUIET}>
                  {BUDGET.stop}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={close} className={SECONDARY}>
          {BUDGET.close}
        </button>
      </div>
    </Sheet>
  );
}

export function StopSessionSheet({ appSessionId, client }: { appSessionId: AppSessionId; client: MawsBridge }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => useBudget.getState().open({ kind: 'blocked' });
  const submit = async () => {
    setBusy(true);
    const result = await client.invoke('session.stop', { appSessionId, reason: 'stop' });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    useBudget.getState().close();
  };
  return (
    <Sheet title={BUDGET.stopTitle(titleOf(appSessionId))} onClose={back} data-budget-sheet="stop">
      <SheetForm canSubmit={!busy} onSubmit={() => void submit()} submitLabel={BUDGET.stopConfirm} submitClass={DANGER} cancelLabel={BUDGET.cancel}>
        <p className="m-0 text-fg-muted">{BUDGET.stopBody}</p>
        <BackgroundWorkDisclosure appSessionId={appSessionId} />
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
