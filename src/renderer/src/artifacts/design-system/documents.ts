// D's apply API for B's document page (the P3 spec's Decision Log 61, part 2; the ledger's X28): what the app hands B's
// seam through `provideDocumentDesignSystem` (`src/renderer/src/tools/document/design-system.tsx`). The page is wrapped in
// `<DesignSystemScope>`, and its system is the one governing the document as D's chain resolves it in the renderer: its
// own system, else its Space's default, else the owner's (settings 14), else the house system the window follows
// (`useGoverningSystem`), else the bundled floor; a default the library no longer lists is skipped, as a deleted one is
// on the host. `systemFor` is a hook: B calls it in the page's render, so the page moves when a default, the house or
// the library's systems change. The app provides this object once, at module load, so the hook is fixed for the
// page's life.
import { DesignSystemScope, useGoverningSystem } from '@artifacts/design-system/apply';
import { useLibraryList } from '../../library/store';
import { useSettings } from '../../stores/settings';
import type { DocumentDesignSystem, GoverningSystem } from '../../tools/document/design-system';

const NO_SPACES: Record<string, string> = {};

/** The system governing a document so placed, followed (a hook). */
export function useDocumentGoverningSystem(artifact: { designSystemId?: string; spaceId?: string }): GoverningSystem {
  const defaults = useSettings((s) => s.state?.settings.artifacts);
  const systems = useLibraryList({ kind: 'design_system' }).value?.rows;
  // Until the library answers, every named system is taken as live: a document's own system draws at once.
  const listed = systems && new Set(systems.map((system) => system.id));
  const live = listed && ((id: string) => listed.has(id));
  return useGoverningSystem(artifact, { owner: defaults?.defaultDesignSystem ?? null, spaces: defaults?.spaceDesignSystems ?? NO_SPACES }, live);
}

export const DOCUMENT_DESIGN_SYSTEM: DocumentDesignSystem = { Scope: DesignSystemScope, systemFor: useDocumentGoverningSystem };
