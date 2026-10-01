// The memory budget as the page sees it (C12 execution document, Interfaces "X2 additions" and "Surfaces of the
// budget"): the engine host's `BudgetState` from the `engine.budget` event (subscribed first, then the command's
// snapshot, C1's ordering rule, read again at every host generation), the app-wide banner, and which of the budget's
// two sheets is open.
//
// The banner follows the host's own debounced flag (`overWithoutCandidate`, two consecutive samples over budget with no
// candidate); the page never counts samples. It is posted once per crossing (the flag turning true), through C5's
// banner host; dismissed, it stays dismissed until the next crossing; it goes when the flag clears.
//
// W7: a state whose `enabled` is false is the budget switched off in settings: no banner, and an open sheet closes
// (BudgetSheets renders nothing while it is off). Session info still reads the totals from the same state.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { ipc } from '../ipc/client';
import { useNotices } from '../stores/notices';
import { BUDGET } from './copy';

export const BUDGET_BANNER_ID = 'budget:over';

export type BudgetSheet = { kind: 'blocked' } | { kind: 'stop'; appSessionId: AppSessionId };

export interface BudgetStore {
  state: BudgetState | null;
  sheet: BudgetSheet | null;
  apply(state: BudgetState): void;
  open(sheet: BudgetSheet): void;
  close(): void;
}

export const useBudget = create<BudgetStore>()((set) => ({
  state: null,
  sheet: null,
  apply: (state) => set((s) => ({ state, sheet: state.enabled ? s.sheet : null })), // W7: off closes a sheet
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}));

export function resetBudgetStore(): void {
  useBudget.setState({ state: null, sheet: null });
}

// Posts, updates or withdraws the banner for a new state; `previous` is the state before it.
function syncBanner(previous: BudgetState | null, next: BudgetState): void {
  const notices = useNotices.getState();
  const shown = notices.notices.some((n) => n.id === BUDGET_BANNER_ID);
  if (!next.enabled || !next.overWithoutCandidate) { // W7: never while the budget is off
    if (shown) notices.dismiss(BUDGET_BANNER_ID);
    return;
  }
  const crossing = previous === null || !previous.overWithoutCandidate;
  if (!crossing && !shown) return; // dismissed during this crossing
  notices.banner({
    id: BUDGET_BANNER_ID,
    level: 'warning',
    text: BUDGET.banner(next.blocked.length),
    actions: [{ label: BUDGET.review, run: () => useBudget.getState().open({ kind: 'blocked' }) }],
    dismissible: true,
  });
}

// Follows the engine host's generations (its `engine.hostState` transitions): each time the host is ready its snapshot
// is read again (a startup read the host refused, or a restarted host, which starts with no sessions and may never emit
// an event), an event of that generation winning over its snapshot; when the host goes away, its state and banner go
// with it.
export function connectBudget(client: MawsBridge = ipc): () => void {
  let live = true;
  let generation = 0;
  let snapshotPending = true; // the current generation has heard no event yet
  const apply = (next: BudgetState) => {
    const previous = useBudget.getState().state;
    useBudget.getState().apply(next);
    syncBanner(previous, next);
  };
  const read = () => {
    const asked = generation;
    void client.invoke('engine.budget', undefined).then((result) => {
      if (!live || asked !== generation || !snapshotPending) return;
      if (result.ok) apply(result.value);
      else console.warn('[budget] engine.budget unavailable', result.error);
    });
  };
  const offs = [
    client.on('engine.budget', (state) => {
      if (!live) return;
      snapshotPending = false; // an event is newer than any snapshot still on its way
      apply(state);
    }),
    client.on('engine.hostState', (host) => {
      if (!live) return;
      generation += 1;
      snapshotPending = true;
      if (host.state === 'ready') return read();
      useBudget.setState({ state: null }); // the host took its sessions and their budget with it
      useNotices.getState().dismiss(BUDGET_BANNER_ID);
    }),
  ];
  read();
  return () => {
    live = false;
    offs.forEach((off) => off());
  };
}
