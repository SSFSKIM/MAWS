// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector", D10): the inspector beside the stage.
// It edits the selection (the session's, in pick order; the slide's section when nothing is selected), showing only the
// sections whose properties apply to every selected element, and writes a change to each of them as one gesture: one
// transaction per element inside one `session.edit` (one undo step), or inside a field's typing step while a number or
// colour is typed. Every value is checked as the loader checks it before anything is written (css.ts through
// `planStyle`, then `restyle`); a refusal writes nothing and is shown by its field. Values may be the design system's
// tokens (`var(--ds-color-*)` with the house system's literal as fallback); the swatches paint inside the deck's
// `DesignSystemScope`, which the caller renders the inspector in. The panel follows the replica: a remote change
// re-renders it.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D13; tracker row 280): it reads the selection at the
// settled version (an update or a layout pass outside a drag, and every gesture's end), so it shows where a move or a
// resize left the element, not its frames, and X, Y, W and H in whole pixels (the model keeps its fractions).
import { useMemo, useSyncExternalStore } from 'react';
import type { Doc } from '../../yjs';
import type { SlideCanvas } from '../canvas';
import type { DeckFace } from '../deck';
import { ROOT } from '../model';
import { restyle, setAttrsOf } from '../writers-elements';
import { INSPECTOR_COPY as C } from './inspector/copy';
import { InspectorContext, type InspectorApi, type Write } from './inspector/fields';
import { ConnectorSection, IconSection, ImageSection, ShapeSection, TableSection } from './inspector/kinds';
import { Arrange, Border, Fill, ShadowSection, Text } from './inspector/sections';
import { pickedOf, planStyle, type Picked, type Props } from './inspector/selection';
import { elementName } from './names';
import type { DeckSession } from './session';
import { useSettledVersion } from './transform/use-doc-version';
import './inspector.css';

export interface InspectorProps {
  session: DeckSession;
  slideId: string;
  readOnly: boolean;
  /** The deck's faces (deck.json), offered first in the font list. */
  faces: Readonly<Record<string, DeckFace>>;
  /** Uploads a picked file as the artifact's asset; resolves to its `assets/<name>` ref. No Replace image without it. */
  uploadAsset?: (file: File) => Promise<string>;
  /** An element's laid-out box in its host (slide px): position and size shown when its style does not say them in px. */
  measure?: (elementId: string) => { x: number; y: number; w: number; h: number } | null;
  /** P4-B2 (D13): the slide's canvas on the stage, whose layout passes (geometry moving with no write) refresh the panel. */
  canvas?: SlideCanvas | null;
  /** The deck shell overlays this panel at narrow widths; the design shell owns its inspector's layout instead. */
  overlayRail?: boolean;
}

/**
 * P4-R9: the selection as the model has it at the replica's `version`. The React Compiler memoizes a computation on what
 * it reads, never on a dependency list, so the version is an argument here: with `doc` the same object at every update,
 * a read keyed on it alone kept the fields at the values they opened with.
 */
function pickedAt(doc: Doc, slideId: string, selection: readonly string[], version: number): Picked[] {
  void version;
  return pickedOf(doc, slideId, selection);
}

/** P4-B2 (D13): the laid-out boxes as of `version`: a new reader per version, so what reads it is keyed on the version. */
function measureAt(measure: InspectorProps['measure'], version: number): InspectorProps['measure'] {
  void version;
  return measure && ((id) => measure(id));
}

export function Inspector({ session, slideId, readOnly, faces, uploadAsset, measure: measureNow, canvas = null, overlayRail = false }: InspectorProps) {
  const doc = session.doc;
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const version = useSettledVersion(session, canvas);
  const selection = state.currentSlide === slideId ? state.selection : [];
  const picked = useMemo(() => pickedAt(doc, slideId, selection, version), [doc, slideId, selection, version]);
  const measure = useMemo(() => measureAt(measureNow, version), [measureNow, version]);

  const api = useMemo((): InspectorApi => {
    const typingKey = (how: Write) => (how === 'edit' ? null : `inspector:${how.typing}:${selection.join(',')}`);
    const write = (how: Write, run: (origin: object) => void) => {
      const key = typingKey(how);
      if (key === null) session.edit(run);
      else session.typing(key, run);
    };
    return {
      session,
      slideId,
      picked,
      readOnly,
      faces,
      uploadAsset,
      measure,
      style: (propsFor, how) => {
        if (readOnly) return [];
        // planned against the model as it is now, every element first: one refusal writes nothing to any
        const plan = planStyle(pickedOf(doc, slideId, selection), propsFor);
        if (plan.reasons.length) return plan.reasons;
        if (plan.writes.length === 0) return [];
        const problems: string[] = [];
        write(how, (origin) => {
          for (const [id, props] of plan.writes) problems.push(...restyle(doc, slideId, id, props, origin));
        });
        return problems;
      },
      attrs: (attrsFor, how) => {
        if (readOnly) return;
        const writes: Record<string, Props> = {};
        for (const p of pickedOf(doc, slideId, selection)) {
          const a = attrsFor(p);
          if (a && Object.keys(a).length) writes[p.id] = a;
        }
        if (Object.keys(writes).length) write(how, (origin) => setAttrsOf(doc, slideId, writes, origin));
      },
    };
  }, [session, doc, slideId, picked, selection, readOnly, faces, uploadAsset, measure]);

  const slide = picked.length === 1 && picked[0]!.id === ROOT;
  const title = picked.length === 0 ? '' : slide ? C.slide : picked.length > 1 ? C.selected(picked.length) : elementName(picked[0]!);
  return (
    <aside aria-label={C.panel} className="deck-inspector" data-deck-inspector data-deck-rail={overlayRail ? 'inspector' : undefined}>
      {picked.length > 0 && (
        <InspectorContext.Provider value={api}>
          {/* keyed by what is edited, so a field's unsaved text never carries to another element */}
          <div key={`${slideId}:${picked.map((p) => p.id).join(',')}`} className="deck-inspector-body">
            <h2 className="deck-inspector-title">{title}</h2>
            {slide ? (
              <Fill />
            ) : (
              <>
                <Arrange />
                <Fill />
                <Border />
                <ShadowSection />
                <Text />
                <ImageSection />
                <ShapeSection />
                <IconSection />
                <ConnectorSection />
                <TableSection />
              </>
            )}
          </div>
        </InspectorContext.Provider>
      )}
    </aside>
  );
}
