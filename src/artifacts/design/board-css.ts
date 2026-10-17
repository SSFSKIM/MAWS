// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, "Execution constraints"; the parent's §1 "The
// workbench"): a design board's own type defaults, screen type rather than a slide's. The dialect is one and its
// defaults are per kind: C's `CANVAS_CSS` keeps a slide's (body 32 px, h1–h3 96/64/44), and a board, which C's canvas
// marks `data-board` once its node carries a size, reads these after it (body 16 px at 1.5, h1–h3 32/24/20 px at 600).
// A portable string, so the workbench and the design's exporter (M5) draw a board with the same defaults; an element's
// own inline size always wins. Literal values are the dialect's defaults for a screen, not app chrome.
export const BOARD_CSS = `
.maws-slide[data-board] { font-size: 16px; line-height: 1.5; }
.maws-slide[data-board] h1 { font-size: 32px; font-weight: 600; line-height: 1.2; }
.maws-slide[data-board] h2 { font-size: 24px; font-weight: 600; line-height: 1.25; }
.maws-slide[data-board] h3 { font-size: 20px; font-weight: 600; line-height: 1.3; }
`;
