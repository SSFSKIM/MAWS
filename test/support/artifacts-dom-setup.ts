// Every happy-dom project's setup (P3-B's `artifacts-dom`, docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Decision
// Log 23; P3-F widened it to the renderer projects, whose library, viewer and editor suites load KaTeX too):
// KaTeX warns once per worker that it "doesn't work in quirks mode" because it reads `document.compatMode`, which
// happy-dom does not implement (a doctype changes nothing); rendering goes through `renderToString`, which that check
// does not touch. That one known environment diagnostic is dropped; every other warning passes through.
const KATEX_QUIRKS = "Warning: KaTeX doesn't work in quirks mode. Make sure your website has a suitable doctype.";
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (args.length === 1 && args[0] === KATEX_QUIRKS) return;
  warn(...args);
};
