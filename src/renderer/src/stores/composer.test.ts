import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import { DEFAULT_MEMORY_TARGET, IDLE_RESUBMIT, inlineEditOf, insertComposerText, isDocked, openComposerWidget, isStarting, markDocked, memoryTargetOf, prefillComposer, registerFocusTarget, resetComposerStore, resubmitOf, resubmitRecordOf, setInlineEdit, setInlineText, setMemoryTarget, setResubmit, setStarting, takePrefill, useComposerStore } from './composer';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const r1 = 'req-1' as RequestId;

beforeEach(() => resetComposerStore());

describe('composer store seam', () => {
  it('holds one prefill per session until the composer takes it', () => {
    prefillComposer(A, { text: 'first' });
    prefillComposer(A, { text: 'second' });
    expect(useComposerStore.getState().prefills.get(A)?.text).toBe('second'); // the latest replaces an untaken one
    expect(takePrefill(B)).toBeNull();
    expect(takePrefill(A)).toMatchObject({ text: 'second' });
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
    const first = { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn() };
    const second = { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn() };
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

  it('keeps the M4 state per session: starting, the bubble edited in place (W3) and the resubmit state', () => {
    setStarting(A, true);
    expect([isStarting(useComposerStore.getState(), A), isStarting(useComposerStore.getState(), B)]).toEqual([true, false]);
    setStarting(A, false);
    expect(isStarting(useComposerStore.getState(), A)).toBe(false);
    setInlineEdit(A, { messageUuid: 'u-1' as MessageUuid, seenCursor: 'u-2' as MessageUuid, kind: 'edit', text: 'turn two', pasted: [], images: [] });
    setInlineText(A, 'turn two edited');
    expect(inlineEditOf(useComposerStore.getState(), A)).toMatchObject({ messageUuid: 'u-1', seenCursor: 'u-2', text: 'turn two edited' });
    expect(inlineEditOf(useComposerStore.getState(), B)).toBeNull();
    setInlineEdit(A, null);
    expect(inlineEditOf(useComposerStore.getState(), A)).toBeNull();
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('idle');
    setResubmit(A, 'rewound_awaiting_send');
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('rewound_awaiting_send');
    expect(resubmitRecordOf(useComposerStore.getState(), A)).toEqual({ state: 'rewound_awaiting_send', exited: false, sendFailed: false, autoSend: false });
    setResubmit(A, { state: 'rewound_awaiting_send', sendFailed: true });
    expect(resubmitRecordOf(useComposerStore.getState(), A)).toMatchObject({ state: 'rewound_awaiting_send', sendFailed: true });
    setResubmit(A, { state: 'idle', exited: true }); // an idle state that still says something is kept
    expect(resubmitRecordOf(useComposerStore.getState(), A)).toMatchObject({ state: 'idle', exited: true });
    setResubmit(A, 'idle');
    expect(useComposerStore.getState().resubmit.has(A)).toBe(false);
    expect(resubmitRecordOf(useComposerStore.getState(), B)).toEqual(IDLE_RESUBMIT);
  });

  it('inserts text through the mounted composer of the session', () => {
    const target = { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn() };
    const off = registerFocusTarget(A, target);
    insertComposerText(A, '@agent-Explore ');
    expect(target.insertText).toHaveBeenCalledWith('@agent-Explore ');
    off();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertComposerText(A, 'nowhere');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// C11 start: opening a widget over a session's mounted composer (the context widget's Compact…, Session info's actions)
describe('openComposerWidget', () => {
  it("asks the session's mounted composer to open the widget with the argument, and answers whether it did", () => {
    const target = { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn(), openWidget: vi.fn(() => true) };
    const off = registerFocusTarget(A, target);
    expect(openComposerWidget(A, 'compact', 'focus on tests')).toBe(true);
    expect(target.openWidget).toHaveBeenCalledWith('compact', 'focus on tests');
    off();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(openComposerWidget(A, 'compact', '')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
// C11 end
