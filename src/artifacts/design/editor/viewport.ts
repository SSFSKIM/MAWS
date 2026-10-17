// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench" and
// Decision Log 20): the workbench's view of the world. A board sits at its own `x`, `y` in world px; the screen shows the
// world at `zoom` (2 % to 400 %) with its origin at the screen point `(x, y)`, so one CSS transform draws every board and
// the active board's overlay, in screen px beside it, reads the same two numbers (no zoom applied twice).
//
// `DesignView` is what a tab keeps of that view (X32's lifetime rule: the tab owns it, so the header's Zoom to fit and a
// body remounting on a tab switch find it): the viewport, the room the body last measured, and the board whose frame is
// selected (the board's geometry, as against C's element selection in the deck session). M5 (the parent's Decision Log
// 31): and which retained version the history shows in place of the live design, so the header's Export, which outlives
// the body, exports what is on screen. Pure: no DOM, no React.
import type { Pt } from '../../slides/geometry';

export interface Viewport {
  zoom: number;
  /** The screen point (px from the body's top-left) the world's origin is drawn at. */
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Room {
  w: number;
  h: number;
}

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 4;
/** The toolbar's zoom steps (and ⌘= / ⌘−). */
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
/** Screen px kept clear around what a fit shows. */
export const FIT_INSET = 48;
/** A fit of whole boards (fit all, zoom to board) never enlarges past 100 %; a fit of selected elements may, to 400 %. */
export const BOARD_FIT_MAX = 1;

export const clampZoom = (zoom: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
export const toScreen = (v: Viewport, p: Pt): Pt => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });
export const toWorld = (v: Viewport, p: Pt): Pt => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({ zoom: v.zoom, x: v.x + dx, y: v.y + dy });

/** `zoom` (clamped) with the world point under the screen point `at` kept there. */
export function zoomAt(v: Viewport, zoom: number, at: Pt): Viewport {
  const z = clampZoom(zoom);
  const w = toWorld(v, at);
  return { zoom: z, x: at.x - w.x * z, y: at.y - w.y * z };
}

/** The next zoom step past `zoom` in `direction` (the end step at either end). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = direction === 1 ? ZOOM_STEPS.find((s) => s > zoom + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-6);
  return next ?? (direction === 1 ? ZOOM_MAX : ZOOM_MIN);
}

/** The view showing `rect` whole and centred in `room`, `inset` px clear on each side, at most `max` zoom. */
export function fitRect(rect: Rect, room: Room, inset = FIT_INSET, max = ZOOM_MAX): Viewport {
  const w = Math.max(1, room.w - 2 * inset);
  const h = Math.max(1, room.h - 2 * inset);
  const zoom = clampZoom(Math.min(max, w / Math.max(rect.w, 1), h / Math.max(rect.h, 1)));
  return { zoom, x: room.w / 2 - (rect.x + rect.w / 2) * zoom, y: room.h / 2 - (rect.y + rect.h / 2) * zoom };
}

/** The bounds of `rects`, null for none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * M5: what the history shows in place of the live design: one retained version with the board of it an export takes
 * (and how that board is named in the version), two versions compared, or nothing (the live design).
 */
export type ShownVersion = { versionId: number; board: string | null; label: string | null } | 'compare' | null;

export interface DesignViewState {
  /** Null until the body first places the world (a fit once its room is known). */
  viewport: Viewport | null;
  room: Room | null;
  /** The board whose frame is selected (its geometry), if any. */
  frame: string | null;
  /** M5: what the history shows (Decision Log 31); null while the live design is shown. */
  shown: ShownVersion;
}

/** What one tab keeps of its workbench's view (module header). */
export class DesignView {
  private state: DesignViewState = { viewport: null, room: null, frame: null, shown: null };
  private readonly listeners = new Set<() => void>();
  /** A fit asked before the room was measured, with its zoom cap. */
  private pendingFit: { rect: Rect; max: number } | null = null;
  /** The mounted body's live measure of its room (null while none is mounted, or it cannot measure). */
  private roomSource: (() => Room | null) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): DesignViewState => this.state;

  /** Whether the world has been placed in this tab (a remounting body keeps the place rather than fitting again). */
  get placed(): boolean {
    return this.state.viewport !== null || this.pendingFit !== null;
  }

  private set(patch: Partial<DesignViewState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof DesignViewState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  setViewport(viewport: Viewport): void {
    const v = this.state.viewport;
    if (v && v.zoom === viewport.zoom && v.x === viewport.x && v.y === viewport.y) return;
    this.set({ viewport: { ...viewport, zoom: clampZoom(viewport.zoom) } });
  }

  /** The body's measured size; a fit waiting for it lands now. A resize alone never moves the view. */
  setRoom(room: Room): void {
    this.keepRoom(room);
    const fit = this.pendingFit;
    if (fit) {
      this.pendingFit = null;
      this.fitTo(fit.rect, fit.max);
    }
  }

  private keepRoom(room: Room): void {
    const r = this.state.room;
    if (!r || r.w !== room.w || r.h !== room.h) this.set({ room: { w: room.w, h: room.h } });
  }

  /**
   * The mounted body's measure of its room as it is now, read before every fit and zoom: a layout change (a rail opened
   * under or beside the world) reaches the view's next fit even before its resize is reported (the narrow-panel regate:
   * Fit selection right after the inspector opened fitted the room from before). Returns its removal.
   */
  measureRoomWith(source: () => Room | null): () => void {
    this.roomSource = source;
    return () => {
      if (this.roomSource === source) this.roomSource = null;
    };
  }

  /** The room now: the mounted body's measure when it has one, else the last reported. */
  private currentRoom(): Room | null {
    const live = this.roomSource?.() ?? null;
    if (live) this.keepRoom(live);
    return this.state.room;
  }

  /** Shows `rect` whole (fit all, fit selection, zoom to board); waits for the room when it is not measured yet. */
  fitTo(rect: Rect, max = ZOOM_MAX): void {
    const room = this.currentRoom();
    if (!room) {
      this.pendingFit = { rect, max };
      return;
    }
    this.setViewport(fitRect(rect, room, FIT_INSET, max));
  }

  /** A zoom about the room's centre. */
  setZoom(zoom: number): void {
    const v = this.state.viewport;
    const room = this.currentRoom();
    if (!v) return;
    this.setViewport(zoomAt(v, zoom, room ? { x: room.w / 2, y: room.h / 2 } : { x: 0, y: 0 }));
  }

  /** One zoom step in or out about the room's centre. */
  step(direction: 1 | -1): void {
    const v = this.state.viewport;
    if (v) this.setZoom(stepZoom(v.zoom, direction));
  }

  selectFrame(boardId: string | null): void {
    this.set({ frame: boardId });
  }

  /** M5: the history shows one version (with its board), two compared (`compare`), or the live design (null). */
  showVersion(shown: ShownVersion): void {
    const now = this.state.shown;
    const same = shown === null || shown === 'compare' ? now === shown : now !== null && now !== 'compare' && now.versionId === shown.versionId && now.board === shown.board && now.label === shown.label;
    if (!same) this.set({ shown });
  }
}
