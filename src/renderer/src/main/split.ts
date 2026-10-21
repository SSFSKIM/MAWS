// The main split's pixel rule (P4-B3 M1; parent §4.5; the prior art's §3.3): pixel floors replace the 25–75 % clamp. A
// pane whose active tab is a session ("S") holds at S_MIN_PX, and a drag that would leave it under FLOAT_THRESHOLD_PX
// arms its float, live and with the same limit both ways (no hysteresis); the other pane ("A") only ever clamps at
// A_MIN_PX. Every floor is capped at half the region, so a region narrower than both floors splits evenly rather than
// overlapping. The divider's 1 px column is ignored in the arithmetic. LC-3 (2026-10-21) confirmed the constants against
// Codex 26.1013: its chat holds at 320 and snaps past half of it.
export const S_MIN_PX = 320; // confirmed by LC-3
export const A_MIN_PX = 320; // confirmed by LC-3 (source)
export const FLOAT_THRESHOLD_PX = S_MIN_PX / 2; // 160; confirmed by LC-3

export type SplitSide = 'left' | 'right';
// Which panes may float: those whose active tab is a session.
export interface SplitSessions {
  left: boolean;
  right: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The left pane's width while the divider is dragged, `x` being its pointer-implied width in px from the region's left
// edge: armed (the left pane at 0, or at `width` when the right one is armed), else held between the floors.
export function splitDrag(width: number, x: number, canFloat: SplitSessions): { left: number; armed: SplitSide | null } {
  if (canFloat.left && x < FLOAT_THRESHOLD_PX) return { left: 0, armed: 'left' };
  if (canFloat.right && width - x < FLOAT_THRESHOLD_PX) return { left: width, armed: 'right' };
  const { min, max } = splitBounds(width, canFloat);
  return { left: Math.round(clamp(x, min, max)), armed: null };
}

// The left pane's width bounds in px: each side's floor is S's minimum for a session pane and A's otherwise, never more
// than half the region.
export function splitBounds(width: number, canFloat: SplitSessions): { min: number; max: number } {
  const half = Math.floor(width / 2);
  const floor = (session: boolean) => Math.min(session ? S_MIN_PX : A_MIN_PX, half);
  return { min: floor(canFloat.left), max: width - floor(canFloat.right) };
}

// The left pane's rendered width for a stored ratio: clamped to the floors at every width, so a window resize only
// clamps and never floats or docks (the rule of VS Code issue 332314).
export function splitLeft(width: number, ratio: number, canFloat: SplitSessions): number {
  const { min, max } = splitBounds(width, canFloat);
  return Math.round(clamp(ratio * width, min, max));
}
