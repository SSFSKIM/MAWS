// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"; X27's `CANVAS_CSS`): the stylesheet the
// DOM canvas draws Claude's slide semantics with, outside each element's inline style (which is the model's, property
// for property). E's artboards and M9's standalone page reuse it. Literal values here are the dialect's defaults (a
// slide's own look), not app chrome.
//
// - The slide: 1920×1080, isolated (so the under-layer's z-index:-1 stays inside it), a flex column by default.
// - A div without `display` is a column; margins are zero; text defaults are Claude's (h1–h3 96/64/44 px at 600 and
//   1.1/1.15/1.2, body 32 px at 1.4; font-size and font-weight never inherit into h1–h3).
// - A pinned child listed before the first flow child of the section paints under the flow layer (`data-layer`).
// - The dialect's own elements: x-shape (its outline drawn as an inline SVG; the box itself unpainted unless `rect`),
//   x-icon (a line glyph in its colour), x-connector (a stroked polyline with heads, never a box), x-embed (a sandboxed
//   frame), and the placeholder picture.
export const CANVAS_CSS = `
.maws-slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; isolation: isolate; box-sizing: border-box; display: flex; flex-direction: column; margin: 0;
  background: #ffffff; color: #000000; font-family: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 32px; line-height: 1.4; font-weight: 400; text-align: left; }
.maws-slide div { display: flex; flex-direction: column; }
.maws-slide * { margin: 0; box-sizing: border-box; }
.maws-slide h1 { font-size: 96px; font-weight: 600; line-height: 1.1; }
.maws-slide h2 { font-size: 64px; font-weight: 600; line-height: 1.15; }
.maws-slide h3 { font-size: 44px; font-weight: 600; line-height: 1.2; }
.maws-slide ul, .maws-slide ol { padding-left: 1.25em; }
.maws-slide li { margin: 0; }
.maws-slide a { color: inherit; text-decoration: underline; }
.maws-slide table { border-collapse: collapse; border-spacing: 0; }
.maws-slide th, .maws-slide td { padding: 12px 16px; text-align: left; vertical-align: top; }
.maws-slide th { font-weight: 600; }
.maws-slide hr { border: 0; border-top: 2px solid; height: 0; }
.maws-slide img { display: block; }
.maws-slide img[data-placeholder] { background: repeating-linear-gradient(45deg, #e3e6e4 0 12px, #eef1ef 12px 24px); min-width: 48px; min-height: 48px; }
.maws-slide svg { display: block; overflow: visible; }
.maws-slide [data-layer="under"] { z-index: -1; }
.maws-slide x-shape, .maws-slide x-icon, .maws-slide x-embed { display: block; position: relative; }
.maws-slide x-shape:not([kind="rect"]) { background: none !important; border-style: none !important; box-shadow: none !important; border-radius: 0 !important; }
.maws-slide x-shape > svg, .maws-slide x-connector > svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.maws-slide x-icon { width: 64px; height: 64px; }
.maws-slide x-icon > svg { width: 100%; height: 100%; }
.maws-slide x-connector { display: block; position: relative; border-style: none !important; }
.maws-slide x-connector[x1] { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.maws-slide x-embed > iframe { display: block; width: 100%; height: 100%; border: 0; }
.maws-slide x-embed > [data-embed-placeholder] { width: 100%; height: 100%; background: repeating-linear-gradient(-45deg, #e3e6e4 0 12px, #eef1ef 12px 24px); }
`;
