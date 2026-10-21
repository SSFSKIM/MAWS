// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the sections every kind of element
// may have, each shown only where its properties apply to every selected element (css.ts's applies-to column): Arrange
// (position and size in px, rotation composed with the element's other transforms, opacity), Fill (a colour, a linear
// gradient where the element takes one, none), Border (one `border` value from width, style and colour; the radius),
// Shadow (the first `box-shadow` in parts, the rest kept) and Text (family, size, weight, colour, alignment, line height,
// letter spacing, `data-fit`).
import { useId } from 'react';
import { checkValue } from '../../css';
import { pinToLeftTop, px, readTransform, rotationOf, transformFallback, withRotation } from '../../geometry';
import { INSPECTOR_COPY as C } from './copy';
import { Button, ColourField, NumberField, Refusal, Row, Section, SelectField, Toggles, useInspector, useRefusal, type Choice } from './fields';
import { canAll, common, type Picked } from './selection';
import {
  addStop, bareOf, BORDER_STYLES, borderWith, COLOUR_TOKENS, familyLabel, fillKind, firstColour, fontGroups, gradientValue, MAX_STOPS, MIN_STOPS,
  parseBorder, parseGradient, parseShadow, pxOf, rawHint, SHADOW_DEFAULT, shadowValue, tokenLabel, tokenTitle, tokenValue, varName, type Gradient, type Shadow,
} from './values';

const pxOrNull = (n: number | null) => (n === null ? null : px(n));

// ---------------------------------------------------------------- arrange

type Side = 'left' | 'top' | 'width' | 'height';
const BOX_KEY = { left: 'x', top: 'y', width: 'w', height: 'h' } as const;

export function Arrange() {
  const { picked, measure, style } = useInspector();
  if (picked.some((p) => p.tag === 'tr' || p.tag === 'th' || p.tag === 'td')) return null;
  const pinned = canAll('left', picked);
  const sized = canAll('width', picked);
  const turns = canAll('transform', picked);
  const fades = canAll('opacity', picked);
  if (!pinned && !sized && !turns && !fades) return null;

  /** A side in px: the style's, else the laid-out box's (a % or a right pin shows where it is). */
  const at = (p: Picked, side: Side) => pxOf(p.style[side]) ?? measure?.(p.id)?.[BOX_KEY[side]] ?? null;
  const field = (side: Side, label: string) => {
    // P4-B2 (D13): shown whole, so "Mixed" only where the whole numbers shown differ; the first's own value is stepped from
    const v = common(picked, (p) => {
      const n = at(p, side);
      return n === null ? null : Math.round(n);
    });
    const hint = common(picked, (p) => p.style[side]);
    return (
      <NumberField
        key={side}
        label={label}
        caption={label}
        value={v.mixed ? null : at(picked[0]!, side)}
        mixed={v.mixed}
        whole
        hint={rawHint(hint.value)}
        onCommit={(n, how) => {
          if (side === 'width' || side === 'height') return style(() => ({ [side]: pxOrNull(n) }), how);
          if (n === null) return [];
          // a right or bottom pin (or a % or calc) becomes left/top px where the element is, then the side is set
          return style((p) => {
            const b = measure?.(p.id);
            const far = side === 'left' ? 'right' : 'bottom';
            const pin = b ? pinToLeftTop(p.style, b) : p.style[far] !== undefined ? { [far]: null } : {};
            return { ...pin, [side]: px(n) };
          }, how);
        }}
      />
    );
  };
  const rotation = common(picked, (p) => rotationOf(p.style.transform));
  // fix wave 3: a transform that is a design-system token is taken whole; a rotation cannot be composed beside it
  const token = picked.some((p) => p.style.transform !== undefined && readTransform(p.style.transform, 1, 1) === null);
  const detachable = token && picked.every((p) => p.style.transform === undefined || readTransform(p.style.transform, 1, 1) !== null || transformFallback(p.style.transform) !== null);
  const opacity = common(picked, (p) => bareOf(p.style.opacity));
  return (
    <Section title={C.arrange}>
      {pinned && <div className="deck-inspector-pair">{[field('left', C.x), field('top', C.y)]}</div>}
      {sized && <div className="deck-inspector-pair">{[field('width', C.width), field('height', C.height)]}</div>}
      <div className="deck-inspector-pair">
        {turns && (
          <NumberField
            label={C.rotation}
            caption={C.rotation}
            unit="°"
            value={rotation.value ?? null}
            mixed={rotation.mixed}
            disabled={token}
            onCommit={(n, how) => style((p) => ({ transform: withRotation(p.style.transform, n ?? 0) }), how)}
          />
        )}
        {turns && token && detachable && (
          <Button label={C.detachTransform} onClick={() => style((p) => (readTransform(p.style.transform, 1, 1) === null ? { transform: transformFallback(p.style.transform) } : null), 'edit')}>
            {C.detachTransform}
          </Button>
        )}
        {fades && (
          <NumberField
            label={C.opacity}
            caption={C.opacity}
            step={0.05}
            value={opacity.value ?? (opacity.mixed ? null : 1)}
            mixed={opacity.mixed}
            onCommit={(n, how) => style(() => ({ opacity: n === null || n === 1 ? null : String(n) }), how)}
          />
        )}
      </div>
      {turns && token && <p className="deck-inspector-note">{picked.length === 1 ? C.tokenTransform(transformFallback(picked[0]!.style.transform)) : C.tokenTransforms(detachable)}</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- fill

const FLAT_ONLY = new Set(['tr', 'x-shape', 'hr']);
const ACCENT = COLOUR_TOKENS.find((t) => t.name === '--ds-color-accent')!;
// P3-F: a fill switched on starts as the system's raised surface (the house's white), which its text colour reads on and
// a dark system or a Theme switch restyles; never a literal colour (X28)
const SURFACE = COLOUR_TOKENS.find((t) => t.name === '--ds-color-bg-raised')!;

export function Fill() {
  const { picked, style } = useInspector();
  const [refused, refuse] = useRefusal();
  if (!canAll('background', picked)) return null;
  const flatOnly = picked.some((p) => FLAT_ONLY.has(p.tag));
  const bg = common(picked, (p) => p.style.background);
  const kind = bg.mixed ? null : fillKind(bg.value);
  const choices: Choice[] = [
    { value: 'none', label: C.none },
    { value: 'colour', label: C.colour },
    ...(flatOnly ? [] : [{ value: 'gradient', label: C.gradient }]),
    ...(kind === 'other' ? [{ value: 'other', label: C.other }] : []),
  ];
  const switchTo = (next: string) => {
    if (next === kind || next === 'other') return;
    const base = (p: Picked) => firstColour(p.style.background) ?? tokenValue(SURFACE);
    if (next === 'none') refuse(style(() => ({ background: null }), 'edit'));
    else if (next === 'colour') refuse(style((p) => ({ background: base(p) }), 'edit'));
    else refuse(style((p) => ({ background: gradientValue({ angle: 180, stops: [{ color: base(p), at: 0 }, { color: tokenValue(ACCENT), at: 100 }] }) }), 'edit'));
  };
  const gradient = kind === 'gradient' ? parseGradient(bg.value) : null;
  return (
    <Section title={C.fill}>
      <Row>
        <SelectField label={C.fillKind} value={kind ?? 'none'} mixed={bg.mixed} choices={choices} onChange={switchTo} />
      </Row>
      <Refusal reason={refused} />
      {gradient ? (
        <GradientEditor gradient={gradient} />
      ) : kind === 'other' ? (
        <p className="deck-inspector-note" title={bg.value}>
          {bg.value}
        </p>
      ) : (
        <ColourField label={C.fillColour} value={kind === 'colour' ? bg.value : undefined} mixed={bg.mixed} onCommit={(v, how) => style(() => ({ background: v }), how)} />
      )}
    </Section>
  );
}

function GradientEditor({ gradient: g }: { gradient: Gradient }) {
  const { style } = useInspector();
  const [refused, refuse] = useRefusal();
  const write = (next: Gradient, how: Parameters<typeof style>[1]) => style(() => ({ background: gradientValue(next) }), how);
  const stopId = useId();
  return (
    <div className="deck-inspector-gradient">
      <Row>
        <NumberField label={C.gradientAngle} caption={C.gradientAngle} unit="°" value={g.angle} onCommit={(n, how) => write({ ...g, angle: n ?? 180 }, how)} />
      </Row>
      {g.stops.map((s, i) => (
        <div key={`${stopId}-${i}`} className="deck-inspector-stop">
          <div className="deck-inspector-stop-head">
            <NumberField
              label={C.stopPosition(i + 1)}
              caption={C.stopPosition(i + 1)}
              unit="%"
              value={s.at}
              hint={C.auto}
              onCommit={(n, how) => write({ ...g, stops: g.stops.map((t, k) => (k === i ? { ...t, at: n } : t)) }, how)}
            />
            <Button label={C.removeStop(i + 1)} disabled={g.stops.length <= MIN_STOPS} onClick={() => refuse(write({ ...g, stops: g.stops.filter((_, k) => k !== i) }, 'edit'))}>
              −
            </Button>
          </div>
          <ColourField
            label={C.stopColour(i + 1)}
            value={s.color}
            onCommit={(v, how) => (v === null ? [] : write({ ...g, stops: g.stops.map((t, k) => (k === i ? { ...t, color: v } : t)) }, how))}
          />
        </div>
      ))}
      <Button label={C.addStop} disabled={g.stops.length >= MAX_STOPS} onClick={() => refuse(write(addStop(g), 'edit'))} />
      <Refusal reason={refused} />
    </div>
  );
}

// ---------------------------------------------------------------- border

export function Border() {
  const { picked, style } = useInspector();
  const [refused, refuse] = useRefusal();
  const stroke = canAll('border', picked) && !picked.some((p) => p.tag === 'x-connector');
  const rounds = canAll('border-radius', picked);
  if (!stroke && !rounds) return null;
  const part = <K extends 'width' | 'style' | 'color'>(k: K) => common(picked, (p) => parseBorder(p.style.border)[k]);
  const [width, kind, colour] = [part('width'), part('style'), part('color')];
  const radius = common(picked, (p) => p.style['border-radius']);
  return (
    <Section title={C.border}>
      {stroke && (
        <>
          <div className="deck-inspector-pair">
            <NumberField
              label={C.borderWidth}
              caption={C.borderWidth}
              unit="px"
              value={pxOf(width.value ?? undefined)}
              mixed={width.mixed}
              hint={rawHint(width.value ?? undefined)}
              onCommit={(n, how) => (n === null ? [] : style((p) => ({ border: borderWith(p.style.border, { width: px(n) }) }), how))}
            />
            <label className="deck-inspector-number">
              <span className="deck-inspector-mini">{C.borderStyle}</span>
              <SelectField
                label={C.borderStyle}
                value={kind.value ?? 'none'}
                mixed={kind.mixed}
                choices={BORDER_STYLES.map((s) => ({ value: s, label: s }))}
                onChange={(s) => refuse(style((p) => ({ border: borderWith(p.style.border, { style: s }) }), 'edit'))}
              />
            </label>
          </div>
          <Refusal reason={refused} />
          <ColourField
            label={C.borderColour}
            value={colour.value ?? undefined}
            mixed={colour.mixed}
            onCommit={(v, how) => (v === null ? [] : style((p) => ({ border: borderWith(p.style.border, { color: v }) }), how))}
          />
        </>
      )}
      {rounds && (
        <Row>
          <NumberField
            label={C.radius}
            caption={C.radius}
            unit="px"
            value={pxOf(radius.value)}
            mixed={radius.mixed}
            hint={rawHint(radius.value)}
            onCommit={(n, how) => style(() => ({ 'border-radius': pxOrNull(n) }), how)}
          />
        </Row>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- shadow

export function ShadowSection() {
  const { picked, style, readOnly } = useInspector();
  const [refused, refuse] = useRefusal();
  if (!canAll('box-shadow', picked)) return null;
  const value = common(picked, (p) => p.style['box-shadow']);
  const on = value.mixed || value.value !== undefined;
  const first = value.mixed ? null : parseShadow(value.value).first;
  const write = (part: Partial<Shadow>, how: Parameters<typeof style>[1]) =>
    style((p) => {
      const now = parseShadow(p.style['box-shadow']);
      return { 'box-shadow': shadowValue({ ...(now.first ?? SHADOW_DEFAULT), ...part }, now.first ? now.rest : []) };
    }, how);
  // a shape other than a rect draws its shadow from its outline (drop-shadow, fix wave 1): it has no inset and no spread
  const outline = picked.some((p) => p.tag === 'x-shape' && p.attrs.kind !== 'rect');
  const len = (label: string, key: 'x' | 'y' | 'blur' | 'spread', disabled = false) => (
    <NumberField label={label} caption={label} unit="px" value={first?.[key] ?? null} mixed={value.mixed} disabled={disabled} onCommit={(n, how) => (n === null && key !== 'spread' ? [] : write({ [key]: n }, how))} />
  );
  return (
    <Section title={C.shadow}>
      <label className="deck-inspector-check">
        <input
          type="checkbox"
          aria-label={C.shadow}
          checked={on}
          disabled={readOnly}
          onChange={() => refuse(style(() => ({ 'box-shadow': on ? null : shadowValue(SHADOW_DEFAULT, []) }), 'edit'))}
        />
        <span>{C.shadow}</span>
      </label>
      <Refusal reason={refused} />
      {on && (
        <>
          <div className="deck-inspector-triple">
            {len(C.shadowX, 'x')}
            {len(C.shadowY, 'y')}
            {len(C.shadowBlur, 'blur')}
          </div>
          <div className="deck-inspector-triple">
            {len(C.shadowSpread, 'spread', outline)}
            <label className="deck-inspector-check">
              <input type="checkbox" aria-label={C.shadowInset} checked={!outline && (first?.inset ?? false)} disabled={readOnly || outline || value.mixed} onChange={() => write({ inset: !(first?.inset ?? false) }, 'edit')} />
              <span>{C.shadowInset}</span>
            </label>
          </div>
          {outline && <p className="deck-inspector-note">{C.outlineShadow}</p>}
          <ColourField label={C.shadowColour} value={first?.color} mixed={value.mixed} onCommit={(v, how) => (v === null ? [] : write({ color: v }, how))} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- text

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'ol']);
const TEXTISH = new Set([...TEXT_TAGS, 'table', 'th', 'td']);
const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
const FITS = ['', 'none', 'shrink', 'grow'];
const ALIGNS = [
  { value: 'left', label: C.align.left, glyph: '⇤' },
  { value: 'center', label: C.align.center, glyph: '↔' },
  { value: 'right', label: C.align.right, glyph: '⇥' },
  { value: 'justify', label: C.align.justify, glyph: '☰' },
];
/** A weight no list holds (a type class's token, by its friendly name), as a choice. */
function weightChoice(value: string): Choice {
  const token = varName(value);
  return token === null ? { value, label: rawHint(value) } : { value, label: tokenLabel(token), title: tokenTitle(token) };
}
const normFamily = (v: string) => {
  const r = checkValue('font-family', v);
  return r.ok ? r.value : v;
};

export function Text() {
  const { picked, style, attrs, faces } = useInspector();
  const [refused, refuse] = useRefusal();
  if (!picked.every((p) => TEXTISH.has(p.tag))) return null;
  const has = (prop: string) => canAll(prop, picked);
  const fits = picked.every((p) => TEXT_TAGS.has(p.tag));
  if (!['font-family', 'font-size', 'font-weight', 'color', 'text-align', 'line-height', 'letter-spacing'].some(has) && !fits) return null;
  const read = (prop: string) => common(picked, (p) => p.style[prop]);
  const set = (prop: string) => (v: string | null, how: Parameters<typeof style>[1]) => style(() => ({ [prop]: v }), how);

  const family = read('font-family');
  const groups = fontGroups(faces).map((g) => ({ label: g.label, choices: g.options.map((o) => ({ value: normFamily(o.value), label: o.label })) }));
  // a system face is its listed choice whatever fallback it was written with (every system defines the face)
  const familyToken = varName(family.value);
  const listed = groups.flatMap((g) => g.choices).find((c) => c.value === family.value || (familyToken !== null && varName(c.value) === familyToken));
  const familyChoices: Choice[] = [
    { value: '', label: C.inherited },
    ...(family.value !== undefined && !listed ? [{ value: family.value, label: familyLabel(family.value), title: familyToken === null ? undefined : tokenTitle(familyToken) }] : []),
  ];
  const size = read('font-size');
  const weight = read('font-weight');
  const lineHeight = read('line-height');
  const spacing = read('letter-spacing');
  const fit = common(picked, (p) => p.attrs['data-fit'] ?? '');
  return (
    <Section title={C.text}>
      {has('font-family') && (
        <Row>
          <SelectField label={C.font} value={listed?.value ?? family.value ?? ''} mixed={family.mixed} choices={familyChoices} groups={groups} onChange={(v) => refuse(set('font-family')(v === '' ? null : v, 'edit'))} />
        </Row>
      )}
      <div className="deck-inspector-pair">
        {has('font-size') && (
          <NumberField
            label={C.fontSize}
            caption={C.fontSize}
            unit="px"
            value={pxOf(size.value)}
            mixed={size.mixed}
            hint={rawHint(size.value)}
            onCommit={(n, how) => set('font-size')(pxOrNull(n), how)}
          />
        )}
        {has('font-weight') && (
          <label className="deck-inspector-number">
            <span className="deck-inspector-mini">{C.fontWeight}</span>
            <SelectField
              label={C.fontWeight}
              value={weight.value ?? ''}
              mixed={weight.mixed}
              choices={[
                { value: '', label: C.inherited },
                ...(weight.value !== undefined && !WEIGHTS.includes(weight.value) ? [weightChoice(weight.value)] : []),
                ...WEIGHTS.map((w) => ({ value: w, label: `${w} ${C.weights[w]}` })),
              ]}
              onChange={(v) => refuse(set('font-weight')(v === '' ? null : v, 'edit'))}
            />
          </label>
        )}
      </div>
      {has('color') && <ColourField label={C.textColour} value={read('color').value} mixed={read('color').mixed} placeholder={C.inherited} onCommit={(v, how) => set('color')(v, how)} />}
      {has('text-align') && (
        <Row>
          <Toggles label={C.alignment} value={read('text-align').value} choices={ALIGNS} onChange={(v) => refuse(set('text-align')(v, 'edit'))} />
        </Row>
      )}
      <div className="deck-inspector-pair">
        {has('line-height') && (
          <NumberField
            label={C.lineHeight}
            caption={C.lineHeight}
            step={0.05}
            value={bareOf(lineHeight.value)}
            mixed={lineHeight.mixed}
            hint={rawHint(lineHeight.value)}
            onCommit={(n, how) => set('line-height')(n === null ? null : String(n), how)}
          />
        )}
        {has('letter-spacing') && (
          <NumberField
            label={C.letterSpacing}
            caption={C.letterSpacing}
            unit="px"
            step={0.5}
            value={pxOf(spacing.value)}
            mixed={spacing.mixed}
            hint={rawHint(spacing.value)}
            onCommit={(n, how) => set('letter-spacing')(pxOrNull(n), how)}
          />
        )}
      </div>
      {fits && (
        <Row caption={C.textFit}>
          <SelectField
            label={C.textFit}
            value={fit.value ?? ''}
            mixed={fit.mixed}
            choices={FITS.map((f) => ({ value: f, label: C.fit[f]! }))}
            onChange={(v) => attrs(() => ({ 'data-fit': FITS.includes(v) && v !== '' ? v : null }), 'edit')}
          />
        </Row>
      )}
      <Refusal reason={refused} />
    </Section>
  );
}
