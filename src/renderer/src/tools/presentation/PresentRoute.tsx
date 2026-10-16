// The renderer's `present` route (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13; H1): what an
// audience or presenter window main opened for `presentations.present` draws instead of the app
// (`?present=1&artifact=<id>&role=audience|presenter&slide=<id>&paired=1`). It opens the deck through the window's
// ArtifactHost as a replica it never writes, resolves the system governing it as the editor does (governing.ts, with the
// owner's defaults from settings and the library's live systems), and runs the show (`Presentation`); the deck's embeds
// load from main's `maws-artifact:` route under their own sandbox policy (Decision Log 18). The show's end closes the
// window (main closes the other with it).
import { useEffect, useMemo, useState } from 'react';
import type { DocumentHandle } from '@artifacts/host';
import { Presentation, type PresentRole } from '@artifacts/slides/editor/present/Presentation';
import { PRESENT_COPY as C } from '@artifacts/slides/editor/present/copy';
import { embedUrl } from '@artifacts/slides/render-rules';
import { artifactHost } from '../../artifacts';
import { DesignSystemHostProvider } from '../../artifacts/design-system/provider';
import { useLibraryRow } from '../../library/store';
import { useSettings } from '../../stores/settings';
import { useDeckSystem } from './governing';

export interface PresentParams {
  artifactId: string;
  role: PresentRole;
  slideId: string | null;
  paired: boolean;
}

/** The route's parameters from the window's URL; null when it is not the `present` route. */
export function presentParams(search: string): PresentParams | null {
  const query = new URLSearchParams(search);
  const artifactId = query.get('artifact');
  const role = query.get('role');
  if (query.get('present') !== '1' || !artifactId || (role !== 'audience' && role !== 'presenter')) return null;
  return { artifactId, role, slideId: query.get('slide'), paired: query.get('paired') === '1' };
}

export function PresentRoute({ params, close = () => window.close() }: { params: PresentParams; close?: () => void }) {
  return (
    <DesignSystemHostProvider>
      <Show params={params} close={close} />
    </DesignSystemHostProvider>
  );
}

function Show({ params, close }: { params: PresentParams; close: () => void }) {
  const { artifactId } = params;
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);
  useEffect(() => useSettings.getState().connect(), []);
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    document.title = params.role === 'audience' ? 'Presentation' : 'Presenter';
  }, [params.role]);

  const [opened, setOpened] = useState<{ handle: DocumentHandle } | { failed: string } | null>(null);
  useEffect(() => {
    let live = true;
    let held: DocumentHandle | null = null;
    artifactHost()
      .open(artifactId)
      .then(
        (handle) => {
          if (!live) return handle.close();
          held = handle;
          setOpened({ handle });
        },
        (e: unknown) => live && setOpened({ failed: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
      held?.close();
    };
  }, [artifactId]);

  const row = useLibraryRow(artifactId).value;
  const placement = useMemo(() => (row ? { ...(row.designSystemId && { designSystemId: row.designSystemId }), ...(row.spaceId && { spaceId: row.spaceId }) } : null), [row]);
  const system = useDeckSystem(placement);
  const assetUrl = useMemo(() => (ref: string) => artifactHost().assetUrl(artifactId, ref), [artifactId]);
  const embeds = useMemo(() => (slideId: string, elementId: string, raw: string) => embedUrl(artifactId, slideId, elementId, raw), [artifactId]);

  if (opened === null) return <Note>{C.opening}</Note>;
  if ('failed' in opened) return <Note>{C.failed(opened.failed)}</Note>;
  return (
    <Presentation
      doc={opened.handle.doc}
      artifactId={artifactId}
      role={params.role}
      paired={params.paired}
      start={params.slideId}
      system={system}
      assetUrl={assetUrl}
      embedUrl={embeds}
      onEnd={close}
    />
  );
}

function Note({ children }: { children: string }) {
  return (
    <p role="status" className="flex h-full items-center justify-center p-6 text-center text-ui text-fg-muted">
      {children}
    </p>
  );
}
