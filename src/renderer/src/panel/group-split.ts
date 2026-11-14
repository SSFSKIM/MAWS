// The height the side column's two groups share (UX wave U8b, M3, decision 2; its execution document,
// docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md). The stored share is the lower group's part of the
// groups' height, 0.2 to 0.8 (the store clamps it); drawn, each group keeps GROUP_MIN_PX, and in a column too short for
// both it is the lower group that gives way, down to its strip.
import { SHARE_MAX, SHARE_MIN, clampShare } from './surface-model';

export const GROUP_MIN_PX = 120;
export const GROUP_STRIP_PX = 36; // a strip's row (`TabStrip`'s h-9)
export const GROUP_BAR_PX = 6; // the bar between the groups (the resizer's h-1.5)

// The lower group's drawn height for `share` of `room` px, and the bar's bounds: the share's 0.2..0.8 inside the same
// floors, widened to hold the drawn height (a column too short for both).
export function groupSplit(room: number, share: number): { lower: number; min: number; max: number } {
  const lower = Math.max(GROUP_STRIP_PX, Math.min(room - GROUP_MIN_PX, Math.max(GROUP_MIN_PX, Math.round(room * clampShare(share)))));
  const min = Math.min(lower, Math.max(GROUP_MIN_PX, Math.round(room * SHARE_MIN)));
  const max = Math.max(lower, Math.min(room - GROUP_MIN_PX, Math.round(room * SHARE_MAX)));
  return { lower, min, max };
}
