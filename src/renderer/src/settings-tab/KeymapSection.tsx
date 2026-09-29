// The Keyboard section (C11 execution document, Interfaces "Settings tab" Keyboard; mockup 06 vignette 04; research
// codex-shell-ux.md §6: chord capture with conflict detection and restore-defaults): C5's action table, one row per
// action with its effective chord, `Change` to record a new one. The whole override map is written as one field
// (settings v3's patch replaces `keymap` whole, M1 decision (2)); a chord equal to the default drops the override. A
// `menu` action's change rebuilds the application menu in main; a `renderer` action's reaches the dispatcher through
// the settings store.
import { useState, type KeyboardEvent } from 'react';
import { ACTIONS, type ActionId, type KeymapOverrides } from '@shared/keymap/actions';
import { GatewaySheet } from '../gateway/GatewaySheet';
import { KEYBOARD } from './copy';
import { captureChord, displayChord, keymapGroups, type KeymapRow } from './keymap';
import { TEXT_ACTION, writeSettings } from './parts';

function withChord(keymap: KeymapOverrides, id: ActionId, chord: string | null): KeymapOverrides {
  const next = { ...keymap };
  if (chord === ACTIONS[id].chord) delete next[id];
  else next[id] = chord;
  return next;
}

export function KeymapSection({ keymap }: { keymap: KeymapOverrides }) {
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const stop = () => {
    setRecording(null);
    setRefusal(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: ActionId) => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return; // focus moves on
    event.preventDefault();
    event.stopPropagation();
    const outcome = captureChord(event.nativeEvent, id, keymap);
    switch (outcome.kind) {
      case 'wait':
        return;
      case 'cancel':
        return stop();
      case 'refused':
        return setRefusal(outcome.message);
      case 'unbind':
      case 'chord':
        stop();
        void writeSettings({ keymap: withChord(keymap, id, outcome.kind === 'unbind' ? null : outcome.chord) });
    }
  };

  return (
    <>
      <div role="table" aria-label={KEYBOARD.table} className="mt-1 overflow-hidden rounded-sm border border-border">
        {keymapGroups(keymap).map((group) => (
          <div key={group.label} role="rowgroup" aria-label={group.label}>
            <div role="row" className="border-t border-border bg-bg-raised px-2.5 py-1 text-ui-sm font-semibold tracking-wide text-fg-muted uppercase first:border-t-0">
              <span role="columnheader">{group.label}</span>
            </div>
            {group.rows.map((row) => (
              <KeyRow
                key={row.id}
                row={row}
                recording={recording === row.id}
                refusal={recording === row.id ? refusal : null}
                onRecord={() => {
                  setRecording(row.id);
                  setRefusal(null);
                }}
                onCancel={stop}
                onKeyDown={(e) => onKeyDown(e, row.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={TEXT_ACTION} disabled={Object.keys(keymap).length === 0} onClick={() => setConfirmReset(true)}>
          {KEYBOARD.reset}
        </button>
      </div>
      {confirmReset && (
        <GatewaySheet
          title={KEYBOARD.resetTitle}
          onClose={() => setConfirmReset(false)}
          canSubmit
          onSubmit={() => {
            setConfirmReset(false);
            void writeSettings({ keymap: {} });
          }}
          submitLabel={KEYBOARD.resetConfirm}
          cancelLabel={KEYBOARD.cancel}
        >
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{KEYBOARD.resetBody}</p>
        </GatewaySheet>
      )}
    </>
  );
}

function KeyRow({
  row,
  recording,
  refusal,
  onRecord,
  onCancel,
  onKeyDown,
}: {
  row: KeymapRow;
  recording: boolean;
  refusal: string | null;
  onRecord(): void;
  onCancel(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}) {
  return (
    <div role="row" aria-label={row.title} data-recording={recording || undefined} className={`border-t border-border px-2.5 text-ui-sm ${recording ? 'bg-accent-soft' : ''}`}>
      <div className="grid h-[30px] grid-cols-[minmax(0,1fr)_160px_96px] items-center gap-2.5">
        <span role="cell" className="truncate">
          {row.title}
        </span>
        <span role="cell">
          {recording ? (
            // Focused while recording: it takes every keydown until a chord is accepted, Escape cancels, or it loses focus.
            <kbd
              tabIndex={0}
              ref={(el) => el?.focus()}
              onKeyDown={onKeyDown}
              onBlur={onCancel}
              aria-label={`${row.title}: ${KEYBOARD.recording}`}
              className="rounded-sm border border-accent bg-bg px-1.5 py-0.5 font-ui text-ui-sm whitespace-nowrap text-fg-muted outline-none"
            >
              {KEYBOARD.recording}
            </kbd>
          ) : (
            <kbd className={`rounded-sm border px-1.5 py-0.5 font-ui text-ui-sm whitespace-nowrap ${row.chord === null ? 'border-border text-fg-muted' : 'border-border-strong bg-bg text-fg'}`}>
              {row.display}
            </kbd>
          )}
        </span>
        <span role="cell" className="justify-self-end">
          {recording ? (
            <button type="button" className={TEXT_ACTION} onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
              {KEYBOARD.was(displayChord(row.id, row.chord))}
            </button>
          ) : (
            <button type="button" className={TEXT_ACTION} onClick={onRecord} aria-label={`${KEYBOARD.change} ${row.title}`}>
              {KEYBOARD.change}
            </button>
          )}
        </span>
      </div>
      {refusal && (
        <p role="alert" className="m-0 pb-1.5 text-ui-sm text-warning">
          {refusal}
        </p>
      )}
    </div>
  );
}
