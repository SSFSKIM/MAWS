// E2 (M4): a PDF deliverable's frame (Design §3 "The PDF frame", Decision Log 31): Chromium's own PDF viewer draws the
// scheme URL, and it instantiates in no sandboxed frame, so this frame alone carries no `sandbox` attribute. It is still
// its record's own origin under main's frame policies (requests, navigations and downloads judged by the frame's
// ancestry). The viewer gives it only to a version `bodyOf` types `application/pdf`, and remounts it rather than
// re-pointing it.
// P3-L (M5b): shared with the artifact store's File viewer (`owner` names its data attribute; `onLoad`: on screen).
import type { FrameOwner } from './HtmlFrame';

export function PdfFrame({ url, title, owner = 'deliverable', onLoad }: { url: string; title: string; owner?: FrameOwner; onLoad?(): void }) {
  return <iframe {...{ [`data-${owner}-frame`]: 'pdf' }} src={url} title={title} referrerPolicy="no-referrer" onLoad={onLoad} className="h-full w-full border-0 bg-bg" />;
}
