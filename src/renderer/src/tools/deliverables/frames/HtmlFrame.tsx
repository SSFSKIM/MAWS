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
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { parsePickMessage, pickMessage, type PickMessage } from '../comment/pick';
import { clearConsole } from '../store';

interface Props {
  url: string;
  title: string;
  appSessionId: AppSessionId;
  deliverableId: string;
  version: number;
  picking?: boolean;
  onPick?(message: PickMessage): void;
}

export function HtmlFrame({ url, title, appSessionId, deliverableId, version, picking = false, onPick }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => clearConsole(appSessionId, deliverableId, version), [appSessionId, deliverableId, version]);
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
  return <iframe ref={ref} data-deliverable-frame="html" sandbox="allow-scripts" src={url} title={title} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-bg" />;
}
