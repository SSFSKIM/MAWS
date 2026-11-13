// The toolbar's permission mode (C7 execution document, "Composer frame" Mode): the engine's effective mode, a warning
// glyph with the refusal in words when one is set, and M5's `ModeMenu` in a popover (W2: at the toolbar's left, so it
// opens from its start). W3: never a printed "default" for a mode nothing knows yet; MAWS's own default is auto. P5 O9:
// where nothing reports the mode (`unreported`, a terminal session), the chip names no mode, only "Mode", with why;
// where the session reported it (`reportedAt`, sminos 1.27.14), its title says how long ago.
// ⇧Tab's cycle is the Composer's (`composer.cycleMode`, delivered inside the editor). UX wave U4a M5 (decision 21): the
// menu's open state is the composer store's, as the model chip's is, so ⇧⌘M opens it from the app's one handler; it closes
// as the draft hides (a docked card) and with its composer.
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { Popover } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ModeMenu, modeReported, MODE_REFUSAL_WORDS, type ModeBinding } from '../../statusline';
import { POPOVER_TICK_MS } from '../../statusline/use-now';
import { closeModeMenu, requestModeMenu, useComposerStore } from '../../stores/composer';
import { CHIP, POPOVER } from './chip-style';
import { useDraftShown } from './draft-shown';

// The clock a reported mode's age reads against: read again as a report arrives, and every 30 s while one is shown.
function useReportClock(at: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === undefined) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, POPOVER_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [at]);
  return now;
}

export function ModeChip({ appSessionId, binding, onOpen }: { appSessionId: AppSessionId; binding: ModeBinding; onOpen?(): void }) {
  const requested = useComposerStore((s) => s.modeMenus.has(appSessionId));
  const shown = useDraftShown();
  useEffect(() => () => closeModeMenu(appSessionId), [appSessionId]); // a menu never outlives its composer
  useEffect(() => {
    if (!shown) closeModeMenu(appSessionId);
  }, [shown, appSessionId]);
  // an open menu reads the engine's models (the composer's `onOpen`), however it was opened
  const opened = useRef(onOpen);
  useLayoutEffect(() => void (opened.current = onOpen));
  useEffect(() => {
    if (requested) opened.current?.();
  }, [requested]);
  const open = requested && shown;
  const setOpen = (next: boolean) => (next ? requestModeMenu(appSessionId) : closeModeMenu(appSessionId));
  const now = useReportClock(binding.reportedAt);
  const refusal = binding.refusal ? MODE_REFUSAL_WORDS[binding.refusal] : null;
  const mode = binding.unreported ? null : PERMISSION_MODE_LABELS[binding.value ?? 'auto'];
  const reported = binding.reportedAt === undefined ? null : modeReported(binding.reportedAt, now);
  const why = [reported, binding.disabled].filter((part) => part !== null).join(' · ');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={mode === null ? 'Permission mode not reported' : `Permission mode ${mode}${refusal ? ` · ${refusal}` : ''}`} title={refusal ?? (why || 'Permission mode')} className={`${CHIP} shrink-0`}>
        {refusal && (
          <span aria-hidden className="text-warning">
            ⚠
          </span>
        )}
        {/* E3: whole and on one line in a narrow pane (the Side pane's thread): the location's label gives way first */}
        <span className="truncate">{mode ?? 'Mode'}</span>
        <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Permission mode" side="top" align="start" sideOffset={6} collisionPadding={8} className={`${POPOVER} w-72`}>
          <ModeMenu binding={binding} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
