// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "New slide from layout"; M6): the filmstrip's New
// slide from layout menu. It lists the governing system's `layouts/*.html` (read from the system's doc through D's
// `readSystem`, or D's bundled house system for the floor), each drawn as a thumbnail in the system, and makes the chosen
// one a slide after the current one: loaded through the dialect, its placeholders' `data-ph` marks stripped (a slide
// made from a layout drops them, Claude's rule), every element given a fresh id (two slides from one layout share no
// ids, so a magic move never pairs them by accident), one transaction.
// Final fix wave (B5): a layout's `assets/<name>` refs (a picture's `src`, a style value's `url()`) are the system's
// assets, not the deck's: the thumbnail draws them through the system's own asset URLs, and the slide made from it has
// each copied into the deck first (`artifacts.copyAsset`, Decision Log 25) and its refs rewritten to the copies, the
// copy being the session's awaited edit (B4). The bundled floor's layouts name no assets.
import { DropdownMenu } from 'radix-ui';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DesignSystemHostContext, type DesignSystemRef } from '../../../design-system/apply';
import { readSystem } from '../../../design-system/model';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc, onUpdate, transact, type Doc } from '../../../yjs';
import type { ElementIR, SlideIR, Style } from '../../ir';
import { elementMinter, importSlide } from '../../model';
import { addSlide, mintSlideId } from '../../writers';
import type { DeckSession } from '../session';
import type { ImportAsset } from '../transform/clipboard';
import { loadSlide } from '../../parse';
import type { AssetUrl } from '../../canvas';
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

/** A layout picked from the menu, with the design system it is from (its assets' artifact; null for the bundled floor). */
export interface PickedLayout {
  slide: SlideIR;
  system: string | null;
}

const ASSET_URL = /url\(\s*(["']?)(assets\/[^"')\s]+)\1\s*\)/g;
const walkAll = (els: readonly ElementIR[]): ElementIR[] => els.flatMap((e) => [e, ...walkAll(e.children)]);
const urlsOf = (style: Style): string[] => Object.values(style).flatMap((v) => [...v.matchAll(ASSET_URL)].map((m) => m[2]!));

/** The `assets/<name>` refs a layout names: its pictures' `src` and the `url()`s of its style values (the slide's too). */
export function layoutAssets(slide: SlideIR): string[] {
  const refs = [...urlsOf(slide.style), ...walkAll(slide.children).flatMap((e) => [...(e.tag === 'img' && e.attrs.src?.startsWith('assets/') ? [e.attrs.src] : []), ...urlsOf(e.style)])];
  return [...new Set(refs)];
}

/** The layout with each ref `refs` maps rewritten, in its pictures' `src` and its style values' `url()`s. */
export function withAssets(slide: SlideIR, refs: ReadonlyMap<string, string>): SlideIR {
  const style = (s: Style): Style => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.replace(ASSET_URL, (call, quote: string, ref: string) => (refs.has(ref) ? `url(${quote}${refs.get(ref)!}${quote})` : call))]));
  const src = (attrs: Readonly<Record<string, string>>) => (attrs.src !== undefined && refs.has(attrs.src) ? { ...attrs, src: refs.get(attrs.src)! } : attrs);
  const element = (e: ElementIR): ElementIR => ({ ...e, attrs: e.tag === 'img' ? src(e.attrs) : e.attrs, style: style(e.style), children: e.children.map(element) });
  return { ...slide, style: style(slide.style), children: slide.children.map(element) };
}

type Inserted = { id: string } | { reason: string };

function place(session: DeckSession, layout: SlideIR, afterId: string | null): Inserted {
  const id = mintSlideId(session.doc);
  try {
    session.edit((origin) => addSlide(session.doc, slideFromLayout(session.doc, layout, id), afterId, origin));
  } catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  }
  session.show(id);
  return { id };
}

/**
 * Adds the slide a layout makes after `afterId` (first when null) as one gesture, and shows it. A system's layout that
 * names the system's assets has them copied into the deck first (`copyAsset`, the shell's `artifacts.copyAsset`), as
 * the session's awaited edit; answers the slide's id, or why none was added.
 */
export async function insertLayoutSlide(session: DeckSession, layout: PickedLayout, afterId: string | null, copyAsset?: ImportAsset): Promise<Inserted> {
  const { system } = layout;
  const refs = system === null ? [] : layoutAssets(layout.slide);
  if (system === null || refs.length === 0) return place(session, layout.slide, afterId);
  if (!copyAsset) return { reason: C.noAssetCopy };
  const copied = (async () => {
    const map = new Map<string, string>();
    for (const ref of refs) map.set(ref, await copyAsset(system, ref));
    return withAssets(layout.slide, map);
  })();
  let inserted: Inserted = { reason: C.notPlaced };
  try {
    await session.later(copied, (slide) => (inserted = place(session, slide, afterId)));
  } catch (e) {
    return { reason: C.assetsFailed(e instanceof Error ? e.message : String(e)) };
  }
  return inserted;
}

/** A system's files: the bundled house system's for the floor, a live system's from its doc (followed while shown). */
function useSystemFiles(system: DesignSystemRef | { builtin: 'maws' } | null): { files: Readonly<Record<string, string>> | null; error: string | null; source: string | null } {
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
  if (system === null) return { files: null, error: null, source: null };
  if ('builtin' in system || !host) return { files: defaultSystem(HOUSE_KEY)?.files ?? {}, error: null, source: null };
  return read?.id === id ? { files: read.files, error: read.error, source: id } : { files: null, error: null, source: null };
}

export interface LayoutsMenuProps {
  system: DesignSystemRef | { builtin: 'maws' } | null;
  disabled: boolean;
  /** Draws its children in the deck's design system (the menu is portalled outside the editor's scope). */
  scope: (children: ReactNode) => ReactNode;
  /** Makes a slide from the layout picked. */
  onPick: (layout: PickedLayout) => void;
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
  const { files, error, source } = useSystemFiles(system);
  const host = useContext(DesignSystemHostContext);
  // B5: a system's layout draws its pictures from the system's own assets
  const assetUrl = useMemo<AssetUrl>(() => (source !== null && host ? (ref) => host.assetUrl(source, ref) : NO_ASSETS), [source, host]);
  if (error) return <p className="deck-layouts-note">{C.failed(error)}</p>;
  if (!files) return <p className="deck-layouts-note">{C.loading}</p>;
  const layouts = layoutsOf(files).filter((l) => l.slide !== null);
  if (!layouts.length) return <p className="deck-layouts-note">{C.none}</p>;
  return (
    <div className="deck-layouts-grid">
      {layouts.map((layout) => (
        <DropdownMenu.Item key={layout.name} className="deck-layouts-item" data-layout={layout.name} aria-label={C.layout(layout.label)} onSelect={() => onPick({ slide: layout.slide!, system: source })}>
          {scope(<LayoutThumb slide={layout.slide!} assetUrl={assetUrl} />)}
          <span className="deck-layouts-name">{layout.label}</span>
        </DropdownMenu.Item>
      ))}
    </div>
  );
}

const NO_ASSETS: AssetUrl = () => null;

/** A layout drawn as a thumbnail, from a scratch doc of its own (dropped with the menu; it holds nothing outside). */
function LayoutThumb({ slide, assetUrl }: { slide: SlideIR; assetUrl: AssetUrl }) {
  const doc = useMemo(() => {
    const scratch = newDoc();
    transact(scratch, () => importSlide(scratch, slide, 'a0'));
    return scratch;
  }, [slide]);
  return (
    <div className="deck-layouts-thumb">
      <SlideView doc={doc} slideId={slide.id} token={doc} assetUrl={assetUrl} scale={THUMB_W / SLIDE_W} thumbnail />
    </div>
  );
}
