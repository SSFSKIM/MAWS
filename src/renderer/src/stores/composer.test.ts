import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import { DEFAULT_MEMORY_TARGET, isDocked, markDocked, memoryTargetOf, prefillComposer, registerFocusTarget, resetComposerStore, setMemoryTarget, takePrefill, useComposerStore } from './composer';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const r1 = 'req-1' as RequestId;

beforeEach(() => resetComposerStore());

describe('composer store seam', () => {
  it('holds one prefill per session until the composer takes it', () => {
    prefillComposer(A, { text: 'first', editing: null });
    prefillComposer(A, { text: 'second', editing: { messageUuid: 'u-1' as MessageUuid, seenCursor: 'u-1' as MessageUuid } });
    expect(useComposerStore.getState().prefills.get(A)?.text).toBe('second'); // the latest replaces an untaken one
    expect(takePrefill(B)).toBeNull();
    expect(takePrefill(A)).toMatchObject({ text: 'second', editing: { messageUuid: 'u-1' } });
    expect(takePrefill(A)).toBeNull();
  });

  it('counts docked placements of a request, so one of two unmounting leaves it docked', () => {
    const one = markDocked(A, r1);
    const two = markDocked(A, r1);
    expect(isDocked(useComposerStore.getState(), A, r1)).toBe(true);
    expect(isDocked(useComposerStore.getState(), B, r1)).toBe(false);
    one();
    one(); // a disposer releases once
    expect(isDocked(useComposerStore.getState(), A, r1)).toBe(true);
    two();
    expect(isDocked(useComposerStore.getState(), A, r1)).toBe(false);
  });

  it('keeps the focus target a composer registers, and its disposer removes only its own', () => {
    const first = { focusEditor: vi.fn(), focusFrame: vi.fn() };
    const second = { focusEditor: vi.fn(), focusFrame: vi.fn() };
    const offFirst = registerFocusTarget(A, first);
    const offSecond = registerFocusTarget(A, second);
    offFirst();
    expect(useComposerStore.getState().focusTargets.get(A)).toBe(second);
    offSecond();
    expect(useComposerStore.getState().focusTargets.has(A)).toBe(false);
  });

  it('remembers the # target per session, the project file by default', () => {
    expect(memoryTargetOf(useComposerStore.getState(), A)).toEqual(DEFAULT_MEMORY_TARGET);
    setMemoryTarget(A, { kind: 'path', path: '/repo/docs/CLAUDE.md' });
    expect(memoryTargetOf(useComposerStore.getState(), A)).toEqual({ kind: 'path', path: '/repo/docs/CLAUDE.md' });
    expect(memoryTargetOf(useComposerStore.getState(), B)).toEqual({ kind: 'project', path: null });
  });
});
