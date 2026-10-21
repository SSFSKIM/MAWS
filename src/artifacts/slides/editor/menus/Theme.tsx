// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "the Theme menu"; M6): the panel the header's Theme
// opens beside the stage. It switches the deck's design system (the artifact's `designSystemId`, through the shell's
// `choose`; Default follows the deck's Space and the owner's defaults, D's chain) and edits the deck's own overrides of
// the system's colours and faces (`dsOverrides`, X28's `TokenOverrides`, one transaction each), which the deck's scope
// sets after the system's, so a switch or an override restyles every slide by reference. Each system is offered with
// its own ground, text and accent; each colour and face shows the value the slides draw now, the system's or the deck's.
// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): Faces lists each of the deck's own faces with
// its state, so the owner sees what the engine host fetched from Google Fonts, what waits for it and what it refused by
// name (the same panel serves the design workbench).
import { useId, useState, type ReactNode } from 'react';
import { useDesignSystem, type DesignSystemRef, type TokenOverrides } from '../../../design-system/apply';
import { toSrgb, rgbToHex } from '../../../design-system/color';
import { parseCssColor, parseFontStack } from '../../../design-system/css-read';
import { literalValues } from '../../../design-system/resolve-vars';
import { faceFiles, googleFaceState, type DeckFace } from '../../deck';
import { setDeckOverride } from '../../writers';
import type { DeckSession } from '../session';
import { THEME_COPY as C } from './copy';
import './menus.css';

export interface DeckThemeChoice {
  /** The design systems the deck may name. */
  systems: readonly { id: string; name: string }[];
  /** The system the deck names itself; null when it follows its Space's or the owner's default. */
  chosen: string | null;
  /** Names the deck's system (null: follow the default); rejects with the store's refusal. */
  choose(id: string | null): Promise<void>;
}

export interface ThemePanelProps {
  session: DeckSession;
  /** The system governing the deck now (D's chain). */
  system: DesignSystemRef | { builtin: 'maws' } | null;
  theme?: DeckThemeChoice;
  overrides: TokenOverrides;
  faces: Readonly<Record<string, DeckFace>>;
  readOnly: boolean;
}

/** The colours the panel offers to override: the system's base colour roles (X28). */
export const THEME_COLOURS: readonly [name: string, label: string][] = [
  ['--ds-color-bg', 'Background'],
  ['--ds-color-bg-raised', 'Raised background'],
  ['--ds-color-text', 'Text'],
  ['--ds-color-text-muted', 'Muted text'],
  ['--ds-color-accent', 'Accent'],
  ['--ds-color-accent-text', 'Text on accent'],
  ['--ds-color-border', 'Border'],
];
export const THEME_FONTS: readonly [name: string, label: string][] = [
  ['--ds-font-display', 'Display face'],
  ['--ds-font-body', 'Body face'],
];

// Claude's basic faces with their generics: an override never names a face the Mac may lack without a fallback.
const BASIC_FACES: readonly [string, string][] = [
  ['Arial', 'sans-serif'],
  ['Verdana', 'sans-serif'],
  ['Tahoma', 'sans-serif'],
  ['Trebuchet MS', 'sans-serif'],
  ['Georgia', 'serif'],
  ['Times New Roman', 'serif'],
  ['Courier New', 'monospace'],
  ['Brush Script MT', 'cursive'],
];
const familyCss = (family: string) => (/^[A-Za-z][A-Za-z-]*$/.test(family) ? family : `"${family.replace(/["\\]/g, '')}"`);
/** A face as an override's value: the family, then a generic. */
export const faceStack = (family: string, generic: string) => `${familyCss(family)}, ${generic}`;

/** A colour as `#rrggbb` for the picker; null when it is not one plain colour. */
export function hexOf(value: string | undefined): string | null {
  const color = value === undefined ? null : parseCssColor(value);
  return color ? rgbToHex(toSrgb(color)) : null;
}

/** An override's colour as typed, normalized to `#rrggbb` (or `#rrggbbaa`); null when it is not a plain colour. */
export function readOverrideColour(text: string): string | null {
  const color = parseCssColor(text.trim());
  return color ? rgbToHex(toSrgb(color), true) : null;
}

export function ThemePanel({ session, system, theme, overrides, faces, readOnly }: ThemePanelProps) {
  const { view } = useDesignSystem(system);
  const values = view ? literalValues(view.tokens, 'deck', overrides) : new Map<string, string>();
  const write = (name: string, value: string | null, typing = false) => {
    if (readOnly) return;
    const run = (origin: object) => setDeckOverride(session.doc, name, value, origin);
    if (typing) session.typing(`theme:${name}`, run);
    else session.edit(run);
  };
  const overridden = Object.keys(overrides).filter((name) => THEME_COLOURS.some(([n]) => n === name) || THEME_FONTS.some(([n]) => n === name));

  return (
    <aside className="deck-inspector deck-theme" aria-label={C.panel} data-deck-rail="theme">
      <h2 className="deck-inspector-title">{C.panel}</h2>
      {theme && <SystemPicker theme={theme} governing={view?.name ?? null} readOnly={readOnly} />}
      <Section title={C.colours}>
        {THEME_COLOURS.map(([name, label]) => (
          <ColourOverride key={name} name={name} label={label} value={values.get(name)} own={overrides[name]} readOnly={readOnly} onWrite={write} />
        ))}
      </Section>
      <Section title={C.faces}>
        {THEME_FONTS.map(([name, label]) => (
          <FaceOverride key={name} name={name} label={label} value={values.get(name)} own={overrides[name]} faces={faces} readOnly={readOnly} onWrite={write} />
        ))}
        <DeckFaces faces={faces} />
      </Section>
      {overridden.length > 0 && (
        <div className="deck-inspector-section">
          <button type="button" className="deck-inspector-button" disabled={readOnly} onClick={() => session.edit((origin) => overridden.forEach((name) => setDeckOverride(session.doc, name, null, origin)))}>
            {C.resetAll}
          </button>
        </div>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="deck-inspector-section" aria-label={title}>
      <h3 className="deck-inspector-heading">{title}</h3>
      {children}
    </section>
  );
}

function SystemPicker({ theme, governing, readOnly }: { theme: DeckThemeChoice; governing: string | null; readOnly: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const chosen = pending !== undefined ? pending : theme.chosen;
  const pick = (id: string | null) => {
    if (readOnly || id === chosen) return;
    setError(null);
    setPending(id);
    theme.choose(id).then(
      () => setPending(undefined),
      (e: unknown) => {
        setPending(undefined);
        setError(C.switchFailed(e instanceof Error ? e.message : String(e)));
      },
    );
  };
  return (
    <section className="deck-inspector-section" aria-label={C.system}>
      <h3 className="deck-inspector-heading">{C.system}</h3>
      <div role="radiogroup" aria-label={C.system} className="deck-theme-systems">
        <SystemOption label={C.followDefault} detail={chosen === null && governing ? governing : C.followDefaultDetail} system={null} checked={chosen === null} disabled={readOnly} onPick={() => pick(null)} />
        {theme.systems.map((s) => (
          <SystemOption key={s.id} label={s.name} system={{ id: s.id }} checked={chosen === s.id} disabled={readOnly} onPick={() => pick(s.id)} />
        ))}
      </div>
      {error && (
        <p role="alert" className="deck-inspector-refused">
          {error}
        </p>
      )}
    </section>
  );
}

const SWATCHES = ['--ds-color-bg', '--ds-color-text', '--ds-color-accent'] as const;

function SystemOption({ label, detail, system, checked, disabled, onPick }: { label: string; detail?: string; system: DesignSystemRef | null; checked: boolean; disabled: boolean; onPick: () => void }) {
  const { view } = useDesignSystem(system);
  const values = view ? literalValues(view.tokens, 'deck', undefined) : null;
  return (
    <button type="button" role="radio" aria-checked={checked} className="deck-theme-system" data-system={system?.id ?? 'default'} disabled={disabled} onClick={onPick}>
      <span className="deck-theme-system-swatches" aria-hidden>
        {values && SWATCHES.map((name) => <span key={name} className="deck-theme-system-swatch" style={{ background: values.get(name) }} />)}
      </span>
      <span className="deck-theme-system-name">{label}</span>
      {detail && <span className="deck-theme-system-detail">{detail}</span>}
    </button>
  );
}

interface OverrideProps {
  name: string;
  label: string;
  /** What the slides draw now: the deck's override, else the system's value. */
  value: string | undefined;
  /** The deck's own override, if any. */
  own: string | undefined;
  readOnly: boolean;
  onWrite: (name: string, value: string | null, typing?: boolean) => void;
}

function ColourOverride({ name, label, value, own, readOnly, onWrite }: OverrideProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hex = hexOf(value) ?? '#000000';
  return (
    <div className="deck-inspector-row deck-theme-row" data-token={name} data-overridden={own !== undefined || undefined}>
      <span className="deck-inspector-caption">{label}</span>
      <div className="deck-inspector-control">
        <input type="color" className="deck-theme-picker" aria-label={C.pick(label)} disabled={readOnly} value={hex} onChange={(event) => onWrite(name, event.target.value, true)} />
        <span className="deck-inspector-input-wrap">
          <input
            type="text"
            className="deck-inspector-input"
            aria-label={label}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? `${id}-error` : undefined}
            spellCheck={false}
            disabled={readOnly}
            value={draft ?? own ?? hexOf(value) ?? value ?? ''}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            onBlur={() => {
              if (draft === null) return;
              const colour = readOverrideColour(draft);
              if (draft.trim() === '') onWrite(name, null);
              else if (colour === null) return setError(C.notAColour(draft));
              else onWrite(name, colour);
              setDraft(null);
            }}
          />
        </span>
        {own !== undefined && (
          <button type="button" className="deck-inspector-button" aria-label={C.reset(label)} title={C.reset(label)} disabled={readOnly} onClick={() => onWrite(name, null)}>
            ↺
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="deck-inspector-refused">
          {error}
        </p>
      )}
    </div>
  );
}

const SYSTEM_FACE = '';

function FaceOverride({ name, label, value, own, faces, readOnly, onWrite }: OverrideProps & { faces: Readonly<Record<string, DeckFace>> }) {
  const systemFamily = parseFontStack(value ?? '')?.[0] ?? '';
  const deckFamilies = [...new Set(Object.values(faces).map((f) => f.family).filter((f): f is string => typeof f === 'string' && f.trim() !== ''))];
  const options: { value: string; label: string; group: string }[] = [
    ...deckFamilies.map((family) => ({ value: faceStack(family, 'sans-serif'), label: family, group: C.deckFaces })),
    ...BASIC_FACES.map(([family, generic]) => ({ value: faceStack(family, generic), label: family, group: C.basicFaces })),
  ];
  const known = own === undefined || options.some((o) => o.value === own);
  return (
    <div className="deck-inspector-row deck-theme-row" data-token={name} data-overridden={own !== undefined || undefined}>
      <span className="deck-inspector-caption">{label}</span>
      <div className="deck-inspector-control">
        <select className="deck-inspector-select" aria-label={label} disabled={readOnly} value={own ?? SYSTEM_FACE} onChange={(event) => onWrite(name, event.target.value === SYSTEM_FACE ? null : event.target.value)}>
          <option value={SYSTEM_FACE}>{C.systemFace(own === undefined ? systemFamily : null)}</option>
          {!known && <option value={own}>{parseFontStack(own!)?.[0] ?? own}</option>}
          {[C.deckFaces, C.basicFaces].map((group) => {
            const inGroup = options.filter((o) => o.group === group);
            return inGroup.length ? (
              <optgroup key={group} label={group}>
                {inGroup.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>
    </div>
  );
}

type FaceState = 'uploaded' | 'missing' | 'saved' | 'pending' | 'refused';

/** What a face draws from (D19): its uploaded file, the files MAWS saved from Google Fonts, or its fallback, and why. */
function faceState(face: DeckFace): { state: FaceState; text: string } {
  const google = googleFaceState(face);
  if (google === null) return faceFiles(face).length > 0 ? { state: 'uploaded', text: C.faceUploaded } : { state: 'missing', text: C.faceMissing };
  if (google.state === 'refused') return { state: 'refused', text: google.message };
  return google.state === 'saved' ? { state: 'saved', text: C.faceSaved } : { state: 'pending', text: C.facePending };
}

/** The deck's own faces by family, each with its state (D19). */
function DeckFaces({ faces }: { faces: Readonly<Record<string, DeckFace>> }) {
  const id = useId();
  const entries = Object.entries(faces)
    .filter(([, face]) => typeof face.family === 'string')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return null;
  return (
    <div className="deck-inspector-row">
      <span id={`${id}-faces`} className="deck-inspector-caption">
        {C.faceList}
      </span>
      <ul className="deck-theme-faces" aria-labelledby={`${id}-faces`}>
        {entries.map(([key, face]) => {
          const { state, text } = faceState(face);
          return (
            <li key={key} className="deck-theme-face" data-face={key} data-face-state={state}>
              <span className="deck-theme-face-family">{face.family}</span>{' '}
              <span className="deck-theme-face-state">{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
