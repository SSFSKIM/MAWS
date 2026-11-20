// The field: the plane the sidebar's glass sits over. It is painted here, on a canvas, and nowhere else, so the glass
// samples exactly the pixels the page shows. A row says which lamp it wants with data-lamp; the painter finds the
// rows, eases each lamp toward its target and paints a pool of light under the row's own box.
import type { SessionState } from '../../content/fixtures';

/** What a session's state asks of the field. */
export type Lamp = 'need' | 'live' | 'ember' | 'none';

export function lampOf(state: SessionState): Lamp {
  if (state === 'approval' || state === 'question' || state === 'plan') return 'need';
  if (state === 'running') return 'live';
  if (state === 'unread') return 'ember';
  return 'none';
}

/**
 * What a folded project shows under its name: every lamp its sessions hold, so a fold moves the light up and loses
 * none of it. An ember is dropped beside a warm pool, which already says "something here is for you".
 */
export function lampsOf(states: SessionState[]): string {
  const lamps = new Set(states.map(lampOf));
  const out: Lamp[] = [];
  if (lamps.has('need')) out.push('need');
  else if (lamps.has('ember')) out.push('ember');
  if (lamps.has('live')) out.push('live');
  return out.join(' ') || 'none';
}

type RGB = readonly [number, number, number];

export interface FieldPalette {
  ground: string;
  /** The warm pool behind a session that needs the person. */
  need: RGB;
  /** The hotter centre of that pool, under the bead. */
  core: RGB;
  /** The pool behind a running session. */
  live: RGB;
  /** Peak alpha of each pool before the strength knob. */
  needA: number;
  coreA: number;
  liveA: number;
  emberA: number;
  /** How much of a pool shows past the pane's edge, where no glass thins it. */
  spill: number;
  /**
   * White at this alpha under the pane's footprint. The glass restores the backdrop's chromaticity whatever its
   * level, so over pure black the faintest tail of a pool reads as fully saturated and the pane fills with a brown
   * wash that ends in a hard edge. A base a few codes above black gives the tail something neutral to fade into.
   */
  floor: number;
}

interface Level {
  need: number;
  live: number;
  ember: number;
  seen: boolean;
}

// A smooth bell: the pool has no edge to read as a highlighted row.
const BELL: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.16, 0.9],
  [0.34, 0.66],
  [0.52, 0.4],
  [0.7, 0.19],
  [0.86, 0.06],
  [1, 0],
];

function pool(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, c: RGB, alpha: number) {
  if (alpha < 0.004 || rx < 1 || ry < 1) return;
  g.save();
  g.translate(cx, cy);
  g.scale(rx, ry);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  // An alpha above 1 is a pool with a plateau: the top of the bell clips and the pool grows wider, not whiter.
  for (const [at, a] of BELL) grad.addColorStop(at, `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, a * alpha).toFixed(4)})`);
  g.fillStyle = grad;
  g.fillRect(-1, -1, 2, 2);
  g.restore();
}

const TARGET: Record<Lamp, { need: number; live: number; ember: number }> = {
  need: { need: 1, live: 0, ember: 0 },
  live: { need: 0, live: 1, ember: 0 },
  ember: { need: 0, live: 0, ember: 1 },
  none: { need: 0, live: 0, ember: 0 },
};

/** Light warms and cools like a filament, not like a switch: about a second to settle. */
const TAU_MS = 340;
/** One slow pass of the running light along its row. */
const DRIFT_MS = 7600;

export class FieldPainter {
  private levels = new Map<string, Level>();
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Frames still owed after a layout change that moves rows without resizing anything. */
  private owed = 2;

  constructor(
    private canvas: HTMLCanvasElement,
    private scope: HTMLElement,
  ) {}

  /** Ask for repaints for a while: a fold or a collapse is moving rows. */
  kick(frames = 60) {
    this.owed = Math.max(this.owed, frames);
  }

  private fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.owed = Math.max(this.owed, 2);
  }

  /** Step and paint one frame. Returns whether another frame is wanted. */
  frame(dtMs: number, timeMs: number, palette: FieldPalette, gain: number, still: boolean): boolean {
    this.fit();
    const g = this.canvas.getContext('2d');
    if (!g) return false;
    const box = this.canvas.getBoundingClientRect();
    const rows = this.scope.querySelectorAll<HTMLElement>('[data-lamp]');
    const k = 1 - Math.exp(-Math.min(dtMs, 80) / TAU_MS);
    let moving = false;
    let anyLive = false;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.w, this.h);

    const seenIds = new Set<string>();
    rows.forEach((el, i) => {
      const id = el.dataset.fid ?? String(i);
      seenIds.add(id);
      const lamps = (el.dataset.lamp ?? 'none').split(' ') as Lamp[];
      const target = { need: 0, live: 0, ember: 0 };
      for (const l of lamps) {
        const t = TARGET[l] ?? TARGET.none;
        target.need += t.need;
        target.live += t.live;
        target.ember += t.ember;
      }
      // A row holding two lamps (a folded project) gives each its own half.
      const shared = lamps.length > 1;
      let lv = this.levels.get(id);
      if (!lv) {
        // First sight of a row: it starts at its state, with no entrance.
        lv = { ...target, seen: true };
        this.levels.set(id, lv);
      }
      for (const ch of ['need', 'live', 'ember'] as const) {
        const d = target[ch] - lv[ch];
        if (Math.abs(d) > 0.003) {
          lv[ch] += d * k;
          moving = true;
        } else lv[ch] = target[ch];
      }
      const r = el.getBoundingClientRect();
      // A folding project clips its rows; the light follows what is left of the row, so it leaves as the row does.
      const clip = el.closest('.proj-rows')?.getBoundingClientRect();
      const top = clip ? Math.max(r.top, clip.top) : r.top;
      const bottom = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
      const shown = bottom - top;
      if (shown < 1 || r.width < 2) return;
      const x = r.left - box.left;
      const cy = (top + bottom) / 2 - box.top;
      const w = r.width;
      const h = r.height;
      const fold = Math.min(1, shown / h);
      const wide = Math.min(1, w / 120); // 1 in the open sidebar, small on the rail

      if (lv.live > 0.004) {
        anyLive = true;
        const phase = still ? 0.9 : (timeMs / DRIFT_MS) * Math.PI * 2 + i * 1.7;
        const sway = Math.sin(phase);
        const breath = still ? 1 : 0.9 + 0.1 * Math.sin(phase * 2 + 0.6);
        const cx = x + w * ((shared ? 0.74 : 0.5) + (shared ? 0.1 : 0.27) * wide * sway);
        pool(g, cx, cy, Math.max(34, w * (shared ? 0.3 : 0.44)), h * 1.02, palette.live, palette.liveA * gain * lv.live * breath * fold);
        pool(g, cx - w * 0.06 * sway, cy, Math.max(20, w * 0.2), h * 0.6, palette.live, palette.liveA * 0.7 * gain * lv.live * fold);
      }
      if (lv.need > 0.004) {
        pool(g, x + w * (shared ? 0.3 : 0.42), cy, Math.max(40, w * (shared ? 0.5 : 0.74)), h * 1.12, palette.need, palette.needA * gain * lv.need * fold);
        pool(g, x + Math.min(20, w / 2), cy, Math.max(30, 84 * wide), h * 0.78, palette.core, palette.coreA * gain * lv.need * fold);
      }
      if (lv.ember > 0.004) {
        pool(g, x + Math.min(20, w / 2), cy, Math.max(26, 54 * wide), h * 0.72, palette.need, palette.emberA * gain * lv.ember * fold);
      }
    });
    for (const id of this.levels.keys()) if (!seenIds.has(id)) this.levels.delete(id);

    // The glass thins what is under it, so the pools are painted hotter than they are meant to be seen and held back
    // where they pass the pane's edge: inside the pane's footprint at full strength, outside it at `spill`.
    const pane = this.scope.querySelector<HTMLElement>('.pane');
    if (pane && palette.spill < 1) {
      const pr = pane.getBoundingClientRect();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = `rgba(0,0,0,${(1 - palette.spill).toFixed(3)})`;
      g.filter = 'blur(3px)';
      g.beginPath();
      g.rect(-20, -20, this.w + 40, this.h + 40);
      g.roundRect(pr.left - box.left, pr.top - box.top, pr.width, pr.height, 18);
      g.fill('evenodd');
      g.filter = 'none';
    }
    g.globalCompositeOperation = 'destination-over';
    if (pane && palette.floor > 0) {
      const pr = pane.getBoundingClientRect();
      g.fillStyle = `rgba(255,255,255,${palette.floor})`;
      g.beginPath();
      g.roundRect(pr.left - box.left + 1, pr.top - box.top + 1, pr.width - 2, pr.height - 2, 17);
      g.fill();
    }
    g.fillStyle = palette.ground;
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'source-over';

    if (this.owed > 0) this.owed -= 1;
    return moving || this.owed > 0 || (anyLive && !still);
  }
}
