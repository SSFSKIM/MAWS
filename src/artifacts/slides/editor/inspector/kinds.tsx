// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector"): the sections of one kind of element,
// shown when every selected element is that kind: an image's fit, crop (`data-crop`), replacement (an upload) and alt
// text; a shape's kind; an icon's name and colour; a connector's heads (`head-start`/`head-end`, the `head` shorthand
// removed so the two read alone), route and stroke; a table's rows and columns. Attribute values come from the
// dialect's closed lists, so they are the loader's by construction; a crop is checked against its range first.
// Final fix wave (B4): Replace's upload is the session's awaited edit (`later`): the tab's close waits for it, and the
// picture is replaced only if the deck still takes writes when the upload is done.
import { useRef, useState } from 'react';
import { isAssetRef } from '../../css';
import { px } from '../../geometry';
import { connectorHeads } from '../../glyphs';
import { ICON_NAMES } from '../../parse';
import { setAttrsOf, restyle, tableColumn, tableRow } from '../../writers-elements';
import { INSPECTOR_COPY as C } from './copy';
import { Button, ColourField, NumberField, Refusal, Row, Section, SelectField, TextField, useInspector, useRefusal } from './fields';
import { common, tableAt, type Picked } from './selection';
import { BORDER_STYLES, cropValue, parseCrop, pxOf, rawHint, type Crop } from './values';

const every = (picked: readonly Picked[], tag: string) => picked.length > 0 && picked.every((p) => p.tag === tag);
const NO_CROP: Crop = { zoom: 1, x: 50, y: 50 };

// ---------------------------------------------------------------- image

export function ImageSection() {
  const { session, picked, style, attrs, uploadAsset, readOnly } = useInspector();
  const [refused, refuse] = useRefusal();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!every(picked, 'img')) return null;
  const fit = common(picked, (p) => p.style['object-fit'] ?? '');
  const crop = common(picked, (p) => p.attrs['data-crop'] ?? null);
  const shown = crop.mixed ? null : parseCrop(crop.value ?? undefined);
  const alt = common(picked, (p) => p.attrs.alt ?? '');
  const writeCrop = (part: Partial<Crop>, how: Parameters<typeof attrs>[1]): string[] => {
    const next = new Map<string, string>();
    for (const p of picked) {
      const checked = cropValue({ ...(parseCrop(p.attrs['data-crop']) ?? NO_CROP), ...part });
      if (!checked.ok) return [checked.reason];
      next.set(p.id, checked.value);
    }
    attrs((p) => ({ 'data-crop': next.get(p.id) ?? null }), how);
    return [];
  };
  const cropField = (label: string, key: keyof Crop, unit?: string) => (
    <NumberField
      label={label}
      caption={label}
      unit={unit}
      step={key === 'zoom' ? 0.1 : 1}
      value={shown ? shown[key] : null}
      mixed={crop.mixed}
      hint={String(NO_CROP[key])}
      onCommit={(n, how) => (n === null ? [] : writeCrop({ [key]: n }, how))}
    />
  );
  const replace = async (chosen: File | undefined) => {
    if (!chosen || !uploadAsset) return;
    setBusy(true);
    try {
      const placed = await session.later(uploadAsset(chosen), (ref) => {
        if (!isAssetRef(ref) || !ref.startsWith('assets/')) return refuse([C.notAnAsset(ref)]);
        refuse([]);
        // a new picture drops the crop made for the old one (Claude: keep data-crop unless src changes)
        attrs(() => ({ src: ref, 'data-crop': null }), 'edit');
      });
      if (!placed) refuse([C.replaceNotPlaced]);
    } catch (e) {
      refuse([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <Section title={C.image}>
      <Row caption={C.imageFit}>
        <SelectField
          label={C.imageFit}
          value={fit.value ?? ''}
          mixed={fit.mixed}
          choices={[...(fit.value === '' ? [{ value: '', label: C.auto }] : []), { value: 'cover', label: C.cover }, { value: 'contain', label: C.contain }]}
          onChange={(v) => refuse(style(() => ({ 'object-fit': v === '' ? null : v }), 'edit'))}
        />
      </Row>
      <div className="deck-inspector-triple">
        {cropField(C.cropZoom, 'zoom', '×')}
        {cropField(C.cropX, 'x', '%')}
        {cropField(C.cropY, 'y', '%')}
      </div>
      <div className="deck-inspector-actions">
        <Button label={C.resetCrop} disabled={!crop.mixed && crop.value === null} onClick={() => attrs(() => ({ 'data-crop': null }), 'edit')} />
        {uploadAsset && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              aria-label={C.imageFile}
              hidden
              disabled={readOnly || busy}
              onChange={(event) => void replace(event.target.files?.[0])}
            />
            <Button label={C.replace} disabled={busy} onClick={() => file.current?.click()}>
              {busy ? C.uploading : C.replace}
            </Button>
          </>
        )}
      </div>
      <Row caption={C.altText} wide>
        <TextField label={C.altText} value={alt.mixed ? '' : (alt.value ?? '')} placeholder={alt.mixed ? C.mixed : C.altPlaceholder} onCommit={(v, how) => attrs(() => ({ alt: v }), how)} />
      </Row>
      <Refusal reason={refused} />
    </Section>
  );
}

// ---------------------------------------------------------------- shape and icon

const SHAPE_KINDS = Object.keys(C.shapes);

export function ShapeSection() {
  const { picked, session, slideId } = useInspector();
  if (!every(picked, 'x-shape')) return null;
  const kind = common(picked, (p) => p.attrs.kind ?? 'rect');
  const change = (next: string) => {
    if (!SHAPE_KINDS.includes(next)) return;
    session.edit((origin) => {
      setAttrsOf(session.doc, slideId, Object.fromEntries(picked.map((p) => [p.id, { kind: next }])), origin);
      // a radius is a rect's only (the loader drops it on any other kind)
      if (next !== 'rect') for (const p of picked) if (p.style['border-radius'] !== undefined) restyle(session.doc, slideId, p.id, { 'border-radius': null }, origin);
    });
  };
  return (
    <Section title={C.shape}>
      <Row>
        <SelectField label={C.shapeKind} value={kind.value ?? 'rect'} mixed={kind.mixed} choices={SHAPE_KINDS.map((k) => ({ value: k, label: C.shapes[k]! }))} onChange={change} />
      </Row>
    </Section>
  );
}

export function IconSection() {
  const { picked, style, attrs } = useInspector();
  if (!every(picked, 'x-icon')) return null;
  const name = common(picked, (p) => p.attrs.name ?? '');
  const colour = common(picked, (p) => p.style.color);
  return (
    <Section title={C.icon}>
      <Row>
        <SelectField label={C.iconName} value={name.value ?? ''} mixed={name.mixed} choices={ICON_NAMES.map((n) => ({ value: n, label: n }))} onChange={(n) => ICON_NAMES.includes(n) && attrs(() => ({ name: n }), 'edit')} />
      </Row>
      <ColourField label={C.iconColour} value={colour.value} mixed={colour.mixed} placeholder={C.inherited} onCommit={(v, how) => style(() => ({ color: v }), how)} />
    </Section>
  );
}

// ---------------------------------------------------------------- connector

const HEADS = ['none', 'open', 'filled'] as const;
const ROUTES = ['straight', 'hv', 'vh', 'elbow'];

export function ConnectorSection() {
  const { picked, style, attrs } = useInspector();
  const [refused, refuse] = useRefusal();
  if (!every(picked, 'x-connector')) return null;
  const start = common(picked, (p) => connectorHeads(p.attrs).start);
  const end = common(picked, (p) => connectorHeads(p.attrs).end);
  const route = common(picked, (p) => p.attrs.route ?? 'straight');
  const colour = common(picked, (p) => p.style.color);
  const width = common(picked, (p) => p.style['border-width']);
  const line = common(picked, (p) => p.style['border-style'] ?? 'solid');
  // both ends written explicitly and the shorthand removed, so each end reads alone
  const setHead = (which: 'start' | 'end') => (v: string) => {
    if (!(HEADS as readonly string[]).includes(v)) return;
    attrs((p) => {
      const now = connectorHeads(p.attrs);
      return { head: null, 'head-start': which === 'start' ? v : now.start, 'head-end': which === 'end' ? v : now.end };
    }, 'edit');
  };
  const heads = HEADS.map((h) => ({ value: h, label: C.heads[h]! }));
  return (
    <Section title={C.connector}>
      <div className="deck-inspector-pair">
        <label className="deck-inspector-number">
          <span className="deck-inspector-mini">{C.startHead}</span>
          <SelectField label={C.startHead} value={start.value ?? 'none'} mixed={start.mixed} choices={heads} onChange={setHead('start')} />
        </label>
        <label className="deck-inspector-number">
          <span className="deck-inspector-mini">{C.endHead}</span>
          <SelectField label={C.endHead} value={end.value ?? 'none'} mixed={end.mixed} choices={heads} onChange={setHead('end')} />
        </label>
      </div>
      <Row caption={C.route}>
        <SelectField label={C.route} value={route.value ?? 'straight'} mixed={route.mixed} choices={ROUTES.map((r) => ({ value: r, label: C.routes[r]! }))} onChange={(r) => ROUTES.includes(r) && attrs(() => ({ route: r }), 'edit')} />
      </Row>
      <ColourField label={C.lineColour} value={colour.value} mixed={colour.mixed} onCommit={(v, how) => style(() => ({ color: v }), how)} />
      <div className="deck-inspector-pair">
        <NumberField
          label={C.lineWidth}
          caption={C.lineWidth}
          unit="px"
          value={pxOf(width.value)}
          mixed={width.mixed}
          hint={rawHint(width.value) || '2'}
          onCommit={(n, how) => style(() => ({ 'border-width': n === null ? null : px(n) }), how)}
        />
        <label className="deck-inspector-number">
          <span className="deck-inspector-mini">{C.lineStyle}</span>
          <SelectField
            label={C.lineStyle}
            value={line.value ?? 'solid'}
            mixed={line.mixed}
            choices={BORDER_STYLES.map((s) => ({ value: s, label: s }))}
            onChange={(s) => refuse(style(() => ({ 'border-style': s === 'solid' ? null : s }), 'edit'))}
          />
        </label>
      </div>
      <Refusal reason={refused} />
    </Section>
  );
}

// ---------------------------------------------------------------- table

export function TableSection() {
  const { picked, session, slideId } = useInspector();
  const [refused, refuse] = useRefusal();
  const at = tableAt(session.doc, slideId, picked);
  if (!at) return null;
  const lastRow = at.rows[at.rows.length - 1]!;
  const column = at.column ?? at.columns - 1;
  /** One table gesture; a refusal (a limit, the last row or column) shown; the table selected when the picked part goes. */
  const run = (write: (origin: object) => void, removesPicked: boolean) => {
    const out: { problem: string | null } = { problem: null };
    session.edit((origin) => {
      try {
        write(origin);
      } catch (e) {
        out.problem = e instanceof Error ? e.message : String(e);
      }
    });
    refuse(out.problem === null ? [] : [out.problem]);
    if (out.problem === null && removesPicked) session.select([at.tableId]);
  };
  const pickedTag = picked[0]!.tag;
  return (
    <Section title={C.table}>
      <p className="deck-inspector-note">{C.tableSize(at.rows.length, at.columns)}</p>
      <div className="deck-inspector-actions">
        <Button label={C.addRow} onClick={() => run((o) => tableRow(session.doc, slideId, at.tableId, { add: at.row ?? lastRow }, o), false)} />
        <Button label={C.removeRow} disabled={at.rows.length <= 1} onClick={() => run((o) => tableRow(session.doc, slideId, at.tableId, { remove: at.row ?? lastRow }, o), pickedTag !== 'table')} />
        <Button label={C.addColumn} onClick={() => run((o) => tableColumn(session.doc, slideId, at.tableId, { add: column }, o), false)} />
        <Button label={C.removeColumn} disabled={at.columns <= 1} onClick={() => run((o) => tableColumn(session.doc, slideId, at.tableId, { remove: column }, o), pickedTag === 'th' || pickedTag === 'td')} />
      </div>
      <Refusal reason={refused} />
    </Section>
  );
}
