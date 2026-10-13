// S7b, the editor page: a renderer replica as the app's document editor would be. A document port from main (through
// the preload, S2's route) runs S2's v14 PortProvider (s2/v14/provider/port.ts, in place) on a DOM MessagePort; once
// synced, a real Tiptap 3.31.3 editor binds to the tab body through S3's YCollaboration (s3/lib/collab.mjs, in place:
// S1's extension plus the history mode and undo guards) with the schema module (schema.mjs, S3's). Main drives it
// through CDP (keys, IME) and `window.s7` (Runtime.evaluate); the page measures input → transaction → frame → ack,
// remote frames, first sync and the history preview. Throwaway spike code.
import * as Y from '@y/y';
import { Editor } from '@tiptap/core';
import { PortProvider, type PortLike, type SaveState } from '../../s2/v14/provider/port';
import { decodeFrame, encodeFrame } from '../../s2/src/frames';
import { YCollaboration } from '../../s3/lib/collab.mjs';
import { openDiff, changeList } from '../../s3/lib/history.mjs';
import { extensions } from './schema.mjs';
import { body, hasBody } from './doc';

interface Harness {
  report(message: unknown): void;
  onCommand(listener: (command: { id: number; name: string; input: Record<string, unknown> }) => void): void;
}
const harness = (window as unknown as { harness: Harness }).harness;
const role = new URLSearchParams(location.search).get('role') ?? '?';
const now = () => performance.timeOrigin + performance.now();
const rel = () => performance.now();
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(() => r(rel())));
// the frame after a change: rAF time (style, layout and paint follow it), then a task after that frame
const afterPaint = () => new Promise<{ raf: number; post: number }>((r) => requestAnimationFrame(() => {
  const raf = rel();
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r({ raf, post: rel() });
  ch.port2.postMessage(null);
}));

let doc: Y.Doc;
let provider: PortProvider;
let editor: Editor | null = null;
let localTotal = 0;
let ackTimes: number[] = [];
let holdWhileComposing = false;
let mergeOnFlush = false;
const held: { data: unknown; listener: (e: { data?: unknown }) => void }[] = [];
const frameLog: { type: number; bytes: number; ms: number; at: number }[] = [];
let open: { tMain: number; tPort: number; tSynced?: number; step2Bytes?: number; step2ApplyMs?: number; tEditorStart?: number; tEditorCreated?: number; tBound?: number; tPaint?: number; tPost?: number; childCount?: number } | null = null;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${String((e.reason as Error)?.stack ?? e.reason)}`));
const origError = console.error.bind(console);
console.error = (...a: unknown[]) => { errors.push(`console.error: ${a.map((x) => String((x as Error)?.stack ?? x)).join(' ').slice(0, 600)}`); origError(...a); };

// ---- the port, wrapped to time each frame's handling (and, optionally, to hold sync frames while composing) ----
function wrap(port: MessagePort): PortLike {
  const listeners = new Map<(e: { data?: unknown }) => void, (e: MessageEvent) => void>();
  return {
    postMessage: (m) => port.postMessage(m),
    start: () => port.start(),
    close: () => port.close(),
    removeEventListener: (type, listener) => {
      const w = listeners.get(listener);
      if (w) port.removeEventListener(type as 'message', w);
    },
    addEventListener: (type, listener) => {
      if (type !== 'message') return port.addEventListener(type as 'message', listener as never);
      const w = (e: MessageEvent) => {
        const data = e.data as Uint8Array;
        const kind = data instanceof Uint8Array ? data[0] : -1;
        // the architect's hold shape: only sync frames (type 0) are buffered, in order, never dropped; awareness and
        // ack pass through; the binding sets the hold on compositionstart and clears it when view.composing is false
        if (kind === 0 && (held.length > 0 || holdSince !== null)) {
          if (held.length === 0) holds.push({ start: rel(), frames: 0, bytes: 0, maxQueued: 0 });
          const h = holds[holds.length - 1];
          held.push({ data, listener });
          h.frames += 1;
          h.bytes += (data as Uint8Array).length;
          h.maxQueued = Math.max(h.maxQueued, held.length);
          return;
        }
        const t = rel();
        listener({ data });
        const ms = rel() - t;
        if (data instanceof Uint8Array && data[0] === 0 && data[1] === 1 && open && open.step2ApplyMs === undefined) {
          open.step2ApplyMs = ms;
          open.step2Bytes = data.length;
        }
        if (frameLog.length < 20000) frameLog.push({ type: kind === 0 ? data[1] : kind, bytes: data.length, ms, at: t });
      };
      listeners.set(listener, w);
      port.addEventListener('message', w);
    },
  };
}
// hold episodes (S4's fix): from the first held frame to the drained queue; catch-up is compositionend → drained
const holds: { start: number; frames: number; bytes: number; maxQueued: number; compositionEnd?: number; drained?: number; applyMs?: number }[] = [];
let holdSince: number | null = null; // set on compositionstart while holdWhileComposing
let capFired = 0;
const HOLD_CAP_MS = 5000;
const releaseHeld = () => {
  if (holdSince !== null) {
    const capped = rel() - holdSince > HOLD_CAP_MS;
    if (editor?.view.composing && !capped) return;
    if (capped && editor?.view.composing) capFired += 1;
    holdSince = null;
  }
  if (held.length === 0) return;
  const h = holds[holds.length - 1];
  const t0 = rel();
  const updates = held.map(({ data }) => decodeFrame(data));
  if (mergeOnFlush && updates.every((f) => f.type === 'update')) {
    // one merged update → one Y transaction → one binding transaction and one PM view update
    const { listener } = held[0];
    held.length = 0;
    const merged = encodeFrame({ type: 'update', update: Y.mergeUpdates(updates.map((f) => (f as { update: Uint8Array }).update)) });
    listener({ data: merged });
    frameLog.push({ type: 2, bytes: merged.length, ms: rel() - t0, at: t0 });
  }
  while (held.length > 0) {
    const { data, listener } = held.shift()!;
    const t = rel();
    listener({ data });
    frameLog.push({ type: (data as Uint8Array)[0] === 0 ? (data as Uint8Array)[1] : (data as Uint8Array)[0], bytes: (data as Uint8Array).length, ms: rel() - t, at: t });
  }
  if (h) {
    h.drained = rel();
    h.applyMs = h.drained - t0;
  }
};
setInterval(releaseHeld, 5);

// ---- per-keystroke measurement -----------------------------------------------------------------------------------
interface Key { tIn: number; kind: string; tInput?: number; tTx?: number; tRaf?: number; tPost?: number; local?: number; clock?: number }
let keys: Key[] = [];
let pendingKey: Key | null = null;
let measuring = false;
const longTasks: { at: number; ms: number }[] = [];
const slowEvents: { name: string; at: number; duration: number; delay: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (measuring) longTasks.push({ at: e.startTime, ms: e.duration });
}).observe({ type: 'longtask', buffered: false });
new PerformanceObserver((list) => {
  for (const e of list.getEntries() as PerformanceEventTiming[]) if (measuring) slowEvents.push({ name: e.name, at: e.startTime, duration: e.duration, delay: e.processingStart - e.startTime });
}).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);

function onKeydown(e: KeyboardEvent) {
  if (!measuring) return;
  pendingKey = { tIn: e.timeStamp, kind: e.keyCode === 229 ? 'ime' : 'key' };
  keys.push(pendingKey);
}
function onInput(e: Event) {
  // IME steps have no PM transaction per update in every case; the frame after the input event is what the eye sees
  if (!measuring || !pendingKey) return;
  const k = pendingKey;
  // the first input event after the keydown: natively 0.2 ms after it (the capture); through CDP the composition
  // arrives as a second command, so IME latency is also reported from here
  if (k.tInput === undefined) k.tInput = e.timeStamp;
  if (k.tRaf !== undefined) return;
  if (k.kind === 'ime') afterPaint().then((p) => { if (k.tRaf === undefined) { k.tRaf = p.raf; k.tPost = p.post; } });
  void e;
}

// remote visibility (window B): when another replica's client reaches a clock, and the frame after
let watch: { client: number; last: number; seen: { clock: number; at: number; raf?: number }[] } | null = null;

function fresh(): void {
  editor?.destroy();
  editor = null;
  document.getElementById('editor')?.remove();
  provider?.destroy();
  doc = new Y.Doc();
  localTotal = 0;
  ackTimes = [];
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin !== provider) localTotal += 1;
    else if (watch) {
      const clock = doc.store.getClock(watch.client);
      if (clock > watch.last) {
        watch.last = clock;
        const s = { clock, at: now() } as { clock: number; at: number; raf?: number };
        watch.seen.push(s);
        requestAnimationFrame(() => (s.raf = now()));
      }
    }
  });
  provider = new PortProvider(doc, { log: (line) => harness.report({ t: 'log', role, line }) });
  provider.subscribe((s: SaveState) => {
    const durable = localTotal - s.unsaved;
    while (ackTimes.length < durable) ackTimes.push(rel());
    if (s.synced && open && open.tSynced === undefined) {
      open.tSynced = now();
      harness.report({ t: 'synced', role });
    }
  });
}
fresh();

window.addEventListener('message', (event) => {
  const data = event.data as { s2?: string; tMain?: number } | null;
  if (data?.s2 !== 'doc-port') return;
  open = { tMain: data.tMain ?? 0, tPort: now() };
  frameLog.length = 0;
  provider.connect(wrap(event.ports[0]));
});

// ---- the editor ---------------------------------------------------------------------------------------------------
async function mountEditor(): Promise<unknown> {
  if (!hasBody(doc)) throw new Error('no body yet');
  const el = document.createElement('div');
  el.id = 'editor';
  document.body.appendChild(el);
  const o = open!;
  o.tEditorStart = now();
  const ed = new Editor({
    element: el,
    extensions: [...extensions(), YCollaboration.configure({ ytype: body(doc), awareness: provider.awareness, user: { name: `Owner (${role})`, color: '#2563eb' } })],
  });
  editor = ed;
  o.tEditorCreated = now();
  // the binding renders the Y content in a microtask after the view exists (S1 pitfall 3)
  await new Promise<void>((resolve, reject) => {
    const give = rel() + 20000;
    const check = () => {
      if (ed.state.doc.childCount > 1) {
        o.tBound = now();
        resolve();
      } else if (rel() > give) reject(new Error(`the binding never rendered: childCount ${ed.state.doc.childCount}, Y children ${body(doc).length}, errors ${JSON.stringify(errors)}`));
      else setTimeout(check, 0);
    };
    queueMicrotask(check);
  });
  const p = await afterPaint();
  o.tPaint = performance.timeOrigin + p.raf;
  o.tPost = performance.timeOrigin + p.post;
  o.childCount = ed.state.doc.childCount;
  ed.view.dom.addEventListener('keydown', onKeydown, true);
  ed.view.dom.addEventListener('input', onInput, true);
  ed.view.dom.addEventListener('compositionstart', () => {
    if (holdWhileComposing && holdSince === null) holdSince = rel();
  });
  ed.view.dom.addEventListener('compositionend', () => {
    const h = holds[holds.length - 1];
    if (held.length > 0 && h) h.compositionEnd = rel(); // the last one before the drain
    setTimeout(releaseHeld, 0);
  });
  ed.on('transaction', ({ transaction }) => {
    if (!measuring || !transaction.docChanged || transaction.getMeta('y-sync-transaction') != null) return;
    const k = pendingKey;
    if (!k || k.tTx !== undefined) return;
    k.tTx = rel();
    k.local = localTotal; // the binding writes to Y inside the dispatch; read after it
    queueMicrotask(() => {
      k.local = localTotal;
      k.clock = doc.store.getClock(doc.clientID);
    });
    afterPaint().then((pp) => {
      k.tRaf = pp.raf;
      k.tPost = pp.post;
    });
  });
  return { ...o, openToSyncedMs: o.tSynced! - o.tMain, syncedToBoundMs: o.tBound! - o.tSynced!, openToPaintMs: o.tPaint! - o.tMain, openToPostPaintMs: o.tPost! - o.tMain, editorConstructMs: o.tEditorCreated! - o.tEditorStart!, bindMs: o.tBound! - o.tEditorCreated!, domNodes: document.getElementsByTagName('*').length };
}

function caret(blockId: string, atStart = false): unknown {
  const ed = editor!;
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.attrs?.id === blockId && n.isTextblock) {
      pos = atStart ? p + 1 : p + n.nodeSize - 1;
      return false;
    }
    return true;
  });
  ed.commands.focus();
  ed.commands.setTextSelection(pos);
  ed.commands.scrollIntoView();
  return { pos, hasFocus: ed.view.hasFocus(), visibility: document.visibilityState };
}

function blockText(id: string, from: 'editor' | 'y' = 'editor'): string | null {
  let t: string | null = null;
  if (from === 'editor') {
    editor!.state.doc.descendants((n) => {
      if (t === null && n.attrs?.id === id) {
        t = n.textContent;
        return false;
      }
      return true;
    });
    return t;
  }
  const dom = editor!.view.dom.querySelector(`[data-id="${id}"]`);
  return dom?.textContent ?? null;
}

const stats = (xs: number[]) => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(s[s.length - 1] * 10) / 10 };
};

function keyReport() {
  const done = keys.filter((k) => k.tRaf !== undefined);
  const withAck = keys.filter((k) => k.local !== undefined && ackTimes[k.local - 1] !== undefined);
  return {
    keystrokes: keys.length,
    inputToTxMs: stats(keys.filter((k) => k.tTx !== undefined).map((k) => k.tTx! - k.tIn)),
    inputToFrameMs: stats(done.map((k) => k.tRaf! - k.tIn)),
    inputToPostPaintMs: stats(done.map((k) => k.tPost! - k.tIn)),
    inputToAckMs: stats(withAck.map((k) => ackTimes[k.local! - 1] - k.tIn)),
    // from the input event (IME: the composition update) rather than the keydown
    inputEventToFrameMs: stats(done.filter((k) => k.tInput !== undefined).map((k) => k.tRaf! - k.tInput!)),
    inputEventToPostPaintMs: stats(done.filter((k) => k.tInput !== undefined).map((k) => k.tPost! - k.tInput!)),
    noTransaction: keys.filter((k) => k.tTx === undefined).length,
    over16msToFrame: done.filter((k) => k.tRaf! - k.tIn > 16).length,
    longTasks: { n: longTasks.length, totalMs: Math.round(longTasks.reduce((s, l) => s + l.ms, 0)), max: Math.round(Math.max(0, ...longTasks.map((l) => l.ms))) },
    // Event Timing (input → presented frame, 8 ms granularity; only entries of 16 ms or more are reported)
    eventTiming: Object.fromEntries(['keydown', 'input', 'compositionupdate'].map((n) => [n, { reported: slowEvents.filter((e) => e.name === n).length, durationMs: stats(slowEvents.filter((e) => e.name === n).map((e) => e.duration)), inputDelayMs: stats(slowEvents.filter((e) => e.name === n).map((e) => e.delay)) }])),
    remoteFrames: remoteFrameReport(),
    holds: (() => {
      const hs = holds.filter((h) => h.start >= measureStart && h.drained !== undefined);
      return { n: hs.length, heldMs: stats(hs.map((h) => h.drained! - h.start)), framesHeld: stats(hs.map((h) => h.frames)), bytesHeld: stats(hs.map((h) => h.bytes)), maxQueued: Math.max(0, ...hs.map((h) => h.maxQueued)), capFired, compositionEndToDrainedMs: stats(hs.filter((h) => h.compositionEnd !== undefined).map((h) => h.drained! - h.compositionEnd!)), drainApplyMs: stats(hs.map((h) => h.applyMs!)) };
    })(),
    clocks: keys.map((k) => ({ t: performance.timeOrigin + k.tIn, clock: k.clock ?? null, ack: k.local !== undefined && ackTimes[k.local - 1] !== undefined ? performance.timeOrigin + ackTimes[k.local - 1] : null })),
  };
}
let measureStart = 0;
function remoteFrameReport() {
  const fs = frameLog.filter((f) => f.at >= measureStart && (f.type === 2 || f.type === 1));
  return { n: fs.length, handleMs: stats(fs.map((f) => f.ms)), bytes: stats(fs.map((f) => f.bytes)) };
}

// ---- history preview (S3's renderer module on the live editor) ---------------------------------------------------
let diff: ReturnType<typeof openDiff> | null = null;
async function enterHistory(input: { prevState: Uint8Array; nextState: Uint8Array; attributions: Uint8Array }) {
  const ed = editor!;
  const t0 = rel();
  const attributions = Y.decodeContentMap(input.attributions);
  const t1 = rel();
  diff = openDiff({ prevState: input.prevState, nextState: input.nextState, attributions, pick: (d: Y.Doc) => body(d) });
  const t2 = rel();
  ed.commands.showVersion({ ytype: diff.ytype, renderer: diff.renderer });
  // the rebind dispatches in the command; wait until the editor shows attributed content
  const t3 = rel();
  const p = await afterPaint();
  const t4 = rel();
  const changes = changeList(ed.state.doc);
  const t5 = rel();
  return { decodeProvenanceMs: t1 - t0, openDiffMs: t2 - t1, showVersionMs: t3 - t2, toFrameMs: p.raf - t0, toPostPaintMs: p.post - t0, changeListMs: t5 - t4, changes: changes.length, editable: ed.isEditable, childCount: ed.state.doc.childCount };
}
async function leaveHistory() {
  const ed = editor!;
  const t0 = rel();
  ed.commands.leaveHistory();
  const t1 = rel();
  diff?.destroy();
  diff = null;
  const p = await afterPaint();
  return { leaveMs: t1 - t0, toFrameMs: p.raf - t0, toPostPaintMs: p.post - t0, editable: ed.isEditable };
}

// ---- V1 against V2 in the renderer (item 8) -------------------------------------------------------------------------
function encodings(input: { v1: Uint8Array; v2: Uint8Array }) {
  const out: Record<string, number> = { v1Bytes: input.v1.length, v2Bytes: input.v2.length };
  for (let i = 0; i < 3; i++) {
    let t = rel();
    Y.applyUpdate(new Y.Doc(), input.v1);
    out[`applyV1Ms_${i}`] = +(rel() - t).toFixed(1);
    t = rel();
    Y.applyUpdateV2(new Y.Doc(), input.v2);
    out[`applyV2Ms_${i}`] = +(rel() - t).toFixed(1);
  }
  return out;
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

(window as unknown as { s7: unknown }).s7 = {
  caret,
  blockText,
  composing: () => editor?.view.composing ?? false,
  errors: () => errors,
  held: () => held.length,
};

harness.onCommand(async ({ id, name, input }) => {
  try {
    let value: unknown;
    switch (name) {
      case 'reset':
        fresh();
        value = true;
        break;
      case 'mount':
        value = await mountEditor();
        break;
      case 'caret':
        value = caret(String(input.blockId), input.atStart === true);
        break;
      case 'hold':
        holdWhileComposing = input.on === true;
        mergeOnFlush = input.merge === true;
        value = true;
        break;
      case 'measure.start':
        keys = [];
        pendingKey = null;
        longTasks.length = 0;
        slowEvents.length = 0;
        measureStart = rel();
        measuring = true;
        value = true;
        break;
      case 'measure.stop': {
        measuring = false;
        // let the last frames and acks land
        const deadline = rel() + Number(input.ackWaitMs ?? 8000);
        while (provider.state.unsaved > 0 && rel() < deadline) await new Promise((r) => setTimeout(r, 20));
        await nextFrame();
        value = keyReport();
        break;
      }
      case 'watch':
        watch = { client: Number(input.client), last: doc.store.getClock(Number(input.client)), seen: [] };
        value = true;
        break;
      case 'watched':
        value = watch?.seen ?? [];
        break;
      case 'blockText':
        value = { editor: blockText(String(input.id), 'editor'), dom: blockText(String(input.id), 'y') };
        break;
      case 'digest':
        value = { digest: hasBody(doc) ? fnv(body(doc).toString()) : null, editorMatchesY: editor ? null : null, sv: [...Y.decodeStateVector(Y.encodeStateVector(doc))], state: provider.state, clientId: doc.clientID, errors };
        break;
      case 'history.enter':
        value = await enterHistory(input as never);
        break;
      case 'history.leave':
        value = await leaveHistory();
        break;
      case 'encodings':
        value = encodings(input as never);
        break;
      case 'memory': {
        const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
        value = m ? { usedJSHeapMB: +(m.usedJSHeapSize / 1e6).toFixed(1), totalJSHeapMB: +(m.totalJSHeapSize / 1e6).toFixed(1), domNodes: document.getElementsByTagName('*').length } : null;
        break;
      }
      case 'state':
        value = provider.state;
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
