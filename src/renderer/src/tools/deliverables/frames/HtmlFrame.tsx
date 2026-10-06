// E2 (M4): an HTML deliverable's frame (Design §3 "The HTML frame"): the scheme URL in an `<iframe>` whose sandbox
// allows scripts and nothing else (no same-origin, no navigation, no popups, no downloads, no forms, no modals); the
// handler's per-answer CSP blocks every request that is not `data:` or `blob:`. The URL is set when the element is
// created and never changed: a version switch or a Reload mounts a new frame (the viewer keys it), so the app never
// points a deliverable frame anywhere but the scheme, which main's frame policies would refuse.
export function HtmlFrame({ url, title }: { url: string; title: string }) {
  return <iframe data-deliverable-frame="html" sandbox="allow-scripts" src={url} title={title} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-bg" />;
}
