// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector", D10): the inspector beside the stage.
// It edits the selection (the session's, in pick order; the slide's section when nothing is selected), showing only the
// sections whose properties apply to every selected element, and writes a change to each of them as one gesture: one
// transaction per element inside one `session.edit` (one undo step), or inside a field's typing step while a number or
// colour is typed. Every value is checked as the loader checks it before anything is written (css.ts through
// `planStyle`, then `restyle`); a refusal writes nothing and is shown by its field. Values may be the design system's
// tokens (`var(--ds-color-*)` with the house system's literal as fallback); the swatches paint inside the deck's
// `DesignSystemScope`, which the caller renders the inspector in. The panel follows the replica: a remote change
// re-renders it.
import { useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../yjs';
import type { DeckFace } from '../deck';
import { TEXT_TAGS } from '../ir';
import { ROOT } from '../model';
import { restyle, setAttrsOf } from '../writers-elements';
import { INSPECTOR_COPY as C } from './inspector/copy';
import { InspectorContext, type InspectorApi, type Write } from './inspector/fields';
import { ConnectorSection, IconSection, ImageSection, ShapeSection, TableSection } from './inspector/kinds';
import { Arrange, Border, Fill, ShadowSection, Text } from './inspector/sections';
import { pickedOf, planStyle, type Picked, type Props } from './inspector/selection';
import { ROLE_LABELS, roleOfStyle } from './menus/TextStyle';
import type { DeckSession } from './session';
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
}

const TAG_NAMES: Record<string, string> = {
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', p: 'Text', ul: 'Bulleted list', ol: 'Numbered list', div: 'Box', img: 'Image',
  table: 'Table', tr: 'Table row', th: 'Header cell', td: 'Cell', hr: 'Line', svg: 'Drawing', 'x-shape': 'Shape', 'x-icon': 'Icon',
  'x-connector': 'Connector', 'x-embed': 'Embed',
};

/** An element's name: the type class it is set in, as the toolbar's Text style menu names it; else its kind by the tag. */
function nameOf(p: Picked): string {
  const role = p.tag !== 'section' && TEXT_TAGS.has(p.tag) ? roleOfStyle(p.style) : null;
  if (role !== null) return ROLE_LABELS[role];
  if (p.tag === 'div' && p.attrs['data-group'] !== undefined) return C.group;
  return TAG_NAMES[p.tag] ?? p.tag;
}

/** A number that moves on every update of the replica, so the panel re-reads the model. */
function useDocVersion(doc: Doc): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onUpdate(doc, () => bump()), [doc]);
  return version;
}

export function Inspector({ session, slideId, readOnly, faces, uploadAsset, measure }: InspectorProps) {
  const doc = session.doc;
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const version = useDocVersion(doc);
  const selection = state.currentSlide === slideId ? state.selection : [];
  // `version` re-reads the model at each update
  const picked = useMemo(() => pickedOf(doc, slideId, selection), [doc, slideId, selection, version]);

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
  const title = picked.length === 0 ? '' : slide ? C.slide : picked.length > 1 ? C.selected(picked.length) : nameOf(picked[0]!);
  return (
    <aside aria-label={C.panel} className="deck-inspector">
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
