// S7b, the deck page: a renderer replica of a 100-slide deck (S6's v14 model, s6/src/ydoc.ts) over S2's port
// provider, with a minimal editor: the current slide as S6's SlideCanvas (s6/src/canvas.ts, in place) at half scale
// with S6's drag, and a filmstrip of 100 live thumbnails (one SlideCanvas each at 0.1 scale, all patching from the
// model). Measures open → synced → painted, and a drag's per-move latency (pointermove → transaction → frame → ack)
// while an agent republishes slides. Throwaway spike code.
import * as Y from '@y/y';
import { PortProvider, type PortLike, type SaveState } from '../../s2/v14/provider/port';
import { CANVAS_CSS, SlideCanvas } from '../../s6/src/canvas.ts';
import { slideOrder } from '../../s6/src/model.ts';

interface Harness {
  report(message: unknown): void;
  onCommand(listener: (command: { id: number; name: string; input: Record<string, unknown> }) => void): void;
}
const harness = (window as unknown as { harness: Harness }).harness;
const role = new URLSearchParams(location.search).get('role') ?? '?';
const now = () => performance.timeOrigin + performance.now();
const rel = () => performance.now();
const afterPaint = () => new Promise<{ raf: number; post: number }>((r) => requestAnimationFrame(() => {
  const raf = rel();
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r({ raf, post: rel() });
  ch.port2.postMessage(null);
}));
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
const style = document.createElement('style');
style.textContent = CANVAS_CSS;
document.head.appendChild(style);

const doc = new Y.Doc();
const provider = new PortProvider(doc);
let localTotal = 0;
const ackTimes: number[] = [];
let open: { tMain: number; tPort?: number; tSynced?: number; step2Bytes?: number; step2ApplyMs?: number } = { tMain: 0 };
doc.on('update', (_u: Uint8Array, origin: unknown) => {
  if (origin !== provider) localTotal += 1;
});
provider.subscribe((s: SaveState) => {
  while (ackTimes.length < localTotal - s.unsaved) ackTimes.push(rel());
  if (s.synced && open.tSynced === undefined) {
    open.tSynced = now();
    harness.report({ t: 'synced', role });
  }
});
const frames: { at: number; ms: number; bytes: number }[] = [];
window.addEventListener('message', (event) => {
  const data = event.data as { s2?: string; tMain?: number } | null;
  if (data?.s2 !== 'doc-port') return;
  open = { tMain: data.tMain ?? 0, tPort: now() };
  const port = event.ports[0];
  const wrapped: PortLike = {
    postMessage: (m) => port.postMessage(m),
    start: () => port.start(),
    close: () => port.close(),
    removeEventListener: () => {},
    addEventListener: (type, listener) => {
      if (type !== 'message') return port.addEventListener(type as 'message', listener as never);
      port.addEventListener('message', (e: MessageEvent) => {
        const t = rel();
        listener({ data: e.data });
        const ms = rel() - t;
        const d = e.data as Uint8Array;
        if (d[0] === 0 && d[1] === 1 && open.step2ApplyMs === undefined) {
          open.step2ApplyMs = ms;
          open.step2Bytes = d.length;
        }
        frames.push({ at: t, ms, bytes: d.length });
      });
    },
  };
  provider.connect(wrapped);
});

let stage: SlideCanvas | null = null;
const thumbs: SlideCanvas[] = [];
async function mount() {
  const t0 = now();
  const order = slideOrder(doc);
  const current = order[5]; // the "flow" shape: absolutely placed boxes (S6's bench picks the same slide)
  const stageHost = document.createElement('div');
  stageHost.className = 'scale';
  document.getElementById('stage')!.appendChild(stageHost);
  stage = new SlideCanvas(doc, current, document, stageHost);
  stage.attachDrag(0.5);
  const tStage = now();
  const stagePaint = await afterPaint();
  const strip = document.getElementById('strip')!;
  for (const id of order) {
    const t = document.createElement('div');
    t.className = 'thumb';
    const s = document.createElement('div');
    s.className = 'scale';
    t.appendChild(s);
    strip.appendChild(t);
    thumbs.push(new SlideCanvas(doc, id, document, s));
  }
  const tStrip = now();
  const p = await afterPaint();
  return {
    slides: order.length,
    openToSyncedMs: open.tSynced! - open.tMain,
    step2Bytes: open.step2Bytes,
    step2ApplyMs: open.step2ApplyMs,
    stageRenderMs: tStage - t0,
    openToStagePaintMs: performance.timeOrigin + stagePaint.post - open.tMain,
    filmstripRenderMs: tStrip - (performance.timeOrigin + stagePaint.post),
    openToAllPaintMs: performance.timeOrigin + p.post - open.tMain,
    domNodes: document.getElementsByTagName('*').length,
  };
}

// drag measurement
interface Move { tIn: number; tTx?: number; tRaf?: number; tPost?: number; local?: number }
let moves: Move[] = [];
let measuring = false;
let measureStart = 0;
const longTasks: number[] = [];
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) if (measuring) longTasks.push(e.duration);
}).observe({ type: 'longtask' });
document.addEventListener('pointermove', (e) => {
  if (measuring && e.buttons) moves.push({ tIn: e.timeStamp });
}, true);
doc.on('update', (_u: Uint8Array, origin: unknown) => {
  if (!measuring || origin !== 'drag') return;
  const m = moves[moves.length - 1];
  if (!m || m.tTx !== undefined) return;
  m.tTx = rel();
  m.local = localTotal;
  afterPaint().then((p) => {
    m.tRaf = p.raf;
    m.tPost = p.post;
  });
});
const stats = (xs: number[]) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: Math.round(s[s.length - 1] * 10) / 10 };
};
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

harness.onCommand(async ({ id, name }) => {
  try {
    let value: unknown;
    switch (name) {
      case 'mount':
        value = await mount();
        break;
      case 'dragTarget': {
        const el = [...stage!.root.querySelectorAll<HTMLElement>('[data-eid]')].find((e) => e.style.position === 'absolute' && e.tagName === 'DIV');
        if (!el) throw new Error('no pinned div on the current slide');
        const r = el.getBoundingClientRect();
        value = { eid: el.dataset.eid, x: Math.round(r.left + 10), y: Math.round(r.top + 10) };
        break;
      }
      case 'measure.start':
        moves = [];
        longTasks.length = 0;
        measureStart = rel();
        measuring = true;
        value = true;
        break;
      case 'measure.stop': {
        measuring = false;
        const deadline = rel() + 8000;
        while (provider.state.unsaved > 0 && rel() < deadline) await new Promise((r) => setTimeout(r, 20));
        await afterPaint();
        const tx = moves.filter((m) => m.tTx !== undefined);
        const remote = frames.filter((f) => f.at >= measureStart && f.bytes > 8);
        value = {
          moves: moves.length,
          withTransaction: tx.length,
          inputToTxMs: stats(tx.map((m) => m.tTx! - m.tIn)),
          inputToFrameMs: stats(tx.filter((m) => m.tRaf).map((m) => m.tRaf! - m.tIn)),
          inputToPostPaintMs: stats(tx.filter((m) => m.tPost).map((m) => m.tPost! - m.tIn)),
          inputToAckMs: stats(tx.filter((m) => ackTimes[m.local! - 1] !== undefined).map((m) => ackTimes[m.local! - 1] - m.tIn)),
          longTasks: { n: longTasks.length, max: Math.round(Math.max(0, ...longTasks)) },
          remoteFrames: { n: remote.length, handleMs: stats(remote.map((f) => f.ms)) },
          stageWrites: stage!.writes,
        };
        break;
      }
      case 'memory': {
        const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
        value = m ? { usedJSHeapMB: +(m.usedJSHeapSize / 1e6).toFixed(1), totalJSHeapMB: +(m.totalJSHeapSize / 1e6).toFixed(1), domNodes: document.getElementsByTagName('*').length } : null;
        break;
      }
      case 'digest':
        value = { digest: fnv(JSON.stringify(doc.get('slides').toJSON())), state: provider.state, errors };
        break;
      default:
        throw new Error(`unknown ${name}`);
    }
    harness.report({ t: 'res', id, ok: true, value });
  } catch (error) {
    harness.report({ t: 'res', id, ok: false, error: String((error as Error)?.stack ?? error) });
  }
});
harness.report({ t: 'ready', role });
