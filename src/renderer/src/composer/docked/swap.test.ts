import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AttentionId } from '@shared/graph/ids';
import { item } from '../../../../../test/support/builders';
import { askItemFor, askOpened, itemFor, permission, syntheticRequest } from '../../request-card/test-requests';
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

  // E1 M4b: the Question sheet answers an ask, not the composer, so its item never takes the editor's place
  it('shows a blocking ask as a notice above the frame, leaving the editor and any request to dock', () => {
    const ask = askOpened({ at: '2026-09-29T08:00:00.000Z' });
    const asked = askItemFor(ask, A);
    const event = permission();
    const approval = itemFor(event, A);
    const swap = swapOf([asked, approval], new Map<AttentionId, SessionEvent | null>([[asked.id, ask], [approval.id, event]]));
    expect(swap.notice?.id).toBe(asked.id);
    expect(swap.item?.id).toBe(approval.id);
    expect(swap.waiting).toBe(0);
    expect(swapOf([asked], new Map<AttentionId, SessionEvent | null>([[asked.id, ask]]))).toMatchObject({ item: null, notice: { id: asked.id }, waiting: 0 });
  });

  // E11 F2b (plan 2.4): an error seen in its session (confirmed) keeps its notice there until it is dismissed (retired)
  // or the next turn retires it; an error still open comes first
  it('keeps a seen error as the notice, drops a dismissed one, and puts an open one first', () => {
    const none = { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } };
    const seen = item(A, 'error', '2026-09-29T09:00:00.000Z', { ...none, id: 'a:error:1' as AttentionId, state: 'confirmed' });
    const dismissed = item(A, 'error', '2026-09-29T08:00:00.000Z', { ...none, id: 'a:error:0' as AttentionId, state: 'retired' });
    const fresh = item(A, 'error', '2026-09-29T10:00:00.000Z', { ...none, id: 'a:error:2' as AttentionId });
    const requests = new Map<AttentionId, SessionEvent | null>();
    expect(swapOf([seen, dismissed], requests).notice?.id).toBe(seen.id);
    expect(swapOf([dismissed], requests).notice).toBeNull();
    expect(swapOf([seen, fresh], requests).notice?.id).toBe(fresh.id);
    expect(swapOf([item(A, 'question', '2026-09-29T09:00:00.000Z', { state: 'confirmed' })], requests).notice, 'only an error stays once seen').toBeNull();
  });
});
