// The toolbar's model with effort (C7 execution document, "Composer frame" Model · effort; W3, charter §5.4 as amended
// 2026-10-01): the chip reads `<alias> <effort>` (the binding's label, @shared/sessions/model-label.ts) and opens Codex's selector, one
// 254px menu anchored above the chip in a portal, which C11 registers as the `effort`, `model` and `fast` widgets with
// the `modelChip` placement. The chip opens it on its effort view; `/effort`, `/model` and `/fast` from the palette or
// typed open it here too (the editor puts the ask in the composer store). Esc or a choice that closes it hands the
// keyboard back to the editor. With nothing registered (a harness without C11) the chip only names the model. A model
// asked for and not yet reported running (the binding's `requested`) is marked with the selector's own word for its
// checked row, "setting…" (P2-F wave S, the sitting's A1.6).
import { Popover } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { closeChipWidget, requestChipWidget, useComposerStore } from '../../stores/composer';
import { SELECTOR } from '../../widgets/copy';
import { slashWidget, useRegisteredWidgets } from '../mentions/widgets';
import type { ModelBinding } from './bindings';
import { CHIP } from './chip-style';

const chipWidget = (name: string) => {
  const widget = slashWidget(name);
  return widget?.placement === 'modelChip' ? widget : null;
};

export function ModelChip({ appSessionId, binding, onOpen, onClosed }: { appSessionId: AppSessionId; binding: ModelBinding; onOpen?(): void; onClosed?(): void }) {
  useRegisteredWidgets(); // the chip opens once C11's registrations land
  const open = useComposerStore((s) => s.chipWidgets.get(appSessionId) ?? null);
  const nonce = open?.nonce ?? null;
  // an open menu reads the engine's models (the composer's `onOpen`), however it was opened
  const opened = useRef(onOpen);
  useLayoutEffect(() => void (opened.current = onOpen));
  useEffect(() => {
    if (nonce !== null) opened.current?.();
  }, [nonce]);
  useEffect(() => () => closeChipWidget(appSessionId), [appSessionId]); // a menu never outlives its composer

  const Widget = open ? chipWidget(open.name)?.component : undefined;
  return (
    <Popover.Root
      open={open !== null && Widget !== undefined}
      onOpenChange={(next) => {
        if (!next) closeChipWidget(appSessionId);
        else if (chipWidget('effort')) requestChipWidget(appSessionId, 'effort', '');
      }}
    >
      <Popover.Trigger aria-label={`Model ${binding.label}${binding.requested ? `, ${SELECTOR.setting}` : ''}`} title={binding.disabled ?? 'Model and effort'} className={`${CHIP} shrink-0`}>
        {/* E3: whole and on one line in a narrow pane (the Side pane's thread): the location's label gives way first */}
        <span className="truncate">{binding.label}</span>
        {binding.requested && (
          <span aria-hidden className="shrink-0 text-fg-faint">
            {SELECTOR.setting}
          </span>
        )}
        <span aria-hidden className="shrink-0 text-fg-faint">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="Model and effort"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed?.();
          }}
          className="z-50 w-[254px] overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-ui text-fg shadow-composer"
        >
          {open && Widget && <Widget key={`${open.name}:${open.nonce}`} appSessionId={appSessionId} args={open.args} close={() => closeChipWidget(appSessionId)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
