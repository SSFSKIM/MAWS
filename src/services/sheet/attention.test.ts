// The question sheet's C3 M4 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H): the sheet items the
// spine feeds the attention list from the service's announcements, each from the model the service last verified, for
// the app session the record joins, cleared from the one it no longer joins. Every id, name and sentence is invented.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SheetModel, SheetQuestion, SheetSummary } from '@shared/sheet/model';
import { sheetItemId } from '@shared/attention/sheet-item';
import { feedSheetItems } from './attention';
import type { SheetListener } from './service';

const S1 = '5eed0000-0000-4000-8000-000000000101';
const S2 = '5eed0000-0000-4000-8000-000000000102';
const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

const question = (id: string): SheetQuestion =>
  ({ id, revision: 1, asker: 'main', question: `Which way for ${id}?`, options: [], multiSelect: false, askedAt: '2026-11-24T10:00:00.000Z', callId: 'toolu_1', references: [], handle: id }) as SheetQuestion;
const model = (session: string, ids: string[]): SheetModel => ({ v: 1, session, seq: 1, open: ids.map(question), hidden: [], sent: [], pending: [], closed: {} }) as SheetModel;
const summary = (session: string, appSessionId: AppSessionId | null, live: boolean | null = true): SheetSummary => ({
  session, appSessionId, title: null, live, seq: 1, open: 1, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false,
});

function harness() {
  const models = new Map<string, SheetModel | null>();
  let listener: SheetListener | null = null;
  const told: [AppSessionId, string[]][] = [];
  const off = feedSheetItems(
    { onChange: (l) => ((listener = l), () => (listener = null)), verified: (session) => models.get(session) ?? null },
    (appSessionId, items: AttentionItem[]) => told.push([appSessionId, items.map((item) => item.id)]),
  );
  const change = (session: string, now: SheetSummary | null, was: SheetSummary | null, next?: SheetModel | null) => {
    if (next !== undefined) models.set(session, next);
    listener!(now, session, was);
  };
  return { told, change, off, listening: () => listener !== null };
}

describe('feedSheetItems', () => {
  it('tells an app session its open questions at each change of its record, a stopped session’s too, and none once the record goes', () => {
    const { told, change } = harness();
    change(S1, summary(S1, A), null, model(S1, ['q1', 'q2']));
    change(S1, summary(S1, A, false), summary(S1, A), model(S1, ['q2']));
    change(S1, null, summary(S1, A, false), null);
    expect(told).toEqual([
      [A, [sheetItemId(S1, 'q1'), sheetItemId(S1, 'q2')]],
      [A, [sheetItemId(S1, 'q2')]],
      [A, []],
    ]);
  });

  it('tells nothing for a record no session of the index holds, and the session that gains it its questions', () => {
    const { told, change } = harness();
    change(S1, summary(S1, null), null, model(S1, ['q1']));
    expect(told).toEqual([]);
    change(S1, summary(S1, A), summary(S1, null));
    expect(told).toEqual([[A, [sheetItemId(S1, 'q1')]]]);
  });

  it('clears the app session a record no longer joins, and keeps another record of that session', () => {
    const { told, change } = harness();
    change(S1, summary(S1, A), null, model(S1, ['q1']));
    change(S2, summary(S2, A), null, model(S2, ['q3']));
    expect(told.at(-1)).toEqual([A, [sheetItemId(S1, 'q1'), sheetItemId(S2, 'q3')]]);
    change(S1, summary(S1, B), summary(S1, A));
    expect(told.slice(-2)).toEqual([
      [A, [sheetItemId(S2, 'q3')]],
      [B, [sheetItemId(S1, 'q1')]],
    ]);
    change(S2, summary(S2, null), summary(S2, A));
    expect(told.at(-1)).toEqual([A, []]);
  });

  it('reads an unreadable record as no questions, and stops listening when stopped', () => {
    const { told, change, off, listening } = harness();
    change(S1, { ...summary(S1, A), unreadable: true }, null, null);
    expect(told).toEqual([[A, []]]);
    off();
    expect(listening()).toBe(false);
  });
});
