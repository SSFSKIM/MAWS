// The words of the page and the Settings dialog (UX wave U7b; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §L).
import type { Destination } from '@shared/ipc/schema/layout';

export const DESTINATION = {
  back: 'Back',
  backChord: 'Esc', // no chord of the keymap, so the tooltip writes it out (`Back · Esc`)
  names: { customize: 'Customize', projects: 'Projects', library: 'Artifacts' } satisfies Record<Destination['kind'], string>,
  settings: 'Settings',
  close: 'Close',
} as const;
