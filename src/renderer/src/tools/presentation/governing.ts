// The design system governing a deck in the renderer (P3-C; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10,
// Decision Log 19 and 27): D's chain over the deck's row, the owner's defaults (settings slot 14) and the library's live
// systems, shared by the editor's body and the presenter's route. The house system (one link before the floor) is the
// host's to name; until D's `useGoverningSystem` is merged here (Decision Log 19a, 27(2)) the chain passes `house: null`,
// so a deck with no system of its own, no Space default and no owner default draws in the bundled floor, which the
// house system starts as. At that merge this is the one place the deck takes D's hook.
import { useMemo } from 'react';
import { governingSystem } from '@artifacts/design-system/apply';
import { useLibraryList } from '../../library/store';
import { useSettings } from '../../stores/settings';

export function useDeckSystem(placement: { designSystemId?: string; spaceId?: string } | null) {
  const defaults = useSettings((s) => s.state?.settings.artifacts);
  const systems = useLibraryList({ kind: 'design_system' }).value?.rows;
  return useMemo(() => {
    if (!placement) return null;
    const live = systems ? new Set(systems.map((s) => s.id)) : null;
    return governingSystem(placement, { owner: defaults?.defaultDesignSystem ?? null, spaces: defaults?.spaceDesignSystems ?? {}, house: null }, (id) => live === null || live.has(id));
  }, [placement, defaults, systems]);
}
