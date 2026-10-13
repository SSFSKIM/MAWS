import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import { DEFAULT_MEMORY_TARGET, IDLE_RESUBMIT, inlineEditOf, insertComposerText, isDocked, openComposerWidget, isStarting, markDocked, memoryTargetOf, prefillComposer, queueComposerAttachment, registerFocusTarget, resetComposerStore, resubmitOf, resubmitRecordOf, setInlineEdit, setInlineText, setMemoryTarget, setResubmit, setStarting, takePrefill, useComposerStore } from './composer';

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
    setInlineEdit(A, { messageUuid: 'u-1' as MessageUuid, seenCursor: 'u-2' as MessageUuid, kind: 'edit', text: 'turn two', bodies: {}, images: [] });
    setInlineText(A, 'turn two edited');
    expect(inlineEditOf(useComposerStore.getState(), A)).toMatchObject({ messageUuid: 'u-1', seenCursor: 'u-2', text: 'turn two edited' });
    expect(inlineEditOf(useComposerStore.getState(), B)).toBeNull();
    setInlineEdit(A, null);
    expect(inlineEditOf(useComposerStore.getState(), A)).toBeNull();
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('idle');
    setResubmit(A, 'rewound_awaiting_send');
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('rewound_awaiting_send');
    expect(resubmitRecordOf(useComposerStore.getState(), A)).toEqual({ state: 'rewound_awaiting_send', exited: false, sendFailed: false, autoSend: false, sending: false });
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

// P3-G (§D4.3, the M4 review's rulings): Mark-up's attachment for a session with no composer able to take it waits in a
// per-session queue, which a composer drains into its draft when it registers (adding, never replacing); what it
// refuses stays queued, in order, for the next one.
describe('queueComposerAttachment', () => {
  const file = (name: string) => new File(['x'], name, { type: 'image/png' });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const target = (accepts: () => boolean, log: string[]) => ({
    focusEditor: vi.fn(),
    focusFrame: vi.fn(),
    insertText: (text: string) => void log.push(`text ${text}`),
    attachFiles: async (files: File[]) => {
      const taken = accepts();
      log.push(`${taken ? 'took' : 'refused'} ${files.map((f) => f.name).join(',')}`);
      return taken;
    },
  });

  it('waits for a composer of the session, which takes each in order, its files then its text', async () => {
    queueComposerAttachment(A, { files: [file('one.png')], text: 'Mark-up of one ' });
    queueComposerAttachment(A, { files: [file('two.png')], text: 'Mark-up of two ' });
    expect(useComposerStore.getState().attachmentQueue.get(A)).toHaveLength(2);
    const log: string[] = [];
    registerFocusTarget(B, target(() => true, log)); // another session's composer takes nothing of A's
    await settle();
    expect(log).toEqual([]);
    registerFocusTarget(A, target(() => true, log));
    await settle();
    expect(log).toEqual(['took one.png', 'text Mark-up of one ', 'took two.png', 'text Mark-up of two ']);
    expect(useComposerStore.getState().attachmentQueue.has(A)).toBe(false);
  });

  it('keeps what a busy composer refused, ahead of anything queued since, for the next registration', async () => {
    queueComposerAttachment(A, { files: [file('one.png')], text: 'one ' });
    queueComposerAttachment(A, { files: [file('two.png')], text: 'two ' });
    const log: string[] = [];
    let busy = true;
    const off = registerFocusTarget(A, target(() => !busy, log));
    await settle();
    expect(log).toEqual(['refused one.png']);
    off();
    queueComposerAttachment(A, { files: [file('three.png')], text: 'three ' });
    expect(useComposerStore.getState().attachmentQueue.get(A)?.map((q) => q.text)).toEqual(['one ', 'two ', 'three ']);
    busy = false;
    registerFocusTarget(A, target(() => !busy, log));
    await settle();
    expect(log.slice(1)).toEqual(['took one.png', 'text one ', 'took two.png', 'text two ', 'took three.png', 'text three ']);
  });

  it('goes straight to a composer that is mounted when it is queued (the one that took over from a composer gone mid-attach)', async () => {
    const log: string[] = [];
    registerFocusTarget(A, target(() => true, log));
    queueComposerAttachment(A, { files: [file('late.png')], text: 'late ' });
    await settle();
    expect(log).toEqual(['took late.png', 'text late ']);
    expect(useComposerStore.getState().attachmentQueue.has(A)).toBe(false);
  });

  it('is left alone by a focus target that cannot attach files', async () => {
    queueComposerAttachment(A, { files: [file('one.png')], text: 'one ' });
    registerFocusTarget(A, { focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn() });
    await settle();
    expect(useComposerStore.getState().attachmentQueue.get(A)).toHaveLength(1);
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
