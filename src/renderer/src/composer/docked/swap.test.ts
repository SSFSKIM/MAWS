import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AttentionId } from '@shared/graph/ids';
import { item } from '../../../../../test/support/builders';
import { itemFor, permission, syntheticRequest } from '../../request-card/test-requests';
import { swapOf } from './swap';

const A = 'app-a';

describe('the docked swap takes the oldest answerable request, once it is read', () => {
  it('docks the oldest read request, counts the rest, and reads the unread first', () => {
    const older = permission({ requestId: 'req-1' as never, at: '2026-09-29T09:00:00.000Z' });
    const newer = permission({ requestId: 'req-2' as never, at: '2026-09-29T09:05:00.000Z' });
    const unread = permission({ requestId: 'req-3' as never, at: '2026-09-29T08:00:00.000Z' });
    const items = [itemFor(newer, A), itemFor(older, A), itemFor(unread, A)];
    const requests = new Map<AttentionId, SessionEvent | null>([
      [items[0].id, newer],
      [items[1].id, older],
    ]);
    const swap = swapOf(items, requests);
    expect(swap.item?.id).toBe(items[1].id);
    expect(swap.waiting).toBe(1);
    expect(swap.unread.map((i) => i.id)).toEqual([items[2].id]); // the oldest waits until its request is read
  });

  it('never swaps for an undeclared dialog or a notice: those show above the frame', () => {
    const undeclared = syntheticRequest('undeclared-dialog');
    const dialog = itemFor(undeclared, A);
    const error = item(A, 'error', '2026-09-29T09:10:00.000Z', { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const swap = swapOf([dialog, error], new Map<AttentionId, SessionEvent | null>([[dialog.id, undeclared]]));
    expect(swap.item).toBeNull();
    expect(swap.notice?.id).toBe(dialog.id);
    const declared = syntheticRequest('refusal-fallback-dialog');
    const answerable = itemFor(declared, A);
    expect(swapOf([answerable], new Map([[answerable.id, declared as SessionEvent]])).item?.id).toBe(answerable.id);
  });

  it('shows a request main no longer holds as a notice, never in the editor’s place, whatever its kind', () => {
    const kinds = [permission(), { ...permission(), kind: 'question.requested', questions: [] }, syntheticRequest('refusal-fallback-dialog')] as SessionEvent[];
    for (const event of kinds) {
      const gone = itemFor(event as never, A);
      const swap = swapOf([gone], new Map<AttentionId, SessionEvent | null>([[gone.id, null]])); // attention.request answered null
      expect(swap.item).toBeNull();
      expect(swap.notice?.id).toBe(gone.id);
      expect(swap.waiting).toBe(0);
    }
  });

  it('keeps an answered request docked (collapsed) until it retires', () => {
    const event = permission();
    const delivered = itemFor(event, A, { state: 'delivered' });
    expect(swapOf([delivered], new Map([[delivered.id, event as SessionEvent]])).item?.id).toBe(delivered.id);
    expect(swapOf([itemFor(event, A, { state: 'retired' })], new Map()).item).toBeNull();
  });
});
