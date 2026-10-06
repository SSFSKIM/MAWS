// C12: Session info's two memory-budget lines (C12 execution document, Interfaces "Surfaces of the budget").
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { digest } from '../../../../../test/support/builders';
import { budgetRows } from './model';

const GiB = 1024 * 1024;
const A = 'app-a' as AppSessionId;
const state = (over: Partial<BudgetState> = {}): BudgetState => ({
  enabled: true, limitKiB: 8 * GiB, totalKiB: Math.round(3.1 * GiB), sampledAt: null, over: false, overWithoutCandidate: false, candidates: 5, settling: 1, releasing: null,
  blocked: [{ appSessionId: A, reasons: ['turn'] }, { appSessionId: 'app-b' as AppSessionId, reasons: ['busy'] }, { appSessionId: 'app-c' as AppSessionId, reasons: ['pending_request'] }],
  lastRelease: null, ...over,
});

describe("Session info's memory budget lines", () => {
  it('reads the budget as the sum of the live trees against the limit, with the live sessions counted', () => {
    expect(budgetRows(state(), digest(A))).toEqual([{ label: 'Memory budget', value: '3.1 GB of 8 GB · 9 sessions' }]);
  });

  it('reads the sum and the live sessions without a limit while the budget is off (W7)', () => {
    expect(budgetRows(state({ enabled: false }), digest(A))).toEqual([{ label: 'Memory budget', value: 'Off · 3.1 GB · 9 sessions' }]);
  });

  it('reads — before the host has answered', () => {
    expect(budgetRows(null, null)).toEqual([{ label: 'Memory budget', value: '—' }]);
  });

  it('says when and why a released session was released', () => {
    const at = new Date(2026, 8, 29, 14, 2).toISOString();
    expect(budgetRows(state(), digest(A, { released: { at, reason: 'budget', limitKiB: 8 * GiB } }))).toEqual([
      { label: 'Memory budget', value: '3.1 GB of 8 GB · 9 sessions' },
      { label: 'Process', value: 'Released at 14:02 to stay under 8 GB' },
    ]);
  });

  // E10: the supervisor's idle release, while no app was connected, has no limit and its own words
  it('says when a session was stopped while idle', () => {
    const at = new Date(2026, 9, 6, 14, 2).toISOString();
    expect(budgetRows(state(), digest(A, { released: { at, reason: 'idle', limitKiB: null } }))[1]).toEqual({ label: 'Process', value: 'Stopped at 14:02 while idle' });
  });
});
