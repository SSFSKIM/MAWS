// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "New slide from layout"; M6): the filmstrip's New
// slide from layout menu. It lists the governing system's `layouts/*.html` (read from the system's doc through D's
// `readSystem`, or D's bundled house system for the floor), each drawn as a thumbnail in the system, and makes the chosen
// one a slide after the current one: loaded through the dialect, its placeholders' `data-ph` marks stripped (a slide
// made from a layout drops them, Claude's rule), every element given a fresh id (two slides from one layout share no
// ids, so a magic move never pairs them by accident), one transaction.
import { DropdownMenu } from 'radix-ui';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DesignSystemHostContext, type DesignSystemRef } from '../../../design-system/apply';
import { readSystem } from '../../../design-system/model';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc, onUpdate, transact, type Doc } from '../../../yjs';
import type { ElementIR, SlideIR } from '../../ir';
import { elementMinter, importSlide } from '../../model';
import { addSlide, mintSlideId } from '../../writers';
import type { DeckSession } from '../session';
import { loadSlide } from '../../parse';
import { SLIDE_W, SlideView } from '../SlideView';
import { LAYOUTS_COPY as C } from './copy';
import './menus.css';

export interface DeckLayout {
  /** The file's name without `layouts/` and `.html`. */
  name: string;
  label: string;
  /** The layout as the dialect loads it; null when its file does not load (`reason`). */
  slide: SlideIR | null;
  reason?: string;
}

const LAYOUT_PATH = /^layouts\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.html$/;
const labelOf = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]+/g, ' ');

/** A system's layouts in name order, each loaded through the dialect. */
export function layoutsOf(files: Readonly<Record<string, string>>): DeckLayout[] {
  return Object.keys(files)
    .flatMap((path) => {
      const name = LAYOUT_PATH.exec(path)?.[1];
      return name ? [{ name, path }] : [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, path }) => {
      const loaded = loadSlide(files[path]!, { fileId: name });
      return loaded.ok ? { name, label: labelOf(name), slide: loaded.slide } : { name, label: labelOf(name), slide: null, reason: loaded.held.reasons.join('; ') };
    });
}

/** The slide a layout makes under `slideId`: `data-ph` stripped, every element id fresh. */
export function slideFromLayout(doc: Doc, layout: SlideIR, slideId: string): SlideIR {
  const walk = (els: readonly ElementIR[]): ElementIR[] => els.flatMap((e) => [e, ...walk(e.children)]);
  const mint = elementMinter(doc, slideId, walk(layout.children).map((e) => e.id));
  const strip = (attrs: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'data-ph'));
  const fresh = (e: ElementIR): ElementIR => ({ ...e, id: e.id === '' ? '' : mint(e.id), attrs: strip(e.attrs), children: e.children.map(fresh) });
  return { ...layout, id: slideId, attrs: strip(layout.attrs), children: layout.children.map(fresh) };
}

/** Adds the slide a layout makes after `afterId` (first when null) as one gesture, and shows it; answers its id. */
export function insertLayoutSlide(session: DeckSession, layout: SlideIR, afterId: string | null): string {
  const id = mintSlideId(session.doc);
  session.edit((origin) => addSlide(session.doc, slideFromLayout(session.doc, layout, id), afterId, origin));
  session.show(id);
  return id;
}

/** A system's files: the bundled house system's for the floor, a live system's from its doc (followed while shown). */
function useSystemFiles(system: DesignSystemRef | { builtin: 'maws' } | null): { files: Readonly<Record<string, string>> | null; error: string | null } {
  const host = useContext(DesignSystemHostContext);
  const id = system && !('builtin' in system) ? system.id : null;
  const [read, setRead] = useState<{ id: string; files: Readonly<Record<string, string>> | null; error: string | null } | null>(null);
  useEffect(() => {
    if (id === null || !host) return;
    let live = true;
    let close = () => {};
    host.open(id).then(
      (handle) => {
        if (!live) return handle.close();
        const show = () => setRead({ id, files: readSystem(handle.doc).files, error: null });
        show();
        const off = onUpdate(handle.doc, show);
        close = () => {
          off();
          handle.close();
        };
      },
      (e: unknown) => live && setRead({ id, files: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
      close();
    };
  }, [host, id]);
  if (system === null) return { files: null, error: null };
  if ('builtin' in system || !host) return { files: defaultSystem(HOUSE_KEY)?.files ?? {}, error: null };
  return read?.id === id ? { files: read.files, error: read.error } : { files: null, error: null };
}

export interface LayoutsMenuProps {
  system: DesignSystemRef | { builtin: 'maws' } | null;
  disabled: boolean;
  /** Draws its children in the deck's design system (the menu is portalled outside the editor's scope). */
  scope: (children: ReactNode) => ReactNode;
  /** Makes a slide from the layout picked. */
  onPick: (layout: SlideIR) => void;
}

const THUMB_W = 160;

export function LayoutsMenu({ system, disabled, scope, onPick }: LayoutsMenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="deck-button deck-new-slide" disabled={disabled} aria-label={C.button} title={C.menu}>
          {C.open}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" side="right" sideOffset={6} className="deck-menu deck-layouts" aria-label={C.menu}>
          <LayoutList system={system} scope={scope} onPick={onPick} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function LayoutList({ system, scope, onPick }: Omit<LayoutsMenuProps, 'disabled'>) {
  const { files, error } = useSystemFiles(system);
  if (error) return <p className="deck-layouts-note">{C.failed(error)}</p>;
  if (!files) return <p className="deck-layouts-note">{C.loading}</p>;
  const layouts = layoutsOf(files).filter((l) => l.slide !== null);
  if (!layouts.length) return <p className="deck-layouts-note">{C.none}</p>;
  return (
    <div className="deck-layouts-grid">
      {layouts.map((layout) => (
        <DropdownMenu.Item key={layout.name} className="deck-layouts-item" data-layout={layout.name} aria-label={C.layout(layout.label)} onSelect={() => onPick(layout.slide!)}>
          {scope(<LayoutThumb slide={layout.slide!} />)}
          <span className="deck-layouts-name">{layout.label}</span>
        </DropdownMenu.Item>
      ))}
    </div>
  );
}

const NO_ASSETS = () => null;

/** A layout drawn as a thumbnail, from a scratch doc of its own (dropped with the menu; it holds nothing outside). */
function LayoutThumb({ slide }: { slide: SlideIR }) {
  const doc = useMemo(() => {
    const scratch = newDoc();
    transact(scratch, () => importSlide(scratch, slide, 'a0'));
    return scratch;
  }, [slide]);
  return (
    <div className="deck-layouts-thumb">
      <SlideView doc={doc} slideId={slide.id} token={doc} assetUrl={NO_ASSETS} scale={THUMB_W / SLIDE_W} thumbnail />
    </div>
  );
}
