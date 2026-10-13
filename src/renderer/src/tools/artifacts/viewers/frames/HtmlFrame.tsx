// E2 (M4): an HTML deliverable's frame (Design §3 "The HTML frame"): the scheme URL in an `<iframe>` whose sandbox
// allows scripts and nothing else (no same-origin, no navigation, no popups, no downloads, no forms, no modals); the
// handler's per-answer CSP blocks every request that is not `data:` or `blob:`. The URL is set when the element is
// created and never changed: a version switch or a Reload mounts a new frame (the viewer keys it), so the app never
// points a deliverable frame anywhere but the scheme, which main's frame policies would refuse.
//
// Every mount loads the page afresh, and the page logs afresh, so what the store holds for this version is cleared as
// the frame mounts (before any message of this load can arrive): the chip counts one load, however often the frame is
// mounted again (a version switch and back, Back and reopen, a main tab shown again).
//
// E2 (M6), comment mode (Design §10): while `picking`, the frame's page (an artifact's, which carries the bridge
// script) is told to pick (`maws:pick`, again after every load, so a pick asked for before the page loaded still
// reaches it) and the frame's messages are read: those whose source is this frame's window and whose data is a picked
// or a cancelled message, nothing else. When picking ends the page is told so.
//
// P3-L (M5b): moved from the Deliverables tool to be shared with the artifact store's HTML viewer, which frames a
// `maws-artifact:` page; what the viewer keeps per load (a console it clears) is its own `onMount`, and `owner` names
// the frame's data attribute (`data-deliverable-frame` or `data-artifact-frame`). `onLoad` tells the viewer its page is
// on screen.
//
// P2-E1 (M3), re-pin (P2-E1 document, D8): the frame hands its parent a handle (`onFrame`) whose `locate(selector)` asks
// the page where an element is now (`maws:locate`, under an id of its own from this frame's counter) and resolves on the
// `maws:located` echoing that id from this frame's own window, or null `LOCATE_TIMEOUT_MS` after the post (a page that
// blocks its main thread, or one without the bridge); an answer after that matches nothing, and two asks of one
// selector in flight each take their own answer.
// The frame is an opaque origin, so a message posted before its load reaches the blank document and is lost: a locate
// waits for this frame's load before posting, and its clock starts at the post. Answers are heard whether or not
// picking is on; the frame going away answers its pending locates with null.
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { CardRect } from '../../../code/anchor/anchor';
import { locateMessage, parseLocatedMessage, parsePickMessage, pickMessage, type PickMessage } from '../pick';

export const LOCATE_TIMEOUT_MS = 1_000;

export interface FrameHandle {
  locate(selector: string): Promise<CardRect | null>;
}

export type FrameOwner = 'deliverable' | 'artifact';

interface Props {
  url: string;
  title: string;
  owner?: FrameOwner; // P3-L: whose frame, for its data attribute (default the Deliverables tool's)
  onMount?(): void; // P3-L: as the frame mounts, before any message of its load can arrive (a console cleared)
  onLoad?(): void; // P3-L: its page loaded
  picking?: boolean;
  onPick?(message: PickMessage): void;
  onFrame?(handle: FrameHandle | null): void; // P2-E1: the locate handle, null once the frame is gone
}

export function HtmlFrame({ url, title, owner = 'deliverable', onMount, onLoad: loaded, picking = false, onPick, onFrame }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const load = useRef({ loaded: false, waiting: new Set<() => void>() }); // P2-E1: what waits for this frame's load
  const mounted = useEffectEvent(() => onMount?.());
  useLayoutEffect(() => mounted(), [url]); // the frame is keyed by its URL: one call per mount
  const picked = useEffectEvent((message: PickMessage) => onPick?.(message));
  useEffect(() => {
    const frame = ref.current;
    if (!picking || !frame) return;
    const tell = (on: boolean) => frame.contentWindow?.postMessage(pickMessage(on), '*'); // an opaque origin has no name to target
    const onLoad = () => tell(true);
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.contentWindow) return;
      const message = parsePickMessage(event.data);
      if (message) picked(message);
    };
    tell(true);
    frame.addEventListener('load', onLoad);
    window.addEventListener('message', onMessage);
    return () => {
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      tell(false);
    };
  }, [picking]);
  // P2-E1 start (2026-10-09): the locate handle (D8)
  const announce = useEffectEvent((handle: FrameHandle | null) => onFrame?.(handle));
  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const { waiting } = load.current;
    const unanswered = new Set<() => void>(); // each pending locate's null answer, for the frame going away
    let asks = 0;
    const locate = (selector: string) =>
      new Promise<CardRect | null>((resolve) => {
        const id = ++asks;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (rect: CardRect | null) => {
          clearTimeout(timer);
          waiting.delete(post);
          unanswered.delete(gone);
          window.removeEventListener('message', onMessage);
          resolve(rect);
        };
        const gone = () => finish(null);
        const onMessage = (event: MessageEvent) => {
          if (event.source === null || event.source !== frame.contentWindow) return;
          const message = parseLocatedMessage(event.data);
          if (message?.id === id && message.selector === selector) finish(message.rect);
        };
        const post = () => {
          waiting.delete(post);
          window.addEventListener('message', onMessage);
          frame.contentWindow?.postMessage(locateMessage(id, selector), '*'); // an opaque origin has no name to target
          timer = setTimeout(gone, LOCATE_TIMEOUT_MS);
        };
        unanswered.add(gone);
        if (load.current.loaded) post();
        else waiting.add(post);
      });
    announce({ locate });
    return () => {
      announce(null);
      for (const gone of [...unanswered]) gone();
    };
  }, []);
  const onLoad = () => {
    load.current.loaded = true;
    for (const post of [...load.current.waiting]) post();
    loaded?.();
  };
  // P2-E1 end
  return <iframe ref={ref} {...{ [`data-${owner}-frame`]: 'html' }} sandbox="allow-scripts" src={url} title={title} referrerPolicy="no-referrer" onLoad={onLoad} className="h-full w-full border-0 bg-bg" />;
}
