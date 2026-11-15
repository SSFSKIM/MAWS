// The docked placement's chrome, focus and keys (C7 execution document, Composer public surface; §5.7): C10's trust,
// relay-down and failed-start cards render inside this frame, so they take focus, give it back and answer Enter and Esc
// under exactly one set of rules (UX wave U1b: no request docks; a request is drawn in its session's transcript). The
// frame root is focusable (tabIndex -1) and takes focus on mount when its pane held focus; on unmount, if focus was
// inside the frame, it goes back to the session's composer (the focus target a mounted composer registers), else to
// what held it before, unless the session's next docked frame mounts in the same commit, which takes it instead. Enter
// and Esc are `request.accept` and `request.decline` bound `within` the frame root, so C5's dispatcher delivers them
// only while the frame itself holds focus: never from a textarea, a button or another pane. A null handler leaves its
// key unbound.
// UX wave U1a (§D): a permission prompt adds `request.allowOnce` (⌘↩) and `request.allowLasting` (⇧⌘↩), bound the same
// way; every key the frame binds acts on a fresh press only, so a key held through one answer cannot answer the request
// whose frame takes focus next. UX wave U1a §J's "Composer paused" was a request's; the title line now reads the title
// alone for every frame.
// This module imports no editor code.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useKeyChord } from '../../keymap/useKeyChord';
import { useComposerStore } from '../../stores/composer';

export interface DockedCardFrameProps {
  appSessionId: AppSessionId;
  title: string;
  onAccept: (() => void) | null;
  onDecline: (() => void) | null;
  onAllowOnce?: (() => void) | null; // U1a: only a permission prompt has them
  onAllowLasting?: (() => void) | null;
  children: ReactNode;
}

// Sessions whose frame unmounted with focus inside it, each with the mark of that hand-over. A frame that mounts for the
// same session in that commit (the next docked card) takes the focus instead of the editor, which stays hidden behind
// it: its own mount sees focus on the body by then, never in its pane. The mark lives until the commit's microtask
// (UX wave U1b, decision 11: U1a's later-commit hand-over, for the engine's next request, went with the dock); a frame
// mounting later takes the focus only by its pane holding it (`before`).
const handingOver = new Map<AppSessionId, object>();

export function DockedCardFrame({ appSessionId, title, onAccept, onDecline, onAllowOnce = null, onAllowLasting = null, children }: DockedCardFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  useKeyChord('request.accept', () => onAccept?.(), { within: frameRef, enabled: onAccept !== null, fresh: true });
  useKeyChord('request.decline', () => onDecline?.(), { within: frameRef, enabled: onDecline !== null, fresh: true });
  useKeyChord('request.allowOnce', () => onAllowOnce?.(), { within: frameRef, enabled: onAllowOnce !== null, fresh: true });
  useKeyChord('request.allowLasting', () => onAllowLasting?.(), { within: frameRef, enabled: onAllowLasting !== null, fresh: true });

  useLayoutEffect(() => {
    const frame = frameRef.current!;
    const pane = frame.closest('[data-pane]');
    const active = document.activeElement;
    const before = pane !== null && active instanceof HTMLElement && active !== document.body && pane.contains(active) ? active : null;
    // A mark claimed with the focus elsewhere than the body or this pane (`before`) is dropped: the person moved it.
    const handedOver = handingOver.delete(appSessionId) && (active === null || active === document.body);
    if (before || handedOver) frame.focus();
    return () => {
      // Still in the document here (effect cleanups run before the host node is removed).
      const now = document.activeElement;
      if (now !== null && now !== document.body && !frame.contains(now)) return;
      // Layout effects of this commit run before its microtasks: a frame mounting for the session now claims focus.
      const mark = {};
      handingOver.set(appSessionId, mark);
      const ours = () => handingOver.get(appSessionId) === mark;
      queueMicrotask(() => {
        if (!ours()) return;
        handingOver.delete(appSessionId);
        const target = useComposerStore.getState().focusTargets.get(appSessionId);
        // The composer's editor is visible again: its Frame's `hidden` cleared in the commit this frame unmounted in,
        // and `focusEditor` is Tiptap's `commands.focus()`, which defers to the next frame besides.
        if (target) target.focusEditor();
        else if (before?.isConnected && !frame.contains(before)) before.focus();
      });
    };
  }, [appSessionId]);

  return (
    <div
      ref={frameRef}
      role="group"
      aria-label={title}
      tabIndex={-1}
      data-docked-frame={appSessionId}
      className="flex flex-col gap-3 rounded-lg border border-border-strong bg-bg-raised p-3 outline-accent focus-visible:outline-2"
    >
      <p className="m-0 text-ui-sm text-fg-muted">
        <span className="font-medium text-fg">{title}</span>
      </p>
      {children}
    </div>
  );
}
