// The producer (P5 O17 M6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M6, Interfaces §G; O5's M7 verdict,
// condition 2): a tab's paints become JPEG frames for its viewers, and a controlling viewer's input reaches the page as a
// person's. Shared by the render host (the local stage, tab-engine.ts) and the app (the remote stage, M9).
//
// The source is Electron's frame subscription on the tab's WebContents (`contentsFrameSource`), never a CDP screencast
// and never cua's lease: the tab's one debugger attachment is the agent's, and a screencast there collides with the
// agent's screenshots (the U3 spike). One subscription per tab, shared by its viewers, started at the first viewer and
// stopped at the last; nothing runs while nothing is subscribed. Each tab keeps one newest source image, replaced by each
// paint, shared by its viewers and dropped with the last of them; an image is encoded once (JPEG quality 60, at most
// 1280×800, its aspect kept: `encodeJpeg`) for every viewer that sends it.
//
// Flow, per viewer: one frame in flight. A frame goes when the viewer has acknowledged the last one, the tab has painted
// since, and 100 ms have passed since the viewer's last frame (at most 10 a second, by spacing the deliveries, never by
// the page's rate); the one timer is that spacing's, armed only while a viewer waits for it. So a still page sends its
// latest image and then nothing more, and a slow viewer gets the newest paint at its ack, never a queue. A frame over
// 1 MiB ends the subscription `frame_too_large`, an encoder that fails `producer_failed`; the tab closing ends it
// `tab_closed`, its view destroyed or suspended `view_gone` (the source stopped before the page goes). An ack names the
// outstanding frame: a duplicate is a no-op, a future sequence refused.
//
// Input is a person's (§G): `webContents.sendInputEvent` (text through `insertText`), each press recorded on the tab's
// input seam as the human's first, so the takeover gate reads it as it reads a local person's click (agent/control.ts:
// an agent holding the tab yields it, `human`, and its acting commands wait), never `TabDebugger.send('Input.dispatch…')`,
// which is the agent's (input.ts). Coordinates are the tab's viewport's (DIP), whatever the frame's pixels. Keys and
// buttons held down are released at a blur, at the subscription's close and at its end; one controlling subscription per
// tab (`control_busy`). Sequences are taken once within a subscription; nothing carries over to another.
import type { MouseInputEvent, MouseWheelInputEvent, NativeImage, WebContents } from 'electron';
import { BROWSER_LIMITS, type BrowserEndReason, type BrowserInput } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { TabEntry, TabStore } from './tabs';

export const SCREENCAST_JPEG_QUALITY = 60;
export const SCREENCAST_SPACING_MS = 1_000 / BROWSER_LIMITS.fps;

// A tab's paints: `start` subscribes (and asks for a first paint, so a still page has an image), `stop` ends it
export interface FrameSource<Image> {
  start(paint: (image: Image) => void): void;
  stop(): void;
}

export interface EncodedFrame {
  jpeg: Uint8Array;
  width: number; // JPEG pixels
  height: number;
}

// A frame as the producer hands it on (`mawsd` stamps the epoch)
export interface ProducedFrame {
  tabId: string;
  seq: number;
  capturedAt: number; // this process's monotonic ms at the paint
  width: number;
  height: number;
  viewport: { width: number; height: number }; // the tab's input coordinates (DIP)
  jpeg: Uint8Array;
}

export interface ScreencastDeps<Image = NativeImage> {
  store: Pick<TabStore, 'entry' | 'onViewDestroying'>;
  source?(entry: TabEntry): FrameSource<Image>; // contentsFrameSource over the tab's view unless a test's
  encode?(image: Image): Promise<EncodedFrame | null>; // encodeJpeg unless a test's; null: an empty image, skipped
  frame(subscriptionId: string, frame: ProducedFrame): void;
  ended(subscriptionId: string, reason: BrowserEndReason): void; // the producer ended it (never at a close asked for)
  now?(): number; // monotonic ms (performance.now)
}

export interface ScreencastInspection {
  tabs: number; // tabs subscribed
  images: number; // newest source images kept (one per subscribed tab at most)
  viewers: { id: string; tabId: string; control: boolean; inFlight: 0 | 1; encoding: 0 | 1; waiting: 0 | 1 }[];
}

export interface Screencast {
  open(input: { subscriptionId: string; appSessionId: AppSessionId; tabId: string; control: boolean }): void; // throws the reason
  ack(appSessionId: AppSessionId, subscriptionId: string, seq: number): void;
  input(appSessionId: AppSessionId, subscriptionId: string, seq: number, event: BrowserInput): void;
  close(appSessionId: AppSessionId, subscriptionId: string): void; // an unknown one: nothing to do
  closeSession(appSessionId: AppSessionId): void; // its drop: every subscription of its tabs closed, no one told
  inspect(): ScreencastInspection;
  dispose(): void;
}

interface Kept<Image> {
  image: Image;
  version: number;
  capturedAt: number;
}

interface Cast<Image> {
  tabId: string;
  entry: TabEntry;
  source: FrameSource<Image>;
  version: number; // paints seen
  latest: Kept<Image> | null;
  encoded: { version: number; frame: Promise<EncodedFrame | null> } | null; // the latest image's encoding, shared
  viewers: Set<Viewer<Image>>;
}

interface Viewer<Image> {
  id: string;
  appSessionId: AppSessionId;
  cast: Cast<Image>;
  control: boolean;
  seq: number; // the last frame sent
  outstanding: boolean; // that frame not yet acknowledged
  sent: number; // the image version last sent, or being encoded
  encoding: boolean;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null; // the spacing's, while it waits
  inputSeq: number;
  keys: Map<string, string>; // held down: code → Electron's key name
  buttons: Map<'left' | 'middle' | 'right', number>; // held down: the button → its click count
  at: { x: number; y: number };
  closed: boolean;
}

// Electron's key names (accelerator codes) for the DOM's `key` values that differ; a printable key is its character
const KEY_NAMES: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' };
const keyName = (key: string) => KEY_NAMES[key] ?? key;
const modifiersOf = (modifiers: string[]) => modifiers.map((modifier) => modifier.toLowerCase());

export function startScreencast<Image = NativeImage>(deps: ScreencastDeps<Image>): Screencast {
  const now = deps.now ?? (() => performance.now());
  const source = deps.source ?? ((entry: TabEntry) => contentsFrameSource(entry.view!.webContents) as unknown as FrameSource<Image>);
  const encode = deps.encode ?? ((image: Image) => encodeJpeg(image as unknown as NativeImage));
  const casts = new Map<string, Cast<Image>>(); // by tab id
  const viewers = new Map<string, Viewer<Image>>();

  // ---- frames -------------------------------------------------------------------------------------------------------

  const encodedOf = (cast: Cast<Image>, kept: Kept<Image>): Promise<EncodedFrame | null> => {
    if (cast.encoded?.version !== kept.version) cast.encoded = { version: kept.version, frame: encode(kept.image) };
    return cast.encoded.frame;
  };

  function pump(viewer: Viewer<Image>): void {
    const { cast } = viewer;
    const kept = cast.latest;
    if (viewer.closed || viewer.outstanding || viewer.encoding || viewer.timer || !kept || kept.version <= viewer.sent) return;
    const wait = viewer.lastSentAt + SCREENCAST_SPACING_MS - now();
    if (wait > 0) {
      viewer.timer = setTimeout(() => {
        viewer.timer = null;
        pump(viewer);
      }, wait);
      return;
    }
    viewer.encoding = true;
    viewer.sent = kept.version;
    encodedOf(cast, kept).then(
      (encoded) => {
        viewer.encoding = false;
        if (viewer.closed) return;
        if (encoded === null) return pump(viewer); // an empty image: the next paint's
        if (encoded.jpeg.byteLength > BROWSER_LIMITS.frameBytes) return end(viewer, 'frame_too_large');
        viewer.seq += 1;
        viewer.outstanding = true;
        viewer.lastSentAt = now();
        const { width, height } = cast.entry.view?.getBounds() ?? { width: 0, height: 0 };
        deps.frame(viewer.id, { tabId: cast.tabId, seq: viewer.seq, capturedAt: kept.capturedAt, width: encoded.width, height: encoded.height, viewport: { width, height }, jpeg: encoded.jpeg });
      },
      () => {
        viewer.encoding = false;
        if (!viewer.closed) end(viewer, 'producer_failed');
      },
    );
  }

  const paint = (cast: Cast<Image>) => (image: Image) => {
    if (casts.get(cast.tabId) !== cast) return;
    cast.latest = { image, version: ++cast.version, capturedAt: now() };
    for (const viewer of [...cast.viewers]) pump(viewer);
  };

  // ---- the subscription's end ---------------------------------------------------------------------------------------

  // Its timer cleared, its held input released (unless the page is going), and its tab's source stopped with the last
  function finish(viewer: Viewer<Image>, release: boolean): void {
    if (viewer.closed) return;
    if (release) releaseHeld(viewer);
    viewer.closed = true;
    if (viewer.timer) clearTimeout(viewer.timer);
    viewer.timer = null;
    viewers.delete(viewer.id);
    const { cast } = viewer;
    cast.viewers.delete(viewer);
    if (cast.viewers.size > 0 || casts.get(cast.tabId) !== cast) return;
    casts.delete(cast.tabId);
    cast.latest = null;
    cast.encoded = null;
    cast.source.stop();
  }

  function end(viewer: Viewer<Image>, reason: BrowserEndReason): void {
    if (viewer.closed) return;
    finish(viewer, true);
    deps.ended(viewer.id, reason);
  }

  // The view going: the source stopped at once (before the page closes); then, the store settled, why
  const offViews = deps.store.onViewDestroying((entry) => {
    const cast = casts.get(entry.tab.tabId);
    if (!cast || cast.entry !== entry) return;
    const going = [...cast.viewers];
    for (const viewer of going) finish(viewer, false);
    queueMicrotask(() => {
      const reason: BrowserEndReason = deps.store.entry(entry.tab.tabId) === entry ? 'view_gone' : 'tab_closed';
      for (const viewer of going) deps.ended(viewer.id, reason);
    });
  });

  // ---- input --------------------------------------------------------------------------------------------------------

  const contentsOf = (viewer: Viewer<Image>): WebContents | null => {
    const contents = viewer.cast.entry.view?.webContents ?? null;
    return contents && !contents.isDestroyed() ? contents : null;
  };

  // What the person did, on the tab's input seam, before the page has it: the takeover gate's reading (control.ts)
  const person = (viewer: Viewer<Image>, kind: 'key' | 'mouse' | 'wheel') => viewer.cast.entry.input.emit({ kind, source: 'human', at: Date.now() });

  function releaseHeld(viewer: Viewer<Image>): void {
    const contents = contentsOf(viewer);
    const keys = [...viewer.keys.values()];
    const buttons = [...viewer.buttons];
    viewer.keys.clear();
    viewer.buttons.clear();
    if (!contents) return;
    for (const keyCode of keys) contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [] });
    for (const [button, clickCount] of buttons) contents.sendInputEvent({ type: 'mouseUp', x: viewer.at.x, y: viewer.at.y, button, clickCount, modifiers: [] } as MouseInputEvent);
  }

  function inject(viewer: Viewer<Image>, event: BrowserInput): void {
    if (event.kind === 'blur') return releaseHeld(viewer);
    const contents = contentsOf(viewer);
    if (!contents) throw new Error('view_gone');
    switch (event.kind) {
      case 'pointer': {
        const x = Math.round(event.x);
        const y = Math.round(event.y);
        viewer.at = { x, y };
        const modifiers = modifiersOf(event.modifiers) as MouseInputEvent['modifiers'];
        if (event.type === 'move') return contents.sendInputEvent({ type: 'mouseMove', x, y, modifiers });
        person(viewer, 'mouse');
        if (event.type === 'down') viewer.buttons.set(event.button, event.clickCount);
        else viewer.buttons.delete(event.button);
        return contents.sendInputEvent({ type: event.type === 'down' ? 'mouseDown' : 'mouseUp', x, y, button: event.button, clickCount: event.clickCount, modifiers });
      }
      case 'wheel': {
        person(viewer, 'wheel');
        // the DOM's sense (positive scrolls right and down) is Chromium's wheel delta negated
        const wheel: MouseWheelInputEvent = { type: 'mouseWheel', x: Math.round(event.x), y: Math.round(event.y), deltaX: -event.deltaX, deltaY: -event.deltaY, modifiers: modifiersOf(event.modifiers) as MouseWheelInputEvent['modifiers'] };
        return contents.sendInputEvent(wheel);
      }
      case 'key': {
        const keyCode = keyName(event.key);
        const modifiers = [...modifiersOf(event.modifiers), ...(event.repeat ? ['isAutoRepeat'] : [])] as MouseInputEvent['modifiers'];
        if (event.type === 'down') {
          person(viewer, 'key');
          viewer.keys.set(event.code || event.key, keyCode);
        } else viewer.keys.delete(event.code || event.key);
        return contents.sendInputEvent({ type: event.type === 'down' ? 'keyDown' : 'keyUp', keyCode, modifiers });
      }
      case 'text':
        person(viewer, 'key');
        return void contents.insertText(event.text).catch(() => {});
    }
  }

  // ---- the operations -----------------------------------------------------------------------------------------------

  const viewerOf = (appSessionId: AppSessionId, subscriptionId: string): Viewer<Image> => {
    const viewer = viewers.get(subscriptionId);
    if (!viewer || viewer.appSessionId !== appSessionId) throw new Error(`no subscription ${subscriptionId} of this session`);
    return viewer;
  };

  return {
    open({ subscriptionId, appSessionId, tabId, control }) {
      if (viewers.has(subscriptionId)) throw new Error(`subscription ${subscriptionId} is open already`);
      const entry = deps.store.entry(tabId);
      if (!entry || entry.tab.appSessionId !== appSessionId) throw new Error('tab_closed');
      if (!entry.view) throw new Error('view_gone');
      let cast = casts.get(tabId);
      if (control && cast && [...cast.viewers].some((viewer) => viewer.control)) throw new Error('control_busy');
      if (!cast) {
        const made: Cast<Image> = { tabId, entry, source: source(entry), version: 0, latest: null, encoded: null, viewers: new Set() };
        casts.set(tabId, made);
        try {
          made.source.start(paint(made));
        } catch (error) {
          casts.delete(tabId);
          throw new Error('producer_failed', { cause: error });
        }
        cast = made;
      }
      const viewer: Viewer<Image> = { id: subscriptionId, appSessionId, cast, control, seq: 0, outstanding: false, sent: 0, encoding: false, lastSentAt: Number.NEGATIVE_INFINITY, timer: null, inputSeq: 0, keys: new Map(), buttons: new Map(), at: { x: 0, y: 0 }, closed: false };
      viewers.set(subscriptionId, viewer);
      cast.viewers.add(viewer);
      pump(viewer); // a tab already painting: its newest image at once
    },
    ack(appSessionId, subscriptionId, seq) {
      const viewer = viewerOf(appSessionId, subscriptionId);
      if (seq > viewer.seq) throw new Error(`ack ${seq} is a future sequence (the last frame sent is ${viewer.seq})`);
      if (!viewer.outstanding || seq !== viewer.seq) return; // a duplicate
      viewer.outstanding = false;
      pump(viewer);
    },
    input(appSessionId, subscriptionId, seq, event) {
      const viewer = viewerOf(appSessionId, subscriptionId);
      if (!viewer.control) throw new Error('read_only');
      if (seq <= viewer.inputSeq) return; // taken already
      viewer.inputSeq = seq;
      inject(viewer, event);
    },
    close(appSessionId, subscriptionId) {
      const viewer = viewers.get(subscriptionId);
      if (viewer?.appSessionId === appSessionId) finish(viewer, true);
    },
    closeSession(appSessionId) {
      for (const viewer of [...viewers.values()]) if (viewer.appSessionId === appSessionId) finish(viewer, true);
    },
    inspect: () => ({
      tabs: casts.size,
      images: [...casts.values()].filter((cast) => cast.latest !== null).length,
      viewers: [...viewers.values()].map((viewer) => ({ id: viewer.id, tabId: viewer.cast.tabId, control: viewer.control, inFlight: viewer.outstanding ? 1 : 0, encoding: viewer.encoding ? 1 : 0, waiting: viewer.timer ? 1 : 0 })),
    }),
    dispose() {
      offViews();
      for (const viewer of [...viewers.values()]) finish(viewer, true);
    },
  };
}

// ---- Electron's frame subscription and the JPEG encoder ---------------------------------------------------------------

// The tab's paints through `beginFrameSubscription` (every frame, not only the damaged rect), and one paint asked for at
// the start so a still page has an image; a page already destroyed has nothing to stop
export function contentsFrameSource(contents: WebContents): FrameSource<NativeImage> {
  return {
    start(paint) {
      contents.beginFrameSubscription(false, (image) => paint(image));
      contents.invalidate();
    },
    stop() {
      if (!contents.isDestroyed()) contents.endFrameSubscription();
    },
  };
}

// At most 1280×800, its aspect kept, at quality 60; null for an empty image (a page not yet laid out)
export async function encodeJpeg(image: NativeImage): Promise<EncodedFrame | null> {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return null;
  const scale = Math.min(1, BROWSER_LIMITS.frameWidth / size.width, BROWSER_LIMITS.frameHeight / size.height);
  const fitted = scale < 1 ? image.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), quality: 'good' }) : image;
  const jpeg = fitted.toJPEG(SCREENCAST_JPEG_QUALITY);
  const { width, height } = fitted.getSize();
  return { jpeg: new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength), width, height };
}
