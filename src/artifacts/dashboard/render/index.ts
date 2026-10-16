// The dashboard's renderer (P3-E2 M3): one pure function from a view spec, a snapshot's rows and the page's theme to
// one output (a chart's SVG or a table's HTML), read alike by the editor, main's exporters and Node.
export { renderView, renderFailure, viewRows, viewPreview, svgSize, captionOf, TABLE_VIEW_ROWS, TABLE_VIEW_MAX_ROWS, type Rendered } from './render';
export { themeFrom, THEME_PROPERTIES, FIGURE_WIDTH, type Theme } from './svg';
export { transform, compareCells, instantOf, typedKey, type ViewColumn, type ViewData, type ViewTable } from './transform';
