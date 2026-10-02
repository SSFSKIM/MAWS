// The Settings tab's rows at Codex's settings density (research/codex-shell-ux.md §6; mockup 06 vignette 04): a
// `label · value · note` row, a segmented radio group, a switch, a quiet text action and a muted chip; and the one write
// every row goes through. Tokens only.
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { MawsBridge, SettingsPatch } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { INDEX } from './copy';

// One field through `settings.set`; the row re-renders from the settings store, which main's `settings.changed` feeds.
// A refusal is a toast, and the row keeps showing what the store last held.
export async function writeSettings(patch: SettingsPatch, client: MawsBridge = ipc): Promise<boolean> {
  const result = await client.invoke('settings.set', patch);
  if (result.ok) return true;
  console.error('[settings] settings.set failed', result.error);
  toast({ level: 'warning', text: INDEX.writeFailed(result.error.message), actions: [], dismissible: true });
  return false;
}

export const useSettingsValue = () => useSettings((s) => s.state?.settings ?? null);

export const TEXT_ACTION = 'rounded-sm px-1.5 py-0.5 text-ui-sm whitespace-nowrap text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
export const INPUT = 'h-7 w-full min-w-0 rounded-sm border border-border-strong bg-bg px-2 text-ui-sm text-fg outline-accent focus-visible:outline-2';

// W9 (H1): in a Settings view narrower than 32rem (the view is the `settings` query container, SettingsView.tsx) the
// row stacks in one column, the label over the control and the note under the control, as Codex's settings rows stack
// when narrow (readable/chatgpt-26.928.40906/renderer/app/app-shared-360504a28a87.js:380386-380388).
const SETTING_ROW = 'grid min-h-[34px] grid-cols-[168px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 text-ui-sm @max-lg/settings:grid-cols-1';
const SETTING_NOTE = 'col-start-2 -mt-0.5 mb-0.5 text-ui-sm leading-normal text-fg-muted @max-lg/settings:col-start-1';

export function Setting({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={SETTING_ROW}>
      <span id={id} className="text-fg-muted">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {note !== undefined && note !== null && <div className={SETTING_NOTE}>{note}</div>}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-sm border border-border px-2 py-0.5 text-ui-sm whitespace-nowrap text-fg-muted">{children}</span>;
}

export function Segment<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly { value: V; label: string }[]; onChange(value: V): void }) {
  const name = useId();
  return (
    <span role="radiogroup" aria-label={label} className="flex max-w-[260px] flex-1 rounded-sm border border-border-strong bg-bg p-[3px]">
      {options.map((option) => (
        <label
          key={option.value}
          className="relative flex-1 cursor-default rounded-sm px-1.5 py-1 text-center text-ui-sm whitespace-nowrap text-fg-muted has-[:checked]:bg-bg-active has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
        >
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="absolute opacity-0" />
          {option.label}
        </label>
      ))}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange(next: boolean): void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-[26px] shrink-0 items-center rounded-lg border border-border-strong outline-offset-2 outline-accent focus-visible:outline-2 disabled:opacity-45 ${checked ? 'bg-accent' : 'bg-bg-active'}`}
    >
      <span aria-hidden className={`mx-0.5 size-2.5 rounded-full transition-transform motion-reduce:transition-none ${checked ? 'translate-x-2.5 bg-bg' : 'bg-fg-muted'}`} />
    </button>
  );
}

// A text field bound to one nullable setting: typed freely, written once on Enter or blur (empty is null), put back on
// Escape or when the write is refused, and reset whenever the store's value moves. Spread the answer onto the <input>.
export function useCommittedDraft(saved: string | null, write: (next: string | null) => Promise<boolean>) {
  const [field, setField] = useState({ saved, draft: saved ?? '' });
  if (field.saved !== saved) setField({ saved, draft: saved ?? '' }); // the store moved: show its value
  const written = useRef(saved); // what was last written or saved, so Enter then blur writes once
  useEffect(() => {
    written.current = saved;
  }, [saved]);
  const draft = field.draft;
  const setDraft = (next: string) => setField((f) => ({ ...f, draft: next }));
  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next === written.current) return;
    written.current = next;
    void write(next).then((ok) => {
      if (ok || written.current !== next) return; // written, or overtaken by a later edit
      written.current = saved; // refused: the field shows the saved value again, and the same text can be retried
      setField({ saved, draft: saved ?? '' });
    });
  };
  return [
    draft,
    {
      value: draft,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(written.current ?? '');
      },
    },
  ] as const;
}
