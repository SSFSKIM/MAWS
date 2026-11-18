import { describe, expect, it } from 'vitest';
import type { AttentionId } from '@shared/graph/ids';
import { item } from '../../../../../test/support/builders';
import { askItemFor, askOpened, itemFor, permission, syntheticRequest } from '../../request-card/test-requests';
import { noticeOf } from './swap';

const A = 'app-a';
const none = { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } };

// UX wave U1b (decision 14): what the composer shows above itself is the oldest waiting notice that names no request; a
// request is drawn in the session's transcript, never here and never in the editor's place.
describe('the notice above the composer', () => {
  it('is the oldest open notice that names no request: an error, an interruption, auto mode unavailable', () => {
    const error = item(A, 'error', '2026-09-29T09:10:00.000Z', { ...none, id: 'a:error:1' as AttentionId });
    const interrupted = item(A, 'interrupted', '2026-09-29T09:05:00.000Z', { ...none, id: 'a:interrupted:1' as AttentionId });
    const auto = item(A, 'auto_mode_unavailable', '2026-09-29T09:00:00.000Z', { ...none, id: 'a:auto:1' as AttentionId });
    expect(noticeOf([error, interrupted, auto])?.id).toBe(auto.id);
    expect(noticeOf([error, interrupted])?.id).toBe(interrupted.id);
    expect(noticeOf([error])?.id).toBe(error.id);
  });

  it('is never a request, whatever its kind and whether or not it was read: the transcript draws it', () => {
    const requests = [
      itemFor(permission(), A),
      itemFor({ ...permission(), kind: 'question.requested', questions: [] } as never, A),
      itemFor(syntheticRequest('undeclared-dialog'), A), // drawn at the end, with the card's own words
      itemFor(syntheticRequest('refusal-fallback-dialog'), A),
      askItemFor(askOpened({ at: '2026-09-29T08:00:00.000Z' }), A), // a blocking ask: its row's form
      item(A, 'async_input', '2026-09-29T09:00:00.000Z', { id: 'lane-a:eng-1:toolu_q' as AttentionId, request: { requestId: 'toolu_q' as never, toolUseId: 'toolu_q' as never, taskId: null, agentId: null } }),
    ];
    expect(noticeOf(requests)).toBeNull();
    const error = item(A, 'error', '2026-09-29T10:00:00.000Z', { ...none, id: 'a:error:2' as AttentionId });
    expect(noticeOf([...requests, error])?.id).toBe(error.id);
  });

  it('is no owner-channel question and no must-read: they stand in the transcript (P2-C)', () => {
    const anchor = { anchor: { messageUuid: 'm-1' as never, blockIndex: 0, span: 0 } };
    expect(noticeOf([item(A, 'async_input', '2026-09-29T08:00:00.000Z', { ...none, ...anchor }), item(A, 'essential_unread', '2026-09-29T08:01:00.000Z', { ...none, ...anchor })])).toBeNull();
  });

  // The owner's ruling (2026-10-30; it withdraws E11 F2b's kept notice): an error seen or dismissed is no notice, only an
  // unseen one is
  it('shows an open error as the notice and none once it is seen or dismissed', () => {
    const seenBefore = item(A, 'error', '2026-09-29T09:00:00.000Z', { ...none, id: 'a:error:1' as AttentionId, state: 'confirmed' }); // a store's from before the ruling
    const retired = item(A, 'error', '2026-09-29T08:00:00.000Z', { ...none, id: 'a:error:0' as AttentionId, state: 'retired' });
    const fresh = item(A, 'error', '2026-09-29T10:00:00.000Z', { ...none, id: 'a:error:2' as AttentionId });
    expect(noticeOf([seenBefore, retired])).toBeNull();
    expect(noticeOf([seenBefore, retired, fresh])?.id).toBe(fresh.id);
  });
});
