// The design system governing a deck in the renderer (P3-C; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10,
// Decision Log 19, 27 (2) and 28): D's chain through D's `useGoverningSystem`, in the shape of D's `useSystemFor` for B's
// documents: the deck's own system, else its Space's default, else the owner's (settings 14), else the house system the
// window follows, else the bundled floor; a system the library no longer lists is skipped, as a deleted one is on the
// host. Shared by the editor's body and the presenter's route; the deck's own hook, never a call into B's file.
import { useMemo } from 'react';
import { useGoverningSystem } from '@artifacts/design-system/apply';
import { useLibraryList } from '../../library/store';
import { useSettings } from '../../stores/settings';

const NO_SPACES: Record<string, string> = {};
const UNPLACED = {};
const FLOOR = { builtin: 'maws' as const };

/** The system governing a deck so placed, followed (a hook); null while the deck's row is not read. */
export function useDeckSystem(placement: { designSystemId?: string; spaceId?: string } | null) {
  const defaults = useSettings((s) => s.state?.settings.artifacts);
  const systems = useLibraryList({ kind: 'design_system' }).value?.rows;
  // Until the library answers, every named system is taken as live: a deck's own system draws at once.
  const listed = useMemo(() => systems && new Set(systems.map((system) => system.id)), [systems]);
  const live = listed && ((id: string) => listed.has(id));
  const governing = useGoverningSystem(placement ?? UNPLACED, { owner: defaults?.defaultDesignSystem ?? null, spaces: defaults?.spaceDesignSystems ?? NO_SPACES }, live);
  // One value while the system it names stays the same, so the scope and the canvases keep theirs (the chain answers a
  // live id or the floor, never a pin).
  const id = 'builtin' in governing ? null : governing.id;
  const system = useMemo(() => (id === null ? FLOOR : { id }), [id]);
  return placement ? system : null;
}
