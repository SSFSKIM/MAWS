// The question sheet's C3 M4 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; S10): a sheet item is
// one attention item per open question that has no queued answer, told apart from every other item by its id, bare on
// the spine and lifted to an address in a window. Every id, name and sentence is invented.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import { addressOf } from '../machine/address';
import type { MachineRef } from '../machine/ref';
import type { SheetModel, SheetQuestion } from '../sheet/model';
import { isSheetItem, questionOfItem, sheetItemId, sheetItemsOf, SHEET_ITEM_PREFIX } from './sheet-item';

const SESSION = '5eed0000-0000-4000-8000-000000000042';
const APP = 'app-sheet-1' as AppSessionId;
const MACHINE = 'machine-ref-0000000001' as MachineRef;

function question(id: string, over: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    id, revision: 1, asker: 'main', question: 'The import stops at the first clash. Which sailing should it keep?', options: [{ label: 'Earlier' }, { label: 'Later' }],
    multiSelect: false, askedAt: '2026-11-24T10:00:00.000Z', callId: 'toolu_call_1', references: [], handle: id, ...over,
  } as SheetQuestion;
}
const model = (open: SheetQuestion[]): SheetModel => ({ v: 1, session: SESSION, seq: 3, open, hidden: [], sent: [], pending: [], closed: {} }) as SheetModel;

describe('a sheet item’s id', () => {
  it('is `sheet:<session>:<question>`, read back bare and as the address a window holds', () => {
    const id = sheetItemId(SESSION, 'q7');
    expect(id).toBe(`${SHEET_ITEM_PREFIX}${SESSION}:q7`);
    expect(isSheetItem(id)).toBe(true);
    expect(questionOfItem(id)).toEqual({ session: SESSION, questionId: 'q7' });
    const lifted = addressOf(MACHINE, id);
    expect(isSheetItem(lifted)).toBe(true);
    expect(questionOfItem(lifted)).toEqual({ session: SESSION, questionId: 'q7' });
  });

  it('holds for no other item, bare or lifted', () => {
    for (const id of ['lane-a:abc:req-1', 'app-1:error:turn-1', `${APP}:async_input:mark`, 'sheet', 'sheet:', `sheet:${SESSION}`, `sheet:not-a-session:q1`, `sheet:${SESSION}:x1`]) {
      expect(isSheetItem(id), id).toBe(false);
      expect(isSheetItem(addressOf(MACHINE, id)), `lifted ${id}`).toBe(false);
      expect(questionOfItem(id), id).toBeNull();
    }
  });
});

describe('sheetItemsOf', () => {
  it('is one calm `async_input` item per open question without a queued answer, at its asking, with the sentence that asks', () => {
    const queued = { key: 'maws-k-0001', kind: 'answer' as const, picks: ['Earlier'], text: '', images: [], revision: 1, by: 'maws' as const };
    const items = sheetItemsOf(APP, model([
      question('q1'),
      question('q2', { queued }),
      question('q3', { asker: { agentId: 'agent-7', name: 'reviewer' }, callId: 'toolu_call_2', askedAt: '2026-11-24T10:05:00.000Z', question: 'May I replace the old fixture?' }),
    ]));
    expect(items).toEqual([
      {
        id: sheetItemId(SESSION, 'q1'), appSessionId: APP, sessionId: SESSION, kind: 'async_input',
        request: { requestId: 'q1', toolUseId: 'toolu_call_1', taskId: null, agentId: null },
        summary: 'Which sailing should it keep?', createdAt: '2026-11-24T10:00:00.000Z', state: 'pending', stateChangedAt: '2026-11-24T10:00:00.000Z', expiresAt: null,
      },
      {
        id: sheetItemId(SESSION, 'q3'), appSessionId: APP, sessionId: SESSION, kind: 'async_input',
        request: { requestId: 'q3', toolUseId: 'toolu_call_2', taskId: null, agentId: 'agent-7' },
        summary: 'May I replace the old fixture?', createdAt: '2026-11-24T10:05:00.000Z', state: 'pending', stateChangedAt: '2026-11-24T10:05:00.000Z', expiresAt: null,
      },
    ]);
  });
});
