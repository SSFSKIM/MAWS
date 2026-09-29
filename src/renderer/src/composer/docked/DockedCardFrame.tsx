// The docked placement's chrome, focus and keys (C7 execution document, Composer public surface; §5.7): the X4 card's
// docked placement and C10's trust and relay-down cards all render inside this frame, so they take focus, give it
// back and answer Enter and Esc under exactly one set of rules. The frame root is focusable (tabIndex -1) and takes
// focus on mount when its pane held focus; on unmount, if focus was inside the frame, it goes back to the session's
// composer (the focus target a mounted composer registers), else to what held it before. Enter and Esc are
// `request.accept` and `request.decline` bound `within` the frame root, so C5's dispatcher delivers them only while
// the frame itself holds focus: never from a textarea, a button or another pane. A null handler leaves its key unbound.
// This module imports no editor code: the request card imports it directly, never through `composer/index.ts`.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useKeyChord } from '../../keymap/useKeyChord';
import { useComposerStore } from '../../stores/composer';

export interface DockedCardFrameProps {
  appSessionId: AppSessionId;
  title: string;
  onAccept: (() => void) | null;
  onDecline: (() => void) | null;
  children: ReactNode;
}

export function DockedCardFrame({ appSessionId, title, onAccept, onDecline, children }: DockedCardFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  useKeyChord('request.accept', () => onAccept?.(), { within: frameRef, enabled: onAccept !== null });
  useKeyChord('request.decline', () => onDecline?.(), { within: frameRef, enabled: onDecline !== null });

  useLayoutEffect(() => {
    const frame = frameRef.current!;
    const pane = frame.closest('[data-pane]');
    const active = document.activeElement;
    const before = pane !== null && active instanceof HTMLElement && active !== document.body && pane.contains(active) ? active : null;
    if (before) frame.focus();
    return () => {
      // Still in the document here (effect cleanups run before the host node is removed).
      const now = document.activeElement;
      if (now !== null && now !== document.body && !frame.contains(now)) return;
      const target = useComposerStore.getState().focusTargets.get(appSessionId);
      // The composer's editor is still hidden in this commit (its Frame's `hidden` clears in the same commit this
      // frame unmounts). The return works because `focusEditor` is Tiptap's `commands.focus()`, which defers to the
      // next frame, after the Frame is visible again; a synchronous focus here would land on a hidden element.
      if (target) target.focusEditor();
      else if (before?.isConnected && !frame.contains(before)) before.focus();
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
        <span className="font-medium text-fg">{title}</span> · Composer paused · draft preserved
      </p>
      {children}
    </div>
  );
}
