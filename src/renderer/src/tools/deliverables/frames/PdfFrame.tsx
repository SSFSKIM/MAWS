// E2 (M4): a PDF deliverable's frame (Design §3 "The PDF frame", Decision Log 31): Chromium's own PDF viewer draws the
// scheme URL, and it instantiates in no sandboxed frame, so this frame alone carries no `sandbox` attribute. It is still
// its record's own origin under main's frame policies (requests, navigations and downloads judged by the frame's
// ancestry). The viewer gives it only to a version `bodyOf` types `application/pdf`, and remounts it rather than
// re-pointing it.
export function PdfFrame({ url, title }: { url: string; title: string }) {
  return <iframe data-deliverable-frame="pdf" src={url} title={title} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-bg" />;
}
