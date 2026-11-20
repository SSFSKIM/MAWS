// The Settings tab's rows at Codex's settings density (research/codex-shell-ux.md §6; mockup 06 vignette 04): a
// `label · value · note` row, a segmented radio group, a switch, a quiet text action and a muted chip; and the one write
// every row goes through. Tokens only. U11a M9 (l8-settings-06): a section with its heading; a row drawn from its
// declaration (rows.ts). The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1; G13 to G15): a row is
// its label and its control at rest; its note opens in the row on pointing or keyboard focus (the shared row note,
// ui/row-note.tsx) and is its description at all times, with no More and no Less; a line stands at rest.
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { MawsBridge, SettingsPatch } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { RowNote, useRowNote } from '../ui/row-note';
import { Tip } from '../ui/tip';
import { INDEX, KEYBOARD, SECTIONS, SESSIONS } from './copy';
import { useDrawnRow } from './drawn';
import { fillPlaces, settingsRow } from './rows';
import type { SettingsSection } from './SettingsView';

// One field through `settings.set`; the row re-renders from the settings store, which main's `settings.changed` feeds.
// A refusal is a toast, and the row keeps showing what the store last held.
export async function writeSettings(patch: SettingsPatch, client: MawsBridge = ipc): Promise<boolean> {
  const result = await client.invoke('settings.set', patch, { machine: client.localMachine }); // P5 O6 M4: this machine's settings (O3)
  if (result.ok) return true;
  console.error('[settings] settings.set failed', result.error);
  toast({ level: 'warning', text: INDEX.writeFailed(result.error.message), actions: [], dismissible: true });
  return false;
}

export const useSettingsValue = () => useSettings((s) => s.state?.settings ?? null);

export const TEXT_ACTION = 'shrink-0 rounded-sm px-1.5 py-0.5 text-ui-sm whitespace-nowrap text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
export const INPUT = 'h-7 w-full min-w-0 rounded-sm border border-border-strong bg-bg px-2 text-ui-sm text-fg outline-accent focus-visible:outline-2';

// W9 (H1): a row stacks in one column, the label over the control and the note under the control, as Codex's settings
// rows stack when narrow (readable/chatgpt-26.928.40906/renderer/app/app-shared-360504a28a87.js:380386-380388). U11a M9:
// by the body's own width, not the view's: the body's column is the `settings-body` query container (SettingsView.tsx),
// and a row is two columns only where it is at least 32rem, so a note beside its label is never narrower than 332 px.
// P5 O8 M4a Task 8: a word wider than its column (a member's widened name, an email, a path) breaks inside its cell
// instead of running past it; text that fits wraps as before, and a text action never shrinks or breaks.
const SETTING_ROW = 'relative grid min-h-[34px] grid-cols-[168px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 text-ui-sm @max-lg/settings-body:grid-cols-1';
const SECOND_COLUMN = 'col-start-2 @max-lg/settings-body:col-start-1';
const SETTING_NOTE = `${SECOND_COLUMN} -mt-0.5 mb-0.5 text-ui-sm leading-normal text-fg-muted`;

// U11a M10: what a search result lands on (a row, a key binding, an Org group) takes the keyboard itself, with the accent
// outline, so that a second Enter acts on no control of it; Tab then enters its controls. Out of the Tab order.
export const LANDING = 'rounded-sm outline-accent focus-visible:outline-2';

type Values = Readonly<Record<string, string | null>>;
// A row of the table: its words are its declaration's, in the state it shows; a repeating row is drawn under its own
// `label`. `lineEnd` follows the line at rest (Direct login's command and its Copy); `noteEnd` follows the note's words
// in the note (what the row holds at run time: the binary's path). A `bare` row draws its control alone, its label
// still its name (Stop all).
type DeclaredSetting = { row: string; state?: string; values?: Values; label?: string; bare?: boolean; lineEnd?: ReactNode; noteEnd?: ReactNode; children: ReactNode };
// A row of the Org page, which the table does not hold: its label and note as given.
type PlainSetting = { row?: undefined; label: string; note?: ReactNode; children: ReactNode };

export function Setting(props: DeclaredSetting | PlainSetting) {
  const id = useId();
  const rowNote = useRowNote();
  const declared = props.row === undefined ? null : settingsRow(props.row);
  const stateName = props.row === undefined ? null : (props.state ?? 'default');
  useDrawnRow(declared?.id ?? null, stateName);
  let line: ReactNode = null;
  let note: ReactNode = null;
  const bare = props.row !== undefined && props.bare === true;
  if (props.row === undefined) {
    if (props.note !== undefined && props.note !== null) line = <div className={SETTING_NOTE}>{props.note}</div>;
  } else {
    const shown = declared!.states[stateName!];
    if (shown === undefined) throw new Error(`Settings row ${declared!.id} has no state ${stateName}`);
    if (shown.line !== undefined || props.lineEnd !== undefined)
      line = (
        <div data-settings-note={shown.state ? 'state' : 'line'} className={SETTING_NOTE}>
          {shown.line !== undefined && fillPlaces(shown.line, props.values)}
          {shown.line !== undefined && props.lineEnd !== undefined && ' '}
          {props.lineEnd}
        </div>
      );
    if (shown.note !== undefined || props.noteEnd !== undefined)
      note = (
        <RowNote note={rowNote} className={SECOND_COLUMN}>
          {shown.note !== undefined && <p className="m-0">{fillPlaces(shown.note, props.values)}</p>}
          {props.noteEnd}
        </RowNote>
      );
  }
  return (
    <div role="group" aria-labelledby={id} data-settings-row={declared?.id} data-settings-state={stateName ?? undefined} tabIndex={-1} {...(note !== null ? rowNote.rowProps : {})} className={`${SETTING_ROW} ${LANDING}`}>
      <span id={id} className={bare ? 'sr-only' : 'min-w-0 text-fg-muted [overflow-wrap:anywhere]'}>
        {props.label ?? declared!.label}
      </span>
      <div className={`flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere] ${bare ? SECOND_COLUMN : ''}`}>{props.children}</div>
      {line}
      {note}
    </div>
  );
}

// A word whose secondary fact is its tooltip (rule 5): it takes the keyboard, so focus shows the fact as pointing does,
// and the fact is its description.
export const WORD_OWNER = 'rounded-sm outline-accent focus-visible:outline-2';
export function TipWord({ tip, children }: { tip: string | null; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  return (
    <Tip content={tip} description={tip}>
      {children}
    </Tip>
  );
}

// The word cut (G40): an action with no shortcut has an empty dashed key cap, named and tipped by the word.
export function UnboundCap() {
  return (
    <TipWord tip={KEYBOARD.unbound}>
      <kbd role="img" aria-label={KEYBOARD.unbound} tabIndex={0} className={`inline-block h-[18px] w-7 rounded-sm border border-dashed border-border-strong align-middle ${WORD_OWNER}`} />
    </TipWord>
  );
}

// U11a M9: a section of the page under its heading, which takes the keyboard when the index shows the section (and when
// a control of the supervisor's leaves with it). Sessions' line stands under its heading (the word cut, G36: Keyboard's
// hint beside its heading is gone).
const LINES: Partial<Record<SettingsSection, string>> = { sessions: SESSIONS.line };
export const sectionHeadingId = (section: SettingsSection) => `settings-${section}`;

export function Section({ id, children }: { id: SettingsSection; children: ReactNode }) {
  return (
    <section aria-labelledby={sectionHeadingId(id)} className="border-t border-border pt-3 pb-2.5 first:border-t-0">
      <h3 id={sectionHeadingId(id)} aria-label={SECTIONS[id]} tabIndex={-1} className="m-0 mb-1 flex items-baseline gap-2.5 text-ui font-semibold outline-accent focus-visible:outline-2">
        <span>{SECTIONS[id]}</span>
      </h3>
      {LINES[id] && <p className="m-0 mb-1 text-ui-sm leading-normal text-fg-muted">{LINES[id]}</p>}
      {children}
    </section>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-sm border border-border px-2 py-0.5 text-ui-sm whitespace-nowrap text-fg-muted">{children}</span>;
}

// An `onChange` that answers its write's promise: the option chosen shows while the write is out (on the daemon shape a
// machine field's crosses to `mawsd` and back before the store moves, M5b fix round 2), then whatever the store holds,
// the old value again for a refused write.
export function Segment<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly { value: V; label: string }[]; onChange(value: V): void | Promise<unknown> }) {
  const name = useId();
  const [pending, setPending] = useState<{ chosen: V; over: V } | null>(null);
  if (pending !== null && pending.over !== value) setPending(null); // the store moved: show its value
  const shown = pending?.chosen ?? value;
  const choose = (next: V) => {
    const writing = onChange(next);
    if (!(writing instanceof Promise)) return;
    const mine = { chosen: next, over: value };
    setPending(mine);
    void writing.finally(() => setPending((current) => (current === mine ? null : current)));
  };
  return (
    <span role="radiogroup" aria-label={label} className="flex max-w-[260px] flex-1 rounded-sm border border-border-strong bg-bg p-[3px]">
      {options.map((option) => (
        <label
          key={option.value}
          className="relative flex-1 cursor-default rounded-sm px-1.5 py-1 text-center text-ui-sm whitespace-nowrap text-fg-muted has-[:checked]:bg-bg-active has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
        >
          <input type="radio" name={name} value={option.value} checked={shown === option.value} onChange={() => choose(option.value)} className="absolute opacity-0" />
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
