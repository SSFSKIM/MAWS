// The permission-mode menu: the composer toolbar's Mode chip (M4) renders it inside its Radix Popover, and the
// /permissions widget beside its rules (W2: the status line's mode popover went with the line). A list of mode items
// (arrows move between them, Enter or a click chooses; UX wave U4a, decision 21: a digit 1 to 9 picks the row drawn at
// that place, never a disabled one, and draws no number), `bypassPermissions` set apart in the warning tone and behind
// an inline confirm, the refusal in words, and the engine's answer: while the change is in flight nothing else can be
// chosen, a refusal or error stays in the menu, and success calls `onDone`.
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { useState, type KeyboardEvent } from 'react';
import type { PermissionMode } from '@shared/graph/enums';
import { BYPASS_CONFIRM, MODE_OPTIONS, MODE_REFUSAL_WORDS, STARTING_SESSION, type ModeBinding } from './mode-menu';

const ITEM =
  'flex w-full flex-col items-start rounded-sm px-2 py-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-checked:bg-bg-active';
// Bypass permissions, set apart: its mark on the label's line, its line below, all in the warning tone (decision 25)
const WARNED_ITEM = `${ITEM.replace('flex-col items-start', 'flex-row flex-wrap items-baseline gap-x-1')} text-warning`;
const BUTTON = 'rounded-sm px-2 py-0.5 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2';

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')];
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
  items[at === -1 ? 0 : next].focus();
}

// The place a digit 1 to 9 names, pressed alone; null for any other key.
export function digitOf(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): number | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return null;
  return Number(event.key);
}

export function ModeMenu({ binding, onDone }: { binding: ModeBinding; onDone?: () => void }) {
  const [confirming, setConfirming] = useState<PermissionMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (mode: PermissionMode) => {
    setPending(true);
    setError(null);
    try {
      const result = await binding.set(mode);
      if (result.ok) onDone?.();
      else setError(result.error);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown)); // a binding that rejects: shown like a refusal
    } finally {
      setPending(false);
      setConfirming(null);
    }
  };
  const choose = (mode: PermissionMode) => {
    if (mode === binding.value) return onDone?.();
    if (MODE_OPTIONS.find((o) => o.mode === mode)?.confirm) return setConfirming(mode);
    void apply(mode);
  };
  // the rows drawn, each with why it cannot be chosen (null: it can)
  const rows = MODE_OPTIONS.filter((o) => binding.options.includes(o.mode)).map((option) => ({ option, reason: binding.disabled ?? (option.mode === 'auto' ? binding.autoUnavailable : null) }));
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const place = digitOf(event);
    if (place === null) return moveFocus(event);
    event.preventDefault();
    const row = rows[place - 1];
    if (row && row.reason === null && !pending) choose(row.option.mode);
  };

  if (confirming) {
    return (
      <div role="group" aria-label={`Switch to ${PERMISSION_MODE_LABELS[confirming]}`} className="flex flex-col gap-2 p-1">
        <p>{BYPASS_CONFIRM}</p>
        {pending && binding.starts && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {STARTING_SESSION}
          </p>
        )}
        <div className="flex justify-end gap-1">
          {/* focus starts on the safe choice: an Enter pressed on through the menu never grants bypassPermissions */}
          <button type="button" className={`${BUTTON} text-fg-muted`} onClick={() => setConfirming(null)} disabled={pending} autoFocus>
            Cancel
          </button>
          <button type="button" className={`${BUTTON} text-danger`} onClick={() => void apply(confirming)} disabled={pending}>
            Switch to {PERMISSION_MODE_LABELS[confirming]}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {binding.refusal && (
        <p className="flex gap-1 px-2 text-warning">
          <span role="img" aria-label="Warning">
            ⚠
          </span>
          {MODE_REFUSAL_WORDS[binding.refusal]}
        </p>
      )}
      {binding.disabled && <p className="px-2 text-ui-sm text-fg-muted">{binding.disabled}</p>}
      {pending && binding.starts && (
        <p role="status" className="px-2 text-ui-sm text-fg-muted">
          {STARTING_SESSION}
        </p>
      )}
      <div role="menu" aria-label="Permission mode" onKeyDown={onMenuKey} className="flex flex-col">
        {rows.map(({ option, reason }) => {
          const warned = option.separatorBefore === true;
          const item = (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={binding.value === option.mode}
              disabled={pending || reason !== null}
              onClick={() => choose(option.mode)}
              className={warned ? WARNED_ITEM : ITEM}
            >
              <span>{PERMISSION_MODE_LABELS[option.mode]}</span>
              {warned && <span aria-hidden>⚠</span>}
              <span className={`text-ui-sm ${warned ? 'w-full' : 'text-fg-muted'}`}>{option.mode === 'auto' && reason !== null && binding.disabled === null ? reason : option.description}</span>
            </button>
          );
          return warned ? [<div key={`${option.mode}:separator`} role="separator" className="my-1 h-px bg-border" />, item] : item;
        })}
      </div>
      {error && (
        <p role="alert" className="px-2 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
