// The thinking mark: the triquetra engraved on Mjolnir, drawn as a solid bevelled band that weaves over and under
// itself, turning in 3D while a light travels the strand. The owner chose it from a set of explorations
// (~/Developer/triquetra-thinking, flow mode at an 85% dip, sped to 1.1). Every mark on the page is drawn through one
// shared WebGL context and copied into its own 2D canvas, so any number of live thinking rows costs one context, well
// under the browser's per-page limit.

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Quat = [number, number, number, number]; // [w, x, y, z]

// ---------- quaternions ----------
const qMul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qAxis = (ax: Vec3, ang: number): Quat => {
  const s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s];
};
const qNorm = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
// Column-major, as uniformMatrix3fv expects.
function qMatrix(q: Quat): Float32Array {
  const [w, x, y, z] = q;
  return new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
  ]);
}
const norm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
function slerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  const th = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  if (th < 1e-4) return a;
  const s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------- geometry ----------
// Three unit circles on an equilateral triangle of side s. The strand runs, on circle k, from the outer meeting point
// of circles k-1,k to that of k,k+1 (the inner sweep). Offsetting a strand of circular arcs by o is the same
// construction at radius 1+o, so every line of the band's cross-section is exact, sharp tips included.
function centres(s: number): Vec2[] {
  const d = s / SQRT3;
  return [0, 1, 2].map((k) => {
    const a = -Math.PI / 2 + (k * TAU) / 3;
    return [d * Math.cos(a), d * Math.sin(a)];
  });
}
function meet(C: Vec2[], s: number, a: number, b: number, rho: number, outer: boolean): Vec2 {
  const c = 3 - a - b, L = Math.hypot(C[c][0], C[c][1]);
  const h = Math.sqrt(Math.max(0, rho * rho - (s * s) / 4)) * (outer ? 1 : -1);
  return [(C[a][0] + C[b][0]) / 2 - (C[c][0] / L) * h, (C[a][1] + C[b][1]) / 2 - (C[c][1] / L) * h];
}
function arcOf(C: Vec2[], s: number, k: number, rho: number): { a0: number; sweep: number } {
  const p0 = meet(C, s, (k + 2) % 3, k, rho, true), p1 = meet(C, s, k, (k + 1) % 3, rho, true);
  const a0 = Math.atan2(p0[1] - C[k][1], p0[0] - C[k][0]);
  let ccw = (Math.atan2(p1[1] - C[k][1], p1[0] - C[k][0]) - a0) % TAU;
  if (ccw < 0) ccw += TAU;
  const midDist = (sw: number) => Math.hypot(C[k][0] + rho * Math.cos(a0 + sw / 2), C[k][1] + rho * Math.sin(a0 + sw / 2));
  return { a0, sweep: midDist(ccw) < midDist(ccw - TAU) ? ccw : ccw - TAU };
}

// Which arc passes over at each crossing: walk the strand and alternate. Crossing c is the inner meeting point of the
// two circles other than c.
export const OVER: number[] = (() => {
  const C = centres(1), seq: { k: number; c: number; t: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const { a0, sweep } = arcOf(C, 1, k, 1);
    for (let c = 0; c < 3; c++) {
      if (c === k) continue;
      const I = meet(C, 1, k, 3 - k - c, 1, false);
      const d = (((Math.atan2(I[1] - C[k][1], I[0] - C[k][0]) - a0) * Math.sign(sweep)) % TAU + TAU) % TAU;
      seq.push({ k, c, t: k + d / Math.abs(sweep) });
    }
  }
  seq.sort((p, q) => p.t - q.t);
  const over: number[] = [];
  seq.forEach((e, i) => {
    if (i % 2 === 0) over[e.c] = e.k;
  });
  return over;
})();

// The band's cross-section in (radial offset, z): a bevelled rectangle; each facet with its outward normal.
const HALF_W = 0.1, HALF_H = 0.065, BEVEL = 0.046, LIFT = 0.1;
const PROFILE = (() => {
  const [w, h, b] = [HALF_W, HALF_H, BEVEL];
  const P: Vec2[] = [[w, h - b], [w - b, h], [-w + b, h], [-w, h - b], [-w, -h + b], [-w + b, -h], [w - b, -h], [w, -h + b]];
  return P.map((p, i) => {
    const q = P[(i + 1) % P.length];
    let nr = q[1] - p[1], nz = -(q[0] - p[0]);
    if (nr * (p[0] + q[0]) + nz * (p[1] + q[1]) < 0) [nr, nz] = [-nr, -nz];
    const l = Math.hypot(nr, nz);
    return { a: p, b: q, nr: nr / l, nz: nz / l };
  });
})();
const FLOATS = 8; // position 3, normal 3, strand parameter, face weight
const VERTS_PER_SAMPLE = PROFILE.length * 2;

// The band mesh at breathing parameter s, n samples per arc. Each arc is its own strip, so the tips stay creased.
// The strand rises over and dips under at each crossing, so the weave is real depth.
export function buildMesh(s: number, n: number, out: Float32Array): Float32Array {
  const C = centres(s);
  const I = [0, 1, 2].map((c) => meet(C, s, (c + 1) % 3, (c + 2) % 3, 1, false));
  let o = 0;
  for (let k = 0; k < 3; k++) {
    const arcs = new Map<number, { a0: number; sweep: number }>();
    const arcAt = (off: number) => {
      let arc = arcs.get(off);
      if (!arc) arcs.set(off, (arc = arcOf(C, s, k, 1 + off)));
      return arc;
    };
    const centre = arcOf(C, s, k, 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n, thc = centre.a0 + centre.sweep * t;
      const xc = C[k][0] + Math.cos(thc), yc = C[k][1] + Math.sin(thc);
      let z = 0;
      for (let c = 0; c < 3; c++) {
        if (c === k) continue;
        const d2 = (xc - I[c][0]) ** 2 + (yc - I[c][1]) ** 2;
        z += (OVER[c] === k ? 1 : -1) * LIFT * Math.exp(-d2 / 0.05);
      }
      const u = (k + t) / 3;
      for (const f of PROFILE) {
        for (const p of [f.a, f.b]) {
          const arc = arcAt(p[0]), th = arc.a0 + arc.sweep * t, cx = Math.cos(th), sy = Math.sin(th), rho = 1 + p[0];
          out.set([C[k][0] + rho * cx, C[k][1] + rho * sy, z + p[1], cx * f.nr, sy * f.nr, f.nz, u, 0.45 + 0.55 * Math.abs(f.nz)], o);
          o += FLOATS;
        }
      }
    }
  }
  return out;
}
export function buildIndices(n: number): Uint16Array {
  const idx: number[] = [], row = VERTS_PER_SAMPLE;
  for (let k = 0; k < 3; k++) {
    const base = k * (n + 1) * row;
    for (let i = 0; i < n; i++) {
      for (let f = 0; f < PROFILE.length; f++) {
        const a = base + i * row + f * 2, b = a + 1, c = a + row, d = b + row;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  return new Uint16Array(idx);
}
const meshFloats = (n: number) => 3 * (n + 1) * VERTS_PER_SAMPLE * FLOATS;

// ---------- motion ----------
// One full turn per beat about one axis while the axis glides over the sphere to the next; angular velocity is
// integrated, so the mark never stops. It surges mid-turn and eases to (1 - DIP) of its peak between turns.
const BEAT = 1.9, DIP = 0.85, SPEED = 1.1;
// Successive turn axes, spread around the sphere and never close to the view axis (a turn about the view axis reads
// as a flat spin, not a turn in space).
const AXES: Vec3[] = (() => {
  let seed = 7;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out: Vec3[] = [];
  let az = 0;
  for (let i = 0; i < 48; i++) {
    az += (70 + r() * 140) * (Math.PI / 180);
    const el = (r() * 2 - 1) * 0.7;
    out.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
  }
  return out;
})();
// At rest the plane keeps a slight tilt, so the band's thickness still reads.
const Q_REST = qAxis(norm3([1, 0.45, 0]), 0.3);

export interface MarkState {
  t: number;
  q: Quat;
}
export const newMarkState = (phase = 0): MarkState => ({ t: phase, q: Q_REST });

// Advances a mark by dt seconds; returns its pose, breathing and the pulse head along the strand.
export function advance(state: MarkState, dt: number): { q: Quat; breath: number; pulse: number } {
  const t0 = state.t, t = (state.t += dt * SPEED);
  const i = Math.floor(t / BEAT), ph = t / BEAT - i;
  const ax = norm3(slerp3(AXES[i % AXES.length], AXES[(i + 1) % AXES.length], smooth(0.55, 1, ph)));
  const omega = ((TAU / BEAT) * (1 - DIP + DIP * Math.sin(Math.PI * ph) ** 2)) / (1 - DIP / 2);
  state.q = qNorm(qMul(qAxis(ax, omega * (t - t0)), state.q));
  return { q: qMul(state.q, qAxis([0, 0, 1], -0.35 * t)), breath: -Math.cos(TAU * ph), pulse: t / BEAT };
}
export const restPose = (): { q: Quat; breath: number; pulse: number } => ({ q: Q_REST, breath: 0, pulse: 0 });

// ---------- rendering ----------
const VS = `
  attribute vec3 aPos; attribute vec3 aNor; attribute float aU; attribute float aFace;
  uniform mat3 uRot; uniform float uScale; uniform float uD;
  varying vec3 vN; varying vec3 vP; varying float vU; varying float vFace;
  void main() {
    vec3 p = uRot * aPos;
    vN = uRot * aNor; vP = p; vU = aU; vFace = aFace;
    float w = (uD - p.z) / uD;
    gl_Position = vec4(p.x * uScale, p.y * uScale - 0.12 * uScale * w, -p.z * 0.2, w);
  }`;
// highp to match the vertex stage: uD is shared, and mismatched precision fails linking.
const FS = `
  precision highp float;
  uniform vec3 uInk; uniform vec3 uGlint; uniform vec3 uPulse; uniform vec3 uL;
  uniform float uHead; uniform float uAct; uniform float uD;
  varying vec3 vN; varying vec3 vP; varying float vU; varying float vFace;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vec3(0.0, 0.0, uD) - vP);
    vec3 h = normalize(uL + v);
    float nh = max(dot(n, h), 0.0);
    float spec = pow(nh, 60.0) * 0.95 + pow(nh, 10.0) * 0.12;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.22;
    vec3 col = uInk * (0.22 + 0.3 * (0.5 + 0.5 * n.y) + 0.6 * max(dot(n, uL), 0.0)) + uGlint * (spec + rim);
    float behind = fract(uHead - vU);
    float pulse = exp(-behind / 0.14) * smoothstep(0.0, 0.035, behind) * (1.0 - smoothstep(0.45, 0.6, behind)) * uAct * vFace;
    gl_FragColor = vec4(mix(col, uPulse, clamp(pulse * 0.85, 0.0, 1.0)), 1.0);
  }`;
const LIGHT = norm3([-0.6, 0.65, 0.45]);

export interface MarkColours {
  ink: Vec3;
  glint: Vec3;
  pulse: Vec3;
}

// The one WebGL context every mark draws through: each draw renders into the corner of a scratch canvas and the
// caller copies that corner into its own 2D canvas.
class SharedRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private n = -1;
  private count = 0;
  private verts = new Float32Array(0);

  constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`thinking mark: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    for (const name of ['uRot', 'uScale', 'uD', 'uInk', 'uGlint', 'uPulse', 'uL', 'uHead', 'uAct']) this.u[name] = gl.getUniformLocation(prog, name);
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    ([['aPos', 3, 0], ['aNor', 3, 12], ['aU', 1, 24], ['aFace', 1, 28]] as const).forEach(([name, size, off]) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off);
    });
    gl.enable(gl.DEPTH_TEST);
    gl.uniform3fv(this.u.uL, LIGHT);
    gl.uniform1f(this.u.uD, 8);
  }

  draw(px: number, pose: { q: Quat; breath: number; pulse: number }, activity: number, colours: MarkColours): void {
    const gl = this.gl;
    if (this.canvas.width < px || this.canvas.height < px) {
      this.canvas.width = Math.max(this.canvas.width, px);
      this.canvas.height = Math.max(this.canvas.height, px);
    }
    // Fewer samples where they could not be seen anyway.
    const n = px < 48 ? 24 : px < 120 ? 48 : 96;
    if (n !== this.n) {
      this.n = n;
      this.verts = new Float32Array(meshFloats(n));
      const idx = buildIndices(n);
      this.count = idx.length;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    }
    gl.bufferData(gl.ARRAY_BUFFER, buildMesh(1.02 + 0.1 * pose.breath * activity, n, this.verts), gl.DYNAMIC_DRAW);
    gl.viewport(0, this.canvas.height - px, px, px); // the top-left corner, as the 2D copy reads it
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, this.canvas.height - px, px, px);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix3fv(this.u.uRot, false, qMatrix(pose.q));
    gl.uniform1f(this.u.uScale, 0.66); // the turned, perspective-grown mark just fits
    gl.uniform1f(this.u.uHead, ((pose.pulse % 1) + 1) % 1);
    gl.uniform1f(this.u.uAct, activity);
    gl.uniform3fv(this.u.uInk, colours.ink);
    gl.uniform3fv(this.u.uGlint, colours.glint);
    gl.uniform3fv(this.u.uPulse, colours.pulse);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  }
}

let shared: SharedRenderer | null | undefined;
let retryAt = 0;
const RETRY_MS = 1000;
// The shared renderer, or null where it cannot be had: for good where there is no WebGL (a test DOM), and for a
// moment after a failed build or a lost context (the GPU may be restarting), so a later paint tries again. A mark
// without a renderer draws nothing; building one never throws.
function sharedRenderer(): SharedRenderer | null {
  if (shared !== undefined) return shared;
  if (typeof WebGLRenderingContext === 'undefined') return (shared = null);
  if (performance.now() < retryAt) return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('thinking mark: no context');
    const renderer = new SharedRenderer(canvas, gl);
    if (gl.isContextLost()) throw new Error('thinking mark: context lost');
    canvas.addEventListener('webglcontextlost', () => {
      if (shared === renderer) shared = undefined;
    });
    return (shared = renderer);
  } catch {
    retryAt = performance.now() + RETRY_MS;
    return null;
  }
}

// ---------- the marks on the page ----------
// One animation loop draws every mounted mark that is on screen; a mark off screen, or the whole page under reduced
// motion, holds its rest pose and costs nothing per frame.
interface Mark {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  state: MarkState;
  visible: boolean;
}
const marks = new Set<Mark>();
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let colours: MarkColours | null = null;
let frame = 0;
let last = 0;
let retry = 0;

function hex(value: string, fallback: Vec3): Vec3 {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
function readColours(): MarkColours {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: hex(style.getPropertyValue('--thinking-mark-ink'), [0.45, 0.44, 0.41]),
    glint: hex(style.getPropertyValue('--thinking-mark-glint'), [1, 1, 1]),
    pulse: hex(style.getPropertyValue('--thinking-mark-pulse'), [0.12, 0.12, 0.11]),
  };
}

function paint(mark: Mark, pose: { q: Quat; breath: number; pulse: number }, activity: number): void {
  const renderer = sharedRenderer();
  if (!renderer) {
    // A transient failure (not the permanent null): look again shortly, so marks painted only at rest recover too.
    if (shared === undefined && !retry) retry = window.setTimeout(() => ((retry = 0), repaintAtRest()), RETRY_MS);
    return;
  }
  colours ??= readColours();
  const px = Math.round(mark.size * window.devicePixelRatio);
  if (mark.canvas.width !== px) mark.canvas.width = mark.canvas.height = px;
  renderer.draw(px, pose, activity, colours);
  mark.ctx.clearRect(0, 0, px, px);
  mark.ctx.drawImage(renderer.canvas, 0, 0, px, px, 0, 0, px, px);
}

function tick(now: number): void {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  for (const mark of marks) if (mark.visible) paint(mark, advance(mark.state, dt), 1);
  frame = requestAnimationFrame(tick);
}
function schedule(): void {
  const animate = !reducedMotion() && [...marks].some((mark) => mark.visible);
  if (animate && !frame) {
    last = 0;
    frame = requestAnimationFrame(tick);
  } else if (!animate && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
function repaintAtRest(): void {
  colours = null;
  for (const mark of marks) if (!frame || !mark.visible) paint(mark, restPose(), 0);
  schedule();
}

let watching = false;
function watchPage(): void {
  if (watching) return;
  watching = true;
  // A theme switch re-reads the tokens; a reduced-motion switch stops or starts the loop.
  new MutationObserver(repaintAtRest).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintAtRest);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', repaintAtRest);
}

let seen: IntersectionObserver | null = null;
// Mounts a mark into a canvas; returns its unmount.
export function mountMark(canvas: HTMLCanvasElement, size: number): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof IntersectionObserver === 'undefined') return () => {};
  watchPage();
  // A random phase, so marks on screen together do not turn in step.
  const mark: Mark = { canvas, ctx, size, state: newMarkState(Math.random() * 30), visible: false };
  marks.add(mark);
  seen ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      for (const m of marks) if (m.canvas === entry.target) m.visible = entry.isIntersecting;
    }
    schedule();
  });
  seen.observe(canvas);
  paint(mark, restPose(), 0);
  return () => {
    seen?.unobserve(canvas);
    marks.delete(mark);
    schedule();
  };
}
