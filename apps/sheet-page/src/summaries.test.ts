// The browser tab's title (F8) and which sessions the overview lists (§P's empty states).
import { describe, expect, it } from 'vitest';
import type { SheetSummary } from '@shared/sheet/model';
import { listed, titleOf } from './summaries';

const S = '5eed0000-0000-4000-8000-000000000019';
const T = '5eed0000-0000-4000-8000-0000000000a2';
const summary = (session: string, rest: Partial<SheetSummary> = {}): SheetSummary => ({ session, appSessionId: null, title: 'Winter timetable import', live: true, seq: 1, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false, ...rest });

describe('the tab’s title', () => {
  it('is the place, with the count of open questions without a queued answer before it', () => {
    const sessions = [summary(S, { open: 4, queued: 1 }), summary(T, { open: 5, live: false, title: 'Berth map redraw' })];
    expect(titleOf({ at: 'overview' }, sessions)).toBe('(9) Sheet');
    expect(titleOf({ at: 'sheet', session: S }, sessions)).toBe('(4) Winter timetable import · Sheet');
    expect(titleOf({ at: 'sheet', session: T }, sessions)).toBe('(5) Berth map redraw · Sheet');
  });

  it('carries no count when there is none, and no session’s name where the page knows none', () => {
    expect(titleOf({ at: 'overview' }, [summary(S, { queued: 2 })])).toBe('Sheet');
    expect(titleOf({ at: 'overview' }, null)).toBe('Sheet');
    expect(titleOf({ at: 'sheet', session: S }, [summary(S, { queued: 1 })])).toBe('Winter timetable import · Sheet');
    expect(titleOf({ at: 'sheet', session: T }, [summary(S, { open: 1 })])).toBe('Sheet');
    expect(titleOf({ at: 'sheet', session: S }, [summary(S, { open: 2, title: null })])).toBe('(2) Session 5eed0000 · Sheet');
  });
});

describe('the overview’s list', () => {
  it('holds a session with anything open, queued, accepted or hidden, or one it cannot read, as C3’s overview does', () => {
    expect(listed(summary(S))).toBe(false);
    for (const rest of [{ open: 1 }, { queued: 1 }, { pending: 1 }, { hidden: 1 }, { unreadable: true }]) expect(listed(summary(S, rest))).toBe(true);
  });
});
