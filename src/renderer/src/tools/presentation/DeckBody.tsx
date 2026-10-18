// The deck editor in the panel's Artifacts tool and in an `artifact` main tab (docs/doperpowers/plans/2026-10-12-p3-c-
// presentations.md, D8 "Shell", D10; M4): `DeckEditor` over the tab's replica (the state L's registry made for this tab),
// the X32 header registered under the scope the surface gives, the stage registered as the tab's Mark-up surface while it
// is on screen, the slides in the deck's governing design system (D's chain: the deck's own system, its Space's default,
// the owner's, else the bundled floor), and `onShown` once the first slide is drawn while the body is visible.
// M6: the header's Present, Theme and Check on the tab's deck session; the Theme panel's systems and switch.
// M7: comments go to the session the main area shows (P3-F1: with none shown, the deck's own context), through B's
// comment surface (P2's card with B's artifact target and anchor), the replica held by the tab while the card's overlay
// writes; the header counts the open threads.
// M8: the header's Version history and the editor's history (the tab's history api over the tab's replica).
// P3-F (L233): the header's Export exports what the editor shows (the session's `shown`), read when an entry is chosen.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ArtifactHost } from '@artifacts/host';
import { DeckEditor } from '@artifacts/slides/editor/DeckEditor';
import type { DeckSession } from '@artifacts/slides/editor/session';
import type { ArtifactEditorProps } from '../../artifacts/registry';
import { useLibraryList, useLibraryRow } from '../../library/store';
import { useRegionMarkupSurface } from '../../markup/surface';
import { useEditorHost } from '../../panel/editor-host';
import { useArtifactCommentTarget } from '../document/comment-session'; // P3-F1
import { useDocumentComments } from '../document/comments'; // M7: B's surface
import { chooseDeckSystem, presentDeck } from './commands';
import { deckExports, exportDeck } from './exports';
import { useDeckSystem } from './governing';
import { deckHeader, type DeckHeaderCommands } from './header';
import type { DeckTabState } from './tab-state';

export type DeckEditorBodyProps = ArtifactEditorProps<DeckTabState>;

export function DeckPanel(props: DeckEditorBodyProps) {
  return <DeckBody {...props} compact />;
}
export function DeckMain(props: DeckEditorBodyProps) {
  return <DeckBody {...props} compact={false} />;
}

const NO_SESSION = () => () => {};
const NO_TARGET = { context: { kind: 'none' } } as const; // P3-F1: unused while the target is unread (no comments offered)
/** M6: the panel open beside the stage (the header shows it pressed); null before the deck opens. */
function useRail(session: DeckSession | null) {
  return useSyncExternalStore(session?.subscribe ?? NO_SESSION, () => session?.snapshot().rail ?? null);
}
/** P3-F (L233): what the editor shows in place of the live deck (Export's subject); null before the deck opens. */
function useShown(session: DeckSession | null) {
  return useSyncExternalStore(session?.subscribe ?? NO_SESSION, () => session?.snapshot().shown ?? null);
}

function DeckBody({ artifactId, state, scope, visible, onShown, compact }: DeckEditorBodyProps & { compact: boolean }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  const row = useLibraryRow(artifactId).value;
  const title = row?.title ?? 'Presentation';
  useEffect(() => state.setTitle(title), [state, title]);
  // M6: the actions drive the tab's own session (X32's lifetime rule), Present from the slide it shows
  const opened = snapshot.session;
  const rail = useRail(opened);
  // M9; P3-F (L233): each entry exports what the editor shows when it is chosen
  const shown = useShown(opened);
  const exports = useMemo(() => deckExports(artifactId, shown, (entry) => void exportDeck(artifactId, entry, opened?.snapshot().shown ?? null)), [artifactId, shown, opened]);
  const commands = useMemo<DeckHeaderCommands | undefined>(
    () => (opened ? { present: () => void presentDeck(artifactId, opened.snapshot().currentSlide), toggleRail: (r) => opened.toggleRail(r) } : undefined),
    [opened, artifactId],
  );
  useEditorHost(scope, deckHeader({ title, document: snapshot.document, saving: snapshot.saving, closeGuard: state.closeGuard, exports, rail, canPresent: opened !== null, unresolved: snapshot.unresolved, history: state.history !== null }, commands));

  // M7: comments go to the session the main area shows (its Side thread, or its conversation). P3-F1: with none shown,
  // to the deck's own context; not offered only while that is unread
  const target = useArtifactCommentTarget(artifactId);
  const comments = useDocumentComments({ artifactId, ...(target ?? NO_TARGET), title, mode: scope.surface === 'main' ? 'tab' : 'panel', visible, holdReplica: state.hold, artifactKind: 'presentation' });

  const placement = useMemo(() => (row ? { ...(row.designSystemId && { designSystemId: row.designSystemId }), ...(row.spaceId && { spaceId: row.spaceId }) } : null), [row]);
  const system = useDeckSystem(placement);
  // M6: the Theme panel's systems (the library's live design systems) and the deck's own choice
  const systemRows = useLibraryList({ kind: 'design_system' }).value?.rows;
  const theme = useMemo(
    () => ({ systems: (systemRows ?? []).map((s) => ({ id: s.id, name: s.title })), chosen: row?.designSystemId ?? null, choose: (id: string | null) => chooseDeckSystem(artifactId, id) }),
    [systemRows, row?.designSystemId, artifactId],
  );
  const assetUrl = useCallback((ref: string) => state.host.assetUrl(artifactId, ref), [state, artifactId]);
  const assetUrlAt = useCallback((ref: string, revision: number) => state.host.assetUrl(artifactId, ref, revision), [state, artifactId]); // M8 fix wave 1 (R2)
  // M5: a picked image uploaded into the artifact (Insert's image, the inspector's Replace), answered as its `assets/<name>`
  const uploadAsset = useCallback(async (file: File) => (await state.host.uploadAsset(artifactId, new Uint8Array(await file.arrayBuffer()), { name: file.name, mime: file.type })).ref, [state, artifactId]);
  // a picture pasted from another deck brings its asset into this one: a MAWS asset copied by the store, bytes and mime
  // unchanged (fix wave 2, Decision Log 25); anything else drawn and uploaded as PNG pixels (fix wave 1's route)
  const importAsset = useCallback(
    async (source: string, ref: string) => (ref.startsWith('assets/') ? (await state.host.copyAsset(source, ref, artifactId)).ref : copyPixels(state.host, source, ref, artifactId)),
    [state, artifactId],
  );

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
  // M8: the deck's history over the tab's replica and history api
  const handle = snapshot.handle;
  const history = useMemo(() => (state.history && handle ? { api: state.history, handle } : undefined), [state.history, handle]);
  const onPreviewDrawn = useCallback((ms: number) => session && (session.timings.previewMs ??= []).push(ms), [session]);
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
        theme={theme}
        comments={target === null ? undefined : comments /* P3-F1 */}
        history={history}
        sessionTitle={state.sessionTitle}
        assetUrlAt={assetUrlAt}
        onPreviewDrawn={onPreviewDrawn}
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
 * A picture that is not one of the store's assets brought into a deck as pixels: the renderer reads an image only as the
 * page draws it (the app's CSP keeps `connect-src` to the app itself), so it is loaded through its URL (CORS-enabled),
 * drawn at its natural size and uploaded as a PNG under its name. A MAWS asset never takes this route: the store copies
 * its bytes (`ArtifactHost.copyAsset`).
 */
async function copyPixels(host: ArtifactHost, source: string, ref: string, target: string): Promise<string> {
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
