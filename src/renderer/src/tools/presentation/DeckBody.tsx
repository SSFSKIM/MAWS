// The deck editor in the panel's Artifacts tool and in an `artifact` main tab (docs/doperpowers/plans/2026-10-12-p3-c-
// presentations.md, D8 "Shell", D10; M4): `DeckEditor` over the tab's replica (the state L's registry made for this tab),
// the X32 header registered under the scope the surface gives, the stage registered as the tab's Mark-up surface while it
// is on screen, the slides in the deck's governing design system (D's chain: the deck's own system, its Space's default,
// the owner's, else the bundled floor), and `onShown` once the first slide is drawn while the body is visible.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { governingSystem } from '@artifacts/design-system/apply';
import type { ArtifactHost } from '@artifacts/host';
import { DeckEditor } from '@artifacts/slides/editor/DeckEditor';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useLibraryList, useLibraryRow } from '../../library/store';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost } from '../../panel/editor-host';
import { useSettings } from '../../stores/settings';
import { deckExports } from './exports';
import { deckHeader } from './header';
import type { DeckTabState } from './tab-state';

export type DeckEditorBodyProps = ArtifactEditorProps<DeckTabState>;

export function DeckPanel(props: DeckEditorBodyProps) {
  return <DeckBody {...props} compact />;
}
export function DeckMain(props: DeckEditorBodyProps) {
  return <DeckBody {...props} compact={false} />;
}

// The system governing the deck. The house system (D's chain, one link before the floor) is the host's to name; the
// renderer has no origin keys to find it by, so a deck with no system of its own, no Space default and no owner default
// draws in the bundled floor, which the house system starts as (M6's Theme menu names the deck's system explicitly).
function useGoverningSystem(placement: { designSystemId?: string; spaceId?: string } | null) {
  const defaults = useSettings((s) => s.state?.settings.artifacts);
  const systems = useLibraryList({ kind: 'design_system' }).value?.rows;
  return useMemo(() => {
    if (!placement) return null;
    const live = systems ? new Set(systems.map((s) => s.id)) : null;
    return governingSystem(placement, { owner: defaults?.defaultDesignSystem ?? null, spaces: defaults?.spaceDesignSystems ?? {}, house: null }, (id) => live === null || live.has(id));
  }, [placement, defaults, systems]);
}

function DeckBody({ artifactId, state, scope, visible, onShown, compact }: DeckEditorBodyProps & { compact: boolean }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  const row = useLibraryRow(artifactId).value;
  const title = row?.title ?? 'Presentation';
  useEffect(() => state.setTitle(title), [state, title]);
  const exports = useMemo(() => deckExports(artifactId), [artifactId]); // M9
  useEditorHost(scope, deckHeader({ title, document: snapshot.document, saving: snapshot.saving, closeGuard: state.closeGuard, exports }));

  const placement = useMemo(() => (row ? { ...(row.designSystemId && { designSystemId: row.designSystemId }), ...(row.spaceId && { spaceId: row.spaceId }) } : null), [row]);
  const system = useGoverningSystem(placement);
  const assetUrl = useCallback((ref: string) => state.host.assetUrl(artifactId, ref), [state, artifactId]);
  // M5: a picked image uploaded into the artifact (Insert's image, the inspector's Replace), answered as its `assets/<name>`
  const uploadAsset = useCallback(async (file: File) => (await state.host.uploadAsset(artifactId, new Uint8Array(await file.arrayBuffer()), { name: file.name, mime: file.type })).ref, [state, artifactId]);
  // fix wave 1: a picture pasted from another deck brings its asset into this one (copyAsset reads it through the store's
  // scheme and uploads it here)
  const importAsset = useCallback((source: string, ref: string) => copyAsset(state.host, source, ref, artifactId), [state, artifactId]);

  // the stage is the tab's Mark-up surface while it is on screen
  const stage = useRef<HTMLElement | null>(null);
  const [stageShown, setStageShown] = useState(false);
  const onStage = useCallback((element: HTMLElement | null) => {
    stage.current = element;
    setStageShown(element !== null);
  }, []);
  useRegionMarkupSurface(stage, `“${title}”`, visible && stageShown);

  // the owner's view (L's `onShown`, then markViewed): once per showing, once the first slide is drawn while visible
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!visible || !drawn) return;
    if (state.markShown()) onShown();
  }, [visible, drawn, state, onShown]);
  const session = snapshot.session;
  const onDrawn = useCallback(() => setDrawn(true), []);
  const onThumbnailsDrawn = useCallback((thumbnails: number) => session?.markDrawn(thumbnails), [session]);

  if (snapshot.failed !== null) return <Notice>{`This presentation could not be opened: ${snapshot.failed}`}</Notice>;
  if (!snapshot.handle || !session) return <Notice>Opening the presentation…</Notice>;
  return (
    <div className="h-full" data-deck-artifact={artifactId} data-deck-surface={scope.surface}>
      <DeckEditor
        session={session}
        assetUrl={assetUrl}
        system={system}
        readOnly={snapshot.document?.readOnly ?? false}
        compact={compact}
        onStage={onStage}
        onDrawn={onDrawn}
        onThumbnailsDrawn={onThumbnailsDrawn}
        uploadAsset={uploadAsset}
        artifactId={artifactId}
        importAsset={importAsset}
      />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex h-full items-center justify-center p-6 text-center text-ui text-fg-muted">
      {children}
    </div>
  );
}

/**
 * Fix wave 1: one deck's picture brought into another. The renderer reads an asset only as the page draws it (the app's
 * CSP keeps `connect-src` to the app itself, and the store's scheme answers no fetch), so the picture is loaded through
 * its `maws-artifact:` URL (CORS-enabled), drawn at its natural size and uploaded into the target as a PNG under its
 * name: the pixels travel exactly; an SVG arrives rasterized and a GIF as its first frame (a byte-exact copy needs a
 * store-side copy, an IPC this child does not own).
 */
async function copyAsset(host: ArtifactHost, source: string, ref: string, target: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = host.assetUrl(source, ref);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${ref} could not be read`))), 'image/png'));
  const name = ref.slice('assets/'.length).replace(/\.[^.]*$/, '') + '.png';
  return (await host.uploadAsset(target, new Uint8Array(await blob.arrayBuffer()), { name, mime: 'image/png' })).ref;
}
