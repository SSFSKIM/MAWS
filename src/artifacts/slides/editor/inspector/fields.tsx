// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the inspector's controls. Every
// control is named for assistive technology (and the e2e) by its full label; a write returns the reasons the dialect
// refuses it, which the field shows inline (`role="alert"`, `aria-invalid`) while it keeps what was typed until fixed or
// left. Number fields commit on Enter, on leaving and on arrow steps (Shift ×10); colour fields write as typed whenever
// the text is a value the dialect takes, and carry the design system's swatch row.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D13; tracker row 280): a number field may show its
// value as a whole number (position and size), while the model keeps the fraction: Enter on a field nobody typed in
// writes nothing (so a rounded display is never written back), and an arrow steps from the model's value.
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import type { DeckFace } from '../../deck';
import type { DeckSession } from '../session';
import { INSPECTOR_COPY as C } from './copy';
import type { Picked, Props } from './selection';
import { COLOUR_TOKENS, fmt, readColour, round2, showColour, tokenLabel, tokenTitle, tokenValue } from './values';

/** How a change is written: one gesture (its own undo step), or into the typing step of one field. */
export type Write = 'edit' | { typing: string };

export interface InspectorApi {
  session: DeckSession;
  slideId: string;
  picked: readonly Picked[];
  readOnly: boolean;
  faces: Readonly<Record<string, DeckFace>>;
  uploadAsset?: (file: File) => Promise<string>;
  measure?: (elementId: string) => { x: number; y: number; w: number; h: number } | null;
  /** Writes each element's props (checked first; all or nothing); the reasons when refused. */
  style: (propsFor: (p: Picked) => Props | null, how: Write) => string[];
  /** Writes each element's attributes (the caller has checked them) in one transaction. */
  attrs: (attrsFor: (p: Picked) => Props | null, how: Write) => void;
}

export const InspectorContext = createContext<InspectorApi | null>(null);
export function useInspector(): InspectorApi {
  const api = useContext(InspectorContext);
  if (!api) throw new Error('an inspector field outside the inspector');
  return api;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="deck-inspector-section" aria-label={title}>
      <h3 className="deck-inspector-heading">{title}</h3>
      {children}
    </section>
  );
}

export function Refusal({ id, reason }: { id?: string; reason: string | null }) {
  if (reason === null) return null;
  return (
    <p id={id} role="alert" className="deck-inspector-refused">
      {reason}
    </p>
  );
}

/** A refusal shown under a discrete control (a select, a button), cleared by the next success. */
export function useRefusal(): [string | null, (reasons: readonly string[]) => void] {
  const [reason, setReason] = useState<string | null>(null);
  return [reason, (reasons) => setReason(reasons.length ? reasons.join('; ') : null)];
}

/** A labelled row: the visible caption beside the control. */
export function Row({ caption, children, wide = false }: { caption?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="deck-inspector-row" data-wide={wide || undefined}>
      {caption !== undefined && <span className="deck-inspector-caption">{caption}</span>}
      <div className="deck-inspector-control">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- number

export interface NumberFieldProps {
  label: string;
  caption?: string;
  value: number | null;
  mixed?: boolean;
  /** What the field shows greyed when the value is not a plain number (a token's name, shown by its friendly name, a %). */
  hint?: string;
  unit?: string;
  step?: number;
  /** null: the field emptied (remove the value where that means something). */
  onCommit: (n: number | null, how: Write) => readonly string[];
  /** Held off for what the selection cannot show (fix wave 1). */
  disabled?: boolean;
  /** P4-B2 (D13): shown as a whole number (position and size in px); the model keeps its fraction. */
  whole?: boolean;
}

export function NumberField({ label, caption, value, mixed = false, hint = '', unit, step = 1, onCommit, disabled = false, whole = false }: NumberFieldProps) {
  const readOnly = useInspector().readOnly || disabled;
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (whole && value !== null ? String(Math.round(value)) : fmt(value));
  const how: Write = { typing: label };
  const token = hint.startsWith('--ds-') ? hint : null;

  const commit = (text: string, keep: boolean) => {
    const t = text.trim();
    const n = t === '' ? null : Number(t);
    const reasons = n !== null && !Number.isFinite(n) ? [C.notANumber] : onCommit(n, how);
    if (reasons.length && keep) {
      setDraft(text);
      setError(reasons.join('; '));
    } else {
      setDraft(null);
      setError(null);
    }
  };

  return (
    <label className="deck-inspector-number">
      {caption !== undefined && <span className="deck-inspector-mini">{caption}</span>}
      <span className="deck-inspector-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          className="deck-inspector-input"
          aria-label={label}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          disabled={readOnly}
          value={shown}
          placeholder={mixed ? C.mixed : token !== null ? tokenLabel(token) : hint}
          title={!mixed && token !== null ? tokenTitle(token) : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft !== null) commit(draft, true); // P4-B2 (D13): a field nobody typed in writes nothing
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              // P4-B2 (D13): from what was typed, else from the model's value (never the rounded one shown)
              const base = draft !== null && Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : (value ?? 0);
              const next = round2(base + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
              commit(String(next), true);
            } else if (event.key === 'Escape' && draft !== null) {
              setDraft(null);
              setError(null);
            }
          }}
          onBlur={() => {
            if (draft !== null) commit(draft, false);
          }}
        />
        {unit && <span className="deck-inspector-unit">{unit}</span>}
      </span>
      <Refusal id={`${id}-error`} reason={error} />
    </label>
  );
}

// ---------------------------------------------------------------- colour

export interface ColourFieldProps {
  label: string;
  value: string | undefined;
  mixed?: boolean;
  placeholder?: string;
  /** null: the field emptied. */
  onCommit: (value: string | null, how: Write) => readonly string[];
}

export function ColourField({ label, value, mixed = false, placeholder = C.none, onCommit }: ColourFieldProps) {
  const { readOnly } = useInspector();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // the refusal of the text typed, shown on Enter
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (mixed ? '' : showColour(value));

  const settle = (reasons: readonly string[]) => {
    setError(reasons.length ? reasons.join('; ') : null);
    if (!reasons.length) setDraft(null);
  };

  return (
    <div className="deck-inspector-colour">
      <span className="deck-inspector-input-wrap">
        <span className="deck-inspector-chip" aria-hidden="true" style={value !== undefined && !mixed ? { background: value } : undefined} />
        <input
          type="text"
          className="deck-inspector-input"
          aria-label={label}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          disabled={readOnly}
          spellCheck={false}
          value={shown}
          placeholder={mixed ? C.mixed : placeholder}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            setError(null);
            const next = readColour(text);
            if (next === null) {
              setPending(null);
              return;
            }
            const reasons = onCommit(next, { typing: label });
            setPending(reasons.length ? reasons.join('; ') : null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || draft === null) return;
            event.preventDefault();
            if (draft.trim() === '') settle(onCommit(null, 'edit'));
            else if (pending !== null) setError(pending);
            else setDraft(null);
          }}
          onBlur={() => {
            setDraft(null);
            setPending(null);
            setError(null);
          }}
        />
      </span>
      <div className="deck-inspector-swatches" role="group" aria-label={C.swatches(label)}>
        {COLOUR_TOKENS.map((t) => (
          <button
            key={t.name}
            type="button"
            className="deck-inspector-swatch"
            aria-label={t.label}
            title={`${t.label} (${t.name})`}
            aria-pressed={!mixed && value === tokenValue(t)}
            disabled={readOnly}
            style={{ background: tokenValue(t) }}
            onClick={() => {
              setPending(null);
              settle(onCommit(tokenValue(t), 'edit'));
            }}
          />
        ))}
      </div>
      <Refusal id={`${id}-error`} reason={error} />
    </div>
  );
}

// ---------------------------------------------------------------- select and toggles

export interface Choice {
  value: string;
  label: string;
  /** A hover title: a token's own name beside its friendly label. */
  title?: string;
}
export const MIXED_CHOICE = '\u0000mixed';

export function SelectField({ label, value, mixed = false, choices, groups, onChange }: {
  label: string;
  value: string;
  mixed?: boolean;
  choices?: readonly Choice[];
  groups?: readonly { label: string; choices: readonly Choice[] }[];
  onChange: (value: string) => void;
}) {
  const { readOnly } = useInspector();
  // named apart from the <option> tag it draws: the React Compiler read the tag as this binding, used before it was made
  const renderOption = (c: Choice) => (
    <option key={c.value} value={c.value} title={c.title}>
      {c.label}
    </option>
  );
  return (
    <select className="deck-inspector-select" aria-label={label} disabled={readOnly} value={mixed ? MIXED_CHOICE : value} onChange={(event) => event.target.value !== MIXED_CHOICE && onChange(event.target.value)}>
      {mixed && (
        <option value={MIXED_CHOICE} disabled>
          {C.mixed}
        </option>
      )}
      {choices?.map(renderOption)}
      {groups?.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.choices.map(renderOption)}
        </optgroup>
      ))}
    </select>
  );
}

/** One of a few, as pressed buttons (alignment). */
export function Toggles({ label, value, choices, onChange }: { label: string; value: string | undefined; choices: readonly (Choice & { glyph: string })[]; onChange: (value: string) => void }) {
  const { readOnly } = useInspector();
  return (
    <div className="deck-inspector-toggles" role="group" aria-label={label}>
      {choices.map((c) => (
        <button key={c.value} type="button" className="deck-inspector-toggle" aria-label={c.label} title={c.label} aria-pressed={value === c.value} disabled={readOnly} onClick={() => onChange(c.value)}>
          {c.glyph}
        </button>
      ))}
    </div>
  );
}

export function Button({ label, children, disabled = false, onClick }: { label: string; children?: ReactNode; disabled?: boolean; onClick: () => void }) {
  const { readOnly } = useInspector();
  return (
    <button type="button" className="deck-inspector-button" aria-label={label} disabled={readOnly || disabled} onClick={onClick}>
      {children ?? label}
    </button>
  );
}

export function TextField({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (value: string, how: Write) => void }) {
  const { readOnly } = useInspector();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      className="deck-inspector-input deck-inspector-text"
      aria-label={label}
      disabled={readOnly}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
        onCommit(event.target.value, { typing: label });
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
