// The toolbar's permission mode (C7 execution document, "Composer frame" Mode): the engine's effective mode, a warning
// glyph with the refusal in words when one is set, and M5's `ModeMenu` in a popover (W2: at the toolbar's left, so it
// opens from its start). W3: never a printed "default" for a mode nothing knows yet; MAWS's own default is auto.
// ⇧Tab's cycle is the Composer's (`composer.cycleMode`, delivered inside the editor).
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { ModeMenu, MODE_REFUSAL_WORDS, type ModeBinding } from '../../statusline';
import { CHIP, POPOVER } from './chip-style';

export function ModeChip({ binding, onOpen }: { binding: ModeBinding; onOpen?(): void }) {
  const [open, setOpen] = useState(false);
  const refusal = binding.refusal ? MODE_REFUSAL_WORDS[binding.refusal] : null;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen?.();
        setOpen(next);
      }}
    >
      <Popover.Trigger aria-label={`Permission mode ${PERMISSION_MODE_LABELS[binding.value ?? 'auto']}${refusal ? ` · ${refusal}` : ''}`} title={refusal ?? binding.disabled ?? 'Permission mode'} className={`${CHIP} shrink-0`}>
        {refusal && (
          <span aria-hidden className="text-warning">
            ⚠
          </span>
        )}
        {/* E3: whole and on one line in a narrow pane (the Side pane's thread): the location's label gives way first */}
        <span className="truncate">{PERMISSION_MODE_LABELS[binding.value ?? 'auto']}</span>
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
