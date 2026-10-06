// E2 (M4): an HTML deliverable's frame (Design §3 "The HTML frame"): the scheme URL in an `<iframe>` whose sandbox
// allows scripts and nothing else (no same-origin, no navigation, no popups, no downloads, no forms, no modals); the
// handler's per-answer CSP blocks every request that is not `data:` or `blob:`. The URL is set when the element is
// created and never changed: a version switch or a Reload mounts a new frame (the viewer keys it), so the app never
// points a deliverable frame anywhere but the scheme, which main's frame policies would refuse.
//
// Every mount loads the page afresh, and the page logs afresh, so what the store holds for this version is cleared as
// the frame mounts (before any message of this load can arrive): the chip counts one load, however often the frame is
// mounted again (a version switch and back, Back and reopen, a main tab shown again).
import { useLayoutEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { clearConsole } from '../store';

interface Props {
  url: string;
  title: string;
  appSessionId: AppSessionId;
  deliverableId: string;
  version: number;
}

export function HtmlFrame({ url, title, appSessionId, deliverableId, version }: Props) {
  useLayoutEffect(() => clearConsole(appSessionId, deliverableId, version), [appSessionId, deliverableId, version]);
  return <iframe data-deliverable-frame="html" sandbox="allow-scripts" src={url} title={title} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-bg" />;
}
