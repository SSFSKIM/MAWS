// The permission-mode menu: the composer toolbar's Mode chip (M4) renders it inside its Radix Popover, and the
// /permissions widget beside its rules (W2: the status line's mode popover went with the line). A list of mode items
// (arrows move between them, Enter or a click chooses), `bypassPermissions` behind an inline confirm, the refusal in
// words, and the engine's answer: while the change is in flight nothing else can be chosen, a refusal or error stays in
// the menu, and success calls `onDone`.
import { useState, type KeyboardEvent } from 'react';
import type { PermissionMode } from '@shared/graph/enums';
import { BYPASS_CONFIRM, MODE_OPTIONS, MODE_REFUSAL_WORDS, type ModeBinding } from './mode-menu';

const ITEM =
  'flex w-full flex-col items-start rounded-sm px-2 py-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-checked:bg-bg-active';
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

  if (confirming) {
    return (
      <div role="group" aria-label={`Switch to ${confirming}`} className="flex flex-col gap-2 p-1">
        <p>{BYPASS_CONFIRM}</p>
        <div className="flex justify-end gap-1">
          {/* focus starts on the safe choice: an Enter pressed on through the menu never grants bypassPermissions */}
          <button type="button" className={`${BUTTON} text-fg-muted`} onClick={() => setConfirming(null)} disabled={pending} autoFocus>
            Cancel
          </button>
          <button type="button" className={`${BUTTON} text-danger`} onClick={() => void apply(confirming)} disabled={pending}>
            Switch to {confirming}
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
      <div role="menu" aria-label="Permission mode" onKeyDown={moveFocus} className="flex flex-col">
        {MODE_OPTIONS.filter((o) => binding.options.includes(o.mode)).map((option) => {
          const reason = binding.disabled ?? (option.mode === 'auto' ? binding.autoUnavailable : null);
          return (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={binding.value === option.mode}
              disabled={pending || reason !== null}
              onClick={() => choose(option.mode)}
              className={ITEM}
            >
              <span className="font-mono">{option.mode}</span>
              <span className="text-ui-sm text-fg-muted">{option.mode === 'auto' && reason !== null && binding.disabled === null ? reason : option.description}</span>
            </button>
          );
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
